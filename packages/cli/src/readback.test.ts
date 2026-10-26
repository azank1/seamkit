import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeProduction } from '@seamkit/adapters';
import { git } from '@seamkit/state';
import { execFileSync } from 'node:child_process';
import { run, type Io } from './cli.js';
import { gatherReadback } from './readback.js';
import { markerKey } from '@seamkit/core';

const AT = '2026-10-14T09:00:00.000Z';
const MAIN = fileURLToPath(new URL('./main.js', import.meta.url));
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

async function cli(args: string[], cwd: string, env: Record<string, string> = {}, at = AT): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const io: Io = { out: (t) => void (out += t), err: (t) => void (err += t), readStdin: async () => '', stdinIsTTY: true, env, cwd, now: () => at };
  return { code: await run(args, io), out, err };
}

/**
 * A repository with two merged pull requests and one direct commit. The first merge has GitHub's
 * default message, which holds no description; the second has the form that "Pull request title
 * and description" writes, and carries a card unless `card` is false.
 */
async function repo(options: { card?: boolean | string } = {}): Promise<{ dir: string; merges: string[]; direct: string }> {
  const dir = join(root, `repo-${++counter}`);
  await git(['init', '-q', '-b', 'main', dir], { cwd: root });
  await writeFile(join(dir, 'README.md'), 'x\n');
  await git(['add', 'README.md'], { cwd: dir });
  await git([...ID, 'commit', '-q', '-m', 'Initial commit'], { cwd: dir });
  const merges: string[] = [];
  const card = '```seamkit-card\ncard: 1\nintent: Add the badge.\nlayers: [frontend]\ntargets: [web]\nmarkers:\n  - kind: bundle\n    text: "sync-badge-v2"\n```';
  for (const [n, message] of [
    [1, 'Merge pull request #1 from agent/b1\n\nChange 1'],
    [2, `Change 2 (#2)\n\nAdds the badge.\n\n${options.card === false ? '' : typeof options.card === 'string' ? `\`\`\`seamkit-card\n${options.card}\n\`\`\`` : card}`],
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
    // A run kept out of the ledger says so, not that there is no ledger.
    assert.equal((await cli(['readback', '--url', prod.url, '--no-record'], dir)).err, 'not recorded (--no-record)\n');
    // --no-ledger judges as if there were none, records nothing, and says why.
    const off = await cli(['readback', '--url', prod.url, '--no-ledger', '--deployed', merges[1] as string], dir);
    assert.equal(off.err, 'not recorded (--no-ledger)\n');
    assert.match(off.out, /the ledger was not read \(--no-ledger\), so/);
    assert.doesNotMatch(off.out, /seamkit state init/);
    assert.equal((await cli(['readback', '--url', prod.url, '--no-ledger', '--record'], dir)).code, 2);
    assert.equal((await cli(['audit', '--url', prod.url, '--no-ledger'], dir)).code, 2);
    const events = await git(['ls-tree', '-r', '--name-only', 'seamkit/state', 'events/'], { cwd: dir });
    assert.equal(events.split('\n').length, 1);
  });

  it('cites the latest run that saw a change live, also when that run read the version document at another path', async () => {
    for (const later of ['version.json', 'api/version']) {
      const { dir, merges, direct } = await repo({ card: false });
      assert.equal((await cli(['state', 'init'], dir)).code, 0);
      const build = (commit: string, path: string): void =>
        prod.deploy({ 'index.html': '<!doctype html>', [path]: JSON.stringify({ schema: 'seamkit.version/1', commit, dirty: false, source: 'git' }) });
      const event = (err: string): string => /recorded as event ([0-9a-f]{12})/.exec(err)?.[1] ?? assert.fail(err);
      build(direct, 'version.json');
      event((await cli(['readback', '--url', prod.url], dir, {}, '2026-10-14T09:00:00.000Z')).err);
      build(direct, later);
      const second = event((await cli(['readback', '--url', prod.url], dir, {}, '2026-10-14T09:00:02.000Z')).err);
      build(merges[0] as string, 'version.json');
      const r = await cli(['readback', '--url', prod.url, '--json'], dir, {}, '2026-10-14T09:00:04.000Z');
      const pr2 = JSON.parse(r.out).verdicts.find((v: { subject: string }) => v.subject === 'pr#2');
      assert.equal(pr2.state, 'not_live', r.out);
      assert.ok(pr2.reasons.some((x: string) => x.includes(`it was seen live at 2026-10-14T09:00:02.000Z (event ${second})`)), `${later}: ${JSON.stringify(pr2.reasons)}`);
    }
    // Two runs at the same time are told apart by event id, so every reader cites the same one.
    const { dir, merges, direct } = await repo({ card: false });
    assert.equal((await cli(['state', 'init'], dir)).code, 0);
    deploy(direct, '');
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) ids.push(/recorded as event ([0-9a-f]{12})/.exec((await cli(['readback', '--url', prod.url, '--last', String(2 + i)], dir)).err)?.[1] ?? '');
    deploy(merges[0] as string, '');
    const pr2 = JSON.parse((await cli(['readback', '--url', prod.url, '--json'], dir)).out).verdicts.find((v: { subject: string }) => v.subject === 'pr#2');
    assert.ok(pr2.reasons.some((x: string) => x.includes(`(event ${[...ids].sort()[1]})`)), `${ids.join(' ')}: ${JSON.stringify(pr2.reasons)}`);
  });

  it('refuses URLs that would put secrets in the ledger, and needs a URL', async () => {
    const { dir } = await repo();
    for (const [url, message] of [
      [`${prod.url}?token=abc`, /must not carry a query string/],
      ['https://user:pw@notes.example/', /must not contain a user name or password/],
      ['ftp://notes.example/', /must be an http or https URL/],
      ['notes.example/?token=s3cr3t', /is not an absolute URL; give one such as/],
    ] as const) {
      const r = await cli(['readback', '--url', url], dir);
      assert.equal(r.code, 2);
      assert.match(r.err, message);
      assert.ok(!r.err.includes('s3cr3t'), r.err);
    }
    assert.match((await cli(['readback'], dir)).err, /give the production URL with --url, or set SEAMKIT_URL/);
    assert.match((await cli(['readback', '--url', prod.url, '--pr', '1', '--commit', 'HEAD'], dir)).err, /cannot be combined/);
    assert.match((await cli(['readback', '--url', prod.url, '--last', '0'], dir)).err, /--last must be a whole number from 1 to 1000/);
  });

  it('leaves changes merged after the deployed commit to the next deploy, once the ledger has read this address', async () => {
    const { dir, merges } = await repo();
    assert.equal((await cli(['state', 'init'], dir)).code, 0);
    deploy(merges[0] as string);
    // An earlier recorded run at this address, such as the watch, before the next merges deployed.
    assert.equal((await cli(['readback', '--url', prod.url], dir)).code, 1);
    const r = await cli(['readback', '--url', prod.url, '--deployed', merges[0] as string, '--json'], dir);
    assert.equal(r.code, 0, r.err);
    const out = JSON.parse(r.out);
    const [summary, ...parts] = out.verdicts;
    assert.deepEqual(parts.map((v: { subject: string; state: string }) => `${v.subject} ${v.state}`)[0], 'pr#1 live');
    assert.equal(parts.length, 2);
    const gap = summary.notExamined.find((g: { item: string }) => / merged after the deployed commit /.test(g.item));
    assert.equal(gap.item, `2 changes merged after the deployed commit ${(merges[0] as string).slice(0, 12)}`);
    assert.match(gap.reason, /^production at this address was never seen running them, so the next deploy proves them: commit:[0-9a-f]{12}, pr#2$/);
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

  it('judges every change while the ledger holds no run that read this address', async () => {
    const { dir, merges } = await repo();
    assert.equal((await cli(['state', 'init'], dir)).code, 0);
    deploy(merges[0] as string);
    const r = await cli(['readback', '--url', prod.url, '--deployed', merges[0] as string, '--json'], dir);
    assert.equal(r.code, 1);
    const summary = JSON.parse(r.out).verdicts[0];
    assert.ok(summary.notExamined.some((g: { reason: string }) => /^the ledger holds no earlier run that read this address/.test(g.reason)));
  });

  it('judges every change while the only recorded runs read another address, or could not read this one', async () => {
    const { dir, merges, direct } = await repo();
    assert.equal((await cli(['state', 'init'], dir)).code, 0);
    const staging = await FakeProduction.start({ spaFallback: true });
    try {
      staging.deploy({ 'version.json': JSON.stringify({ schema: 'seamkit.version/1', commit: direct, dirty: false, source: 'git' }) });
      assert.match((await cli(['readback', '--url', staging.url], dir)).err, /recorded as event/);
    } finally {
      await staging.close();
    }
    prod.deploy({ 'index.html': '<!doctype html>' });
    assert.match((await cli(['readback', '--url', prod.url], dir)).err, /recorded as event/);
    deploy(merges[0] as string);
    const r = await cli(['readback', '--url', prod.url, '--deployed', merges[0] as string, '--json'], dir);
    assert.equal(r.code, 1);
    assert.ok(JSON.parse(r.out).verdicts[0].notExamined.some((g: { reason: string }) => /^the ledger holds no earlier run that read this address/.test(g.reason)));
  });

  it('keeps a change in scope only for a sighting at this address', async () => {
    const { dir, merges, direct } = await repo();
    assert.equal((await cli(['state', 'init'], dir)).code, 0);
    deploy(merges[0] as string, '');
    assert.equal((await cli(['readback', '--url', prod.url], dir)).code, 1);
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
    deploy(direct);
    assert.equal((await cli(['readback', '--url', prod.url], dir)).code, 0);
    for (let i = 0; i < 150; i++) await git([...ID, 'commit', '-q', '--allow-empty', '-m', `step ${i}`], { cwd: dir });
    const r = await cli(['readback', '--url', prod.url, '--last', '200', '--deployed', direct, '--json'], dir);
    assert.equal(r.code, 0, r.err);
    const gap = JSON.parse(r.out).verdicts[0].notExamined.find((g: { item: string }) => / merged after the deployed commit /.test(g.item));
    assert.match(gap.item, /^150 changes merged after/);
    assert.match(gap.reason, /and 130 more$/);
  });

  it('judges a change that production runs, so a run records it live and a rollback of it fails', async () => {
    const { dir, merges } = await repo();
    assert.equal((await cli(['state', 'init'], dir)).code, 0);
    deploy(merges[0] as string);
    assert.equal((await cli(['readback', '--url', prod.url], dir)).code, 1);
    // The deploy of #1 is read while a later deploy of #2 already serves.
    deploy(merges[1] as string);
    const later = await cli(['readback', '--url', prod.url, '--deployed', merges[0] as string, '--json'], dir);
    assert.equal(later.code, 0, later.out);
    assert.ok(JSON.parse(later.out).verdicts.some((v: { subject: string; state: string }) => v.subject === 'pr#2' && v.state === 'live'));
    deploy(merges[0] as string, '');
    const rollback = await cli(['readback', '--url', prod.url, '--deployed', merges[0] as string], dir);
    assert.equal(rollback.code, 1);
    assert.match(rollback.out, /NOT LIVE {2}1 of 3/);
  });

  it('counts --last over the changes judged, so changes left to the next deploy do not empty it', async () => {
    const { dir, merges } = await repo();
    assert.equal((await cli(['state', 'init'], dir)).code, 0);
    deploy(merges[0] as string);
    assert.equal((await cli(['readback', '--url', prod.url], dir)).code, 1);
    const r = await cli(['readback', '--url', prod.url, '--last', '1', '--deployed', merges[0] as string, '--json'], dir);
    assert.equal(r.code, 0, r.out);
    const [summary, ...parts] = JSON.parse(r.out).verdicts;
    assert.deepEqual(parts.map((v: { subject: string }) => v.subject), ['pr#1']);
    assert.ok(summary.notExamined.some((g: { item: string }) => g.item === 'changes before the last 1 on main'));
  });

  it('reports production as its own version document, not one a card names for another service', async () => {
    const { dir, merges } = await repo({ card: false });
    const other = await FakeProduction.start();
    try {
      other.deploy({ 'version.json': JSON.stringify({ schema: 'seamkit.version/1', commit: merges[1], dirty: false, source: 'git' }) });
      const head = join(dir, 'g.txt');
      await writeFile(head, 'g\n');
      await git(['add', 'g.txt'], { cwd: dir });
      const card = `\`\`\`seamkit-card\ncard: 1\nintent: Ship the api.\nlayers: [function]\ntargets: [api]\nmarkers:\n  - kind: version\n    url: ${other.url}version.json\n\`\`\``;
      await git([...ID, 'commit', '-q', '-m', `Ship the api (#3)\n\n${card}`], { cwd: dir });
      deploy(merges[0] as string);
      const r = await cli(['readback', '--url', prod.url, '--json'], dir);
      const out = JSON.parse(r.out);
      assert.equal(out.production.url, `${prod.url}version.json`);
      assert.equal(out.production.commit, merges[0]);
    } finally {
      await other.close();
    }
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
    // A local branch of that name, as actions/checkout makes at the job's commit, does not hide the remote's.
    await git(['branch', 'release', 'origin/release~1'], { cwd: clone });
    const remote = await cli(['readback', '--url', prod.url, '--branch', 'release', '--json'], clone);
    assert.equal(JSON.parse(remote.out).verdicts.length, 4);
  });

  it('reads a remote branch named refs/<x> as the remote has it, not a local branch of that name', async () => {
    const { dir, direct } = await repo();
    await git(['branch', 'refs/rel', 'HEAD~1'], { cwd: dir });
    const clone = join(root, `clone-${++counter}`);
    await git(['clone', '-q', dir, clone], { cwd: root });
    await git(['branch', 'refs/rel', 'origin/refs/rel~1'], { cwd: clone });
    deploy(direct);
    const r = await cli(['readback', '--url', prod.url, '--branch', 'refs/rel', '--json'], clone);
    assert.equal(r.code, 0, r.err);
    assert.equal(JSON.parse(r.out).verdicts.length, 4, r.out);
    // A full ref the remote has no branch for still means what git says.
    assert.equal(JSON.parse((await cli(['readback', '--url', prod.url, '--branch', 'refs/heads/refs/rel', '--json'], clone)).out).verdicts.length, 3);
  });

  it('reads a version document naming a tag as one naming a commit this clone does not have', async () => {
    const { dir, merges } = await repo();
    await git([...ID, 'tag', '-a', '-m', 'release', 'v1', merges[1] as string], { cwd: dir });
    const tag = await git(['rev-parse', 'v1'], { cwd: dir });
    for (const reported of [tag, tag.slice(0, 7)]) {
      prod.deploy({ 'index.html': '<!doctype html>', 'version.json': JSON.stringify({ sha: reported }) });
      const r = await cli(['audit', '--url', prod.url, '--json'], dir);
      assert.notEqual(r.code, 2, r.err);
      const out = JSON.parse(r.out);
      assert.deepEqual(out.production, { url: `${prod.url}version.json`, status: 'ok', reported });
      assert.ok(out.advice.some((a: string) => a.includes('names a tag rather than the commit')), r.out);
    }
  });

  it('scopes a deploy after a recorded run read a version document naming a tag, as the commit the tag points at', async () => {
    const { dir, merges } = await repo();
    assert.equal((await cli(['state', 'init'], dir)).code, 0);
    await git([...ID, 'tag', '-a', '-m', 'release', 'v1', merges[0] as string], { cwd: dir });
    const tag = await git(['rev-parse', 'v1'], { cwd: dir });
    prod.deploy({ 'index.html': '<!doctype html>', 'version.json': JSON.stringify({ sha: tag }) });
    assert.match((await cli(['readback', '--url', prod.url], dir)).err, /recorded as event/);
    deploy(merges[0] as string);
    const r = await cli(['readback', '--url', prod.url, '--deployed', merges[0] as string, '--json'], dir);
    assert.equal(r.code, 0, r.out);
    const gaps = JSON.parse(r.out).verdicts[0].notExamined as { reason: string }[];
    assert.ok(gaps.some((g) => /never seen running them/.test(g.reason)), JSON.stringify(gaps));
  });

  it('hands the check only the sightings it looks up, however many addresses the ledger records', async () => {
    const { dir, direct } = await repo();
    assert.equal((await cli(['state', 'init'], dir)).code, 0);
    const staging = await FakeProduction.start({ spaFallback: true });
    try {
      staging.deploy({ 'index.html': '<!doctype html><script src="/app.js"></script>', 'app.js': 'el.id = "sync-badge-v2";', 'version.json': JSON.stringify({ schema: 'seamkit.version/1', commit: direct, dirty: false, source: 'git' }) });
      assert.match((await cli(['readback', '--url', staging.url], dir)).err, /recorded as event/);
    } finally {
      await staging.close();
    }
    deploy(direct);
    assert.match((await cli(['readback', '--url', prod.url], dir)).err, /recorded as event/);
    const { input } = await gatherReadback(dir, { url: prod.url, last: 20 }, () => AT, {});
    const wanted = new Set(input.changes.flatMap((c) => c.markers.map((m) => `${c.commit} ${markerKey(m)}`)));
    assert.ok((input.history ?? []).length > 0);
    assert.ok((input.history ?? []).every((s) => wanted.has(`${s.change} ${s.marker}`)), JSON.stringify(input.history));
  });

  it('gives a verdict when a card lists more markers than the check takes, and a rollback across it fails', async () => {
    const markers = Array.from({ length: 21 }, (_, i) => `  - kind: bundle\n    text: "marker-${i}-x"`).join('\n');
    const { dir, merges, direct } = await repo({ card: `card: 1\nintent: Add the badge.\nlayers: [frontend]\ntargets: [web]\nmarkers:\n${markers}` });
    assert.equal((await cli(['state', 'init'], dir)).code, 0);
    deploy(merges[0] as string);
    assert.match((await cli(['readback', '--url', prod.url], dir)).err, /recorded as event/);
    deploy(direct);
    const live = await cli(['readback', '--url', prod.url, '--json'], dir);
    assert.equal(live.code, 0, live.out);
    const pr2 = JSON.parse(live.out).verdicts.find((v: { subject: string }) => v.subject === 'pr#2');
    // Whichever check refuses it, the card's or the check's own, the change is proven by version.
    assert.ok(pr2.notExamined.some((g: { reason: string }) => /at most 20/.test(g.reason)), live.out);
    deploy(merges[0] as string);
    const rollback = await cli(['readback', '--url', prod.url, '--deployed', merges[0] as string, '--json'], dir);
    assert.equal(rollback.code, 1, rollback.out);
    assert.equal(JSON.parse(rollback.out).verdicts.find((v: { subject: string }) => v.subject === 'pr#2').state, 'not_live', rollback.out);
  });

  it('proves by version alone the older changes whose card markers no longer fit in one run', async () => {
    // Six cards of twenty pages, six of twenty version documents beside production's own, and
    // fifty-one of twenty texts on one page: the oldest cards that do not fit are proven by version.
    const cases = [
      { cards: 6, demoted: 1, marker: (n: number, k: number) => `  - kind: bundle\n    url: /p${n}-${k}\n    text: "marker-${n}-${k}"` },
      { cards: 6, demoted: 2, marker: (n: number, k: number) => `  - kind: version\n    url: /v${n}-${k}` },
      { cards: 51, demoted: 1, marker: (n: number, k: number) => `  - kind: bundle\n    text: "marker-${n}-${k}"` },
    ];
    for (const { cards, demoted, marker } of cases) {
      await budgetCase(Array.from({ length: cards }, () => 20), marker, (i) => i >= cards - demoted);
    }
    // The oldest card, of 19, fits exactly once the card before it is refused, which spends nothing.
    await budgetCase([19, 20, 20, 20, 20, 20], (n, k) => `  - kind: version\n    url: /w${n}-${k}`, (i) => i === 4);
  });

  /** One readback over cards of `sizes` markers, oldest first; `demotedAt(i)` says which change, newest first, the budget proves by version. */
  async function budgetCase(sizes: number[], marker: (n: number, k: number) => string, demotedAt: (i: number) => boolean): Promise<void> {
    const cards = sizes.length;
    const dir = join(root, `repo-${++counter}`);
    await git(['init', '-q', '-b', 'main', dir], { cwd: root });
    for (let n = 1; n <= cards; n++) {
      const markers = Array.from({ length: sizes[n - 1] as number }, (_, k) => marker(n, k)).join('\n');
      await writeFile(join(dir, `f${n}.txt`), `${n}\n`);
      await git(['add', `f${n}.txt`], { cwd: dir });
      await git([...ID, 'commit', '-q', '-m', `change ${n}\n\n\`\`\`seamkit-card\ncard: 1\nintent: Change ${n}.\nlayers: [frontend]\ntargets: [web]\nmarkers:\n${markers}\n\`\`\``], { cwd: dir });
    }
    deploy(await git(['rev-parse', 'HEAD'], { cwd: dir }));
    const r = await cli(['readback', '--url', prod.url, '--last', String(cards), '--json'], dir);
    assert.notEqual(r.code, 2, r.err);
    const budget = (v: { notExamined: { reason: string }[] }): boolean => v.notExamined.some((g) => /one run reads at most 100 version documents, 100 pages/.test(g.reason));
    const parts = JSON.parse(r.out).verdicts.slice(1);
    assert.deepEqual(parts.map(budget), parts.map((_: unknown, i: number) => demotedAt(i)), r.out.slice(0, 2000));
  }

  it('keeps in --deployed scope a change seen live under a card marker the budget no longer reads', async () => {
    const dir = join(root, `repo-${++counter}`);
    await git(['init', '-q', '-b', 'main', dir], { cwd: root });
    const commit = async (n: number, message: string): Promise<string> => {
      await writeFile(join(dir, `f${n}.txt`), `${n}\n`);
      await git(['add', `f${n}.txt`], { cwd: dir });
      await git([...ID, 'commit', '-q', '-m', message], { cwd: dir });
      return git(['rev-parse', 'HEAD'], { cwd: dir });
    };
    const card = (markers: string): string => `\n\n\`\`\`seamkit-card\ncard: 1\nintent: A change.\nlayers: [frontend]\ntargets: [web]\nmarkers:\n${markers}\n\`\`\``;
    const base = await commit(0, 'Initial commit');
    assert.equal((await cli(['state', 'init'], dir)).code, 0);
    deploy(base, '');
    assert.match((await cli(['readback', '--url', prod.url], dir)).err, /recorded as event/);
    // The change is seen live by its marker while the version document cannot be read.
    const seen = await commit(1, `change 1 (#1)${card('  - kind: bundle\n    text: "seen-marker"')}`);
    deploy(seen, 'el.id = "seen-marker";');
    prod.failWith('/version.json', 503);
    assert.match((await cli(['readback', '--url', prod.url, '--pr', '1'], dir)).err, /recorded as event/);
    // Five newer cards of twenty pages each use up the pages one run reads.
    for (let n = 2; n <= 6; n++) {
      await commit(n, `change ${n} (#${n})${card(Array.from({ length: 20 }, (_, k) => `  - kind: bundle\n    url: /p${n}-${k}\n    text: "m-${n}-${k}"`).join('\n'))}`);
    }
    // A rollback to the first build drops the change seen live, so it is judged and fails.
    deploy(base, '');
    const r = await cli(['readback', '--url', prod.url, '--deployed', base, '--last', '10', '--json'], dir);
    assert.equal(r.code, 1, r.out.slice(0, 2000));
    const pr1 = JSON.parse(r.out).verdicts.find((v: { subject: string }) => v.subject === 'pr#1');
    assert.equal(pr1.outcome, 'fail', r.out.slice(0, 2000));
    assert.ok(pr1.notExamined.some((g: { reason: string }) => /one run reads at most 100 version documents/.test(g.reason)), r.out.slice(0, 2000));
  });

  it('counts the discovery paths of the --version-url\'s own origin, when the version document is on another host', async () => {
    const { dir, merges, direct } = await repo({ card: false });
    assert.equal((await cli(['state', 'init'], dir)).code, 0);
    const api = await FakeProduction.start({ spaFallback: true });
    try {
      prod.deploy({ 'index.html': '<!doctype html>' });
      const doc = (commit: string): string => JSON.stringify({ schema: 'seamkit.version/1', commit, dirty: false, source: 'git' });
      api.deploy({ 'api/version': doc(direct) });
      assert.match((await cli(['readback', '--url', prod.url, '--version-url', `${api.url}api/version`], dir)).err, /recorded as event/);
      api.deploy({ 'version.json': doc(merges[0] as string) });
      const r = await cli(['readback', '--url', prod.url, '--version-url', `${api.url}version.json`, '--deployed', merges[0] as string, '--json'], dir);
      assert.equal(r.code, 1, r.out);
      const out = JSON.parse(r.out);
      const states = Object.fromEntries(out.verdicts.slice(1).map((v: { subject: string; state: string }) => [v.subject, v.state]));
      assert.equal(states[`commit:${direct.slice(0, 12)}`], 'not_live', r.out);
      assert.equal(states['pr#2'], 'not_live', r.out);
      assert.ok(!out.verdicts[0].notExamined.some((g: { reason: string }) => /holds no earlier run/.test(g.reason)), r.out);
    } finally {
      await api.close();
    }
  });

  it('keeps in scope a change production was seen running, whatever the recorded run judged', async () => {
    const dirty = (commit: string): void => prod.deploy({ 'version.json': JSON.stringify({ schema: 'seamkit.version/1', commit, dirty: true, source: 'git' }) });
    for (const [label, record] of [
      ['--pr', (dir: string) => cli(['readback', '--url', prod.url, '--pr', '1'], dir)],
      ['--commit', (dir: string, first: string) => cli(['readback', '--url', prod.url, '--commit', first], dir)],
      ['a dirty build', (dir: string, _first: string, second: string) => (dirty(second), cli(['readback', '--url', prod.url], dir))],
    ] as const) {
      const { dir, merges } = await repo();
      assert.equal((await cli(['state', 'init'], dir)).code, 0);
      // Production runs #2, and the only run recorded here judged something else or could sight nothing.
      deploy(merges[1] as string);
      assert.match((await record(dir, merges[0] as string, merges[1] as string)).err, /recorded as event/, label);
      // A rollback to #1 is reported as a deploy of #1, so #2 is not in the deploy and has no sighting.
      deploy(merges[0] as string, '');
      const r = await cli(['readback', '--url', prod.url, '--deployed', merges[0] as string, '--json'], dir);
      assert.equal(r.code, 1, `${label}: ${r.out}`);
      const parts = JSON.parse(r.out).verdicts.slice(1);
      assert.ok(parts.some((v: { subject: string; outcome: string }) => v.subject === 'pr#2' && v.outcome === 'fail'), `${label}: ${r.out}`);
    }
  });

  it('judges every change once production here was seen running a commit this repository does not have', async () => {
    const { dir, merges } = await repo();
    assert.equal((await cli(['state', 'init'], dir)).code, 0);
    prod.deploy({ 'version.json': JSON.stringify({ schema: 'seamkit.version/1', commit: 'e'.repeat(40), dirty: false, source: 'git' }) });
    assert.match((await cli(['readback', '--url', prod.url], dir)).err, /recorded as event/);
    deploy(merges[0] as string);
    const r = await cli(['readback', '--url', prod.url, '--deployed', merges[0] as string, '--json'], dir);
    assert.equal(r.code, 1, r.out);
    const summary = JSON.parse(r.out).verdicts[0];
    assert.ok(
      summary.notExamined.some((g: { reason: string }) => g.reason.startsWith(`production at this address was seen running ${'e'.repeat(12)}, which this repository does not have (fetch the branch it came from), so`)),
      JSON.stringify(summary.notExamined),
    );
  });

  it('keeps a change in scope that a run saw live here, even when no build seen here contained it', async () => {
    const { dir, merges } = await repo();
    assert.equal((await cli(['state', 'init'], dir)).code, 0);
    deploy(merges[0] as string);
    assert.equal((await cli(['readback', '--url', prod.url], dir)).code, 1);
    // Production serves #2's marker but no version document, so the run sees #2 live by its card alone.
    prod.deploy({ 'index.html': '<!doctype html><script src="/app.js"></script>', 'app.js': 'el.id = "sync-badge-v2";' });
    assert.match((await cli(['readback', '--url', prod.url, '--pr', '2'], dir)).err, /recorded as event/);
    deploy(merges[0] as string, '');
    const r = await cli(['readback', '--url', prod.url, '--deployed', merges[0] as string, '--json'], dir);
    assert.equal(r.code, 1, r.out);
    assert.ok(JSON.parse(r.out).verdicts.some((v: { subject: string; state: string }) => v.subject === 'pr#2' && v.state === 'not_live'), r.out);
  });

  it('counts the build production runs now among those seen here, dirty or unknown', async () => {
    const { dir, merges } = await repo();
    assert.equal((await cli(['state', 'init'], dir)).code, 0);
    deploy(merges[0] as string);
    assert.equal((await cli(['readback', '--url', prod.url], dir)).code, 1);
    // A dirty build of #2 now serves: #2 is judged, so this run records it live.
    prod.deploy({
      'index.html': '<!doctype html><script src="/app.js"></script>',
      'app.js': 'el.id = "sync-badge-v2";',
      'version.json': JSON.stringify({ schema: 'seamkit.version/1', commit: merges[1], dirty: true, source: 'git' }),
    });
    const dirty = JSON.parse((await cli(['readback', '--url', prod.url, '--deployed', merges[0] as string, '--json'], dir)).out);
    assert.ok(dirty.verdicts.some((v: { subject: string; state: string }) => v.subject === 'pr#2' && v.state === 'live'), JSON.stringify(dirty.verdicts.map((v: { subject: string }) => v.subject)));
    // A build this repository cannot place: nothing is scoped out.
    prod.deploy({ 'version.json': JSON.stringify({ schema: 'seamkit.version/1', commit: 'd'.repeat(40), dirty: false, source: 'git' }) });
    const unknown = JSON.parse((await cli(['readback', '--url', prod.url, '--deployed', merges[0] as string, '--json'], dir)).out).verdicts[0];
    assert.ok(unknown.notExamined.some((g: { reason: string }) => g.reason.startsWith(`production at this address was seen running ${'d'.repeat(12)}, which this repository does not have`)), JSON.stringify(unknown.notExamined));
  });

  it('keeps a change in scope that production ran here, when its version document moved to another discovery path', async () => {
    for (const [before, after] of [['api/version', 'version.json'], ['version.json', 'api/version']] as const) {
      const { dir, merges } = await repo();
      assert.equal((await cli(['state', 'init'], dir)).code, 0);
      const build = (commit: string, path: string, script: string): void =>
        prod.deploy({ 'index.html': '<!doctype html><script src="/app.js"></script>', 'app.js': script, [path]: JSON.stringify({ schema: 'seamkit.version/1', commit, dirty: false, source: 'git' }) });
      build(merges[0] as string, before, '');
      assert.match((await cli(['readback', '--url', prod.url], dir)).err, /recorded as event/);
      // #2's build runs, but its marker is not served, so only the version document saw it.
      build(merges[1] as string, after, '');
      assert.match((await cli(['readback', '--url', prod.url], dir)).err, /recorded as event/);
      // The rollback serves the old build, with its document at the old path.
      build(merges[0] as string, before, '');
      const r = await cli(['readback', '--url', prod.url, '--deployed', merges[0] as string, '--json'], dir);
      assert.equal(r.code, 1, `${before} then ${after}: ${r.out}`);
      assert.ok(JSON.parse(r.out).verdicts.some((v: { subject: string; outcome: string }) => v.subject === 'pr#2' && v.outcome === 'fail'), r.out);
    }
  });

  it('reads a rollback as not live when the version document moved to another path since the change was seen', async () => {
    const { dir, merges, direct } = await repo({ card: false });
    assert.equal((await cli(['state', 'init'], dir)).code, 0);
    const build = (commit: string, path: string): void =>
      prod.deploy({ 'index.html': '<!doctype html>', [path]: JSON.stringify({ schema: 'seamkit.version/1', commit, dirty: false, source: 'git' }) });
    build(direct, 'api/version');
    assert.match((await cli(['readback', '--url', prod.url], dir)).err, /recorded as event/);
    // The rollback's build serves its document at /version.json.
    build(merges[0] as string, 'version.json');
    const r = await cli(['readback', '--url', prod.url, '--deployed', merges[0] as string, '--json'], dir);
    assert.equal(r.code, 1, r.out);
    const states = Object.fromEntries(JSON.parse(r.out).verdicts.slice(1).map((v: { subject: string; state: string }) => [v.subject, v.state]));
    const first = await git(['rev-list', '--max-parents=0', 'HEAD'], { cwd: dir });
    assert.deepEqual(states, { [`commit:${direct.slice(0, 12)}`]: 'not_live', 'pr#2': 'not_live', 'pr#1': 'live', [`commit:${first.slice(0, 12)}`]: 'live' });
  });

  it('reads a rollback across a move as not live when --version-url names one of the discovery paths', async () => {
    const { dir, merges, direct } = await repo({ card: false });
    assert.equal((await cli(['state', 'init'], dir)).code, 0);
    const build = (commit: string, path: string): void =>
      prod.deploy({ 'index.html': '<!doctype html>', [path]: JSON.stringify({ schema: 'seamkit.version/1', commit, dirty: false, source: 'git' }) });
    build(direct, 'api/version');
    assert.match((await cli(['readback', '--url', prod.url], dir)).err, /recorded as event/);
    build(merges[0] as string, 'version.json');
    const r = await cli(['readback', '--url', prod.url, '--version-url', `${prod.url}version.json`, '--deployed', merges[0] as string, '--json'], dir);
    assert.equal(r.code, 1, r.out);
    const states = Object.fromEntries(JSON.parse(r.out).verdicts.slice(1).map((v: { subject: string; state: string }) => [v.subject, v.state]));
    assert.equal(states[`commit:${direct.slice(0, 12)}`], 'not_live', r.out);
    assert.equal(states['pr#2'], 'not_live', r.out);
  });

  it('leaves later changes to the next deploy when earlier runs read the version document at another discovery path', async () => {
    const { dir, merges } = await repo();
    assert.equal((await cli(['state', 'init'], dir)).code, 0);
    const build = (path: string): void =>
      prod.deploy({ 'index.html': '<!doctype html>', [path]: JSON.stringify({ schema: 'seamkit.version/1', commit: merges[0], dirty: false, source: 'git' }) });
    build('version.json');
    assert.match((await cli(['readback', '--url', prod.url], dir)).err, /recorded as event/);
    build('api/version');
    const r = await cli(['readback', '--url', prod.url, '--deployed', merges[0] as string, '--json'], dir);
    assert.equal(r.code, 0, r.out);
    const gaps = JSON.parse(r.out).verdicts[0].notExamined as { item: string; reason: string }[];
    assert.ok(gaps.some((g) => / merged after the deployed commit /.test(g.item) && /never seen running them/.test(g.reason)), JSON.stringify(gaps));
    assert.ok(!gaps.some((g) => /holds no earlier run/.test(g.reason)), JSON.stringify(gaps));
  });

  it('counts a sighting at another version path for a card whose version marker names none, or a broken card', async () => {
    for (const card of ['card: 1\nintent: Add the badge.\nlayers: [frontend]\ntargets: [web]\nmarkers:\n  - kind: version', 'card: 1\nintent: [broken']) {
      const { dir, merges } = await repo({ card });
      assert.equal((await cli(['state', 'init'], dir)).code, 0);
      const build = (commit: string, path: string): void =>
        prod.deploy({ 'index.html': '<!doctype html>', [path]: JSON.stringify({ schema: 'seamkit.version/1', commit, dirty: false, source: 'git' }) });
      build(merges[1] as string, 'api/version');
      assert.match((await cli(['readback', '--url', prod.url], dir)).err, /recorded as event/);
      build(merges[0] as string, 'version.json');
      const r = await cli(['readback', '--url', prod.url, '--deployed', merges[0] as string, '--json'], dir);
      assert.equal(r.code, 1, r.out);
      assert.equal(JSON.parse(r.out).verdicts.find((v: { subject: string }) => v.subject === 'pr#2').state, 'not_live', `${card}: ${r.out}`);
    }
  });

  it('keeps a sighting under the version path a card names, when production\'s own document is elsewhere', async () => {
    const card = (markers: string): string => `card: 1\nintent: Add the badge.\nlayers: [function]\ntargets: [api]\nmarkers:\n${markers}`;
    const serve = (front: string, api: string): void =>
      prod.deploy({
        'index.html': '<!doctype html>',
        'version.json': JSON.stringify({ schema: 'seamkit.version/1', commit: front, dirty: false, source: 'git' }),
        'api/version': JSON.stringify({ schema: 'seamkit.version/1', commit: api, dirty: false, source: 'git' }),
      });
    // Only the API's own path: seen live there while the front end ran #1, then the API rolls back.
    {
      const { dir, merges } = await repo({ card: card('  - kind: version\n    url: /api/version') });
      assert.equal((await cli(['state', 'init'], dir)).code, 0);
      serve(merges[0] as string, merges[1] as string);
      assert.match((await cli(['readback', '--url', prod.url], dir)).err, /recorded as event/);
      serve(merges[0] as string, merges[0] as string);
      const r = await cli(['readback', '--url', prod.url, '--deployed', merges[0] as string, '--json'], dir);
      assert.equal(r.code, 1, r.out);
      assert.equal(JSON.parse(r.out).verdicts.find((v: { subject: string }) => v.subject === 'pr#2').state, 'not_live', r.out);
    }
    // Both documents: the API rolls back while the front end stays.
    {
      const { dir, merges } = await repo({ card: card('  - kind: version\n  - kind: version\n    url: /api/version') });
      assert.equal((await cli(['state', 'init'], dir)).code, 0);
      serve(merges[1] as string, merges[1] as string);
      assert.match((await cli(['readback', '--url', prod.url], dir)).err, /recorded as event/);
      serve(merges[1] as string, merges[0] as string);
      const r = await cli(['readback', '--url', prod.url, '--json'], dir);
      assert.equal(r.code, 1, r.out);
      assert.equal(JSON.parse(r.out).verdicts.find((v: { subject: string }) => v.subject === 'pr#2').state, 'not_live', r.out);
    }
    // Both documents, and only the API ever ran #2: the front end's marker was never seen live.
    {
      const { dir, merges } = await repo({ card: card('  - kind: version\n  - kind: version\n    url: /api/version') });
      assert.equal((await cli(['state', 'init'], dir)).code, 0);
      serve(merges[0] as string, merges[1] as string);
      assert.match((await cli(['readback', '--url', prod.url], dir)).err, /recorded as event/);
      const r = await cli(['readback', '--url', prod.url, '--json'], dir);
      const pr2 = JSON.parse(r.out).verdicts.find((v: { subject: string }) => v.subject === 'pr#2');
      assert.equal(pr2.state, 'not_proven', r.out);
      assert.ok(!pr2.reasons.some((x: string) => /seen live/.test(x)), r.out);
    }
  });

  it('reads the ledger before it reads production', async () => {
    const { dir, merges } = await repo();
    assert.equal((await cli(['state', 'init'], dir)).code, 0);
    deploy(merges[1] as string);
    let first = true;
    // The ledger goes away as production is first read: a run that read it first still has it.
    const fetchThen: typeof fetch = (input, init) => {
      if (first) execFileSync('git', ['update-ref', '-d', 'refs/heads/seamkit/state'], { cwd: dir });
      first = false;
      return fetch(input, init);
    };
    const { input } = await gatherReadback(dir, { url: prod.url, last: 20, deployed: merges[0] as string }, () => AT, { fetch: fetchThen });
    assert.ok(input.notExamined?.some((g) => g.reason.startsWith('the ledger holds no earlier run that read this address')), JSON.stringify(input.notExamined));
  });

  it('says --last left changes out when scoping kept more than it judges, with nothing older on the branch', async () => {
    const { dir, merges, direct } = await repo();
    const first = await git(['rev-list', '--max-parents=0', 'HEAD'], { cwd: dir });
    deploy(direct);
    const r = await cli(['readback', '--url', prod.url, '--deployed', first, '--last', '1', '--json'], dir);
    assert.equal(r.code, 0, r.out);
    const [summary, ...parts] = JSON.parse(r.out).verdicts;
    assert.deepEqual(parts.map((v: { subject: string }) => v.subject), [`commit:${direct.slice(0, 12)}`]);
    assert.ok(summary.notExamined.some((g: { item: string; reason: string }) => g.item === 'changes before the last 1 on main' && g.reason === 'outside --last'), JSON.stringify(summary.notExamined));
    assert.equal(merges.length, 2);
  });

  it('judges --last changes however many were merged after the deployed commit', async () => {
    const { dir, merges, direct } = await repo();
    assert.equal((await cli(['state', 'init'], dir)).code, 0);
    deploy(direct);
    assert.equal((await cli(['readback', '--url', prod.url], dir)).code, 0);
    for (let i = 0; i < 230; i++) await git([...ID, 'commit', '-q', '--allow-empty', '-m', `step ${i}`], { cwd: dir });
    const r = await cli(['readback', '--url', prod.url, '--last', '2', '--deployed', direct, '--json'], dir);
    assert.equal(r.code, 0, r.out);
    const [summary, ...parts] = JSON.parse(r.out).verdicts;
    assert.deepEqual(parts.map((v: { subject: string }) => v.subject), [`commit:${direct.slice(0, 12)}`, 'pr#2']);
    assert.ok(summary.notExamined.some((g: { item: string }) => g.item === `230 changes merged after the deployed commit ${direct.slice(0, 12)}`), JSON.stringify(summary.notExamined));
    assert.equal(merges.length, 2);
  });

  it('records --url and --version-url without their fragment', async () => {
    const { dir, direct } = await repo();
    deploy(direct);
    const r = await cli(['readback', '--url', `${prod.url}#top`, '--version-url', `${prod.url}version.json#v`, '--json'], dir);
    assert.equal(r.code, 0, r.out);
    const out = JSON.parse(r.out);
    assert.equal(out.production.url, `${prod.url}version.json`);
    assert.ok(!r.out.includes('#top') && !r.out.includes('#v'), r.out);
  });

  it('says --last left changes out when it did, with or without a deploy', async () => {
    const { dir, direct } = await repo();
    deploy(direct);
    const r = await cli(['readback', '--url', prod.url, '--last', '2', '--json'], dir);
    assert.equal(r.code, 0, r.out);
    const [summary, ...parts] = JSON.parse(r.out).verdicts;
    assert.equal(parts.length, 2);
    assert.ok(summary.notExamined.some((g: { item: string; reason: string }) => g.item === 'changes before the last 2 on main' && g.reason === 'outside --last'));
    const all = JSON.parse((await cli(['readback', '--url', prod.url, '--last', '4', '--json'], dir)).out).verdicts[0];
    assert.ok(!all.notExamined.some((g: { item: string }) => g.item.startsWith('changes before the last')), JSON.stringify(all.notExamined));
  });

  it('checks --version-url as it checks --url, and never repeats it', async () => {
    const { dir } = await repo();
    for (const [url, message] of [
      [`${prod.url}version.json?token=s3cr3t`, /--version-url must not carry a query string/],
      ['https://user:s3cr3t@notes.example/version.json', /--version-url must not contain a user name or password/],
      ['file:///s3cr3t/version.json', /--version-url must be an http or https URL/],
      ['version.json#s3cr3t', /--version-url is not an absolute URL; give one such as/],
    ] as const) {
      const r = await cli(['readback', '--url', prod.url, '--version-url', url], dir);
      assert.equal(r.code, 2, url);
      assert.match(r.err, message);
      assert.ok(!r.err.includes('s3cr3t'), r.err);
    }
  });

  it('reads --branch HEAD as the checkout has it, and any branch git allows as the remote has it', async () => {
    const { dir, direct } = await repo();
    await git(['branch', 'release', 'HEAD~1'], { cwd: dir });
    await git(['branch', 'release+1', 'HEAD~1'], { cwd: dir });
    const clone = join(root, `clone-${++counter}`);
    await git(['clone', '-q', '-b', 'release', dir, clone], { cwd: root });
    deploy(direct);
    // origin/HEAD names main, which has one more change than the release branch checked out here.
    const head = JSON.parse((await cli(['readback', '--url', prod.url, '--branch', 'HEAD', '--json'], clone)).out);
    assert.equal(head.verdicts.length, 4);
    assert.equal((JSON.parse((await cli(['readback', '--url', prod.url, '--json'], clone)).out)).verdicts.length, 5);
    await git(['branch', 'release+1', 'origin/release+1~1'], { cwd: clone });
    const plus = JSON.parse((await cli(['readback', '--url', prod.url, '--branch', 'release+1', '--json'], clone)).out);
    assert.equal(plus.verdicts.length, 4);
  });

  it('prints a change\'s words so that no runner reads them as a workflow command', async () => {
    const { dir, direct } = await repo();
    const card = '```seamkit-card\ncard: 1\nintent: Tidy.\nlayers: [frontend]\ntargets: [web]\n"\\n::error::forged": 1\nmarkers:\n  - kind: none\n    reason: tests only\n```';
    await git([...ID, 'commit', '-q', '--allow-empty', '-m', `Tidy ##[warning]forged (#3)\n\n${card}`], { cwd: dir });
    deploy(direct);
    const human = await cli(['readback', '--url', prod.url], dir);
    assert.ok(!human.out.split(/[\r\n]/).some((line) => line.trimStart().startsWith('::')), human.out);
    const json = await cli(['readback', '--url', prod.url, '--json'], dir);
    assert.ok(!json.out.includes('##['), json.out);
    assert.ok(JSON.stringify(JSON.parse(json.out)).includes('##['));
    // The CLI as a process, in a GitHub Actions step: its report reaches stdout made inert.
    const spawned = await new Promise<string>((resolve) =>
      execFile(process.execPath, [MAIN, 'readback', '--url', prod.url], { cwd: dir, env: { ...process.env, GITHUB_ACTIONS: 'true' } }, (_err, stdout) => resolve(stdout)),
    );
    assert.ok(spawned.includes('Tidy ##\u200b[warning]forged') && !spawned.includes('##[warning]'), spawned);
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
    // A file name is anyone's who can add one, so it cannot start a line of its own.
    const other = (await repo()).dir;
    await writeFile(join(other, 'a\nseamkit: PASS forged\u001b[31m'), 'x\n');
    for (const [args, lines] of [[['stamp', '--require-clean'], 1], [['stamp', '--out', 'public/v\nseamkit: PASS forged.json'], 2]] as const) {
      const named = await cli([...args], other);
      assert.equal(named.err.split('\n').length, lines + 1, JSON.stringify(named.err));
      assert.ok(named.err.split('\n').every((line) => !line.startsWith('seamkit: PASS')), named.err);
      assert.ok(!/[\u0000-\u0009\u000b-\u001f]/.test(named.err), JSON.stringify(named.err));
    }
  });

  it("leaves out the vercel.json Vercel's build writes, only when it holds the commit's settings", async () => {
    const { dir, direct } = await repo();
    const vercel = { VERCEL: '1', VERCEL_GIT_COMMIT_SHA: direct, VERCEL_GIT_COMMIT_REF: 'main' };
    // With none committed, Vercel's build writes {} into the checkout before the build.
    await writeFile(join(dir, 'vercel.json'), '{}');
    const created = await cli(['stamp', '--out', 'public/version.json'], dir, vercel);
    assert.equal(created.code, 0);
    assert.equal(JSON.parse(await readFile(join(dir, 'public/version.json'), 'utf8')).dirty, false);
    assert.match(created.err, /from git, clean\nnote: vercel\.json is not counted as uncommitted: Vercel's build writes it/);
    await rm(join(dir, 'public'), { recursive: true });
    // Anywhere but Vercel's build of this commit, the same file is a change like any other.
    for (const env of [{}, { ...vercel, VERCEL: '' }, { ...vercel, VERCEL_GIT_COMMIT_SHA: 'd'.repeat(40) }]) {
      const r = await cli(['stamp'], dir, env);
      assert.equal(JSON.parse(r.out).dirty, true);
      assert.match(r.err, /warning: 1 uncommitted change \(such as vercel\.json\)/);
    }
    // Settings that no commit holds are a change.
    await writeFile(join(dir, 'vercel.json'), '{"cleanUrls":true}');
    assert.equal(JSON.parse((await cli(['stamp'], dir, vercel)).out).dirty, true);
    await writeFile(join(dir, 'vercel.json'), '{');
    assert.equal(JSON.parse((await cli(['stamp'], dir, vercel)).out).dirty, true);

    // A committed vercel.json reformatted, as Vercel's build writes it, is not a change; other settings are.
    await writeFile(join(dir, 'vercel.json'), '{\n  "cleanUrls": true,\n  "headers": []\n}\n');
    await writeFile(join(dir, 'settings.json'), '{\n  "a": 1\n}\n');
    await git(['add', 'vercel.json', 'settings.json'], { cwd: dir });
    await git([...ID, 'commit', '-q', '-m', 'add vercel.json'], { cwd: dir });
    const head = await git(['rev-parse', 'HEAD'], { cwd: dir });
    const built = { ...vercel, VERCEL_GIT_COMMIT_SHA: head.toUpperCase() };
    await writeFile(join(dir, 'vercel.json'), '{"headers":[],"cleanUrls":true}');
    const rewritten = await cli(['stamp'], dir, built);
    assert.deepEqual(JSON.parse(rewritten.out), { schema: 'seamkit.version/1', commit: head, dirty: false, source: 'git', ref: 'main', builtAt: AT });
    assert.match(rewritten.err, /^note: vercel\.json is not counted as uncommitted/);
    assert.equal(JSON.parse((await cli(['stamp'], dir, {})).out).dirty, true);
    // Only vercel.json: another file reformatted the same way is a change.
    await writeFile(join(dir, 'settings.json'), '{"a":1}');
    assert.match((await cli(['stamp'], dir, built)).err, /warning: 1 uncommitted change \(such as settings\.json\)/);
    await git(['checkout', '-q', '--', 'settings.json'], { cwd: dir });
    await writeFile(join(dir, 'vercel.json'), '{"headers":[],"cleanUrls":false}');
    assert.equal(JSON.parse((await cli(['stamp'], dir, built)).out).dirty, true);
    await writeFile(join(dir, 'vercel.json'), '{}');
    assert.equal(JSON.parse((await cli(['stamp'], dir, built)).out).dirty, true);
    // Beside another change, the build is dirty, and the other change is the one named.
    await writeFile(join(dir, 'vercel.json'), '{"headers":[],"cleanUrls":true}');
    await writeFile(join(dir, 'f1.txt'), 'edited\n');
    const both = await cli(['stamp', '--require-clean'], dir, built);
    assert.equal(both.code, 1);
    assert.match(both.err, /refusing to stamp a build with 1 uncommitted change \(such as f1\.txt\)/);
    // A vercel.json in another directory is held to the same rule.
    await git(['checkout', '-q', '--', 'f1.txt', 'vercel.json'], { cwd: dir });
    await mkdir(join(dir, 'web'), { recursive: true });
    await writeFile(join(dir, 'web', 'vercel.json'), '{}');
    assert.equal(JSON.parse((await cli(['stamp'], dir, built)).out).dirty, false);
    // Vercel builds a project with a Root Directory from inside it.
    const below = await cli(['stamp'], join(dir, 'web'), built);
    assert.equal(JSON.parse(below.out).dirty, false);
    assert.match(below.err, /^note: web\/vercel\.json is not counted as uncommitted/m);
    await writeFile(join(dir, 'web', 'vercel.json'), '{"cleanUrls":true}');
    assert.equal(JSON.parse((await cli(['stamp'], dir, built)).out).dirty, true);
    assert.equal(JSON.parse((await cli(['stamp'], join(dir, 'web'), built)).out).dirty, true);
    await rm(join(dir, 'web'), { recursive: true });
    // A file renamed onto vercel.json is gone from where the commit has it.
    await writeFile(join(dir, 'flags.json'), '{}');
    await git(['add', 'flags.json'], { cwd: dir });
    await git([...ID, 'commit', '-q', '-m', 'add flags'], { cwd: dir });
    await git(['rm', '-q', 'vercel.json'], { cwd: dir });
    await git([...ID, 'commit', '-q', '-m', 'drop vercel.json'], { cwd: dir });
    const dropped = { ...vercel, VERCEL_GIT_COMMIT_SHA: await git(['rev-parse', 'HEAD'], { cwd: dir }) };
    await git(['mv', 'flags.json', 'vercel.json'], { cwd: dir });
    const renamed = await cli(['stamp'], dir, dropped);
    assert.equal(JSON.parse(renamed.out).dirty, true);
    assert.match(renamed.err, /warning: 1 uncommitted change \(such as flags\.json\)/);
  });

  it("counts a file renamed onto stamp's own output as gone", async () => {
    const { dir } = await repo();
    await mkdir(join(dir, 'public'), { recursive: true });
    await git(['mv', 'README.md', 'public/version.json'], { cwd: dir });
    const r = await cli(['stamp', '--require-clean', '--out', 'public/version.json'], dir);
    assert.equal(r.code, 1);
    assert.match(r.err, /refusing to stamp a build with 1 uncommitted change \(such as README\.md\)/);
  });

  it('counts the changes git status leaves out: an ignored submodule, and files marked skip-worktree or assume-unchanged', async () => {
    const { dir } = await repo();
    const lib = (await repo()).dir;
    await git(['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', lib, 'lib'], { cwd: dir });
    await git(['config', '-f', '.gitmodules', 'submodule.lib.ignore', 'all'], { cwd: dir });
    await git(['add', '.gitmodules', 'lib'], { cwd: dir });
    await git([...ID, 'commit', '-q', '-m', 'add lib'], { cwd: dir });
    assert.equal(JSON.parse((await cli(['stamp'], dir)).out).dirty, false);
    await writeFile(join(dir, 'lib', 'README.md'), 'edited\n');
    const edited = await cli(['stamp', '--require-clean'], dir);
    assert.equal(edited.code, 1);
    assert.match(edited.err, /refusing to stamp a build with 1 uncommitted change \(such as lib\)/);
    await git(['checkout', '-q', '--', 'README.md'], { cwd: join(dir, 'lib') });
    await git([...ID, 'commit', '-q', '--allow-empty', '-m', 'moved'], { cwd: join(dir, 'lib') });
    await git(['config', 'diff.ignoreSubmodules', 'all'], { cwd: dir });
    assert.equal(JSON.parse((await cli(['stamp'], dir)).out).dirty, true);
    await git(['reset', '-q', '--hard', 'HEAD~1'], { cwd: join(dir, 'lib') });
    assert.equal(JSON.parse((await cli(['stamp'], dir)).out).dirty, false);

    for (const flag of ['--skip-worktree', '--assume-unchanged']) {
      await git(['update-index', flag, 'README.md'], { cwd: dir });
      await writeFile(join(dir, 'README.md'), 'local override\n');
      const hidden = await cli(['stamp', '--require-clean'], dir);
      assert.equal(hidden.code, 1, flag);
      assert.match(hidden.err, /1 uncommitted change \(such as README\.md\)/);
      // Marked but unchanged, or absent from the work tree as in a sparse checkout, it is not a change.
      await writeFile(join(dir, 'README.md'), 'x\n');
      assert.equal(JSON.parse((await cli(['stamp'], dir)).out).dirty, false, flag);
      await rm(join(dir, 'README.md'));
      if (flag === '--skip-worktree') assert.equal(JSON.parse((await cli(['stamp'], dir)).out).dirty, false, flag);
      await git(['update-index', flag.replace('--', '--no-'), 'README.md'], { cwd: dir });
      await git(['checkout', '-q', '--', 'README.md'], { cwd: dir });
    }
  });

  it('writes nothing to the repository, its index included', async () => {
    const { dir } = await repo();
    // A file touched but not changed makes git status refresh, and rewrite, the index.
    const later = new Date(Date.now() + 5000);
    await utimes(join(dir, 'README.md'), later, later);
    const index = await readFile(join(dir, '.git', 'index'));
    assert.equal(JSON.parse((await cli(['stamp'], dir)).out).dirty, false);
    assert.deepEqual(await readFile(join(dir, '.git', 'index')), index);
  });

  it('knows its own output through a symbolic link, stamped again', async () => {
    for (const through of ['cwd', 'out']) {
      const { dir } = await repo();
      const link = join(root, `link-${++counter}`);
      await symlink(dir, link);
      const [cwd, out] = through === 'cwd' ? [link, 'public/version.json'] : [dir, join(link, 'public', 'version.json')];
      for (const time of ['first', 'second']) {
        const r = await cli(['stamp', '--require-clean', '--out', out], cwd);
        assert.equal(r.code, 0, `${time} ${out}: ${r.err}`);
      }
    }
  });

  it('checks the tree for --require-clean with --commit, or refuses when it cannot', async () => {
    const { dir, direct, merges } = await repo();
    const head = await cli(['stamp', '--commit', 'HEAD', '--require-clean'], dir);
    assert.equal(head.code, 0, head.err);
    assert.deepEqual(JSON.parse(head.out), { schema: 'seamkit.version/1', commit: direct, source: 'argument', builtAt: AT, dirty: false });
    await writeFile(join(dir, 'README.md'), 'edited\n');
    assert.equal((await cli(['stamp', '--commit', direct, '--require-clean'], dir)).code, 1);
    // Without --require-clean, --commit stamps as asked.
    assert.equal((await cli(['stamp', '--commit', direct], dir)).code, 0);
    const other = await cli(['stamp', '--commit', merges[0] as string, '--require-clean'], dir);
    assert.equal(other.code, 2);
    assert.match(other.err, /--require-clean cannot tell whether the tree is clean: --commit \S+ is not the commit checked out/);
    const plain = await mkdtemp(join(root, 'plain-'));
    const sha = 'c'.repeat(40);
    assert.match((await cli(['stamp', '--commit', sha, '--require-clean'], plain)).err, /--require-clean cannot tell whether the tree is clean: --commit was given outside a repository/);
    const env = await cli(['stamp', '--require-clean'], plain, { GITHUB_SHA: sha });
    assert.equal(env.code, 2);
    assert.match(env.err, /--require-clean cannot tell whether the tree is clean: this is not a repository/);
    process.env['GIT_TEST_ASSUME_DIFFERENT_OWNER'] = '1';
    try {
      assert.match((await cli(['stamp', '--commit', direct, '--require-clean'], dir)).err, /--require-clean cannot tell whether the tree is clean: git cannot read this repository: fatal: detected dubious ownership/);
    } finally {
      delete process.env['GIT_TEST_ASSUME_DIFFERENT_OWNER'];
    }
  });

  it('stamps without git from the CI variable or --commit, but never a checkout it cannot read', async () => {
    const { dir } = await repo();
    const plain = await mkdtemp(join(root, 'nogit-'));
    const sha = 'c'.repeat(40);
    const path = process.env['PATH'];
    process.env['PATH'] = await mkdtemp(join(root, 'nopath-'));
    try {
      const env = await cli(['stamp'], plain, { GITHUB_SHA: sha });
      assert.equal(env.code, 0, env.err);
      assert.equal(JSON.parse(env.out).source, 'env:GITHUB_SHA');
      const given = await cli(['stamp', '--commit', sha], plain);
      assert.equal(given.code, 0, given.err);
      assert.equal(JSON.parse(given.out).source, 'argument');
      // A checkout is there, and only git could say whether its tree is clean.
      const checkout = await cli(['stamp', '--out', 'public/version.json'], dir, { GITHUB_SHA: sha });
      assert.equal(checkout.code, 2);
      assert.match(checkout.err, /git is not installed, so this checkout cannot be checked for uncommitted changes/);
      assert.equal(existsSync(join(dir, 'public')), false);
      // From below the checkout's top, as a Root Directory build runs, and with GIT_DIR naming it.
      await mkdir(join(dir, 'web'), { recursive: true });
      for (const [cwd, extra] of [[join(dir, 'web'), {}], [plain, { GIT_DIR: join(dir, '.git') }]] as const) {
        const r = await cli(['stamp'], cwd, { GITHUB_SHA: sha, ...extra });
        assert.equal(r.code, 2, cwd);
        assert.match(r.err, /git is not installed/);
        assert.equal((await cli(['stamp', '--commit', sha], cwd, extra)).code, 0);
      }
      assert.equal((await cli(['stamp', '--commit', sha], dir)).code, 0);
    } finally {
      process.env['PATH'] = path;
    }
    // A repository git refuses to read is not taken for no repository.
    await writeFile(join(dir, 'README.md'), 'edited\n');
    process.env['GIT_TEST_ASSUME_DIFFERENT_OWNER'] = '1';
    try {
      const refused = await cli(['stamp', '--require-clean', '--out', 'public/version.json'], dir, { GITHUB_SHA: sha });
      assert.equal(refused.code, 2);
      assert.match(refused.err, /git cannot read this repository, so stamp cannot tell whether the tree is clean: fatal: detected dubious ownership.*safe\.directory/);
      assert.equal(existsSync(join(dir, 'public')), false);
    } finally {
      delete process.env['GIT_TEST_ASSUME_DIFFERENT_OWNER'];
    }
    assert.equal((await cli(['stamp', '--require-clean'], dir, { GITHUB_SHA: sha })).code, 1);
  });

  it('names the branch Vercel built, not the branch of its checkout', async () => {
    const { dir, direct } = await repo();
    await git(['switch', '-q', '-c', 'master'], { cwd: dir });
    const vercel = { VERCEL: '1', VERCEL_GIT_COMMIT_SHA: direct, VERCEL_GIT_COMMIT_REF: 'main' };
    assert.equal(JSON.parse((await cli(['stamp'], dir, vercel)).out).ref, 'main');
    assert.equal(JSON.parse((await cli(['stamp'], dir, { ...vercel, VERCEL_GIT_COMMIT_REF: ' ' })).out).ref, 'master');
    assert.equal(JSON.parse((await cli(['stamp'], dir, { ...vercel, VERCEL_GIT_COMMIT_SHA: 'd'.repeat(40) })).out).ref, 'master');
    assert.equal(JSON.parse((await cli(['stamp'], dir)).out).ref, 'master');
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
