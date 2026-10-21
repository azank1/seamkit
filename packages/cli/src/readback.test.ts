import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeProduction } from '@seamkit/adapters';
import { git } from '@seamkit/state';
import { run, type Io } from './cli.js';

const AT = '2026-10-14T09:00:00.000Z';
const ID = ['-c', 'user.name=dev', '-c', 'user.email=dev@example.invalid'];

let root: string;
let prod: FakeProduction;
let counter = 0;

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'seamkit-readback-test-'));
  const emptyConfig = join(root, 'gitconfig');
  await writeFile(emptyConfig, '');
  process.env['GIT_CONFIG_GLOBAL'] = emptyConfig;
  process.env['GIT_CONFIG_NOSYSTEM'] = '1';
  prod = await FakeProduction.start({ spaFallback: true });
});

after(async () => {
  await prod.close();
  await rm(root, { recursive: true, force: true });
});

async function cli(args: string[], cwd: string, env: Record<string, string> = {}): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const io: Io = { out: (t) => void (out += t), err: (t) => void (err += t), readStdin: async () => '', stdinIsTTY: true, env, cwd, now: () => AT };
  return { code: await run(args, io), out, err };
}

/**
 * A repository with two merged pull requests and one direct commit. The first merge has GitHub's
 * default message, which holds no description; the second has the form that "Pull request title
 * and description" writes, and carries a card unless `card` is false.
 */
async function repo(options: { card?: boolean } = {}): Promise<{ dir: string; merges: string[]; direct: string }> {
  const dir = join(root, `repo-${++counter}`);
  await git(['init', '-q', '-b', 'main', dir], { cwd: root });
  await writeFile(join(dir, 'README.md'), 'x\n');
  await git(['add', 'README.md'], { cwd: dir });
  await git([...ID, 'commit', '-q', '-m', 'Initial commit'], { cwd: dir });
  const merges: string[] = [];
  const card = '```seamkit-card\ncard: 1\nintent: Add the badge.\nlayers: [frontend]\ntargets: [web]\nmarkers:\n  - kind: bundle\n    text: "sync-badge-v2"\n```';
  for (const [n, message] of [
    [1, 'Merge pull request #1 from agent/b1\n\nChange 1'],
    [2, `Change 2 (#2)\n\nAdds the badge.\n\n${options.card === false ? '' : card}`],
  ] as const) {
    await git(['switch', '-q', '-c', `b${n}`, 'main'], { cwd: dir });
    await writeFile(join(dir, `f${n}.txt`), `${n}\n`);
    await git(['add', `f${n}.txt`], { cwd: dir });
    await git([...ID, 'commit', '-q', '-m', `change ${n}`], { cwd: dir });
    await git(['switch', '-q', 'main'], { cwd: dir });
    await git([...ID, 'merge', '-q', '--no-ff', '-m', message, `b${n}`], { cwd: dir });
    merges.push(await git(['rev-parse', 'HEAD'], { cwd: dir }));
  }
  await writeFile(join(dir, 'f3.txt'), '3\n');
  await git(['add', 'f3.txt'], { cwd: dir });
  await git([...ID, 'commit', '-q', '-m', 'fix: a typo'], { cwd: dir });
  const direct = await git(['rev-parse', 'HEAD'], { cwd: dir });
  return { dir, merges, direct };
}

const deploy = (commit: string, script = 'el.id = "sync-badge-v2";'): void =>
  prod.deploy({
    'index.html': '<!doctype html><script src="/app.js"></script>',
    'app.js': script,
    'version.json': JSON.stringify({ schema: 'seamkit.version/1', commit, dirty: false, source: 'git' }),
  });

