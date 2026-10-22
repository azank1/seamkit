import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { git, GitStateStore, STATE_REF } from '@seamkit/state';
import { detectActor, inert, run, VERSION, type Io } from './cli.js';

const AT = '2026-10-14T09:00:00.000Z';
const MAIN = fileURLToPath(new URL('./main.js', import.meta.url));

let root: string;
let counter = 0;

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'seamkit-cli-test-'));
  const emptyConfig = join(root, 'gitconfig');
  await writeFile(emptyConfig, '');
  process.env['GIT_CONFIG_GLOBAL'] = emptyConfig;
  process.env['GIT_CONFIG_NOSYSTEM'] = '1';
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

interface Captured {
  code: number;
  out: string;
  err: string;
}

async function cli(args: string[], opts: { cwd: string; stdin?: string; env?: Record<string, string> }): Promise<Captured> {
  let out = '';
  let err = '';
  const io: Io = {
    out: (t) => void (out += t),
    err: (t) => void (err += t),
    readStdin: async () => opts.stdin ?? '',
    stdinIsTTY: opts.stdin === undefined,
    env: opts.env ?? {},
    cwd: opts.cwd,
    now: () => AT,
  };
  const code = await run(args, io);
  return { code, out, err };
}

async function plainDir(): Promise<string> {
  return mkdtemp(join(root, `plain-${++counter}-`));
}

async function repo(): Promise<string> {
  const dir = join(root, `repo-${++counter}`);
  await git(['init', '-q', '-b', 'main', dir], { cwd: root });
  return dir;
}

const EMPTY = JSON.stringify({ subject: 'notes.owner_set', scope: 'rows in notes', examined: 0, violations: 0 });
const VIOLATED = JSON.stringify({ subject: 'notes.owner_set', scope: 'rows in notes', examined: 40, violations: 2 });
const HELD = JSON.stringify({ subject: 'notes.owner_set', scope: 'rows in notes', examined: 40, violations: 0 });

