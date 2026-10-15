import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from '@seamkit/state';
import { FakeProduction, GitRepo, discoverVersion, fetchLimited, observeBundle, observeVersion, pageRefs, scriptRefs } from './index.js';

const AT = '2026-10-14T12:00:00.000Z';
const FULL = 'ab'.repeat(20);
const resolveFull = async (reported: string): Promise<string | undefined> => (FULL.startsWith(reported) ? FULL : undefined);

let prod: FakeProduction;
before(async () => {
  prod = await FakeProduction.start({ spaFallback: true });
});
after(async () => {
  await prod.close();
});

describe('bounded HTTP', () => {
  it('reads a response, and reports a status without the body', async () => {
    prod.deploy({ 'a.txt': 'hello', 'big.txt': 'x'.repeat(2000) });
    const ok = await fetchLimited(`${prod.url}a.txt`);
    assert.ok(ok.ok && ok.body.toString() === 'hello');
    assert.deepEqual(await fetchLimited(`${prod.url}nope.txt`), { ok: false, status: 404, reason: 'HTTP 404' });
    assert.match((await fetchLimited(`${prod.url}big.txt`, { maxBytes: 1000 }) as { reason: string }).reason, /larger than 1000 bytes/);
  });

  it('gives up on a server that does not answer, or is not there', async () => {
    prod.failWith('/slow', 'hang');
    assert.deepEqual(await fetchLimited(`${prod.url}slow`, { timeoutMs: 200 }), { ok: false, reason: 'no response within 0.2 s' });
    const gone = await FakeProduction.start();
    const url = gone.url;
    await gone.close();
    assert.match((await fetchLimited(url) as { reason: string }).reason, /^could not connect/);
  });
});

describe('version documents in production', () => {
  it('finds a stamped version document and resolves its commit', async () => {
    prod.deploy({ 'index.html': '<html></html>', 'version.json': JSON.stringify({ schema: 'seamkit.version/1', commit: FULL, dirty: false, source: 'git' }) });
    const obs = await discoverVersion(prod.url, AT, resolveFull);
    assert.equal(obs.status, 'ok');
    assert.equal(obs.url, `${prod.url}version.json`);
    assert.equal(obs.commit, FULL);
    assert.equal(obs.dirty, false);
    assert.match(obs.digest ?? '', /^[0-9a-f]{64}$/);
  });

  it('tries the next path, and keeps an abbreviated commit it cannot place as reported only', async () => {
    prod.deploy({ 'index.html': '<html></html>', 'api/version': '{"sha":"1234567"}' });
    const obs = await discoverVersion(prod.url, AT, resolveFull);
    assert.equal(obs.url, `${prod.url}api/version`);
    assert.equal(obs.reported, '1234567');
    assert.equal(obs.commit, undefined);
  });

  it('says what every path gave when none is a version document', async () => {
    prod.deploy({ 'index.html': '<!doctype html><title>notes</title>' });
    const obs = await discoverVersion(prod.url, AT, resolveFull);
    assert.equal(obs.status, 'unreadable');
    assert.equal(obs.url, `${prod.url}version.json`);
    assert.match(obs.reason ?? '', /\/version\.json: HTTP 404; \/api\/version: the response is a web page/);
    prod.failWith('/version.json', 500);
    assert.deepEqual(await observeVersion(`${prod.url}version.json`, AT, resolveFull), { url: `${prod.url}version.json`, at: AT, status: 'unreadable', reason: 'HTTP 500' });
  });
});

