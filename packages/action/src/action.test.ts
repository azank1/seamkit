import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { Verdict } from '@seamkit/core';
import { FakeProduction } from '@seamkit/adapters';
import { git } from '@seamkit/state';
import { run as seamkitRun } from 'seamkit';
import { runAction, type ActionDeps } from './action.js';
import { CONCLUSIONS, clip, errorReport, readbackReport } from './report.js';
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
    assert.match((post['output'] as { summary: string }).summary, /a commit this repository does not have/);
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
    for (const name of ['release', 'release+1']) {
      const { ci, commits } = await project();
      await git(['push', '-q', 'origin', `${commits[2] as string}:refs/heads/${name}`], { cwd: ci });
      deploy(commits[2]);
      assert.equal((await act(ci, { ledger: 'true', branch: name }, success(commits[2] as string))).code, 0);
      const late = join(root, `ci-late-${++counter}`);
      await git(['clone', '-q', `file://${await git(['remote', 'get-url', 'origin'], { cwd: ci })}`, late], { cwd: root });
      await git(['update-ref', `refs/remotes/origin/${name}`, commits[1] as string], { cwd: late });
      await git(['checkout', '-q', '-B', name, commits[1] as string], { cwd: late });
      deploy(commits[1]);
      const ran = await act(late, { branch: name }, success(commits[1] as string));
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
    assert.equal(inputs.checkName, 'seamkit readback (a.example)');
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
