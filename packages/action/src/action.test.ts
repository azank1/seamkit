import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { Verdict } from '@seamkit/core';
import { FakeProduction } from '@seamkit/adapters';
import { git } from '@seamkit/state';
import { run as seamkitRun } from '@seamkit/cli';
import { pushAdvice, runAction, type ActionDeps } from './action.js';
import { CONCLUSIONS, clip, errorReport, jobSummary, readbackReport } from './report.js';
import { defaultBranchOf, deployedCommit, displayUrl, headSha, plainText, readInputs, scrub, skipReason, type GitHubContext } from './github.js';

const AT = '2026-10-21T09:00:00.000Z';
const ID = ['-c', 'user.name=dev', '-c', 'user.email=dev@example.invalid'];

let root: string;
let prod: FakeProduction;
let api: { server: Server; url: string; posts: Record<string, unknown>[]; status: number };
let counter = 0;

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'seamkit-action-test-'));
  const emptyConfig = join(root, 'gitconfig');
  await writeFile(emptyConfig, '');
  process.env['GIT_CONFIG_GLOBAL'] = emptyConfig;
  process.env['GIT_CONFIG_NOSYSTEM'] = '1';
  prod = await FakeProduction.start();
  // A stand-in for the GitHub REST API that keeps every check run it is sent.
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString('utf8')));
    req.on('end', () => {
      api.posts.push({ path: req.url, auth: req.headers['authorization'], ...(JSON.parse(body) as Record<string, unknown>) });
      res.writeHead(api.status, { 'content-type': 'application/json' }).end(JSON.stringify({ html_url: 'https://github.example/o/r/runs/1' }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  api = { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, posts: [], status: 201 };
});

after(async () => {
  await prod.close();
  api.server.closeAllConnections();
  await new Promise((resolve) => api.server.close(resolve));
  await rm(root, { recursive: true, force: true });
});

/**
 * A remote with two merged pull requests, and a clone of it as actions/checkout leaves one: the
 * full history, with the deployed commit checked out. `depth` makes the clone shallow.
 */
async function project(options: { depth?: number; card?: boolean | string } = {}): Promise<{ remote: string; ci: string; commits: string[] }> {
  const n = ++counter;
  const remote = join(root, `remote-${n}.git`);
  const dev = join(root, `dev-${n}`);
  const ci = join(root, `ci-${n}`);
  await git(['init', '-q', '--bare', '-b', 'main', remote], { cwd: root });
  await git(['init', '-q', '-b', 'main', dev], { cwd: root });
  const commits: string[] = [];
  for (const [file, message] of [
    ['README.md', 'Initial commit'],
    ['a.txt', 'Add the list (#1)\n\nThe first change.'],
    ['b.txt', `Add the badge (#2)\n\nThe second change.${options.card ? `\n\n${typeof options.card === 'string' ? options.card : CARD}` : ''}`],
  ] as const) {
    await writeFile(join(dev, file), `${file}\n`);
    await git(['add', file], { cwd: dev });
    await git([...ID, 'commit', '-q', '-m', message], { cwd: dev });
    commits.push(await git(['rev-parse', 'HEAD'], { cwd: dev }));
  }
  await git(['remote', 'add', 'origin', remote], { cwd: dev });
  await git(['push', '-q', 'origin', 'main'], { cwd: dev });
  const depth = options.depth === undefined ? [] : ['--depth', String(options.depth)];
  await git(['clone', '-q', ...depth, `file://${remote}`, ci], { cwd: root });
  return { remote, ci, commits };
}

const CARD = '```seamkit-card\ncard: 1\nintent: Add the badge.\nlayers: [frontend]\ntargets: [web]\nmarkers:\n  - kind: bundle\n    text: "badge-v2-marker"\n```';

const deploy = (commit: string | undefined): void =>
  prod.deploy(commit === undefined ? { 'index.html': '<!doctype html><title>app</title>' } : { 'index.html': '<!doctype html>', 'version.json': JSON.stringify({ schema: 'seamkit.version/1', commit, dirty: false, source: 'git' }) });

/** Production on `commit`, serving the card's marker in a script. */
const servePage = (commit: string): void =>
  prod.deploy({
    'index.html': '<!doctype html><script src="/app.js"></script>',
    'app.js': 'const badge = "badge-v2-marker";',
    'version.json': JSON.stringify({ schema: 'seamkit.version/1', commit, dirty: false, source: 'git' }),
  });

/** A commit on a preview branch, pushed and fetched: deployed somewhere, but never merged. */
async function previewCommit(remote: string, ci: string): Promise<string> {
  const dev = join(root, `dev-preview-${++counter}`);
  await git(['clone', '-q', `file://${remote}`, dev], { cwd: root });
  await git(['switch', '-q', '-c', 'preview'], { cwd: dev });
  await writeFile(join(dev, 'p.txt'), 'p\n');
  await git(['add', 'p.txt'], { cwd: dev });
  await git([...ID, 'commit', '-q', '-m', 'Try the new header'], { cwd: dev });
  await git(['push', '-q', 'origin', 'preview'], { cwd: dev });
  await git(['fetch', '-q', 'origin'], { cwd: ci });
  return git(['rev-parse', 'HEAD'], { cwd: dev });
}

interface Ran {
  code: number;
  logs: string[];
  warnings: string[];
  sleeps: number[];
  outputs: string;
  summary: string;
}

async function act(
  ci: string,
  inputs: Record<string, string>,
  event: Record<string, unknown>,
  extra: Partial<ActionDeps> = {},
  job: { eventName?: string; env?: Record<string, string> } = {},
): Promise<Ran> {
  const n = ++counter;
  const eventPath = join(root, `event-${n}.json`);
  const outputPath = join(root, `output-${n}.txt`);
  const summaryPath = join(root, `summary-${n}.md`);
  await writeFile(eventPath, JSON.stringify(event));
  await writeFile(outputPath, '');
  await writeFile(summaryPath, '');
  const env: Record<string, string> = {
    GITHUB_API_URL: api.url,
    GITHUB_SERVER_URL: 'https://github.example',
    GITHUB_REPOSITORY: 'o/r',
    GITHUB_RUN_ID: '7',
    GITHUB_EVENT_NAME: job.eventName ?? 'deployment_status',
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_SHA: 'f'.repeat(40),
    GITHUB_WORKSPACE: ci,
    GITHUB_OUTPUT: outputPath,
    GITHUB_STEP_SUMMARY: summaryPath,
    INPUT_URL: prod.url,
    INPUT_WAIT: '0',
    INPUT_TOKEN: 'test-token',
    ...job.env,
  };
  for (const [k, v] of Object.entries(inputs)) env[`INPUT_${k.toUpperCase()}`] = v;
  const ran: Ran = { code: -1, logs: [], warnings: [], sleeps: [], outputs: '', summary: '' };
  const before = api.posts.length;
  let clock = 0;
  // A test's own sleep runs as well, never instead: the clock always moves, so a wait always ends.
  const { sleep: alsoSleep, ...rest } = extra;
  ran.code = await runAction({
    env,
    now: () => AT,
    clock: () => clock,
    sleep: async (ms) => {
      ran.sleeps.push(ms);
      clock += ms;
      await alsoSleep?.(ms);
    },
    fetch: (url, init) => fetch(url, init),
    log: (line) => ran.logs.push(line),
    warn: (line) => ran.warnings.push(line),
    ...rest,
  });
  posted = api.posts.slice(before);
  ran.outputs = await readFile(outputPath, 'utf8');
  ran.summary = await readFile(summaryPath, 'utf8');
  return ran;
}

const success = (sha: string): Record<string, unknown> => ({ deployment: { sha, environment: 'Production' }, deployment_status: { state: 'success' }, repository: { default_branch: 'main' } });
const output = (ran: Ran, name: string): string | undefined => new RegExp(`^${name}<<(\\S+)\\n([\\s\\S]*?)\\n\\1$`, 'm').exec(ran.outputs)?.[2];
/** The seamkit CLI in another checkout, as a run elsewhere would use it. */
async function seamkit(args: string[], cwd: string): Promise<number> {
  return seamkitRun(args, { out: () => undefined, err: () => undefined, readStdin: async () => '', stdinIsTTY: true, env: {}, cwd, now: () => AT });
}

/** Merges a change on the remote from a clone of its own, as a merge after this job's checkout does, and returns its commit. */
async function pushChange(remote: string, message: string): Promise<string> {
  const dev = join(root, `dev-push-${++counter}`);
  await git(['clone', '-q', `file://${remote}`, dev], { cwd: root });
  await git([...ID, 'commit', '-q', '--allow-empty', '-m', message], { cwd: dev });
  await git(['push', '-q', 'origin', 'main'], { cwd: dev });
  return git(['rev-parse', 'HEAD'], { cwd: dev });
}

/** The check runs the last act() posted; lastPost() insists there was exactly one. */
let posted: Record<string, unknown>[] = [];
const lastPost = (): Record<string, unknown> => {
  assert.equal(posted.length, 1, `the run posted ${posted.length} check runs, not 1`);
  return posted[0] as Record<string, unknown>;
};

/** The shortest abbreviation of a commit, of at least 7 characters, that holds a letter, so it differs in capitals. */
function lettered(commit: string): string {
  return commit.slice(0, Math.max(7, commit.search(/[a-f]/) + 1));
}

describe('the seamkit action', () => {
  it('passes when production runs the deployed commit, and posts a successful check run on it', async () => {
    const { ci, commits } = await project();
    const head = commits[2] as string;
    deploy(head);
    const ran = await act(ci, {}, success(head));
    assert.equal(ran.code, 0, ran.warnings.join('\n'));
    const post = lastPost();
    assert.equal(post['path'], '/repos/o/r/check-runs');
    assert.equal(post['auth'], 'Bearer test-token');
    assert.equal(post['head_sha'], head);
    assert.equal(post['conclusion'], 'success');
    assert.equal(post['name'], `seamkit readback (${new URL(prod.url).host})`);
    assert.equal(post['details_url'], 'https://github.example/o/r/actions/runs/7');
    assert.equal((post['output'] as { title: string }).title, 'PASS: 3 live of 3');
    assert.equal(output(ran, 'outcome'), 'pass');
    assert.equal(output(ran, 'exit-code'), '0');
    assert.equal(output(ran, 'check-run-url'), 'https://github.example/o/r/runs/1');
    assert.match(ran.summary, /### seamkit readback .*: PASS: 3 live of 3/);
    assert.deepEqual(ran.sleeps, []);
  });

  it('fails a deploy that production does not run, listing the change that is not proven', async () => {
    const { ci, commits } = await project();
    deploy(commits[1]);
    const ran = await act(ci, {}, success(commits[2] as string));
    assert.equal(ran.code, 1);
    const out = lastPost()['output'] as { title: string; summary: string; text: string };
    assert.equal(lastPost()['conclusion'], 'failure');
    assert.equal(out.title, 'FAIL: 1 not proven, 2 live of 3');
    assert.match(out.summary, /\| pr#2 \| FAIL \|/);
    assert.match(out.text, /^```text\nNOT PROVEN {2}1 of 3/);
  });

  it('never posts examined nothing as a success', async () => {
    const { ci, commits } = await project();
    deploy(undefined);
    const ran = await act(ci, {}, success(commits[2] as string));
    assert.equal(ran.code, 3);
    assert.equal(lastPost()['conclusion'], 'failure');
    assert.match((lastPost()['output'] as { title: string }).title, /^EXAMINED NOTHING: /);
    assert.equal(output(ran, 'outcome'), 'examined_nothing');
  });

  it('waits for production to show the deploy, without recording the attempts', async () => {
    const { ci, commits } = await project();
    deploy(commits[1]);
    const ran = await act(ci, { wait: '60', ledger: 'true' }, success(commits[2] as string), {
      sleep: async () => deploy(commits[2]),
    });
    assert.equal(ran.code, 0);
    assert.ok(ran.logs.some((l) => new RegExp(`production reports ${(commits[1] as string).slice(0, 12)}, not the deployed commit ${(commits[2] as string).slice(0, 12)} yet \\(exit 1\\); reading it again in 10s`).test(l)));
    // One recorded run: the attempts while waiting are not written to the ledger.
    const events = await git(['ls-tree', '-r', '--name-only', 'seamkit/state', 'events/'], { cwd: ci });
    assert.equal(events.split('\n').filter((l) => l.length > 0).length, 1);
  });

  it('gives up after the wait, with the last result', async () => {
    const { ci, commits } = await project();
    deploy(commits[1]);
    const ran = await act(ci, { wait: '25' }, success(commits[2] as string));
    assert.equal(ran.code, 1);
    assert.deepEqual(ran.sleeps, [10000, 10000, 5000]);
  });

  it('starts, records to and pushes the ledger, and a later run sees a change leave production', async () => {
    const { remote, ci, commits } = await project();
    deploy(commits[2]);
    const first = await act(ci, { ledger: 'true' }, success(commits[2] as string));
    assert.equal(first.code, 0);
    assert.ok(first.logs.some((l) => /recorded as event [0-9a-f]{12}/.test(l)));
    assert.match(await git(['ls-remote', remote, 'refs/heads/seamkit/state'], { cwd: root }), /refs\/heads\/seamkit\/state$/);

    // ledger: false reads no ledger, even one this checkout holds: the rollback is only not proven.
    deploy(commits[1]);
    const off = await act(ci, { ledger: 'false' }, success(commits[1] as string));
    assert.equal(off.code, 1, off.logs.join('\n'));
    const offOut = lastPost()['output'] as { title: string; summary: string };
    assert.doesNotMatch(offOut.title, /not live/);
    assert.match(offOut.summary, /the ledger was not read \(--no-ledger\)/);
    assert.doesNotMatch(offOut.summary, /seamkit state init/);

    // A fresh checkout, as the next job gets: auto finds the ledger on the remote and uses it. The
    // deploy of an older commit drops a change that was seen live, so it fails as not live.
    const next = join(root, `ci-next-${++counter}`);
    await git(['clone', '-q', `file://${remote}`, next], { cwd: root });
    deploy(commits[1]);
    const second = await act(next, {}, success(commits[1] as string));
    assert.equal(second.code, 1);
    assert.match((lastPost()['output'] as { title: string }).title, /1 not live/);
    const events = await git(['ls-tree', '-r', '--name-only', 'refs/heads/seamkit/state', 'events/'], { cwd: remote });
    assert.equal(events.split('\n').length, 2);
  });

  it('judges a deploy by the commit it deployed, not by a change merged while it was building', async () => {
    const { ci, commits } = await project();
    deploy(commits[1]);
    // Once the ledger holds a run at this address, as the watch records, it tells a change on its
    // way from one a rollback removed, so it scopes the deploy.
    assert.equal((await act(ci, { ledger: 'true' }, {}, {}, { eventName: 'schedule' })).code, 1);
    const ran = await act(ci, {}, success(commits[1] as string));
    assert.equal(ran.code, 0, ran.warnings.join('\n'));
    assert.equal(lastPost()['head_sha'], commits[1]);
    assert.equal((lastPost()['output'] as { title: string }).title, 'PASS: 2 live of 2');
    assert.match((lastPost()['output'] as { summary: string }).summary, new RegExp(`not examined: 1 change merged after the deployed commit ${(commits[1] as string).slice(0, 7)}`));
    // The scheduled watch reads the default branch, where the newer change is not proven yet.
    const watch = await act(ci, {}, {}, {}, { eventName: 'schedule' });
    assert.equal(watch.code, 1);
    assert.equal(lastPost()['head_sha'], 'f'.repeat(40));
  });

  it('keeps the verdict it read when recording it fails, and says it was not recorded', async () => {
    const { ci, commits } = await project();
    deploy(commits[2]);
    // A handle with an @ is refused only when an event is written, so every read passes and the recording fails.
    const ran = await act(ci, { ledger: 'true' }, success(commits[2] as string), {}, { env: { SEAMKIT_HANDLE: 'dev@example.invalid' } });
    assert.equal(ran.code, 0);
    assert.equal(lastPost()['conclusion'], 'success');
    assert.ok(ran.warnings.some((w) => /the verdict was not recorded: .*SEAMKIT_HANDLE must be a handle/.test(w)));
  });

  it('says what to change when the remote refuses the ledger push, by why it refused', async () => {
    for (const [refusal, advice] of [
      ['refused by policy', /the verdict was recorded here but not pushed, so it is lost with this runner; allow this workflow to push the seamkit\/state branch, which a ruleset or branch protection may block, or set ledger: false, which also stops this workflow reading the ledger: .*refused by policy/],
      ['Permission to o/r denied', /not pushed, so it is lost with this runner; give the job "permissions: contents: write": /],
    ] as const) {
      const { remote, ci, commits } = await project();
      await writeFile(join(remote, 'hooks', 'pre-receive'), `#!/bin/sh\nwhile read old new ref; do [ "$ref" = refs/heads/seamkit/state ] && { echo '${refusal}' >&2; exit 1; }; done\nexit 0\n`, { mode: 0o755 });
      deploy(commits[2]);
      const ran = await act(ci, { ledger: 'true' }, success(commits[2] as string));
      assert.equal(ran.code, 0, ran.warnings.join('\n'));
      assert.ok(ran.warnings.some((w) => advice.test(w)), ran.warnings.join('\n'));
      assert.ok(!ran.warnings.some((w) => /concurrency group/.test(w)), ran.warnings.join('\n'));
    }
  });

  it('advises on a failed ledger push by what the error says, and only then', () => {
    assert.match(pushAdvice('seamkit: git ls-remote origin refs/heads/seamkit/state exited 128: remote: Permission to o/r denied; fatal: ... 403') ?? '', /contents: write/);
    assert.match(pushAdvice('seamkit: origin refused the push to seamkit/state while no other writer was pushing: hook declined') ?? '', /ledger: false, which also stops this workflow reading the ledger$/);
    assert.match(pushAdvice('seamkit: git push origin refs/heads/seamkit/state exited 1: ! [rejected] (fetch first)') ?? '', /concurrency group/);
    assert.match(pushAdvice('seamkit: could not synchronise seamkit/state with origin after 12 attempts') ?? '', /concurrency group/);
    assert.equal(pushAdvice('seamkit: state branches disagree about "events/x.json"; one copy has been altered, run seamkit state verify'), undefined);
    // Other git failures during the sync are not a lost race, so they get no advice about one.
    assert.equal(pushAdvice("seamkit: git ls-remote origin refs/heads/seamkit/state exited 128: fatal: unable to access 'https://github.example/o/r/': Could not resolve host: github.example"), undefined);
    assert.equal(pushAdvice('seamkit: git fetch --quiet --no-tags origin +refs/heads/seamkit/state:refs/remotes/origin/seamkit/state exited 128: fatal: the remote end hung up unexpectedly'), undefined);
  });

  it('records nothing when there is no ledger and ledger is auto', async () => {
    const { remote, ci, commits } = await project();
    deploy(commits[2]);
    const ran = await act(ci, {}, success(commits[2] as string));
    assert.equal(ran.code, 0);
    assert.ok(ran.logs.some((l) => /no ledger here or on the remote/.test(l)));
    assert.equal(await git(['ls-remote', remote, 'refs/heads/seamkit/state'], { cwd: root }), '');
  });

  it('fetches the full history of a shallow checkout', async () => {
    const { ci, commits } = await project({ depth: 1 });
    deploy(commits[2]);
    const ran = await act(ci, {}, success(commits[2] as string));
    assert.equal(ran.code, 0, ran.logs.join('\n'));
    assert.ok(ran.logs.some((l) => /the checkout is shallow; fetching the full history/.test(l)));
    assert.equal(await git(['rev-parse', '--is-shallow-repository'], { cwd: ci }), 'false');
  });

  it('skips a deployment that has not succeeded, without a check run, before reading the inputs', async () => {
    const { ci, commits } = await project();
    const before = api.posts.length;
    const ran = await act(ci, { url: '' }, { deployment: { sha: commits[2] }, deployment_status: { state: 'in_progress' } });
    assert.equal(ran.code, 0);
    assert.equal(api.posts.length, before);
    assert.deepEqual(ran.warnings, []);
    assert.equal(output(ran, 'outcome'), 'skipped');
    assert.equal(output(ran, 'exit-code'), '0');
    assert.match(output(ran, 'title') ?? '', /^Skipped: /);
  });

  it('keeps the verdict when GitHub refuses the check run, and says which permission is missing', async () => {
    const { ci, commits } = await project();
    deploy(commits[2]);
    api.status = 403;
    try {
      const ran = await act(ci, {}, success(commits[2] as string));
      assert.equal(ran.code, 0);
      assert.ok(ran.warnings.some((w) => /permissions: checks: write/.test(w)));
      assert.equal(output(ran, 'check-run-url'), undefined);
    } finally {
      api.status = 201;
    }
  });

  it('reports a usage error as no verdict, without the secret the refused url carried', async () => {
    const { ci, commits } = await project();
    const ran = await act(ci, { url: `${prod.url}?token=s3cr3t#s3cr3t`, wait: '60' }, success(commits[2] as string));
    assert.equal(ran.code, 2);
    assert.deepEqual(ran.sleeps, []);
    assert.equal(lastPost()['conclusion'], 'failure');
    assert.match((lastPost()['output'] as { title: string }).title, /^No verdict: --url must not carry a query string/);
    assert.equal(output(ran, 'outcome'), 'error');
    for (const shown of [JSON.stringify(lastPost()), ran.summary, ran.outputs, ...ran.logs, ...ran.warnings]) assert.ok(!shown.includes('s3cr3t'), shown);
  });

  it('keeps a secret out of the reports when the url input is not a url at all', async () => {
    const { ci, commits } = await project();
    for (const url of ['app.example/?token=s3cr3t', 'deploy:s3cr3t@app.example']) {
      const ran = await act(ci, { url }, success(commits[2] as string));
      assert.equal(ran.code, 2);
      for (const shown of [JSON.stringify(lastPost()), ran.summary, ran.outputs, ...ran.logs, ...ran.warnings]) assert.ok(!shown.includes('s3cr3t'), shown);
    }
  });

  it('keeps a secret in the url out of the report of a misconfigured step', async () => {
    const { ci, commits } = await project();
    const ran = await act(ci, { url: 'https://dev:s3cr3t@app.example/?key=s3cr3t', wait: 'soon' }, success(commits[2] as string));
    assert.equal(ran.code, 2);
    assert.equal(lastPost()['name'], 'seamkit readback (app.example)');
    assert.match((lastPost()['output'] as { summary: string }).summary, /for https:\/\/app\.example\/:/);
    for (const shown of [JSON.stringify(lastPost()), ran.summary, ran.outputs, ...ran.logs, ...ran.warnings]) assert.ok(!shown.includes('s3cr3t'), shown);
  });

  it('needs the url input, and shows a misconfigured step on the commit', async () => {
    const { ci, commits } = await project();
    const ran = await act(ci, { url: '' }, success(commits[2] as string));
    assert.equal(ran.code, 2);
    assert.match(ran.warnings[0] ?? '', /the url input is required/);
    assert.equal(lastPost()['head_sha'], commits[2]);
    assert.equal(lastPost()['conclusion'], 'failure');
    assert.match((lastPost()['output'] as { title: string }).title, /^No verdict: the url input is required/);
    assert.equal(output(ran, 'outcome'), 'error');
    assert.equal(output(ran, 'exit-code'), '2');
  });

  it('keeps the deployed commit as the bound when the branch input is set', async () => {
    const { ci, commits } = await project();
    deploy(commits[1]);
    assert.equal((await act(ci, { ledger: 'true' }, {}, {}, { eventName: 'schedule' })).code, 1);
    const ran = await act(ci, { branch: 'main' }, success(commits[1] as string));
    assert.equal(ran.code, 0, ran.logs.join('\n'));
    assert.equal((lastPost()['output'] as { title: string }).title, 'PASS: 2 live of 2');
  });

  it('reads the default branch a schedule runs on, not the stale one a cached checkout points at', async () => {
    const { remote, commits } = await project();
    // The default branch is trunk, one change ahead of a main nobody merges into any more.
    const dev = join(root, `dev-trunk-${++counter}`);
    await git(['clone', '-q', `file://${remote}`, dev], { cwd: root });
    await git(['switch', '-q', '-c', 'trunk'], { cwd: dev });
    await writeFile(join(dev, 'c.txt'), 'c\n');
    await git(['add', 'c.txt'], { cwd: dev });
    await git([...ID, 'commit', '-q', '-m', 'Add the chart (#3)'], { cwd: dev });
    await git(['push', '-q', 'origin', 'trunk'], { cwd: dev });
    // The clone's origin/HEAD still names main. A schedule's payload names no repository; GitHub
    // runs it on the default branch, which GITHUB_REF_NAME names.
    const ci = join(root, `ci-trunk-${++counter}`);
    await git(['clone', '-q', `file://${remote}`, ci], { cwd: root });
    assert.equal(await git(['symbolic-ref', 'refs/remotes/origin/HEAD'], { cwd: ci }), 'refs/remotes/origin/main');
    deploy(commits[2]);
    const ran = await act(ci, {}, { schedule: '*/30 * * * *' }, {}, { eventName: 'schedule', env: { GITHUB_REF_NAME: 'trunk' } });
    assert.equal(ran.code, 1);
    assert.equal((lastPost()['output'] as { title: string }).title, 'FAIL: 1 not proven, 3 live of 4');
  });

  it('stops waiting once production runs the deployed commit, even when the result is not a pass', async () => {
    const { ci, commits } = await project({ card: true });
    deploy(commits[2]);   // the version is right, but the card's marker is not served
    const ran = await act(ci, { wait: '60' }, success(commits[2] as string));
    assert.equal(ran.code, 1);
    assert.deepEqual(ran.sleeps, []);
    assert.ok(ran.logs.some((l) => /production runs the deployed commit/.test(l)));
  });

  it('keeps reading while production still runs the build a rollback replaces, and fails it once it lands', async () => {
    const { ci, commits } = await project();
    deploy(commits[2]);
    assert.equal((await act(ci, { ledger: 'true' }, success(commits[2] as string))).code, 0);
    // The rollback to #1 succeeded, but production serves the old build on the first read.
    const ran = await act(ci, { wait: '60' }, success(commits[1] as string), { sleep: async () => deploy(commits[1]) });
    assert.equal(ran.code, 1);
    assert.deepEqual(ran.sleeps, [10000]);
    assert.equal((lastPost()['output'] as { title: string }).title, 'FAIL: 1 not live, 2 live of 3');
    assert.ok(ran.logs.some((l) => new RegExp(`production reports ${(commits[2] as string).slice(0, 12)}, not the deployed commit`).test(l)));
  });

  it('says so when a rollback has not landed by the end of the wait, and judges what production runs', async () => {
    const { ci, commits } = await project();
    deploy(commits[2]);
    assert.equal((await act(ci, { ledger: 'true' }, success(commits[2] as string))).code, 0);
    const ran = await act(ci, { wait: '20' }, success(commits[1] as string));
    assert.equal(ran.code, 0);
    assert.deepEqual(ran.sleeps, [10000, 10000]);
    assert.match((lastPost()['output'] as { summary: string }).summary, new RegExp(`Production runs ${(commits[2] as string).slice(0, 12)}, which comes after the deployed commit .* if this deploy is a rollback, it has not landed yet`));
  });

  it('fails a deploy of a commit that production does not contain, even when every change is live', async () => {
    const { remote, ci, commits } = await project();
    // A preview built from a branch reports success too, when the job's environment filter is wrong.
    const preview = await previewCommit(remote, ci);
    deploy(commits[2]);
    const ran = await act(ci, { wait: '10' }, success(preview));
    assert.equal(ran.code, 1);
    assert.equal(lastPost()['conclusion'], 'failure');
    assert.equal(lastPost()['head_sha'], preview);
    const out = lastPost()['output'] as { title: string; summary: string };
    assert.equal(out.title, `FAIL: production does not run the deployed commit ${preview.slice(0, 12)}`);
    assert.match(out.summary, /which does not contain the deployed commit .* after waiting 10s/);
    assert.equal(output(ran, 'outcome'), 'fail');
    assert.equal(output(ran, 'exit-code'), '1');
  });

  it('does not wait when production reports no commit and the markers prove the change', async () => {
    const { ci, commits } = await project({ card: true });
    prod.deploy({ 'index.html': '<!doctype html><script src="/app.js"></script>', 'app.js': 'const badge = "badge-v2-marker";' });
    const ran = await act(ci, { wait: '60', pr: '2' }, success(commits[2] as string));
    assert.equal(ran.code, 0, ran.logs.join('\n'));
    assert.deepEqual(ran.sleeps, []);
    assert.match((lastPost()['output'] as { summary: string }).summary, /gave no commit, so whether it runs the deployed commit .* is not known/);
  });

  it('puts the check run on the full commit when the sha input is abbreviated', async () => {
    const { ci, commits } = await project();
    deploy(commits[2]);
    const ran = await act(ci, { sha: (commits[2] as string).slice(0, 9), wait: '60' }, {}, {}, { eventName: 'workflow_dispatch' });
    assert.equal(ran.code, 0, ran.warnings.join('\n'));
    assert.equal(lastPost()['head_sha'], commits[2]);
    assert.deepEqual(ran.sleeps, []);
    assert.doesNotMatch(ran.summary, /comes after the deployed commit/);
  });

  it('puts the check run of a misconfigured step on the full commit when the sha input is abbreviated', async () => {
    const { ci, commits } = await project();
    deploy(commits[2]);
    const ran = await act(ci, { sha: (commits[2] as string).slice(0, 7), wait: 'abc' }, {}, {}, { eventName: 'workflow_dispatch' });
    assert.equal(ran.code, 2, ran.warnings.join('\n'));
    assert.equal(lastPost()['head_sha'], commits[2]);
    assert.match((lastPost()['output'] as { title: string }).title, /^No verdict: /);
    // A branch named like the abbreviation is not the commit it abbreviates; the input is kept.
    const shadow = (commits[1] as string).slice(0, 7);
    await git(['branch', shadow, commits[0] as string], { cwd: ci });
    await act(ci, { sha: shadow, wait: 'abc' }, {}, {}, { eventName: 'workflow_dispatch' });
    assert.equal(lastPost()['head_sha'], shadow);
    // git reads hex in either case; the full commit is posted for both.
    await act(ci, { sha: lettered(commits[2] as string).toUpperCase(), wait: 'abc' }, {}, {}, { eventName: 'workflow_dispatch' });
    assert.equal(lastPost()['head_sha'], commits[2]);
  });

  it('gives no verdict when a tag is named like the abbreviated sha input, rather than judge the tag\'s commit', async () => {
    const { ci, commits } = await project();
    deploy(commits[2]);
    const shadow = lettered(commits[2] as string);
    await git(['tag', shadow, commits[1] as string], { cwd: ci });
    const ran = await act(ci, { sha: shadow, wait: '0' }, {}, {}, { eventName: 'workflow_dispatch' });
    assert.equal(ran.code, 2, ran.logs.join('\n'));
    assert.notEqual(lastPost()['head_sha'], commits[1]);
    assert.equal(lastPost()['conclusion'], 'failure');
    assert.equal((lastPost()['output'] as { title: string }).title.split(';')[0], `No verdict: the deployed commit ${shadow} is also the name of a tag or branch that points at another commit`);
    // A branch and a tag of that name together are still refs, though git finds the name ambiguous.
    await git(['branch', shadow, commits[1] as string], { cwd: ci });
    assert.equal((await act(ci, { sha: shadow, wait: '0' }, {}, {}, { eventName: 'workflow_dispatch' })).code, 2);
    assert.match((lastPost()['output'] as { title: string }).title, /is also the name of a tag or branch/);
    // A branch alone is a ref too, and so is every other name git tries for the text.
    await git(['tag', '-d', shadow], { cwd: ci });
    assert.equal((await act(ci, { sha: shadow, wait: '0' }, {}, {}, { eventName: 'workflow_dispatch' })).code, 2);
    assert.match((lastPost()['output'] as { title: string }).title, /is also the name of a tag or branch/);
    await git(['branch', '-D', shadow], { cwd: ci });
    for (const name of [`refs/${shadow}`, `refs/remotes/${shadow}`, `refs/remotes/${shadow}/HEAD`]) {
      await git(['update-ref', name, commits[1] as string], { cwd: ci });
      assert.equal((await act(ci, { sha: shadow, wait: '0' }, {}, {}, { eventName: 'workflow_dispatch' })).code, 2, name);
      assert.match((lastPost()['output'] as { title: string }).title, /is also the name of a tag or branch/, name);
      await git(['update-ref', '-d', name], { cwd: ci });
    }
    // Hex in capitals is the same abbreviation, and a ref of that name shadows it too.
    await git(['tag', shadow.toUpperCase(), commits[1] as string], { cwd: ci });
    assert.equal((await act(ci, { sha: shadow.toUpperCase(), wait: '0' }, {}, {}, { eventName: 'workflow_dispatch' })).code, 2);
    assert.equal((lastPost()['output'] as { title: string }).title.split(';')[0], `No verdict: the deployed commit ${shadow.toUpperCase()} is also the name of a tag or branch that points at another commit`);
    // A ref named like the sha input that points at the deployed commit itself shadows nothing.
    await git(['tag', shadow, commits[2] as string], { cwd: ci });
    const same = await act(ci, { sha: shadow, wait: '0' }, {}, {}, { eventName: 'workflow_dispatch' });
    assert.equal(same.code, 0, same.logs.join('\n'));
    assert.equal(lastPost()['head_sha'], commits[2]);
    await git(['tag', '-d', shadow], { cwd: ci });
    // The full id is the commit itself, whatever a ref is named.
    for (const target of [commits[2], commits[1]] as string[]) {
      await git(['branch', commits[2] as string, target], { cwd: ci });
      const whole = await act(ci, { sha: commits[2] as string, wait: '0' }, {}, {}, { eventName: 'workflow_dispatch' });
      assert.equal(whole.code, 0, whole.logs.join('\n'));
      assert.equal(lastPost()['head_sha'], commits[2]);
      await git(['branch', '-D', commits[2] as string], { cwd: ci });
    }
    // An annotated tag's own id, full or abbreviated, names the tag, not a commit.
    await git(['-c', 'user.name=dev', '-c', 'user.email=dev@example.invalid', 'tag', '-a', '-m', 'release', 'v1', commits[2] as string], { cwd: ci });
    const tag = await git(['rev-parse', 'v1'], { cwd: ci });
    for (const given of [tag, tag.slice(0, 9)]) {
      assert.equal((await act(ci, { sha: given, wait: '0' }, {}, {}, { eventName: 'workflow_dispatch' })).code, 2);
      assert.match((lastPost()['output'] as { title: string }).title, /^No verdict: the deployed commit [0-9a-f]+ is an annotated tag, not a commit/);
    }
    // A ref is matched by its whole name: one that only starts with the abbreviation shadows nothing.
    const longer = `refs/remotes/${tag.slice(0, 9)}/main`;
    await git(['update-ref', longer, commits[1] as string], { cwd: ci });
    assert.equal((await act(ci, { sha: tag.slice(0, 9), wait: '0' }, {}, {}, { eventName: 'workflow_dispatch' })).code, 2);
    assert.match((lastPost()['output'] as { title: string }).title, /is an annotated tag, not a commit/);
    await git(['update-ref', '-d', longer], { cwd: ci });
    // So does its abbreviation when a blob shares it, though git then finds no single object for it.
    const prefix = tag.slice(0, 5);
    let content = '';
    for (let i = 0; ; i++) {
      content = `blob ${i}\n`;
      if (createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0${content}`).digest('hex').startsWith(prefix)) break;
    }
    await git(['hash-object', '-w', '--stdin'], { cwd: ci, input: content });
    assert.equal((await act(ci, { sha: prefix, wait: '0' }, {}, {}, { eventName: 'workflow_dispatch' })).code, 2);
    assert.match((lastPost()['output'] as { title: string }).title, /is an annotated tag, not a commit/);
    const full = await act(ci, { sha: commits[2] as string, wait: '0' }, {}, {}, { eventName: 'workflow_dispatch' });
    assert.equal(full.code, 0, full.logs.join('\n'));
    assert.equal(lastPost()['head_sha'], commits[2]);
  });

  it('does not let a failed read of the version document end the wait or undo what it saw', async () => {
    const { remote, ci } = await project({ card: true });
    const preview = await previewCommit(remote, ci);
    servePage((await git(['rev-parse', 'origin/main'], { cwd: ci })));
    // The first read reports main's head, which does not contain the preview; every read after it fails.
    const ran = await act(ci, { wait: '30', pr: '2' }, success(preview), { sleep: async () => prod.failWith('/version.json', 503) });
    assert.equal(ran.code, 1, ran.logs.join('\n'));
    assert.deepEqual(ran.sleeps, [10000, 10000, 10000]);
    const out = lastPost()['output'] as { title: string; summary: string };
    assert.equal(out.title, `FAIL: production does not run the deployed commit ${preview.slice(0, 12)}`);
    assert.match(out.summary, /after waiting 30s/);
  });

  it('says how long it really waited when the counted read finds production on another commit', async () => {
    const { ci, commits } = await project();
    deploy(commits[1]);
    const logs: string[] = [];
    const ran = await act(ci, { wait: '60', ledger: 'true' }, success(commits[2] as string), {
      sleep: async () => deploy(commits[2]),
      // Production flips back as soon as the wait has seen the deploy, before the recorded read.
      log: (line) => {
        logs.push(line);
        if (/production runs the deployed commit/.test(line)) deploy(commits[1]);
      },
    });
    assert.equal(ran.code, 1);
    assert.deepEqual(ran.sleeps, [10000]);
    assert.match((lastPost()['output'] as { summary: string }).summary, /does not contain the deployed commit .* after waiting 10s/);
  });

  it('waits on production\'s own version document, not one a card names for another service', async () => {
    const other = await FakeProduction.start();
    try {
      const card = `\`\`\`seamkit-card\ncard: 1\nintent: Ship the api.\nlayers: [function]\ntargets: [api]\nmarkers:\n  - kind: version\n    url: ${other.url}version.json\n\`\`\``;
      const { ci, commits } = await project({ card });
      other.deploy({ 'version.json': JSON.stringify({ schema: 'seamkit.version/1', commit: commits[2], dirty: false, source: 'git' }) });
      deploy(commits[1]);
      const ran = await act(ci, { wait: '20', pr: '2' }, success(commits[2] as string));
      assert.equal(ran.code, 1);
      assert.deepEqual(ran.sleeps, [10000, 10000]);
      assert.equal((lastPost()['output'] as { title: string }).title, `FAIL: production does not run the deployed commit ${(commits[2] as string).slice(0, 12)}`);
    } finally {
      await other.close();
    }
  });

  it('fails a pass while production reports a commit this repository does not have', async () => {
    const { ci, commits } = await project({ card: true });
    servePage('0123456789abcdef0123456789abcdef01234567');
    const ran = await act(ci, { wait: '10', pr: '2' }, success(commits[2] as string));
    assert.equal(ran.code, 1);
    assert.deepEqual(ran.sleeps, [10000]);
    const post = lastPost();
    assert.equal(post['conclusion'], 'failure');
    assert.equal((post['output'] as { title: string }).title, 'FAIL: production runs 0123456789ab, which this repository does not have');
    assert.match((post['output'] as { summary: string }).summary, /a commit this repository does not have even after fetching the branch again/);
  });

  it('says the branch was fetched again when the read after a fetch names another commit this repository does not have', async () => {
    const { ci, commits } = await project({ card: true });
    servePage('0123456789abcdef0123456789abcdef01234567');
    const ran = await act(ci, { wait: '0', pr: '2', ledger: 'false' }, success(commits[2] as string), {
      log: (line) => {
        if (/fetched main again/.test(line)) servePage('89abcdef0123456789abcdef0123456789abcdef');
      },
    });
    assert.equal(ran.code, 1, ran.logs.join('\n'));
    const out = lastPost()['output'] as { title: string; summary: string };
    assert.equal(out.title, 'FAIL: production runs 89abcdef0123, which this repository does not have');
    assert.match(out.summary, /a commit this repository does not have even after fetching the branch again/);
  });

  it('does not claim the branch was fetched again when there was no branch to fetch', async () => {
    const { ci, commits } = await project({ card: true });
    servePage('0123456789abcdef0123456789abcdef01234567');
    const ran = await act(ci, { sha: commits[2] as string, wait: '10', pr: '2' }, {}, {}, { eventName: 'workflow_dispatch' });
    assert.equal(ran.code, 1, ran.logs.join('\n'));
    assert.doesNotMatch(ran.logs.join('\n'), /fetched main again/);
    const out = lastPost()['output'] as { title: string; summary: string };
    assert.equal(out.title, 'FAIL: production runs 0123456789ab, which this repository does not have');
    assert.match(out.summary, /a commit this repository does not have as the branch was fetched for this job/);
    // Recording does not fetch a branch either when there is none to fetch.
    const recorded = await act(ci, { sha: commits[2] as string, wait: '0', pr: '2', ledger: 'true' }, {}, {}, { eventName: 'workflow_dispatch' });
    assert.equal(recorded.code, 1, recorded.logs.join('\n'));
    assert.ok(recorded.logs.some((l) => /recorded as event/.test(l)), recorded.logs.join('\n'));
    const summary = (lastPost()['output'] as { summary: string }).summary;
    assert.match(summary, /a commit this repository does not have as the branch was fetched for this job/);
    assert.doesNotMatch(summary, /even after fetching/);
  });

  it('says the branch was fetched again when the fetch after the wait succeeded, though the one during it failed', async () => {
    const { remote, ci, commits } = await project({ card: true });
    servePage('0123456789abcdef0123456789abcdef01234567');
    const ran = await act(ci, { ledger: 'true', pr: '2' }, success(commits[2] as string), {
      log: (line) => {
        if (/created seamkit\/state/.test(line)) renameSync(remote, `${remote}.away`);
      },
      warn: (line) => {
        if (/could not fetch main from origin again/.test(line)) renameSync(`${remote}.away`, remote);
      },
    });
    assert.equal(ran.code, 1);
    assert.match((lastPost()['output'] as { summary: string }).summary, /a commit this repository does not have even after fetching the branch again/);
  });

  it('says the branch was fetched again when the fetch during the wait succeeded, though the one after it failed', async () => {
    const { remote, ci, commits } = await project({ card: true });
    servePage('0123456789abcdef0123456789abcdef01234567');
    const ran = await act(ci, { ledger: 'true', wait: '0', pr: '2' }, success(commits[2] as string), {
      log: (line) => {
        if (/fetched main again/.test(line)) renameSync(remote, `${remote}.away`);
      },
    });
    renameSync(`${remote}.away`, remote);
    assert.equal(ran.code, 1, ran.logs.join('\n'));
    assert.ok(ran.warnings.some((w) => /could not fetch main from origin again/.test(w)), ran.warnings.join('\n'));
    assert.match((lastPost()['output'] as { summary: string }).summary, /a commit this repository does not have even after fetching the branch again/);
  });

  it('says fetching failed for a commit first seen after the last fetch, which failed, though an earlier one succeeded', async () => {
    const { remote, ci, commits } = await project({ card: true });
    const dev = join(root, `dev-later-${++counter}`);
    await git(['clone', '-q', `file://${remote}`, dev], { cwd: root });
    await git([...ID, 'commit', '-q', '--allow-empty', '-m', 'Add the chart (#3)'], { cwd: dev });
    const later = await git(['rev-parse', 'HEAD'], { cwd: dev });
    // A hand deploy, fetched for in vain; then the deployed commit, which ends the wait.
    servePage('0123456789abcdef0123456789abcdef01234567');
    let landed = false;
    const ran = await act(ci, { ledger: 'true', wait: '10', pr: '2' }, success(commits[2] as string), {
      log: (line) => {
        if (/fetched main again/.test(line)) servePage(commits[2] as string);
        if (landed || !/production runs the deployed commit/.test(line)) return;
        // A merge is deployed after the wait, and origin cannot be reached for the fetch after it.
        landed = true;
        execFileSync('git', ['push', '-q', 'origin', 'main'], { cwd: dev });
        servePage(later);
        renameSync(remote, `${remote}.away`);
      },
    });
    renameSync(`${remote}.away`, remote);
    assert.equal(ran.code, 1, ran.logs.join('\n'));
    const output = lastPost()['output'] as { title: string; summary: string };
    assert.equal(output.title, `FAIL: production runs ${later.slice(0, 12)}, which this repository does not have`);
    assert.match(output.summary, /a commit this repository does not have because fetching the branch again failed/);
  });

  it('says fetching failed when the only fetch, the one after the wait, failed', async () => {
    const { remote, ci, commits } = await project({ card: true });
    servePage(commits[2] as string);
    let swapped = false;
    const ran = await act(ci, { ledger: 'true', wait: '0', pr: '2' }, success(commits[2] as string), {
      // The wait ends on the deployed commit with no fetch; then a hand deploy lands and origin goes away.
      log: (line) => {
        if (swapped || !/production runs the deployed commit/.test(line)) return;
        swapped = true;
        servePage('0123456789abcdef0123456789abcdef01234567');
        renameSync(remote, `${remote}.away`);
      },
    });
    renameSync(`${remote}.away`, remote);
    assert.equal(ran.code, 1, ran.logs.join('\n'));
    assert.ok(ran.warnings.some((w) => /could not fetch main from origin again/.test(w)), ran.warnings.join('\n'));
    assert.match((lastPost()['output'] as { summary: string }).summary, /a commit this repository does not have because fetching the branch again failed/);
  });

  it('says the branch was fetched again for a commit whose own fetch failed, when a fetch after it succeeded', async () => {
    const { remote, ci, commits } = await project({ card: true });
    const hand = '0123456789abcdef0123456789abcdef01234567';
    servePage(hand);
    let flipped = false;
    const ran = await act(ci, { wait: '10', pr: '2', ledger: 'auto' }, success(commits[2] as string), {
      // The fetch for the hand deploy fails; after the sleep another instance reports a second
      // unknown commit, whose fetch succeeds; the read right after it reports the hand deploy again.
      log: (line) => {
        if (/no ledger here/.test(line)) renameSync(remote, `${remote}.away`);
        if (!flipped && /fetched main again/.test(line)) {
          flipped = true;
          servePage(hand);
        }
      },
      sleep: async () => {
        renameSync(`${remote}.away`, remote);
        servePage('fedcba9876543210fedcba9876543210fedcba98');
      },
    });
    assert.equal(ran.code, 1, ran.logs.join('\n'));
    assert.ok(ran.warnings.some((w) => /could not fetch main from origin again/.test(w)), ran.warnings.join('\n'));
    const output = lastPost()['output'] as { title: string; summary: string };
    assert.equal(output.title, 'FAIL: production runs 0123456789ab, which this repository does not have');
    assert.match(output.summary, /a commit this repository does not have even after fetching the branch again/);
  });

  it('says fetching failed for a commit whose own fetches all failed, though one made for another commit succeeded', async () => {
    const { remote, ci, commits } = await project({ card: true });
    const dev = join(root, `dev-later-${++counter}`);
    await git(['clone', '-q', `file://${remote}`, dev], { cwd: root });
    await git([...ID, 'commit', '-q', '--allow-empty', '-m', 'Add the chart (#3)'], { cwd: dev });
    const later = await git(['rev-parse', 'HEAD'], { cwd: dev });
    // A hand deploy on no branch; fetching main for it succeeds and still does not bring it in.
    servePage('0123456789abcdef0123456789abcdef01234567');
    let landed = false;
    const ran = await act(ci, { wait: '20', pr: '2', ledger: 'false' }, success(commits[2] as string), {
      log: (line) => {
        if (landed || !/fetched main again/.test(line)) return;
        // Then a real merge is deployed, and origin cannot be reached for any fetch after it.
        execFileSync('git', ['push', '-q', 'origin', 'main'], { cwd: dev });
        servePage(later);
        renameSync(remote, `${remote}.away`);
        landed = true;
      },
    });
    renameSync(`${remote}.away`, remote);
    assert.equal(ran.code, 1, ran.logs.join('\n'));
    assert.ok(ran.warnings.some((w) => /could not fetch main from origin again/.test(w)), ran.warnings.join('\n'));
    const output = lastPost()['output'] as { title: string; summary: string };
    assert.equal(output.title, `FAIL: production runs ${later.slice(0, 12)}, which this repository does not have`);
    assert.match(output.summary, /a commit this repository does not have because fetching the branch again failed/);
  });

  it('resolves a commit that the fetch after the wait brought in, when the counted read cannot read the version document', async () => {
    const { remote, ci, commits } = await project({ card: true });
    const dev = join(root, `dev-later-${++counter}`);
    await git(['clone', '-q', `file://${remote}`, dev], { cwd: root });
    await git([...ID, 'commit', '-q', '--allow-empty', '-m', 'Add the chart (#3)'], { cwd: dev });
    const later = await git(['rev-parse', 'HEAD'], { cwd: dev });
    let away = false;
    const ran = await act(ci, { wait: '10', ledger: 'true', pr: '2' }, success(commits[2] as string), {
      log: (line) => {
        if (!/created seamkit\/state/.test(line)) return;
        // A later deploy lands, and origin cannot be reached for the fetch during the wait.
        execFileSync('git', ['push', '-q', 'origin', 'main'], { cwd: dev });
        servePage(later);
        renameSync(remote, `${remote}.away`);
        away = true;
      },
      sleep: async () => {
        if (!away) return;
        renameSync(`${remote}.away`, remote);
        away = false;
        prod.failWith('/version.json', 503);
      },
    });
    const output = lastPost()['output'] as { title: string; summary: string };
    assert.equal(ran.code, 0, output.summary);
    assert.match(output.summary, /which comes after the deployed commit/);
  });

  it('reads a version document naming a tag as one naming a commit this repository does not have, as the CLI does', async () => {
    const { ci, commits } = await project({ card: true });
    await git([...ID, 'tag', '-a', '-m', 'release', 'v1', commits[2] as string], { cwd: ci });
    const tag = await git(['rev-parse', 'v1'], { cwd: ci });
    servePage(tag);
    // Every read after the fetch fails, so the run is judged by the read that named the tag.
    const ran = await act(ci, { wait: '10', pr: '2' }, success(commits[2] as string), {
      log: (line) => {
        if (/which this checkout did not have/.test(line)) prod.failWith('/version.json', 503);
      },
    });
    assert.equal(ran.code, 1, ran.logs.join('\n'));
    assert.equal((lastPost()['output'] as { title: string }).title, `FAIL: production runs ${tag.slice(0, 12)}, which this repository does not have`);
  });

  it('fetches the branch again on a later poll when fetching it for a new commit fails, and says when it never could', async () => {
    for (const restore of [true, false]) {
      const { remote, ci, commits } = await project();
      let away = false;
      // After the job's own fetch, a later change is merged and deployed, and origin cannot be
      // reached for the first fetch after that.
      const dev = join(root, `dev-later-${++counter}`);
      await git(['clone', '-q', `file://${remote}`, dev], { cwd: root });
      await git([...ID, 'commit', '-q', '--allow-empty', '-m', 'Add the chart (#3)'], { cwd: dev });
      const later = await git(['rev-parse', 'HEAD'], { cwd: dev });
      const ran = await act(ci, { wait: '30' }, success(commits[2] as string), {
        log: (line) => {
          if (!/no ledger here or on the remote/.test(line)) return;
          execFileSync('git', ['push', '-q', 'origin', 'main'], { cwd: dev });
          deploy(later);
          renameSync(remote, `${remote}.away`);
          away = true;
        },
        sleep: async () => {
          if (restore && away) {
            renameSync(`${remote}.away`, remote);
            away = false;
          }
        },
      });
      if (away) renameSync(`${remote}.away`, remote);
      // One fetch a poll at most: one per read while origin stays away.
      const failures = ran.warnings.filter((w) => /could not fetch main from origin again/.test(w)).length;
      assert.equal(failures, restore ? 1 : ran.sleeps.length + 1, ran.warnings.join('\n'));
      const output = lastPost()['output'] as { title: string; summary: string };
      if (restore) {
        assert.equal(ran.code, 0, output.summary);
        assert.match(output.title, /^PASS/);
      } else {
        assert.notEqual(ran.code, 0);
        assert.match(output.summary, /a commit this repository does not have because fetching the branch again failed/);
      }
    }
  });

  it('keeps a read that named a commit this repository lacks, though every read after the fetch fails', async () => {
    const { ci, commits } = await project({ card: true });
    // A rollback to #1 while production still runs #2, whose card's marker the page serves.
    servePage(commits[2] as string);
    const unknown = '0123456789abcdef0123456789abcdef01234567';
    let served = false;
    const ran = await act(ci, { wait: '20', pr: '2' }, success(commits[1] as string), {
      sleep: async () => {
        if (!served) servePage(unknown);
        served = true;
      },
      log: (line) => {
        if (/which this checkout did not have/.test(line)) prod.failWith('/version.json', 503);
      },
    });
    assert.equal(ran.code, 1);
    assert.equal((lastPost()['output'] as { title: string }).title, 'FAIL: production runs 0123456789ab, which this repository does not have');
  });

  it('judges by the commit the fetch brought in, when the read after it fails', async () => {
    const { remote, ci, commits } = await project({ card: true });
    servePage(commits[1] as string);
    let third = '';
    const ran = await act(ci, { wait: '20', pr: '2' }, success(commits[2] as string), {
      sleep: async () => {
        if (third !== '') return;
        third = await pushChange(remote, 'Add the chart (#3)');
        servePage(third);
      },
      log: (line) => {
        if (/which this checkout did not have/.test(line)) prod.failWith('/version.json', 503);
      },
    });
    assert.equal(ran.code, 0, ran.logs.join('\n'));
    assert.match((lastPost()['output'] as { summary: string }).summary, new RegExp(`Production runs ${third.slice(0, 12)}, which comes after the deployed commit`));
  });

  it('fetches the branch again for each new commit production reports, one poll after another', async () => {
    const { remote, ci, commits } = await project();
    deploy(commits[1]);
    const later: string[] = [];
    const ran = await act(ci, { wait: '30' }, success(commits[2] as string), {
      sleep: async () => {
        if (later.length === 2) return;
        later.push(await pushChange(remote, `Add part ${later.length + 3} (#${later.length + 3})`));
        deploy(later[later.length - 1]);
      },
    });
    assert.equal(ran.code, 0, ran.logs.join('\n'));
    assert.equal(ran.logs.filter((l) => /which this checkout did not have/.test(l)).length, 2);
    assert.equal((lastPost()['output'] as { title: string }).title, 'PASS: 5 live of 5');
  });

  it('ends the wait when production names a new commit on every read', async () => {
    const { ci, commits } = await project();
    let reads = 0;
    const fresh = (): string => (++reads).toString(16).padStart(40, 'a');
    deploy(fresh());
    // A new commit for each fetch, up to a point, so that a wait that never ends fails here instead of hanging.
    const ran = await act(ci, { wait: '0' }, success(commits[2] as string), {
      log: (line) => {
        if (/which this checkout did not have/.test(line) && reads < 6) deploy(fresh());
      },
    });
    assert.equal(reads, 2);
    assert.deepEqual(ran.sleeps, []);
    assert.equal(ran.code, 3, ran.logs.join('\n'));
    assert.match((lastPost()['output'] as { title: string }).title, /^EXAMINED NOTHING/);
  });

  it('keeps waiting while production serves no version document and nothing passes yet', async () => {
    const { ci, commits } = await project();
    deploy(undefined);
    const ran = await act(ci, { wait: '60' }, success(commits[2] as string), { sleep: async () => deploy(commits[2]) });
    assert.equal(ran.code, 0);
    assert.deepEqual(ran.sleeps, [10000]);
  });

  it('reads the branch as the remote has it, not where actions/checkout pinned it for a late deploy', async () => {
    const { remote, ci, commits } = await project();
    deploy(commits[2]);
    assert.equal((await act(ci, { ledger: 'true' }, success(commits[2] as string))).code, 0);
    // The deploy of #1 finishes after the deploy of #2. actions/checkout with fetch-depth: 0 points
    // origin/main and main at the event's commit, because main has moved on.
    // Every spelling of the branch means the remote's main: github.ref's form, and origin's.
    for (const branch of ['', 'main', 'refs/heads/main', 'heads/main', 'origin/main', 'remotes/origin/main', 'refs/remotes/origin/main', 'origin/HEAD', 'refs/remotes/origin/HEAD']) {
      const late = join(root, `ci-late-${++counter}`);
      await git(['clone', '-q', `file://${remote}`, late], { cwd: root });
      await git(['update-ref', 'refs/remotes/origin/main', commits[1] as string], { cwd: late });
      await git(['checkout', '-q', '-B', 'main', commits[1] as string], { cwd: late });
      deploy(commits[1]);
      const ran = await act(late, { branch }, success(commits[1] as string));
      assert.equal(ran.code, 1, `branch "${branch}": ${ran.logs.join('\n')}`);
      assert.match((lastPost()['output'] as { title: string }).title, /1 not live/);
    }
  });

  it('reads a deploy branch that is not the default one as the remote has it, whatever its name', async () => {
    // A branch may even be named refs/<x>: it is still the remote's branch that is read.
    for (const [name, input] of [['release', 'release'], ['release+1', 'release+1'], ['refs/rel', 'refs/heads/refs/rel']] as const) {
      const { ci, commits } = await project();
      await git(['push', '-q', 'origin', `${commits[2] as string}:refs/heads/${name}`], { cwd: ci });
      deploy(commits[2]);
      assert.equal((await act(ci, { ledger: 'true', branch: input }, success(commits[2] as string))).code, 0);
      const late = join(root, `ci-late-${++counter}`);
      await git(['clone', '-q', `file://${await git(['remote', 'get-url', 'origin'], { cwd: ci })}`, late], { cwd: root });
      await git(['update-ref', `refs/remotes/origin/${name}`, commits[1] as string], { cwd: late });
      await git(['checkout', '-q', '-B', name, commits[1] as string], { cwd: late });
      deploy(commits[1]);
      const ran = await act(late, { branch: input }, success(commits[1] as string));
      assert.equal(ran.code, 1, `${name}: ${ran.logs.join('\n')}`);
      assert.match((lastPost()['output'] as { title: string }).title, /1 not live/);
      assert.deepEqual(ran.warnings, []);
    }
  });

  it('gives no verdict when the branch it reads cannot be fetched or is not a branch, since the job\'s own commit would hide a rollback', async () => {
    const { ci, commits } = await project();
    deploy(commits[2]);
    for (const [branch, message] of [
      ['nope', /^could not fetch nope from origin, so changes merged since this job's commit cannot be examined: /],
      ['HEAD', /^the branch input HEAD is not a branch name; give the branch changes are merged into, such as main$/],
      ['refs/tags/v1', /^could not fetch refs\/tags\/v1 from origin/],
    ] as const) {
      const ran = await act(ci, { branch }, success(commits[2] as string));
      assert.equal(ran.code, 2, branch);
      assert.equal(output(ran, 'outcome'), 'error');
      const post = lastPost();
      assert.equal(post['conclusion'], 'failure');
      assert.match((post['output'] as { title: string }).title, /^No verdict: /);
      assert.ok(message.test((post['output'] as { title: string }).title.replace(/^No verdict: /, '')), `${branch}: ${(post['output'] as { title: string }).title}`);
      assert.ok(ran.warnings.some((w) => message.test(w.replace(/^seamkit: /, ''))), `${branch}: ${ran.warnings.join('\n')}`);
    }
  });

  it('gives no verdict when the branch the checkout pinned cannot be fetched, rather than read the pin', async () => {
    const { remote, ci, commits } = await project();
    deploy(commits[2]);
    assert.equal((await act(ci, { ledger: 'true' }, success(commits[2] as string))).code, 0);
    // A rollback to #1, in a checkout that pinned origin/main at #1 and then lost its remote.
    const late = join(root, `ci-late-${++counter}`);
    await git(['clone', '-q', `file://${remote}`, late], { cwd: root });
    await git(['update-ref', 'refs/remotes/origin/main', commits[1] as string], { cwd: late });
    await git(['checkout', '-q', '-B', 'main', commits[1] as string], { cwd: late });
    await git(['remote', 'set-url', 'origin', `file://${remote}-gone`], { cwd: late });
    deploy(commits[1]);
    const ran = await act(late, {}, success(commits[1] as string));
    assert.equal(ran.code, 2, ran.logs.join('\n'));
    assert.equal(output(ran, 'outcome'), 'error');
    assert.match((lastPost()['output'] as { title: string }).title, /^No verdict: could not fetch main from origin, so changes merged since this job's commit cannot be examined/);
  });

  it('fetches the branch again when production reports a commit merged and deployed since the fetch', async () => {
    const { remote, ci, commits } = await project();
    deploy(commits[1]);
    let once = false;
    let third = '';
    const ran = await act(ci, { wait: '60' }, success(commits[2] as string), {
      sleep: async () => {
        if (once) return;
        once = true;
        // #3 merges and its deploy lands before this run sees the deploy of #2.
        const dev = join(root, `dev-later-${++counter}`);
        await git(['clone', '-q', `file://${remote}`, dev], { cwd: root });
        await writeFile(join(dev, 'c.txt'), 'c\n');
        await git(['add', 'c.txt'], { cwd: dev });
        await git([...ID, 'commit', '-q', '-m', 'Add the chart (#3)'], { cwd: dev });
        await git(['push', '-q', 'origin', 'main'], { cwd: dev });
        third = await git(['rev-parse', 'HEAD'], { cwd: dev });
        deploy(third);
      },
    });
    assert.equal(ran.code, 0, ran.logs.join('\n'));
    const post = lastPost();
    assert.equal(post['conclusion'], 'success');
    const out = post['output'] as { title: string; summary: string };
    assert.match(out.summary, new RegExp(`Production runs ${third.slice(0, 12)}, which comes after the deployed commit`));
    // The verdict is read again once the branch holds #3, so #3 is judged and nothing is left unknown.
    assert.equal(out.title, 'PASS: 4 live of 4');
    assert.ok(!out.summary.includes('does not have'), out.summary);
  });

  it('fetches the branch again before the counted read, for a deploy that lands just after the wait', async () => {
    const { remote, ci, commits } = await project();
    deploy(commits[2]);
    let third = '';
    const ran = await act(ci, { ledger: 'true', wait: '60' }, success(commits[2] as string), {
      log: (line) => {
        if (third !== '' || !/production runs the deployed commit/.test(line)) return;
        const dev = join(root, `dev-after-${++counter}`);
        execFileSync('git', ['clone', '-q', `file://${remote}`, dev], { cwd: root });
        execFileSync('git', [...ID, 'commit', '-q', '--allow-empty', '-m', 'Add the chart (#3)'], { cwd: dev });
        execFileSync('git', ['push', '-q', 'origin', 'main'], { cwd: dev });
        third = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dev }).toString().trim();
        deploy(third);
      },
    });
    assert.equal(ran.code, 0, ran.logs.join('\n'));
    const out = lastPost()['output'] as { title: string; summary: string };
    assert.equal(out.title, 'PASS: 4 live of 4');
    assert.match(out.summary, new RegExp(`Production runs ${third.slice(0, 12)}, which comes after`));
  });

  it('reads production again after fetching the branch, even when the wait ends at that read', async () => {
    const { remote, ci, commits } = await project();
    deploy(commits[1]);
    let third = '';
    // One poll: #3 merges and deploys during it, after this job fetched the branch, and the read
    // that first reports #3 is the wait's last.
    const ran = await act(ci, { wait: '10' }, success(commits[2] as string), {
      sleep: async () => {
        const dev = join(root, `dev-last-${++counter}`);
        await git(['clone', '-q', `file://${remote}`, dev], { cwd: root });
        await writeFile(join(dev, 'c.txt'), 'c\n');
        await git(['add', 'c.txt'], { cwd: dev });
        await git([...ID, 'commit', '-q', '-m', 'Add the chart (#3)'], { cwd: dev });
        await git(['push', '-q', 'origin', 'main'], { cwd: dev });
        third = await git(['rev-parse', 'HEAD'], { cwd: dev });
        deploy(third);
      },
    });
    assert.equal(ran.sleeps.length, 1);
    assert.equal(ran.code, 0, ran.logs.join('\n'));
    const out = lastPost()['output'] as { title: string; summary: string };
    assert.equal(out.title, 'PASS: 4 live of 4');
    assert.match(out.summary, new RegExp(`Production runs ${third.slice(0, 12)}, which comes after`));
  });

  it('fetches the ledger again after the wait, so the run that counts sees what other runs pushed meanwhile', async () => {
    const { remote, ci, commits } = await project();
    deploy(commits[0]);
    // The ledger's first run here judges every change, so it fails; it is recorded all the same.
    assert.ok((await act(ci, { ledger: 'true' }, success(commits[0] as string))).logs.some((l) => /recorded as event/.test(l)));
    // While this run waits for the deploy of #1, a later deploy of #2 serves and a watch run
    // elsewhere records it live and pushes; then a rollback to #1 lands.
    const watch = join(root, `ci-watch-${++counter}`);
    await git(['clone', '-q', `file://${remote}`, watch], { cwd: root });
    let once = false;
    deploy(commits[0]);
    const ran = await act(ci, { wait: '60' }, success(commits[1] as string), {
      sleep: async () => {
        if (once) return;
        once = true;
        deploy(commits[2]);
        assert.equal(await seamkit(['state', 'sync'], watch), 0);
        assert.equal(await seamkit(['readback', '--url', prod.url], watch), 0);
        assert.equal(await seamkit(['state', 'sync'], watch), 0);
        deploy(commits[1]);
      },
    });
    assert.equal(ran.code, 1, ran.logs.join('\n'));
    assert.match((lastPost()['output'] as { title: string }).title, /1 not live/);
  });

  it('keeps the verdict and the check run when the step outputs cannot be written', async () => {
    const { ci, commits } = await project();
    deploy(commits[2]);
    const ran = await act(ci, {}, success(commits[2] as string), {}, { env: { GITHUB_OUTPUT: root } });
    assert.equal(ran.code, 0);
    assert.equal(lastPost()['conclusion'], 'success');
    assert.ok(ran.warnings.some((w) => /could not write the step outputs or summary/.test(w)));
  });
});

describe('action inputs and reports', () => {
  const readbackSummary: Verdict = { check: 'readback', subject: 'readback', outcome: 'fail', examined: [], notExamined: [], evidence: [], reasons: ['1 of 1 changes not live'], inputs: 'sha256:0', at: AT };
  const ctx = (eventName: string): GitHubContext => ({
    apiUrl: '',
    serverUrl: '',
    repository: 'o/r',
    runId: '',
    eventName,
    eventPath: '',
    sha: 'job-sha',
    refName: 'trunk',
    workspace: '',
    outputPath: '',
    summaryPath: '',
  });

  it('attaches the check run to the deployed commit, the other workflow\'s, or the pull request\'s head', () => {
    assert.equal(headSha(ctx('deployment_status'), { deployment: { sha: 'dep' } }, ''), 'dep');
    assert.equal(headSha(ctx('workflow_run'), { workflow_run: { head_sha: 'wr' } }, ''), 'wr');
    assert.equal(headSha(ctx('push'), {}, ''), 'job-sha');
    assert.equal(headSha(ctx('deployment_status'), { deployment: { sha: 'dep' } }, 'given'), 'given');
    assert.equal(headSha(ctx('pull_request'), { pull_request: { head: { sha: 'pr-head' } } }, ''), 'pr-head');
    assert.equal(deployedCommit(ctx('pull_request'), { pull_request: { head: { sha: 'pr-head' } } }, ''), undefined);
    assert.equal(deployedCommit(ctx('schedule'), {}, 'given'), 'given');
  });

  it('skips a failed deploy workflow, and one that ran for a pull request', () => {
    assert.match(skipReason(ctx('workflow_run'), { workflow_run: { conclusion: 'failure' } }) ?? '', /concluded failure/);
    assert.match(skipReason(ctx('workflow_run'), { workflow_run: { conclusion: 'success', event: 'pull_request' } }) ?? '', /ran for a pull request/);
    assert.equal(skipReason(ctx('workflow_run'), { workflow_run: { conclusion: 'success' } }), undefined);
    assert.equal(skipReason(ctx('schedule'), {}), undefined);
  });

  it('finds the default branch in the payload, or for a schedule in the ref it runs on', () => {
    assert.equal(defaultBranchOf(ctx('deployment_status'), { repository: { default_branch: 'main' } }), 'main');
    assert.equal(defaultBranchOf(ctx('schedule'), { schedule: '0 * * * *' }), 'trunk');
    assert.equal(defaultBranchOf(ctx('push'), {}), undefined);
  });

  it('shows a url without its user name, password, query or fragment', () => {
    assert.equal(displayUrl('https://u:p@a.example/app?k=v#f'), 'https://a.example/app');
    assert.equal(displayUrl('not a url'), 'the url input');
    assert.equal(displayUrl('deploy:s3cr3t@a.example'), 'the url input');
    assert.equal(displayUrl('https://deploy:s3cr3t@'), 'the url input');
  });

  it('fences every log write, whatever form a workflow command in it takes', () => {
    for (const text of ['LIVE 3 of 3', 'pr#9 ok\n  ::add-mask::x', 'docs only\n\u0085::warning::forged', 'Fix the list ##[warning]forged (#8)']) {
      assert.equal(plainText(text, 'tok'), `::stop-commands::tok\n${text}\n::tok::\n`);
    }
  });

  it('keeps a change\'s words on one table row, and puts the action\'s notes first', () => {
    const verdict = (subject: string, outcome: 'pass' | 'fail'): Verdict => ({ ...readbackSummary, subject, outcome, state: outcome === 'pass' ? 'live' : 'not_live', reasons: ['line one\nline | two'] });
    const r = readbackReport('fail', [readbackSummary, verdict('pr#1 a\nb', 'fail')], 'https://a.example', ['Production runs abc.']);
    assert.match(r.summary, /^\*\*FAIL\*\* for https:\/\/a\.example\n\n> Production runs abc\./);
    assert.match(r.summary, /\| pr#1 a b \| FAIL \| line one line \\\| two \|/);
    const cr = readbackReport('fail', [readbackSummary, { ...verdict('pr#2', 'fail'), reasons: ['docs only\r# PASS\r[x](https://example.invalid)'] }], 'https://a.example');
    assert.match(cr.summary, /\| pr#2 \| FAIL \| docs only # PASS \\\[x\\\]\(https:\/\/example\.invalid\) \|/);
    // Markup in a change's words shows as written: no HTML, image, link, emphasis or code.
    const marked = readbackReport('fail', [readbackSummary, { ...verdict('pr#4 <img src=x> **ok**', 'fail'), reasons: ['![p](https://example.invalid/p.png) `x` _y_ ~z~ a & b \\'] }], 'https://a.example');
    assert.ok(marked.summary.includes('| pr#4 &lt;img src=x&gt; \\*\\*ok\\*\\* | FAIL | \\!\\[p\\](https://example.invalid/p.png) \\`x\\` \\_y\\_ \\~z\\~ a &amp; b \\\\ |'), marked.summary);
    const ticks = readbackReport('fail', [readbackSummary, { ...verdict('pr#3', 'fail'), reasons: ['a\n```\n# PASS'] }], 'https://a.example');
    assert.match(ticks.text, /^````text\n/);
    assert.match(ticks.text, /\n````$/);
  });

  it('replaces raw values in a message in one pass, longest first, and leaves short ones alone', () => {
    const url = 'https://user:s3cr3t@a.example/app?t=1';
    assert.equal(scrub(`read ${url} and https://a.example`, [url, 'https://a.example']), 'read https://a.example/app and https://a.example/');
    assert.equal(scrub('read https://a.example/app and https://a.example/app/version.json', ['https://a.example/app', 'https://a.example/app/version.json']), 'read https://a.example/app and https://a.example/app/version.json');
    const short = 'https://a.example/app?t=1';
    assert.equal(scrub(`x ${short}&u=s3cr3t`, [short, `${short}&u=s3cr3t`]), 'x https://a.example/app');
    assert.equal(scrub('a b c', ['a', 'b c']), 'a b c');
    assert.equal(scrub('cost $& and $1', ['https://x.example/$&']), 'cost $& and $1');
    // A plain path holds no secret, so the advice that names one keeps it.
    assert.equal(scrub('serve /version.json, such as https://your.app/version.json', ['/version.json']), 'serve /version.json, such as https://your.app/version.json');
    assert.ok(!scrub('read /version.json?token=s3cr3t', ['/version.json?token=s3cr3t']).includes('s3cr3t'));
  });

  it('cuts a report that is too long between characters, never inside one', () => {
    const note = '\n… cut to fit; the full report is in the job log';
    for (const pad of [0, 1]) {
      const text = `${'a'.repeat(100 - note.length - 1 + pad)}${'\u{1F600}'.repeat(60)}`;
      const cut = clip(text, 100);
      assert.ok(cut.length <= 100 && cut.endsWith(note), cut);
      assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(cut), JSON.stringify(cut.slice(-60)));
    }
  });

  it('reads the spellings of a branch input as the bare branch name, and origin/HEAD as the default branch', () => {
    const branch = (given: string): string => readInputs({ INPUT_URL: 'https://a.example', INPUT_BRANCH: given }).branch;
    for (const given of ['main', 'refs/heads/main', 'heads/main', 'origin/main', 'remotes/origin/main', 'refs/remotes/origin/main']) assert.equal(branch(given), 'main');
    for (const given of ['origin/HEAD', 'remotes/origin/HEAD', 'refs/remotes/origin/HEAD']) assert.equal(branch(given), '');
    assert.equal(branch('release/2.0'), 'release/2.0');
    assert.equal(branch('HEAD'), 'HEAD');
  });

  it('validates wait and ledger', () => {
    assert.throws(() => readInputs({ INPUT_URL: 'https://a.example', INPUT_WAIT: '-1' }), /wait must be a whole number/);
    assert.throws(() => readInputs({ INPUT_URL: 'https://a.example', INPUT_LEDGER: 'yes' }), /ledger must be auto, true or false/);
    const inputs = readInputs({ INPUT_URL: 'https://a.example/app', 'INPUT_VERSION-URL': 'https://a.example/v.json' });
    assert.equal(inputs.checkName, 'seamkit readback (a.example/app)');
    // One check per production address: two on one host get two names, and a bare host keeps its own.
    const name = (url: string): string => readInputs({ INPUT_URL: url }).checkName;
    assert.equal(name('https://a.example'), 'seamkit readback (a.example)');
    assert.equal(name('https://a.example/'), 'seamkit readback (a.example)');
    assert.equal(name('https://a.example/eu/'), 'seamkit readback (a.example/eu)');
    assert.equal(readInputs({ INPUT_URL: 'https://a.example/eu/', 'INPUT_CHECK-NAME': 'eu readback' }).checkName, 'eu readback');
    // Text that is not an http address names nothing, since what parses as its path can be a credential.
    assert.equal(name('deploy:s3cr3t@app.example'), 'seamkit readback');
    assert.equal(inputs.versionUrl, 'https://a.example/v.json');
    assert.equal(inputs.waitSeconds, 60);
  });

  it('maps only a pass to success', () => {
    assert.deepEqual(CONCLUSIONS, { pass: 'success', fail: 'failure', examined_nothing: 'failure', unclassified: 'action_required' });
    assert.equal(readbackReport('examined_nothing', [], 'https://a.example').title, 'EXAMINED NOTHING: no changes examined');
  });

  it('keeps every output field within GitHub\'s limit', () => {
    const r = errorReport(`seamkit: ${'x'.repeat(70000)}`, 'https://a.example');
    assert.ok(r.summary.length <= 65535);
    assert.ok(r.title.length <= 1000);
    assert.match(r.summary, /cut to fit/);
    assert.match(r.summary, /cut to fit; the full report is in the job log\n```$/);
    // A long run of backticks shows as its count, so the fence cannot fill the limit.
    const ticks = errorReport(`seamkit: x${'`'.repeat(40000)}y`, 'https://a.example');
    assert.ok(ticks.summary.length <= 65535);
    assert.match(ticks.summary, /x\[40000 backticks\]y\n```$/);
    const title = readbackReport('fail', [readbackSummary, { ...readbackSummary, subject: 'pr#1', state: 'not_live', reasons: [`fix ${'`'.repeat(40000)}`] }], 'https://a.example');
    assert.ok(title.text.length <= 65535, String(title.text.length));
    assert.match(title.text, /\[40000 backticks\]/);
    assert.match(title.text, /\n```$/);
    // A limit too small for the note is still a limit.
    assert.equal(clip('x'.repeat(100), 10), 'x'.repeat(10));
    assert.equal(clip('x'.repeat(100), 60), `${'x'.repeat(12)}\n… cut to fit; the full report is in the job log`);
  });

  it('keeps the closing fence of a report cut to fit, so the job summary closes its details', () => {
    const verdicts: Verdict[] = [readbackSummary, ...Array.from({ length: 700 }, (_, i): Verdict => ({ ...readbackSummary, subject: `pr#${i}`, state: 'not_live', reasons: [`reason ${i} `.repeat(12)] }))];
    const r = readbackReport('fail', verdicts, 'https://a.example');
    assert.ok(r.text.length <= 65535, String(r.text.length));
    assert.match(r.text, /cut to fit; the full report is in the job log\n```$/);
    assert.match(jobSummary('seamkit readback', r), /\n```\n\n<\/details>\n$/);
  });

  it('writes the job summary heading as text, whatever the check name or a no-verdict message holds', () => {
    const r = errorReport('seamkit: the branch input [Approve](https://evil.example/a) <b>x</b> `y` is not a branch name', 'https://a.example');
    const heading = jobSummary('check *one*', r).split('\n')[0] as string;
    assert.equal(heading, '### check \\*one\\*: No verdict: the branch input \\[Approve\\](https://evil.example/a) &lt;b&gt;x&lt;/b&gt; \\`y\\` is not a branch name');
  });

  it('declares in action.yml exactly the inputs and outputs the code uses, as YAML GitHub can load', () => {
    const at = (p: string): URL => new URL(`../../../${p}`, import.meta.url);
    const doc = parseYaml(readFileSync(at('action.yml'), 'utf8')) as {
      inputs: Record<string, { required?: boolean; default?: string }>;
      outputs: Record<string, unknown>;
      runs: { using: string; main: string };
    };
    assert.deepEqual(Object.keys(doc.inputs).sort(), ['branch', 'check-name', 'last', 'ledger', 'pr', 'sha', 'token', 'url', 'version-url', 'wait']);
    assert.deepEqual(Object.keys(doc.outputs).sort(), ['check-run-url', 'exit-code', 'outcome', 'title']);
    assert.equal(doc.inputs['url']?.required, true);
    assert.equal(doc.inputs['wait']?.default, '60');
    assert.equal(doc.runs.using, 'node24');
    assert.ok(existsSync(at(doc.runs.main)), `${doc.runs.main} exists`);
    // Every input readInputs reads is declared, so none is silently empty.
    const source = readFileSync(new URL('../src/github.ts', import.meta.url), 'utf8');
    const read = [...source.matchAll(/input\(env, '([a-z-]+)'\)/g)].map((m) => m[1]);
    for (const name of read) assert.ok(name !== undefined && name in doc.inputs, `${name} is declared`);
  });

  it('carries seamkit\'s version, which the bundle reports', () => {
    const version = (p: string): string => (JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8')) as { version: string }).version;
    assert.equal(version('../package.json'), version('../../cli/package.json'));
  });
});
