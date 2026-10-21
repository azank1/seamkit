import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeProduction } from '@seamkit/adapters';
import { git } from '@seamkit/state';
import { runAction, type ActionDeps } from './action.js';
import { CONCLUSIONS, errorReport, readbackReport } from './report.js';
import { headSha, readInputs, skipReason, type GitHubContext } from './github.js';

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
async function project(options: { depth?: number } = {}): Promise<{ remote: string; ci: string; commits: string[] }> {
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
    ['b.txt', 'Add the badge (#2)\n\nThe second change.'],
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

const deploy = (commit: string | undefined): void =>
  prod.deploy(commit === undefined ? { 'index.html': '<!doctype html><title>app</title>' } : { 'index.html': '<!doctype html>', 'version.json': JSON.stringify({ schema: 'seamkit.version/1', commit, dirty: false, source: 'git' }) });

interface Ran {
  code: number;
  logs: string[];
  warnings: string[];
  sleeps: number[];
  outputs: string;
  summary: string;
}

async function act(ci: string, inputs: Record<string, string>, event: Record<string, unknown>, extra: Partial<ActionDeps> = {}): Promise<Ran> {
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
    GITHUB_EVENT_NAME: 'deployment_status',
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_SHA: 'f'.repeat(40),
    GITHUB_WORKSPACE: ci,
    GITHUB_OUTPUT: outputPath,
    GITHUB_STEP_SUMMARY: summaryPath,
    INPUT_URL: prod.url,
    INPUT_WAIT: '0',
    INPUT_TOKEN: 'test-token',
  };
  for (const [k, v] of Object.entries(inputs)) env[`INPUT_${k.toUpperCase()}`] = v;
  const ran: Ran = { code: -1, logs: [], warnings: [], sleeps: [], outputs: '', summary: '' };
  let clock = 0;
  ran.code = await runAction({
    env,
    now: () => AT,
    clock: () => clock,
    sleep: async (ms) => {
      ran.sleeps.push(ms);
      clock += ms;
    },
    fetch: (url, init) => fetch(url, init),
    log: (line) => ran.logs.push(line),
    warn: (line) => ran.warnings.push(line),
    ...extra,
  });
  ran.outputs = await readFile(outputPath, 'utf8');
  ran.summary = await readFile(summaryPath, 'utf8');
  return ran;
}

const success = (sha: string): Record<string, unknown> => ({ deployment: { sha, environment: 'Production' }, deployment_status: { state: 'success' } });
const output = (ran: Ran, name: string): string | undefined => new RegExp(`^${name}<<(\\S+)\\n([\\s\\S]*?)\\n\\1$`, 'm').exec(ran.outputs)?.[2];
const lastPost = (): Record<string, unknown> => api.posts[api.posts.length - 1] as Record<string, unknown>;

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

  it('fails a deploy of an older commit, listing the change that is not proven', async () => {
    const { ci, commits } = await project();
    deploy(commits[1]);
    const ran = await act(ci, {}, success(commits[1] as string));
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
    assert.ok(ran.logs.some((l) => /not a pass yet \(exit 1\); reading production again in 10s/.test(l)));
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

    // A fresh checkout, as the next job gets: auto finds the ledger on the remote and uses it.
    const next = join(root, `ci-next-${++counter}`);
    await git(['clone', '-q', `file://${remote}`, next], { cwd: root });
    deploy(commits[1]);
    const second = await act(next, {}, success(commits[1] as string));
    assert.equal(second.code, 1);
    assert.match((lastPost()['output'] as { title: string }).title, /1 not live/);
    const events = await git(['ls-tree', '-r', '--name-only', 'refs/heads/seamkit/state', 'events/'], { cwd: remote });
    assert.equal(events.split('\n').length, 2);
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

  it('skips a deployment that has not succeeded, without a check run', async () => {
    const { ci, commits } = await project();
    const before = api.posts.length;
    const ran = await act(ci, {}, { deployment: { sha: commits[2] }, deployment_status: { state: 'in_progress' } });
    assert.equal(ran.code, 0);
    assert.equal(api.posts.length, before);
    assert.equal(output(ran, 'outcome'), 'skipped');
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

  it('reports a usage error as no verdict', async () => {
    const { ci, commits } = await project();
    const ran = await act(ci, { url: `${prod.url}?token=abc` }, success(commits[2] as string));
    assert.equal(ran.code, 2);
    assert.equal(lastPost()['conclusion'], 'failure');
    assert.match((lastPost()['output'] as { title: string }).title, /^No verdict: --url must not carry a query string/);
    assert.equal(output(ran, 'outcome'), 'error');
  });

  it('needs the url input', async () => {
    const { ci, commits } = await project();
    const ran = await act(ci, { url: '' }, success(commits[2] as string));
    assert.equal(ran.code, 2);
    assert.match(ran.warnings[0] ?? '', /the url input is required/);
  });
});

describe('action inputs and reports', () => {
  const ctx = (eventName: string): GitHubContext => ({
    apiUrl: '',
    serverUrl: '',
    repository: 'o/r',
    runId: '',
    eventName,
    eventPath: '',
    sha: 'job-sha',
    workspace: '',
    outputPath: '',
    summaryPath: '',
  });

  it('attaches the check run to the deployed commit, or the other workflow\'s', () => {
    assert.equal(headSha(ctx('deployment_status'), { deployment: { sha: 'dep' } }, ''), 'dep');
    assert.equal(headSha(ctx('workflow_run'), { workflow_run: { head_sha: 'wr' } }, ''), 'wr');
    assert.equal(headSha(ctx('push'), {}, ''), 'job-sha');
    assert.equal(headSha(ctx('deployment_status'), { deployment: { sha: 'dep' } }, 'given'), 'given');
  });

  it('skips a failed deploy workflow', () => {
    assert.match(skipReason(ctx('workflow_run'), { workflow_run: { conclusion: 'failure' } }) ?? '', /concluded failure/);
    assert.equal(skipReason(ctx('workflow_run'), { workflow_run: { conclusion: 'success' } }), undefined);
    assert.equal(skipReason(ctx('schedule'), {}), undefined);
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

  it('carries seamkit\'s version, which the bundle reports', () => {
    const version = (p: string): string => (JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8')) as { version: string }).version;
    assert.equal(version('../package.json'), version('../../cli/package.json'));
  });
});