describe('seamkit readback', () => {
  it('proves each change by version, and by its card where it has one', async () => {
    const { dir, merges, direct } = await repo();
    deploy(direct);
    const r = await cli(['readback', '--url', prod.url, '--json'], dir);
    assert.equal(r.code, 0, r.err);
    const out = JSON.parse(r.out);
    assert.deepEqual(
      out.verdicts.map((v: { subject: string; state?: string }) => `${v.subject} ${v.state ?? ''}`),
      ['main ', `commit:${direct.slice(0, 12)} live`, 'pr#2 live', 'pr#1 live', 'commit:' + (await git(['rev-list', '--max-parents=0', 'HEAD'], { cwd: dir })).slice(0, 12) + ' live'],
    );
    assert.ok(out.verdicts[2].reasons.some((x: string) => x.startsWith('marker "sync-badge-v2" found')));
    assert.equal(merges.length, 2);
  });

  it('fails a change merged after the running build, and says so in its exit code', async () => {
    const { dir, merges } = await repo();
    deploy(merges[0] as string, '');
    const r = await cli(['readback', '--url', prod.url], dir);
    assert.equal(r.code, 1);
    assert.match(r.out, /NOT PROVEN {2}2 of 4 {2}\(2 fail\)/);
    assert.match(r.out, /proven live 2 of 4 changes/);
    assert.match(r.err, /not recorded \(no seamkit\/state branch/);
  });

  it('reads back one pull request, or one commit', async () => {
    const { dir, merges } = await repo();
    deploy(merges[1] as string);
    const one = await cli(['readback', '--url', prod.url, '--pr', '2', '--json'], dir);
    assert.equal(one.code, 0);
    assert.deepEqual(JSON.parse(one.out).verdicts.map((v: { subject: string }) => v.subject), ['pr#2', 'pr#2']);
    const missing = await cli(['readback', '--url', prod.url, '--pr', '9', '--json'], dir);
    assert.equal(missing.code, 3);
    assert.match(JSON.parse(missing.out).verdicts[0].notExamined[0].reason, /not among the last 4 changes on main; it may not be merged yet/);
    const byCommit = await cli(['readback', '--url', prod.url, '--commit', (merges[0] as string).slice(0, 10), '--json'], dir);
    assert.equal(byCommit.code, 0);
    assert.equal(JSON.parse(byCommit.out).verdicts[1].subject, 'pr#1');
  });

  it('records the run when the ledger exists, and replays it', async () => {
    const { dir, merges } = await repo();
    deploy(merges[1] as string);
    assert.equal((await cli(['state', 'init'], dir)).code, 0);
    const r = await cli(['readback', '--url', prod.url], dir);
    assert.match(r.err, /recorded as event [0-9a-f]{12} on seamkit\/state/);
    assert.equal((await cli(['replay'], dir)).code, 0);
  });

  it('refuses URLs that would put secrets in the ledger, and needs a URL', async () => {
    const { dir } = await repo();
    for (const [url, message] of [
      [`${prod.url}?token=abc`, /must not carry a query string/],
      ['https://user:pw@notes.example/', /must not contain a user name or password/],
      ['ftp://notes.example/', /must be an http or https URL/],
    ] as const) {
      const r = await cli(['readback', '--url', url], dir);
      assert.equal(r.code, 2);
      assert.match(r.err, message);
    }
    assert.match((await cli(['readback'], dir)).err, /give the production URL with --url, or set SEAMKIT_URL/);
    assert.match((await cli(['readback', '--url', prod.url, '--pr', '1', '--commit', 'HEAD'], dir)).err, /cannot be combined/);
    assert.match((await cli(['readback', '--url', prod.url, '--last', '0'], dir)).err, /--last must be a whole number from 1 to 1000/);
  });

  it('leaves changes merged after the deployed commit to the next deploy, when a ledger was read', async () => {
    const { dir, merges } = await repo();
    assert.equal((await cli(['state', 'init'], dir)).code, 0);
    deploy(merges[0] as string);
    const r = await cli(['readback', '--url', prod.url, '--deployed', merges[0] as string, '--json'], dir);
    assert.equal(r.code, 0, r.err);
    const out = JSON.parse(r.out);
    const [summary, ...parts] = out.verdicts;
    assert.deepEqual(parts.map((v: { subject: string; state: string }) => `${v.subject} ${v.state}`)[0], 'pr#1 live');
    assert.equal(parts.length, 2);
    const gap = summary.notExamined.find((g: { item: string }) => / merged after the deployed commit /.test(g.item));
    assert.equal(gap.item, `2 changes merged after the deployed commit ${(merges[0] as string).slice(0, 12)}`);
    assert.match(gap.reason, /^no recorded run saw them live at this address, so the next deploy proves them: commit:[0-9a-f]{12}, pr#2$/);
    assert.deepEqual(out.production, { url: `${prod.url}version.json`, status: 'ok', commit: merges[0], reported: merges[0] });
  });

  it('judges every change when no ledger was read, because a rollback looks the same', async () => {
    const { dir, merges } = await repo();
    deploy(merges[0] as string);
    const r = await cli(['readback', '--url', prod.url, '--deployed', merges[0] as string, '--json'], dir);
    assert.equal(r.code, 1);
    const summary = JSON.parse(r.out).verdicts[0];
    assert.ok(summary.notExamined.some((g: { item: string; reason: string }) => g.item === 'whether changes merged after the deployed commit are still on their way' && /no ledger was read/.test(g.reason)));
  });

  it('keeps a change in scope only for a sighting at this address', async () => {
    const { dir, merges, direct } = await repo();
    assert.equal((await cli(['state', 'init'], dir)).code, 0);
    const staging = await FakeProduction.start({ spaFallback: true });
    try {
      staging.deploy({
        'index.html': '<!doctype html><script src="/app.js"></script>',
        'app.js': 'el.id = "sync-badge-v2";',
        'version.json': JSON.stringify({ schema: 'seamkit.version/1', commit: direct, dirty: false, source: 'git' }),
      });
      assert.equal((await cli(['readback', '--url', staging.url], dir)).code, 0);
    } finally {
      await staging.close();
    }
    deploy(merges[0] as string, '');
    const r = await cli(['readback', '--url', prod.url, '--deployed', merges[0] as string], dir);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /not examined: 2 changes merged after the deployed commit/);
  });

  it('folds any number of changes left to the next deploy into one gap', async () => {
    const { dir, direct } = await repo();
    assert.equal((await cli(['state', 'init'], dir)).code, 0);
    for (let i = 0; i < 150; i++) await git([...ID, 'commit', '-q', '--allow-empty', '-m', `step ${i}`], { cwd: dir });
    deploy(direct);
    const r = await cli(['readback', '--url', prod.url, '--last', '200', '--deployed', direct, '--json'], dir);
    assert.equal(r.code, 0, r.err);
    const gap = JSON.parse(r.out).verdicts[0].notExamined.find((g: { item: string }) => / merged after the deployed commit /.test(g.item));
    assert.match(gap.item, /^150 changes merged after/);
    assert.match(gap.reason, /and 130 more$/);
  });

  it('still fails a deploy that drops a change an earlier run saw live', async () => {
    const { dir, merges, direct } = await repo();
    assert.equal((await cli(['state', 'init'], dir)).code, 0);
    deploy(direct);
    assert.equal((await cli(['readback', '--url', prod.url], dir)).code, 0);
    deploy(merges[0] as string, '');
    const r = await cli(['readback', '--url', prod.url, '--deployed', merges[0] as string], dir);
    assert.equal(r.code, 1);
    assert.match(r.out, /NOT LIVE {2}2 of 4/);
  });

  it('refuses a deployed commit the repository does not have', async () => {
    const { dir } = await repo();
    const r = await cli(['readback', '--url', prod.url, '--deployed', 'f'.repeat(40)], dir);
    assert.equal(r.code, 2);
    assert.match(r.err, /there is no commit called f{40} in this repository; fetch it/);
    assert.match((await cli(['readback', '--url', prod.url, '--deployed='], dir)).err, /--deployed needs a commit/);
  });

  it('finds a branch that a clone has only as origin/<name>', async () => {
    const { dir, direct } = await repo();
    await git(['branch', 'release', 'HEAD~1'], { cwd: dir });
    const clone = join(root, `clone-${++counter}`);
    await git(['clone', '-q', dir, clone], { cwd: root });
    deploy(direct);
    const r = await cli(['readback', '--url', prod.url, '--branch', 'release', '--json'], clone);
    assert.equal(r.code, 0, r.err);
    assert.equal(JSON.parse(r.out).verdicts[0].subject, 'release');
    assert.equal((await cli(['readback', '--url', prod.url, '--branch', 'nope'], clone)).code, 2);
  });

  it('takes the URL from SEAMKIT_URL', async () => {
    const { dir, direct } = await repo();
    deploy(direct);
    assert.equal((await cli(['readback'], dir, { SEAMKIT_URL: prod.url })).code, 0);
  });
});

describe('seamkit audit', () => {
  it('examines nothing when production does not say what it runs, and says how to fix that', async () => {
    const { dir } = await repo();
    // The page holds the card's marker, so only the changes without a card are left unexamined.
    prod.deploy({ 'index.html': '<!doctype html><title>notes</title><p id="sync-badge-v2"></p>' });
    const r = await cli(['audit', '--url', prod.url], dir);
    assert.equal(r.code, 3);
    assert.match(r.out, /LIVE {2}1 of 4/);
    assert.match(r.out, /Production does not say which version it runs \(production serves no version document/);
    assert.match(r.out, /seamkit stamp --out <your public directory>\/version\.json/);
    assert.match(r.out, /There is no ledger yet\. Run "seamkit state init"/);
  });

  it('says how a card reaches the history when it finds none', async () => {
    const { dir, direct } = await repo({ card: false });
    deploy(direct);
    const r = await cli(['audit', '--url', prod.url], dir);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /No change carries a seamkit-card/);
    assert.match(r.out, /"Pull request title and description"/);
  });

  it('is for the last changes only', async () => {
    const { dir } = await repo();
    assert.equal((await cli(['audit', '--url', prod.url, '--pr', '1'], dir)).code, 2);
  });
});

describe('seamkit stamp', () => {
  it('stamps the checked-out commit and knows a clean tree from a dirty one', async () => {
    const { dir, direct } = await repo();
    const clean = await cli(['stamp'], dir);
    assert.equal(clean.code, 0);
    assert.deepEqual(JSON.parse(clean.out), { schema: 'seamkit.version/1', commit: direct, dirty: false, source: 'git', ref: 'main', builtAt: AT });

    // Its own output does not make the tree dirty.
    const written = await cli(['stamp', '--out', 'public/version.json'], dir);
    assert.equal(written.code, 0);
    assert.match(written.err, /: [0-9a-f]{12} from git, clean/);
    assert.equal(JSON.parse(await readFile(join(dir, 'public/version.json'), 'utf8')).dirty, false);

    await writeFile(join(dir, 'f1.txt'), 'edited\n');
    const dirty = await cli(['stamp', '--out', 'public/version.json'], dir);
    assert.equal(JSON.parse(await readFile(join(dir, 'public/version.json'), 'utf8')).dirty, true);
    assert.match(dirty.err, /warning: 1 uncommitted change \(such as f1\.txt\)/);
    // A stamp written elsewhere earlier is an uncommitted file like any other.
    assert.match((await cli(['stamp'], dir)).err, /warning: 2 uncommitted changes/);
    const refused = await cli(['stamp', '--require-clean', '--out', 'v.json'], dir);
    assert.equal(refused.code, 1);
    await assert.rejects(readFile(join(dir, 'v.json')));
  });

  it('falls back to the CI variable outside a repository, and refuses to guess', async () => {
    const plain = await mkdtemp(join(root, 'plain-'));
    const sha = 'c'.repeat(40);
    const r = await cli(['stamp'], plain, { VERCEL_GIT_COMMIT_SHA: sha });
    assert.equal(r.code, 0);
    assert.deepEqual(JSON.parse(r.out), { schema: 'seamkit.version/1', commit: sha, source: 'env:VERCEL_GIT_COMMIT_SHA', builtAt: AT });
    const none = await cli(['stamp'], plain);
    assert.equal(none.code, 2);
    assert.match(none.err, /cannot tell which commit this build is from/);
    assert.equal((await cli(['stamp', '--commit', 'abc'], plain)).code, 2);
  });

  it('writes what readback reads', async () => {
    const { dir, direct } = await repo();
    const stamp = JSON.parse((await cli(['stamp'], dir)).out);
    prod.deploy({ 'index.html': '<!doctype html>', 'version.json': JSON.stringify(stamp) });
    const r = await cli(['readback', '--url', prod.url, '--commit', direct, '--json'], dir);
    assert.equal(r.code, 0);
    assert.equal(JSON.parse(r.out).verdicts[1].state, 'live');
  });
});