describe('served files', () => {
  const page = '<!doctype html><script type="module" src="/assets/app-1.js"></script><link rel=stylesheet href=\'assets/app.css\'>';
  const app = 'const a = () => import("./chunk-2.js"); const b = "./missing-9.js"; el.dataset.x = "data-sync-state";';

  it('finds marker text in the page, its scripts and their chunks', async () => {
    prod.deploy({ 'index.html': page, 'assets/app-1.js': app, 'assets/app.css': '.x{}', 'assets/chunk-2.js': 'banner("Conflict banner")' });
    const obs = await observeBundle(prod.url, ['data-sync-state', 'Conflict banner', 'only-in-source'], AT);
    assert.equal(obs.status, 'ok');
    assert.equal(obs.complete, true, obs.reason);
    assert.equal(obs.files, 4);
    assert.deepEqual(obs.found, ['Conflict banner', 'data-sync-state']);
    assert.deepEqual(obs.searched, ['Conflict banner', 'data-sync-state', 'only-in-source']);
    assert.ok(prod.requests.includes('/assets/missing-9.js'), 'a guessed path is tried');
  });

  it('is incomplete when a file the page loads cannot be read', async () => {
    prod.deploy({ 'index.html': page, 'assets/app.css': '.x{}' });
    const missing = await observeBundle(prod.url, ['data-sync-state'], AT);
    assert.equal(missing.complete, false);
    assert.match(missing.reason ?? '', /\/assets\/app-1\.js: HTTP 404/);

    prod.deploy({ 'index.html': page, 'assets/app-1.js': '<!doctype html><title>notes</title>', 'assets/app.css': '.x{}' });
    const stale = await observeBundle(prod.url, ['data-sync-state'], AT);
    assert.equal(stale.complete, false);
    assert.match(stale.reason ?? '', /answered with a web page instead of the file/);
  });

  it('reads only its own origin, and says which others it skipped', async () => {
    prod.deploy({ 'index.html': '<script src="https://cdn.example.net/app.js"></script>' });
    const obs = await observeBundle(prod.url, ['data-sync-state'], AT);
    assert.equal(obs.complete, true);
    assert.deepEqual(obs.otherOrigins, ['https://cdn.example.net']);
    assert.equal(obs.files, 1);
  });

  it('stops at its limits and says so', async () => {
    prod.deploy({ 'index.html': page, 'assets/app-1.js': app, 'assets/app.css': '.x{}', 'assets/chunk-2.js': '' });
    const obs = await observeBundle(prod.url, ['data-sync-state'], AT, { maxFiles: 2 });
    assert.equal(obs.complete, false);
    assert.equal(obs.files, 2);
    assert.match(obs.reason ?? '', /limit of 2 files/);
  });

  it('reports an unreachable page as unreadable', async () => {
    prod.deploy({});
    prod.failWith('/', 503);
    const obs = await observeBundle(prod.url, ['data-sync-state'], AT);
    assert.deepEqual(obs, { url: prod.url, at: AT, status: 'unreadable', complete: false, files: 0, bytes: 0, searched: ['data-sync-state'], found: [], reason: 'HTTP 503' });
  });

  it('parses references the way pages and bundlers write them', () => {
    assert.deepEqual(
      pageRefs(`<link rel="modulepreload" href="/m.js"><link rel=preload as=script href=/p.js><link rel="preload" as="font" href="/f.woff2"><link rel="icon" href="/i.png"><SCRIPT SRC='/s.js?v=1&amp;x=2'></SCRIPT>`),
      ['/m.js', '/p.js', '/s.js?v=1&x=2'],
    );
    assert.deepEqual(scriptRefs(`import("./a-1.js");f("../b.css");g('/c.mjs');h("react.js");i("https://x.example/d.js")`), ['./a-1.js', '../b.css', '/c.mjs']);
  });
});

describe('the repository', () => {
  let root: string;
  let dir: string;
  const commits: string[] = [];

  before(async () => {
    root = await mkdtemp(join(tmpdir(), 'seamkit-adapters-test-'));
    const emptyConfig = join(root, 'gitconfig');
    await writeFile(emptyConfig, '');
    process.env['GIT_CONFIG_GLOBAL'] = emptyConfig;
    process.env['GIT_CONFIG_NOSYSTEM'] = '1';
    dir = join(root, 'repo');
    await git(['init', '-q', '-b', 'main', dir], { cwd: root });
    const id = ['-c', 'user.name=dev', '-c', 'user.email=dev@example.invalid'];
    for (const n of [1, 2]) {
      await writeFile(join(dir, `f${n}.txt`), `${n}\n`);
      await git(['add', `f${n}.txt`], { cwd: dir });
      await git([...id, 'commit', '-q', '-m', `change ${n}`], { cwd: dir });
      commits.push(await git(['rev-parse', 'HEAD'], { cwd: dir }));
    }
    await git(['switch', '-q', '-c', 'feature'], { cwd: dir });
    await writeFile(join(dir, 'f3.txt'), '3\n');
    await git(['add', 'f3.txt'], { cwd: dir });
    await git([...id, 'commit', '-q', '-m', 'change 3'], { cwd: dir });
    commits.push(await git(['rev-parse', 'HEAD'], { cwd: dir }));
    await git(['switch', '-q', 'main'], { cwd: dir });
    await git([...id, 'merge', '-q', '--no-ff', '-m', 'Merge pull request #3 from agent/three\n\nAdd three', 'feature'], { cwd: dir });
    commits.push(await git(['rev-parse', 'HEAD'], { cwd: dir }));
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('finds the branch and walks its first-parent history, newest first', async () => {
    const repo = await GitRepo.open(dir);
    const branch = await repo.resolveBranch();
    assert.deepEqual(branch, { name: 'main', head: commits[3] });
    const history = await repo.firstParent(branch.head, 10);
    assert.deepEqual(history.map((c) => c.commit), [commits[3], commits[1], commits[0]]);
    assert.equal(history[0]?.parents.length, 2);
    assert.equal(history[0]?.message, 'Merge pull request #3 from agent/three\n\nAdd three\n');
    assert.deepEqual(await repo.firstParent(branch.head, 0), []);
  });

  it('answers ancestry, and resolves abbreviated commits', async () => {
    const repo = await GitRepo.open(dir);
    assert.deepEqual(await repo.contains(commits[1] as string, commits[0] as string), { contains: true });
    assert.deepEqual(await repo.contains(commits[1] as string, commits[2] as string), { contains: false });
    const unknown = await repo.contains('f'.repeat(40), commits[0] as string);
    assert.equal(unknown.contains, null);
    assert.match(unknown.reason ?? '', /git could not compare/);
    assert.equal(await repo.resolve((commits[2] as string).slice(0, 10)), commits[2]);
    assert.equal(await repo.resolve('fffffff'), undefined);
    assert.equal(await repo.resolve('--all'), undefined);
    assert.equal(await repo.isShallow(), false);
    await assert.rejects(repo.resolveBranch('no-such-branch'), /no branch or commit called no-such-branch/);
  });
});