describe('seamkit cli', () => {
  it('prints its version and refuses unknown commands and flags with exit 2', async () => {
    const cwd = await plainDir();
    assert.deepEqual(await cli(['version'], { cwd }), { code: 0, out: `${VERSION}\n`, err: '' });
    assert.equal((await cli([], { cwd })).code, 2);
    assert.equal((await cli(['frobnicate'], { cwd })).code, 2);
    assert.equal((await cli(['check', 'invariant', '--no-such-flag'], { cwd })).code, 2);
    assert.equal((await cli(['help'], { cwd })).code, 0);
  });

  it('exits with the outcome of the check: 0 pass, 1 fail, 3 examined nothing', async () => {
    const cwd = await plainDir();
    const empty = await cli(['check', 'invariant', '--input', '-'], { cwd, stdin: EMPTY });
    assert.equal(empty.code, 3);
    assert.match(empty.out, /^EXAMINED NOTHING {2}invariant {2}notes\.owner_set {2}\(no_rows\)/);
    assert.match(empty.out, /a check over zero rows is not a pass/);
    assert.equal((await cli(['check', 'invariant'], { cwd, stdin: VIOLATED })).code, 1);
    assert.equal((await cli(['check', 'invariant'], { cwd, stdin: HELD })).code, 0);
  });

  it('reads input from a file and reports input errors with exit 2', async () => {
    const cwd = await plainDir();
    await writeFile(join(cwd, 'obs.json'), HELD);
    assert.equal((await cli(['check', 'invariant', '--input', 'obs.json'], { cwd })).code, 0);
    const bad = await cli(['check', 'invariant'], { cwd, stdin: '{"subject":"s","scope":"r","examined":1,"violations":5}' });
    assert.equal(bad.code, 2);
    assert.match(bad.err, /input error: violations \(5\) cannot exceed examined \(1\)/);
    assert.equal((await cli(['check', 'invariant'], { cwd, stdin: 'not json' })).code, 2);
    assert.equal((await cli(['check', 'invariant'], { cwd })).code, 2, 'no input and a terminal on stdin');
    assert.equal((await cli(['check', 'nope'], { cwd, stdin: HELD })).code, 2);
  });

  it('prints one JSON document with the outcome and exit code', async () => {
    const cwd = await plainDir();
    const r = await cli(['check', 'invariant', '--json'], { cwd, stdin: VIOLATED });
    const doc = JSON.parse(r.out);
    assert.equal(doc.outcome, 'fail');
    assert.equal(doc.exitCode, 1);
    assert.equal(doc.verdicts[0].reasons[0], '2 of 40 rows violate notes.owner_set');
  });

  it('records only when the state branch exists or --record is given', async () => {
    const plain = await plainDir();
    assert.equal((await cli(['check', 'invariant', '--record'], { cwd: plain, stdin: HELD })).code, 2);

    const dir = await repo();
    const unrecorded = await cli(['check', 'invariant'], { cwd: dir, stdin: HELD });
    assert.match(unrecorded.err, /not recorded/);
    assert.equal(await (await GitStateStore.open(dir)).exists(), false);

    assert.equal((await cli(['state', 'init'], { cwd: dir })).code, 0);
    const recorded = await cli(['check', 'invariant'], { cwd: dir, stdin: HELD, env: { CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'sess-1' } });
    assert.match(recorded.err, /recorded as event [0-9a-f]{12} on seamkit\/state/);
    const listed = JSON.parse((await cli(['state', 'list', '--json'], { cwd: dir })).out);
    assert.equal(listed.length, 1);
    assert.deepEqual(listed[0].outcomes, ['pass']);
  });

  it('verifies and replays a clean ledger, and reports an empty one as examined nothing', async () => {
    const dir = await repo();
    assert.equal((await cli(['state', 'verify'], { cwd: dir })).code, 3);
    assert.equal((await cli(['replay'], { cwd: dir })).code, 3);
    await cli(['state', 'init'], { cwd: dir });
    assert.equal((await cli(['state', 'verify'], { cwd: dir })).code, 3, 'a branch with no events');
    for (const input of [EMPTY, VIOLATED, HELD]) await cli(['check', 'invariant'], { cwd: dir, stdin: input });
    const verify = await cli(['state', 'verify'], { cwd: dir });
    assert.equal(verify.code, 0);
    assert.match(verify.out, /examined: event files \(3\)/);
    const replay = await cli(['replay'], { cwd: dir });
    assert.equal(replay.code, 0, replay.out);
    assert.match(replay.out, /3 verdicts: 3 pass replayed/);
  });

  it('turns an edited event file into a failure for both verify and replay', async () => {
    const dir = await repo();
    await cli(['state', 'init'], { cwd: dir });
    await cli(['check', 'invariant'], { cwd: dir, stdin: VIOLATED });
    const store = await GitStateStore.open(dir);
    const [file] = await store.list();
    assert.ok(file);
    // Rewrite history the way a careless agent might: change the outcome and keep the file name.
    const edited = file.content.replace('"outcome":"fail"', '"outcome":"pass"');
    assert.notEqual(edited, file.content);
    const blob = await git(['hash-object', '-w', '--stdin'], { cwd: dir, input: edited });
    const index = join(root, `index-${++counter}`);
    const env = { GIT_INDEX_FILE: index };
    await git(['read-tree', STATE_REF], { cwd: dir, env });
    await git(['update-index', '--cacheinfo', `100644,${blob},${file.path}`], { cwd: dir, env });
    const tree = await git(['write-tree'], { cwd: dir, env });
    const head = await git(['rev-parse', STATE_REF], { cwd: dir });
    const commit = await git(['commit-tree', '--no-gpg-sign', tree, '-p', head, '-m', 'edit'], {
      cwd: dir,
      env: { GIT_AUTHOR_NAME: 'x', GIT_AUTHOR_EMAIL: 'x@x.invalid', GIT_COMMITTER_NAME: 'x', GIT_COMMITTER_EMAIL: 'x@x.invalid' },
    });
    await git(['update-ref', STATE_REF, commit, head], { cwd: dir });

    const verify = await cli(['state', 'verify'], { cwd: dir });
    assert.equal(verify.code, 1);
    assert.match(verify.out, /does not match the id in the file name/);
    const replay = await cli(['replay'], { cwd: dir });
    assert.equal(replay.code, 1);
    assert.match(replay.out, /the event file cannot be trusted/);
  });

  it('records provenance without trusting it, and refuses an email address as a handle', () => {
    assert.deepEqual(detectActor({}), { kind: 'unknown' });
    assert.deepEqual(detectActor({ CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'abc' }), { kind: 'agent', harness: 'claude-code', session: 'abc' });
    assert.deepEqual(detectActor({ GITHUB_ACTIONS: 'true', CI: 'true' }), { kind: 'ci', harness: 'github-actions' });
    assert.deepEqual(detectActor({ SEAMKIT_HANDLE: 'eng-1' }), { kind: 'unknown', handle: 'eng-1' });
    assert.throws(() => detectActor({ SEAMKIT_HANDLE: 'someone@example.com' }), /not an email address/);
  });

  it('keeps output from reading as a workflow command in a GitHub Actions step', () => {
    assert.equal(inert('ok\n  ::warning::x\n'), 'ok\n\u200b  ::warning::x\n');
    assert.equal(inert('::error::y'), '\u200b::error::y');
    assert.equal(inert('a\r::error::y'), 'a\r\u200b::error::y');
    assert.equal(inert('a\n\u0085\t::x::'), 'a\n\u200b\u0085\t::x::');
    assert.equal(inert('Fix ##[warning]x and ##[y'), 'Fix ##\u200b[warning]x and ##\u200b[y');
    assert.equal(inert('a :: b\nno command here\n'), 'a :: b\nno command here\n');
    const actions = spawnSync(process.execPath, [MAIN, '##[warning]x'], { encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: 'true' } });
    assert.ok(actions.stderr.includes('##\u200b[warning]x') && !actions.stderr.includes('##[warning]'), actions.stderr);
    const elsewhere = spawnSync(process.execPath, [MAIN, '##[warning]x'], { encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: '' } });
    assert.ok(elsewhere.stderr.includes('##[warning]x'), elsewhere.stderr);
  });

  it('runs as a real process with the documented exit codes', async () => {
    const cwd = await plainDir();
    const empty = spawnSync(process.execPath, [MAIN, 'check', 'invariant', '--input', '-'], { cwd, input: EMPTY, encoding: 'utf8' });
    assert.equal(empty.status, 3, empty.stderr);
    const held = spawnSync(process.execPath, [MAIN, 'check', 'invariant', '--input', '-', '--json'], { cwd, input: HELD, encoding: 'utf8' });
    assert.equal(held.status, 0, held.stderr);
    assert.equal(JSON.parse(held.stdout).outcome, 'pass');
    const usage = spawnSync(process.execPath, [MAIN, 'replay', 'zz'], { cwd, encoding: 'utf8' });
    assert.equal(usage.status, 2);
  });
});
