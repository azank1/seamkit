import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { invariantCheck, parseEventFile, runCheck, type SeamEvent } from '@seamkit/core';
import { git, GitStateStore, NotAGitRepository, STATE_REF } from './index.js';

let root: string;

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'seamkit-state-test-'));
  // Isolate the tests from the developer's own git configuration (signing, hooks, templates).
  const emptyConfig = join(root, 'gitconfig');
  await writeFile(emptyConfig, '');
  process.env['GIT_CONFIG_GLOBAL'] = emptyConfig;
  process.env['GIT_CONFIG_NOSYSTEM'] = '1';
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

let counter = 0;
async function repo(name: string): Promise<string> {
  const dir = join(root, `${name}-${++counter}`);
  await git(['init', '-q', '-b', 'main', dir], { cwd: root });
  return dir;
}

function event(n: number, at = `2026-10-14T12:00:${String(n % 60).padStart(2, '0')}.000Z`): SeamEvent {
  return {
    v: 1,
    kind: 'verdict',
    at,
    actor: { kind: 'agent', harness: 'test' },
    tool: { name: 'seamkit', version: '0.0.0' },
    body: { run: runCheck(invariantCheck, { subject: `inv-${n}`, scope: 'rows', examined: n + 1, violations: 0 }, at) },
  };
}

describe('GitStateStore', () => {
  it('refuses a directory that is not a git repository', async () => {
    const dir = await mkdtemp(join(root, 'plain-'));
    await assert.rejects(GitStateStore.open(dir), NotAGitRepository);
  });

  it('creates the branch on first append and lists valid event files', async () => {
    const store = await GitStateStore.open(await repo('first'));
    assert.equal(await store.exists(), false);
    const r = await store.append(event(1));
    assert.equal(r.created, true);
    const files = await store.list();
    assert.equal(files.length, 1);
    const parsed = parseEventFile(files[0]!.path, files[0]!.content);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.ok && parsed.id, r.id);
  });

  it('treats an identical event as already recorded', async () => {
    const store = await GitStateStore.open(await repo('idem'));
    const e = event(2);
    const first = await store.append(e);
    const second = await store.append(e);
    assert.equal(second.created, false);
    assert.equal(second.commit, first.commit);
    assert.equal((await store.list()).length, 1);
  });

  it('never touches the working tree, the index or HEAD', async () => {
    const dir = await repo('untouched');
    await writeFile(join(dir, 'app.txt'), 'v1\n');
    await git(['add', 'app.txt'], { cwd: dir });
    await git(['-c', 'user.name=dev', '-c', 'user.email=dev@example.invalid', 'commit', '-q', '-m', 'app'], { cwd: dir });
    await writeFile(join(dir, 'app.txt'), 'v2, uncommitted\n');
    const before = {
      head: await git(['rev-parse', 'HEAD'], { cwd: dir }),
      status: await git(['status', '--porcelain'], { cwd: dir }),
    };
    const store = await GitStateStore.open(dir);
    await store.append(event(3));
    await store.append(event(4));
    assert.equal(await git(['rev-parse', 'HEAD'], { cwd: dir }), before.head);
    assert.equal(await git(['status', '--porcelain'], { cwd: dir }), before.status);
    assert.equal(await git(['symbolic-ref', 'HEAD'], { cwd: dir }), 'refs/heads/main');
  });

  it('loses no event when twelve writers append at once', async () => {
    const store = await GitStateStore.open(await repo('race'));
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => store.append(event(10 + i))));
    assert.ok(results.every((r) => r.created));
    const files = await store.list();
    assert.equal(files.length, 12);
    assert.deepEqual(new Set(files.map((f) => f.path)), new Set(results.map((r) => r.path)));
  });

  it('creates the branch with only a README on init, once', async () => {
    const store = await GitStateStore.open(await repo('init'));
    const a = await store.init();
    const b = await store.init();
    assert.equal(a.created, true);
    assert.equal(b.created, false);
    assert.equal(b.commit, a.commit);
    assert.equal(await store.list().then((f) => f.length), 0);
    assert.equal(await git(['ls-tree', '--name-only', STATE_REF], { cwd: store.cwd }), 'README.md');
  });

  it('merges diverged writers through a shared remote without losing or forcing anything', async () => {
    const remote = join(root, `remote-${++counter}.git`);
    await git(['init', '-q', '--bare', remote], { cwd: root });
    const a = await GitStateStore.open(await repo('clone-a'));
    const b = await GitStateStore.open(await repo('clone-b'));
    await git(['remote', 'add', 'origin', remote], { cwd: a.cwd });
    await git(['remote', 'add', 'origin', remote], { cwd: b.cwd });

    assert.equal((await a.sync()).status, 'empty');
    await a.append(event(30));
    assert.equal((await a.sync()).status, 'pushed');

    await b.append(event(31));
    const merged = await b.sync();
    assert.equal(merged.status, 'merged');

    assert.equal((await a.sync()).status, 'pulled');
    const pathsA = (await a.list()).map((f) => f.path);
    const pathsB = (await b.list()).map((f) => f.path);
    assert.equal(pathsA.length, 2);
    assert.deepEqual(pathsA, pathsB);
    assert.equal((await b.sync()).status, 'up_to_date');

    const remoteHead = await git(['rev-parse', STATE_REF], { cwd: remote });
    assert.equal(remoteHead, await a.head());
  });

  it('reports a missing remote instead of failing', async () => {
    const store = await GitStateStore.open(await repo('noremote'));
    assert.equal((await store.sync()).status, 'no_remote');
  });
});

describe('GitStateStore sync with look-alike branches', () => {
  it('reads only the exact state ref from the remote', async () => {
    const remote = join(root, `remote-lookalike-${++counter}.git`);
    await git(['init', '-q', '--bare', remote], { cwd: root });
    const decoy = await GitStateStore.open(await repo('decoy'));
    await decoy.append(event(50));
    // Publish the decoy's history under a branch whose name ends in "seamkit/state".
    const decoyHead = (await decoy.head()) as string;
    await git(['push', '-q', remote, `${decoyHead}:refs/heads/other/seamkit/state`], { cwd: decoy.cwd });

    const store = await GitStateStore.open(await repo('lookalike'));
    await git(['remote', 'add', 'origin', remote], { cwd: store.cwd });
    assert.equal((await store.sync()).status, 'empty');
    assert.equal(await store.exists(), false);
  });
});
