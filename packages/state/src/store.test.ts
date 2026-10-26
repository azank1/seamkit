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
import { scrubGitText } from './git.js';

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

  it('merges with the remote without pushing when asked, and says how the two stand', async () => {
    const remote = join(root, `nopush-${++counter}.git`);
    await git(['init', '-q', '--bare', '-b', 'main', remote], { cwd: root });
    const advertised = (): Promise<string> => git(['ls-remote', remote, STATE_REF], { cwd: root });
    const a = await repo('nopush-a');
    await git(['remote', 'add', 'origin', remote], { cwd: a });
    const store = await GitStateStore.open(a);
    await store.append(event(1));
    assert.equal((await store.sync('origin', { push: false })).status, 'ahead');
    assert.equal(await advertised(), '');
    assert.equal((await store.sync()).status, 'pushed');
    const b = await repo('nopush-b');
    await git(['remote', 'add', 'origin', remote], { cwd: b });
    const other = await GitStateStore.open(b);
    assert.equal((await other.sync('origin', { push: false })).status, 'pulled');
    assert.equal((await other.sync('origin', { push: false })).status, 'up_to_date');
    await other.append(event(2));
    await store.append(event(3));
    assert.equal((await store.sync()).status, 'pushed');
    const before = await advertised();
    assert.equal((await other.sync('origin', { push: false })).status, 'merged');
    assert.equal(await advertised(), before);
    assert.equal((await other.list()).length, 3);
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
    // Nor does a slash, a quote or a space in it end the user name and password early.
    for (const odd of ['vault1:pass2/tok3@word4', "vault1:pass2'tok3@word4", 'vault1:pass2"tok3@word4', 'vault1:pass2 tok3@word4']) {
      const quoted = await runGit(['ls-remote', `http://${odd}@127.0.0.1:9/o/r.git`], { cwd, env: { GIT_TRACE: '1' } });
      assert.match(quoted.stderr, /trace:/);
      for (const part of ['vault1', 'pass2', 'tok3', 'word4']) assert.ok(!quoted.stderr.includes(part), quoted.stderr);
    }
    // git and curl end the authority at its first / ? or #, so the host curl names can be a piece of
    // the password, or with a port the user name; neither is left, traced or not. curl takes a name
    // ending in .localhost for this machine without asking a resolver, so no network is involved.
    for (const odd of ['vault1:pass2@tok3.localhost:9/word4', 'vault1:pass2@tok3.localhost:9?word4', 'vault1:pass2@tok3.localhost:9#word4', 'tok3.localhost:9/word4', 'vault1.localhost:1234/word4', 'vault1:pass2@127.0.0.2:9/word4']) {
      for (const env of [{ GIT_TRACE: '1' }, {}]) {
        const named = await runGit(['ls-remote', `http://${odd}@127.0.0.1:9/o/r.git`], { cwd, env });
        assert.match(named.stderr, /http:\/\/127\.0\.0\.1:9\/o\/r\.git/);
        for (const part of odd.split(/[:@/?#.]+/).filter((p) => !/^\d*$/.test(p))) assert.ok(!named.stderr.includes(part), `${odd} left ${part}: ${named.stderr}`);
      }
    }
    // A remote given as <transport>::<address>, or on git's own protocol, is printed with no //.
    for (const odd of ['https::x-access-token:tok3sec@127.0.0.1:9/o/r.git', 'http::tok3sec@127.0.0.1:9/o/r.git', 'git://x-access-token:tok3sec@127.0.0.1:1/o/r.git', 'git://tok3sec@127.0.0.1:1/o/r.git']) {
      for (const env of [{ GIT_TRACE: '1' }, {}]) {
        const bare = await runGit(['ls-remote', odd], { cwd, env });
        assert.notEqual(bare.code, 0);
        assert.ok(!bare.stderr.includes('tok3sec') && !bare.stderr.includes('x-access-token'), `${odd}: ${bare.stderr}`);
      }
    }
    // git ends a proxy's authority at its first / ? or #, and curl quotes what is left.
    for (const proxy of ['http://puser1:ps3cr/et9@127.0.0.1:3128', 'http://puser1:ps3cr?et9@127.0.0.1:3128', 'http://puser1:ps3cr#et9@127.0.0.1:3128', 'http://puser1:ps3cr et9@127.0.0.1:3128']) {
      const r = await runGit(['-c', `http.proxy=${proxy}`, 'ls-remote', 'http://127.0.0.1:9/o/r.git'], { cwd });
      assert.notEqual(r.code, 0);
      for (const part of ['puser1', 'ps3cr', 'et9']) assert.ok(!r.stderr.includes(part), `${proxy} left ${part}: ${r.stderr}`);
    }
    // git's own error carries its arguments, and loses the credentials in them too.
    await assert.rejects(git(['ls-remote', 'http://vault1:tok3sec@127.0.0.1:9/o/r.git'], { cwd }), (err: Error) => !/vault1|tok3sec/.test(err.message));
    // git refuses a URL holding a line break and prints it whole, traced or not, wherever the break and
    // any @ fall; its words are replaced by the reason.
    const split = ['vault1:pass2tok3\n', 'vault1\n:pass2tok3', 'vault1:pass2tok3\r\n', 'me@corp.example:pass2tok3\n', 'vault1\n:pa@tok3', 'vault1:pa@tok3\n', 'me@corp.example\n:tok3', 'vault1:pa@ss2\ntok3\nword4', 'va@ult1\nx:pass2'];
    for (const odd of split) {
      for (const env of [{ GIT_TRACE: '1' }, {}]) {
        const broken = await runGit(['ls-remote', `http://${odd}@127.0.0.1:9/o/r.git`], { cwd, env });
        assert.notEqual(broken.code, 0);
        assert.equal(broken.stderr, "fatal: the remote's URL holds a line break, which git refuses (check the secret it is built from)\n", JSON.stringify(odd));
      }
    }
  });

  it('removes a URL credential split over lines, however its @ and line breaks fall', () => {
    // Text in which a URL runs over lines but git did not refuse it, such as a trace of the command.
    const shapes = ['mex4@corp9.example:pass2tok3\n', 'vault1\n:pak7@tok3', 'vault1:pak7@tok3\n', 'mex4@corp9.example\n:tok3', 'vault1:pak7@ss29\ntok3\nword4', 'usr9:pak7@ss29\r\ntok3\r\n', 'vak7@ult1\nxq79:pass2', 'vault1:pass2tok3\n', 'mex4@corp9.example\n:pak7@tok3'];
    // Each line break with an @ on both sides costs one more pass, so no fixed number of passes will do.
    for (let k = 1; k <= 8; k++) shapes.push(Array.from({ length: k }, (_, i) => `uq${i}x@vq${i}y`).join('\n'));
    for (const odd of shapes) {
      // Quoted, as git prints a command, and bare, as a remote helper's arguments are traced.
      const lines: [string, RegExp][] = [
        [`trace: built-in: git ls-remote 'http://${odd}@127.0.0.1:9/o/r.git'`, /'http:\/\/127\.0\.0\.1:9\/o\/r\.git'\n/],
        [`trace: run_command: git remote-http origin http://${odd}@127.0.0.1:9/o/r.git`, /origin http:\/\/127\.0\.0\.1:9\/o\/r\.git\n/],
      ];
      for (const [line, kept] of lines) {
        const scrubbed = scrubGitText(`${line}\nfatal: unable to access 'http://127.0.0.1:9/o/r.git/': Failed to connect\n`);
        for (const part of odd.split(/[\r\n:@]+/).filter((p) => p !== '')) assert.ok(!scrubbed.includes(part), `${JSON.stringify(odd)} left ${JSON.stringify(part)}: ${scrubbed}`);
        assert.match(scrubbed, kept);
      }
    }
    // Text with no credential is left as git wrote it.
    const plain = "fatal: unable to access 'https://github.example/o/r/': The requested URL returned error: 403\n";
    assert.equal(scrubGitText(plain), plain);
    // Every removal ends at an @, so long text with none after its slashes or letters is passed over at once.
    for (const long of ['//'.repeat(200_000), `${'x'.repeat(400_000)}@`, `${'//x'.repeat(100_000)}\n`]) {
      const started = process.hrtime.bigint();
      scrubGitText(long);
      assert.ok(process.hrtime.bigint() - started < 2_000_000_000n, `${long.length} characters took too long`);
    }
  });

  it('keeps the credentials in a remote that git reads as a local path out of its errors', async () => {
    const cwd = await repo('localpath');
    // A mistyped scheme, or none, makes git read the remote as a path, which its errors quote whole.
    const paths: [string, string[]][] = [
      ['https//vault1:tok3@127.0.0.1:9/o/r.git', ['vault1', 'tok3']],
      ['//vault1:tok3@127.0.0.1:9/o/r.git', ['vault1', 'tok3']],
      ['tok3@127.0.0.1/o/r.git', ['tok3']],
      ['tok3\n@127.0.0.1/o/r.git', ['tok3']],
      ['vault1@pa@tok3\nword4@127.0.0.1/o/r.git', ['vault1', 'tok3', 'word4']],
      // A quote in the credential does not end git's quotes, nor the removal.
      ["tok3'x9@127.0.0.1/o/r.git", ['tok3', 'x9']],
      ["va'ult1@tok3@127.0.0.1/o/r.git", ['va', 'ult1', 'tok3']],
      ["hunter2'\n@127.0.0.1/o/r.git", ['hunter2']],
    ];
    for (const [path, parts] of paths) {
      const r = await runGit(['ls-remote', path], { cwd });
      assert.match(r.stderr, /does not appear to be a git repository/);
      for (const part of parts) assert.ok(!r.stderr.includes(part), `${JSON.stringify(path)} left ${part}: ${r.stderr}`);
    }
    // With a colon and no scheme, git reads host:path and hands ssh the user name or token as the host,
    // which ssh may name in any of its messages. As the checkout's origin, those are hidden wherever
    // they appear, whatever a resolver answers for the name; ssh gives up quickly if one answers.
    const ssh = ['-c', 'core.sshCommand=ssh -o ConnectTimeout=2 -o BatchMode=yes'];
    for (const path of ['vault1:tok3@127.0.0.1/o/r.git', 'ghs_tok3:x-oauth-basic@127.0.0.1/o/r.git']) {
      await git(['remote', 'add', 'origin', path], { cwd });
      const r = await runGit([...ssh, 'ls-remote', 'origin'], { cwd });
      await git(['remote', 'remove', 'origin'], { cwd });
      assert.notEqual(r.code, 0);
      for (const part of ['vault1', 'tok3']) assert.ok(!r.stderr.toLowerCase().includes(part), `${JSON.stringify(path)} left ${part}: ${r.stderr}`);
    }
    // A trace prints a path with a // unquoted, and it loses its credentials there too.
    for (const path of ['https//vault1:tok3@127.0.0.1:9/o/r.git', '//vault1:tok3@127.0.0.1:9/o/r.git']) {
      const traced = await runGit(['ls-remote', path], { cwd, env: { GIT_TRACE: '1' } });
      assert.match(traced.stderr, /trace:/);
      for (const part of ['vault1', 'tok3']) assert.ok(!traced.stderr.includes(part), traced.stderr);
    }
    // The usual way a job adds a token, with the same typo in its base.
    const rewritten = await runGit(['-c', 'url.https//x-access-token:tok3@127.0.0.1:9/.insteadOf=http://127.0.0.1:9/', 'ls-remote', 'http://127.0.0.1:9/o/r.git'], { cwd });
    assert.match(rewritten.stderr, /does not appear to be a git repository/);
    assert.ok(!rewritten.stderr.includes('tok3'), rewritten.stderr);
  });

  it('hides the hosts curl names, which can be part of a password, and keeps the URL beside them', () => {
    const lines: [string, string][] = [
      ['Could not resolve host: tok3.part9', 'Could not resolve host: (host not shown)'],
      ['Could not resolve proxy: tok3', 'Could not resolve proxy: (host not shown)'],
      ["Failed to connect to 127.0.0.2 port 9 after 0 ms: Couldn't connect to server", "Failed to connect to (host not shown) port 9 after 0 ms: Couldn't connect to server"],
      ['Failed to connect to tok3.localhost port 9 after 0 ms', 'Failed to connect to (host not shown) port 9 after 0 ms'],
      ['Failed to connect to proxy tok3 port 8080', 'Failed to connect to proxy (host not shown) port 8080'],
      ["SSL: no alternative certificate subject name matches target host name 'tok3.part9'", "SSL: no alternative certificate subject name matches target host name '(host not shown)'"],
      ['OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to tok3.part9:443', 'OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to (host not shown):443'],
      ["Can't complete SOCKS5 connection to tok3.part9. (4)", "Can't complete SOCKS5 connection to (host not shown) (4)"],
      ['cannot complete SOCKS5 connection to tok3. (1)', 'cannot complete SOCKS5 connection to (host not shown) (1)'],
      ['SOCKS4 connection to tok3 not supported', 'SOCKS4 connection to (host not shown) not supported'],
      ['Failed to resolve "tok3.part9" for SOCKS5 connect.', 'Failed to resolve "(host not shown)" for SOCKS5 connect.'],
      ["Unsupported proxy syntax in 'puser1:ps3cr': Port number was not a decimal number between 0 and 65535", "Unsupported proxy syntax in '(proxy not shown)': Port number was not a decimal number between 0 and 65535"],
      ["Unsupported proxy scheme for 'puser1:p's3cr'", "Unsupported proxy scheme for '(proxy not shown)'"],
      ["Couldn't resolve proxy 'puser1:ps3cr'", "Couldn't resolve proxy '(proxy not shown)'"],
    ];
    const text = lines.map(([line]) => `fatal: unable to access 'http://127.0.0.1:9/o/r.git/': ${line}`).join('\n');
    const scrubbed = scrubGitText(text);
    assert.equal(scrubbed, lines.map(([, line]) => `fatal: unable to access 'http://127.0.0.1:9/o/r.git/': ${line}`).join('\n'));
    // ssh names its host the same ways, keeping the words around it.
    const ssh = 'ssh: Could not resolve hostname tok3: Name or service not known\r\nssh: connect to host tok3 port 22: Connection refused\r\n';
    assert.equal(scrubGitText(ssh), 'ssh: Could not resolve hostname (host not shown): Name or service not known\r\nssh: connect to host (host not shown) port 22: Connection refused\r\n');
  });

  it('hides the credentials git can see wherever its errors show them, in any wording', async () => {
    const cwd = await repo('known');
    await git(['remote', 'add', 'origin', 'https://vault1:tok3sec@127.0.0.1:9/o/r.git'], { cwd });
    await git(['config', 'url.https://x-access-token:ghp_rewr1te@127.0.0.1:9/.insteadOf', 'https://github.example/'], { cwd });
    await git(['config', 'http.https://127.0.0.1:9/.extraheader', `AUTHORIZATION: basic ${Buffer.from('x-access-token:ghs_head3r').toString('base64')}`], { cwd });
    await git(['config', 'remote.origin.proxy', 'http://puser1:ps3cr/et9@127.0.0.1:3128'], { cwd });
    // A message no pattern knows, naming each piece: shown as it was, but for the credentials in it.
    const said = 'vault1 tok3sec ghp_rewr1te ghs_head3r ps3cr puser1 kept';
    const r = await runGit(['-c', `alias.say=!echo '${said} ${Buffer.from('x-access-token:ghs_head3r').toString('base64')}' >&2`, 'say'], { cwd, env: { HTTPS_PROXY: 'http://envuser:envpa55@127.0.0.1:3128' } });
    assert.equal(r.stderr, '*** *** *** *** *** *** kept ***\n');
    const proxied = await runGit(['-c', "alias.say=!echo envuser envpa55 >&2", 'say'], { cwd, env: { HTTPS_PROXY: 'http://envuser:envpa55@127.0.0.1:3128' } });
    assert.equal(proxied.stderr, '*** ***\n');
  });

  it('hides a credential however its address writes it: encoded, holding an @, or starting with its user name', async () => {
    const cases: Array<[string, string, Record<string, string>?]> = [
      ['https://vault1:tok%33sec99@127.0.0.1:9/o/r.git', 'tok3sec99'],
      ['https://vault1:p@ss3cret9@127.0.0.1:9/o/r.git', 'ss3cret9'],
      ['https://deploy:deploy-2026-secret@127.0.0.1:9/o/r.git', 'deploy-2026-secret'],
      ['', 'lowuser lowpa55', { http_proxy: 'http://lowuser:lowpa55@127.0.0.1:3128' }],
      ['', 'alluser allpa55', { all_proxy: 'socks5://alluser:allpa55@127.0.0.1:1080' }],
    ];
    for (const [remote, said, env] of cases) {
      const cwd = await repo('pieces');
      if (remote !== '') await git(['remote', 'add', 'origin', remote], { cwd });
      const r = await runGit(['-c', `alias.say=!echo '${said} kept' >&2`, 'say'], { cwd, env: env ?? {} });
      assert.equal(r.stderr, `${said.split(' ').map(() => '***').join(' ')} kept\n`, said);
    }
  });

  it('hides a credential held only in a push URL, and one that arrives split across writes', async () => {
    const cwd = await repo('pushurl');
    await git(['remote', 'add', 'origin', 'https://127.0.0.1:9/o/r.git'], { cwd });
    await git(['config', 'remote.origin.pushurl', 'https://pusher:ghs_PushOnly123456@127.0.0.1:9/o/r.git'], { cwd });
    const pushed = await runGit(['-c', "alias.say=!echo 'ghs_PushOnly123456 kept' >&2", 'say'], { cwd });
    assert.equal(pushed.stderr, '*** kept\n');
    // GIT_CONFIG makes git config list one file, but the git that failed read every scope.
    const configured = await runGit(['-c', "alias.say=!echo 'ghs_PushOnly123456 kept' >&2", 'say'], { cwd, env: { GIT_CONFIG: '/dev/null' } });
    assert.equal(configured.stderr, '*** kept\n');
    // A header with no scheme holds its token as its one word.
    await git(['config', 'http.extraheader', 'PRIVATE-TOKEN: glpat-HdrTok3n1234'], { cwd });
    assert.equal((await runGit(['-c', "alias.say=!echo 'glpat-HdrTok3n1234 kept' >&2", 'say'], { cwd })).stderr, '*** kept\n');
    // Whatever size the pipe hands over, the credential is hidden in the whole of what git wrote.
    await git(['config', 'remote.origin.pushurl', 'https://x-access-token:ghs_ChunkSecret123456@127.0.0.1:9/o/r.git'], { cwd });
    const split = await runGit(['-c', "alias.say=!printf '%s' 'pre ghs_Chunk' >&2; sleep 0.3; printf '%s' 'Secret123456 tail' >&2", 'say'], { cwd });
    assert.equal(split.stderr, 'pre *** tail');
    const long = await runGit(['-c', `alias.say=!printf '%s' '${'x'.repeat(65528)}ghs_ChunkSecret123456 tail' >&2`, 'say'], { cwd });
    assert.ok(long.stderr.endsWith('x*** tail'), long.stderr.slice(-40));
  });

  it('keeps what a credential helper holds or prints out of the errors git reports', async () => {
    const cwd = await repo('helper');
    const server = createServer((_req, res) => {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="r"' });
      res.end();
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const { port } = server.address() as AddressInfo;
    const url = `http://127.0.0.1:${port}/o/r.git`;
    try {
      // A helper printing a bare token, which git quotes as a line it cannot use.
      const bare = await runGit(['-c', 'credential.helper=!f() { echo "ghp_HelperTok3n0123"; }; f', 'ls-remote', url], { cwd });
      assert.notEqual(bare.code, 0);
      assert.match(bare.stderr, /^warning: invalid credential line: \(not shown\)\nfatal: could not read Username/);
      // A helper printing url= with no scheme, which git quotes twice.
      const noScheme = await runGit(['-c', 'credential.helper=!f() { echo "url=ghp_UrlTok3n55555"; }; f', 'ls-remote', url], { cwd });
      assert.equal(noScheme.stderr, 'warning: url has no scheme: (not shown)\nfatal: credential url cannot be parsed: (not shown)\n');
      // A helper holding a literal token whose first command is missing: the shell prints the helper whole.
      // dash and bash word their error differently; either way the helper it names is hidden.
      const missing = /^\*\*\*[^\n]*: (?:line )?1: missing-helper-cmd: (?:command )?not found\n/;
      const literal = '!f() { missing-helper-cmd; echo username=x-access-token; echo password=ghp_LiteralTok3n98765; }; f';
      await git(['config', 'credential.helper', literal], { cwd });
      const echoed = await runGit(['ls-remote', url], { cwd });
      assert.notEqual(echoed.code, 0);
      assert.match(echoed.stderr, missing);
      // A helper for one URL only is hidden the same way.
      await git(['config', '--unset', 'credential.helper'], { cwd });
      await git(['config', `credential.${url}.helper`, literal.replace('Literal', 'Scoped')], { cwd });
      const scoped = await runGit(['ls-remote', url], { cwd });
      assert.match(scoped.stderr, missing);
      await git(['config', '--unset', `credential.${url}.helper`], { cwd });
      // A helper that traces itself prints each value as the shell expands it, without its quotes.
      const traced: string[] = [];
      for (const value of ['ghp_Bare0Tok3n4567', "'ghp_Single0Tok3n4567'", '"ghp_Double0Tok3n4567"', "'ghp_Spaced0Tok3n with spaces9'", '"ghp_Esc\\"aped0Tok3n"', '"ghp_Joined0Tok3n"\'X9\'', '"ghp_Back\\slash0Tok3n"', 'ghp_Redir0Tok3n>&2']) {
        await git(['config', 'credential.helper', `!f() { set -x; echo username=x; echo password=${value}; }; f`], { cwd });
        const r = await runGit(['ls-remote', url], { cwd });
        const echoes = r.stderr.split('\n').filter((line) => line.startsWith('+ echo'));
        assert.ok(echoes.length > 0 && echoes.every((line) => /^\+ echo '?(?:\w+=)?\*\*\*'?$/.test(line)), r.stderr);
        traced.push(r.stderr);
      }
      // A token that is no name's value, as a printf argument, is one of the words a trace prints.
      await git(['config', 'credential.helper', "!f() { set -x; printf 'username=%s\\npassword=%s\\n' x ghpZ9Print0Tok3n; }; f"], { cwd });
      traced.push((await runGit(['ls-remote', url], { cwd })).stderr);
      for (const text of [bare.stderr, noScheme.stderr, echoed.stderr, scoped.stderr, ...traced]) assert.ok(!/ghp|Tok3n|spaces9/.test(text), text);
    } finally {
      await new Promise((done) => server.close(done));
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
    // Passed to git, these would print this exchange's curl traffic, refs, timings and setup, unredacted. A 403
    // ends it before any packet, so the next test covers the variables that print nothing here.
    const set = { GIT_CURL_VERBOSE: '1', GIT_TRACE_CURL: '1', GIT_TRACE_REDACT: '0', GIT_TRACE_REFS: '1', GIT_TRACE_CURL_NO_DATA: '1', GIT_TRACE_PERFORMANCE: '1', GIT_TRACE_SETUP: '1' };
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

  it('turns off every git trace, a name git has not invented yet included', async () => {
    const cwd = await repo('envdump');
    const names = ['GIT_TRACE', 'GIT_TRACE_PACKET', 'GIT_TRACE_PERFORMANCE', 'GIT_TRACE_SETUP', 'GIT_TRACE_PACKFILE', 'GIT_TRACE_PACK_ACCESS', 'GIT_TRACE_SHALLOW', 'GIT_TRACE_FSMONITOR', 'GIT_TRACE_CURL', 'GIT_TRACE_CURL_NO_DATA', 'GIT_TRACE_REFS', 'GIT_TRACE_SEAMKIT_PROBE', 'GIT_CURL_VERBOSE'];
    const saved = Object.fromEntries([...names, 'GIT_TRACE_REDACT', 'GIT_SSH_COMMAND'].map((k) => [k, process.env[k]]));
    try {
      for (const name of names) process.env[name] = '1';
      process.env['GIT_TRACE_REDACT'] = '0';
      // Other git variables, such as the ssh command a job pushes with, still reach git.
      process.env['GIT_SSH_COMMAND'] = 'ssh -i deploy_key';
      // The environment git hands an alias is the one seamkit gave it.
      const r = await runGit(['-c', 'alias.seamkit-env=!env', 'seamkit-env'], { cwd });
      assert.equal(r.code, 0, r.stderr);
      const vars = r.stdout.toString('utf8').split('\n');
      const left = vars.filter((line) => /^GIT_(TRACE|CURL)/.test(line)).sort();
      assert.deepEqual(left, ['GIT_TRACE2=0', 'GIT_TRACE2_EVENT=0', 'GIT_TRACE2_PERF=0', 'GIT_TRACE_REDACT=1']);
      assert.ok(vars.includes('GIT_SSH_COMMAND=ssh -i deploy_key'), 'GIT_SSH_COMMAND was dropped');
      assert.ok(vars.includes(`GIT_CONFIG_GLOBAL=${process.env['GIT_CONFIG_GLOBAL']}`), 'GIT_CONFIG_GLOBAL was dropped');
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
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
