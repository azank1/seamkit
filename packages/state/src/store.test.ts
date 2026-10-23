import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { invariantCheck, parseEventFile, runCheck, type SeamEvent } from '@seamkit/core';
import { git, GitStateStore, NotAGitRepository, runGit, STATE_REF } from './index.js';

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

  it('pushes the ledger without running the project\'s pre-push hook', async () => {
    const remote = join(root, `remote-${++counter}.git`);
    await git(['init', '-q', '--bare', remote], { cwd: root });
    const store = await GitStateStore.open(await repo('hooked'));
    await git(['remote', 'add', 'origin', remote], { cwd: store.cwd });
    const hooks = join(root, `hooks-${counter}`);
    const ran = join(root, `hook-ran-${counter}`);
    await mkdir(hooks);
    await writeFile(join(hooks, 'pre-push'), `#!/bin/sh\necho ran > '${ran}'\necho 'branch names must start with feature/' >&2\nexit 1\n`, { mode: 0o755 });
    await git(['config', 'core.hooksPath', hooks], { cwd: store.cwd });
    await store.append(event(80));
    assert.equal((await store.sync()).status, 'pushed');
    assert.equal(await git(['rev-parse', STATE_REF], { cwd: remote }), await git(['rev-parse', STATE_REF], { cwd: store.cwd }));
    assert.equal(existsSync(ran), false);
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

  it('pushes every one of eight writers that sync at once', async () => {
    const remote = join(root, `remote-${++counter}.git`);
    await git(['init', '-q', '--bare', remote], { cwd: root });
    const writers = await Promise.all(
      Array.from({ length: 8 }, async (_, i) => {
        const store = await GitStateStore.open(await repo(`writer-${i}`));
        await git(['remote', 'add', 'origin', remote], { cwd: store.cwd });
        await store.append(event(40 + i));
        return store;
      }),
    );
    const results = await Promise.all(writers.map((w) => w.sync()));
    assert.ok(results.every((r) => r.status === 'pushed' || r.status === 'merged'), JSON.stringify(results));
    const pushed = await git(['ls-tree', '-r', '--name-only', STATE_REF], { cwd: remote });
    assert.equal(pushed.split('\n').filter((p) => p.startsWith('events/')).length, 8);
  });

  it('gives up after a few tries when the remote refuses a push that no other writer raced', async () => {
    const remote = join(root, `remote-${++counter}.git`);
    await git(['init', '-q', '--bare', remote], { cwd: root });
    const tries = join(root, `tries-${counter}`);
    await writeFile(join(remote, 'hooks', 'pre-receive'), `#!/bin/sh\necho try >> '${tries}'\necho 'refused by policy' >&2\nexit 1\n`, { mode: 0o755 });
    const store = await GitStateStore.open(await repo('refused'));
    await git(['remote', 'add', 'origin', remote], { cwd: store.cwd });
    await store.append(event(50));
    await assert.rejects(store.sync(), /refused by policy/);
    assert.equal((await readFile(tries, 'utf8')).trim().split('\n').length, 3);
  });

  it('keeps tracing and the credentials in a URL out of the errors git reports', async () => {
    const cwd = await repo('trace');
    const url = 'http://x-access-token:s3cr3t-token@127.0.0.1:9/o/r.git';
    const before = process.env['GIT_TRACE'];
    process.env['GIT_TRACE'] = '1';
    try {
      // A job that turned tracing on for itself does not turn it on for seamkit's git.
      const quiet = await runGit(['ls-remote', url], { cwd });
      assert.notEqual(quiet.code, 0);
      assert.ok(!/trace:/.test(quiet.stderr), quiet.stderr);
    } finally {
      if (before === undefined) delete process.env['GIT_TRACE'];
      else process.env['GIT_TRACE'] = before;
    }
    // Whatever git writes, a URL's user name and password are taken out.
    const traced = await runGit(['ls-remote', url], { cwd, env: { GIT_TRACE: '1' } });
    assert.match(traced.stderr, /trace:/);
    assert.match(traced.stderr, /http:\/\/127\.0\.0\.1:9\/o\/r\.git/);
    assert.ok(!traced.stderr.includes('s3cr3t-token'), traced.stderr);
    // A password can hold an @ that is not encoded; none of it is left.
    const at = await runGit(['ls-remote', 'http://vault1@pass2@word3@127.0.0.1:9/o/r.git'], { cwd, env: { GIT_TRACE: '1' } });
    assert.match(at.stderr, /http:\/\/127\.0\.0\.1:9\/o\/r\.git/);
    for (const part of ['vault1', 'pass2', 'word3']) assert.ok(!at.stderr.includes(part), at.stderr);
    // Nor does a quote or a space in it end the user name and password early.
    for (const odd of ["vault1:pass2'tok3@word4", 'vault1:pass2"tok3@word4', 'vault1:pass2 tok3@word4']) {
      const quoted = await runGit(['ls-remote', `http://${odd}@127.0.0.1:9/o/r.git`], { cwd, env: { GIT_TRACE: '1' } });
      assert.match(quoted.stderr, /trace:/);
      for (const part of ['vault1', 'pass2', 'tok3', 'word4']) assert.ok(!quoted.stderr.includes(part), quoted.stderr);
    }
  });

  it('keeps curl tracing and request headers out of the errors an http remote gives', async () => {
    const cwd = await repo('curl');
    const server = createServer((_req, res) => {
      res.writeHead(403);
      res.end('no');
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const { port } = server.address() as AddressInfo;
    const url = `http://s3cr3t-user@127.0.0.1:${port}/o/r.git`;
    const header = ['-c', 'http.extraheader=X-Deploy-Token: s3cr3t-header'];
    const set = { GIT_CURL_VERBOSE: '1', GIT_TRACE_REDACT: '0', GIT_TRACE_REFS: '1', GIT_TRACE_CURL_NO_DATA: '1' };
    const saved = Object.fromEntries([...Object.keys(set), 'GIT_CONFIG_GLOBAL'].map((k) => [k, process.env[k]]));
    try {
      // trace2 can also be turned on in git config, for every git on a machine.
      const traced = join(root, `trace2-${counter}`);
      await writeFile(traced, '[trace2]\n\tnormalTarget = true\n\tperfTarget = 2\n\teventTarget = 1\n\tconfigParams = http.*\n\tenvVars = GIT_*\n');
      for (const env of [{}, set, { GIT_CONFIG_GLOBAL: traced }]) {
        Object.assign(process.env, env);
        const r = await runGit([...header, 'ls-remote', url], { cwd });
        assert.notEqual(r.code, 0);
        assert.match(r.stderr, /^fatal: unable to access '[^']*': The requested URL returned error: 403\n$/);
        assert.ok(!/http\.c:|== Info|Send header|refs\.c|s3cr3t/.test(r.stderr), r.stderr);
      }
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      await new Promise((done) => server.close(done));
    }
  });

  it('keeps its own index and author whatever git variables the environment holds', async () => {
    const cwd = await repo('env');
    await writeFile(join(cwd, 'kept.txt'), 'kept\n');
    await git(['add', 'kept.txt'], { cwd });
    const staged = await git(['ls-files', '--stage'], { cwd });
    const saved = { index: process.env['GIT_INDEX_FILE'], author: process.env['GIT_AUTHOR_NAME'] };
    // A git hook runs with GIT_INDEX_FILE set to the repository's own index.
    process.env['GIT_INDEX_FILE'] = join(cwd, '.git', 'index');
    process.env['GIT_AUTHOR_NAME'] = 'someone else';
    try {
      const store = await GitStateStore.open(cwd);
      await store.append(event(70));
    } finally {
      for (const [k, v] of [['GIT_INDEX_FILE', saved.index], ['GIT_AUTHOR_NAME', saved.author]] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
    assert.equal(await git(['ls-files', '--stage'], { cwd }), staged);
    assert.equal(await git(['log', '-1', '--format=%an', STATE_REF], { cwd }), 'seamkit');
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
