import { renderReadback, type Outcome, type Verdict } from '@seamkit/core';
import { runGit } from '@seamkit/state';
import { run, type Io } from 'seamkit';
import {
  ActionInputError,
  appendSummary,
  defaultBranchOf,
  deployedCommit,
  headSha,
  postCheckRun,
  readContext,
  readEvent,
  readInputs,
  setOutput,
  skipReason,
  type ActionInputs,
  type Fetch,
  type GitHubContext,
} from './github.js';
import { errorReport, jobSummary, readbackReport, type Report } from './report.js';

/** Everything the action touches outside itself, so that a test can stand in for each. */
export interface ActionDeps {
  env: Record<string, string | undefined>;
  /** The time verdicts are stamped with. */
  now(): string;
  /** Milliseconds, for the wait only; Date.now when not given. */
  clock?: () => number;
  sleep(ms: number): Promise<void>;
  fetch: Fetch;
  /** One line for the job log. */
  log(line: string): void;
  /** A warning annotation: shown on the run, never a change to the verdict. */
  warn(line: string): void;
  /** Seconds between readback attempts while waiting for production to show the deploy. */
  pollSeconds?: number;
}

interface CliResult {
  code: number;
  out: string;
  err: string;
}

const EXIT_USAGE = 2;

function cliRunner(cwd: string, deps: ActionDeps): (args: string[]) => Promise<CliResult> {
  return async (args) => {
    let out = '';
    let err = '';
    const io: Io = {
      out: (t) => void (out += t),
      err: (t) => void (err += t),
      readStdin: async () => '',
      stdinIsTTY: true,
      env: deps.env,
      cwd,
      now: deps.now,
    };
    return { code: await run(args, io), out, err };
  };
}

/**
 * The readback command. After a deploy the deployed commit goes in as --deployed: a change merged
 * while the deploy was building is left to the next deploy instead of failing this one, and a
 * change an earlier run saw live is still judged, so a deploy that drops it fails as not live.
 */
function readbackArgs(inputs: ActionInputs, deployed: string | undefined): string[] {
  const args = ['readback', '--url', inputs.url, '--json'];
  if (inputs.last !== '') args.push('--last', inputs.last);
  if (inputs.pr !== '') args.push('--pr', inputs.pr);
  if (inputs.branch !== '') args.push('--branch', inputs.branch);
  if (deployed !== undefined) args.push('--deployed', deployed);
  if (inputs.versionUrl !== '') args.push('--version-url', inputs.versionUrl);
  return args;
}

/**
 * Keeps the ledger in step with the remote before the readback. Returns whether this run records
 * its verdict: auto records when a ledger already exists here or on the remote, true creates one
 * when there is none, and false never records.
 */
async function openLedger(inputs: ActionInputs, cli: (args: string[]) => Promise<CliResult>, deps: ActionDeps): Promise<boolean> {
  if (inputs.ledger === 'false') return false;
  const sync = await cli(['state', 'sync', '--json']);
  if (sync.code !== 0 && /"status":"no_remote"/.test(sync.out)) {
    deps.log('seamkit: the checkout has no origin remote, so this run is not recorded');
    return false;
  }
  if (sync.code !== 0) {
    deps.warn(`seamkit: the ledger could not be fetched, so this run is not recorded: ${sync.err.trim()}`);
    return false;
  }
  const status = (JSON.parse(sync.out) as { status: string }).status;
  if (status !== 'empty') {
    deps.log(`seamkit: ledger ${status === 'up_to_date' ? 'is up to date' : status}`);
    return true;
  }
  if (inputs.ledger === 'auto') {
    deps.log('seamkit: no ledger here or on the remote, so this run is not recorded (set ledger: true to start one)');
    return false;
  }
  const init = await cli(['state', 'init']);
  if (init.code !== 0) {
    deps.warn(`seamkit: the ledger could not be created, so this run is not recorded: ${init.err.trim()}`);
    return false;
  }
  deps.log(`seamkit: ${init.out.trim()}`);
  return true;
}

/**
 * Prepares the checkout as readback expects a clone: the full history, because readback decides by
 * ancestry, and origin/HEAD, which actions/checkout does not set, so the default branch is the one
 * the event names rather than a guess between main and master.
 */
async function prepareCheckout(cwd: string, defaultBranch: string | undefined, deps: ActionDeps): Promise<void> {
  const shallow = await runGit(['rev-parse', '--is-shallow-repository'], { cwd });
  if (shallow.stdout.toString('utf8').trim() === 'true') {
    deps.log('seamkit: the checkout is shallow; fetching the full history (set fetch-depth: 0 on actions/checkout to skip this)');
    const fetched = await runGit(['fetch', '--quiet', '--unshallow', '--no-tags', 'origin'], { cwd });
    if (fetched.code !== 0) deps.warn(`seamkit: could not fetch the full history, so older changes are not examined: ${fetched.stderr.trim()}`);
  }
  if (defaultBranch === undefined || !/^[A-Za-z0-9._/-]+$/.test(defaultBranch)) return;
  const head = await runGit(['symbolic-ref', '-q', 'refs/remotes/origin/HEAD'], { cwd });
  if (head.code === 0) return;
  const target = `refs/remotes/origin/${defaultBranch}`;
  if ((await runGit(['rev-parse', '--verify', '--quiet', target], { cwd })).code !== 0) return;
  await runGit(['symbolic-ref', 'refs/remotes/origin/HEAD', target], { cwd });
}

/** Whether production already runs a version that contains the deployed commit. */
async function showsDeploy(result: CliResult, deployed: string, cwd: string): Promise<boolean> {
  let verdicts: Verdict[];
  try {
    verdicts = (JSON.parse(result.out) as { verdicts: Verdict[] }).verdicts;
  } catch {
    return false;
  }
  const running = new Set(verdicts.flatMap((v) => v.evidence.filter((e) => e.kind === 'commit' && e.label === 'running version').map((e) => e.value)));
  for (const r of running) {
    if ((await runGit(['merge-base', '--is-ancestor', deployed, r], { cwd })).code === 0) return true;
  }
  return false;
}

/**
 * Reads production back until the result is final. After a deploy, a fail or examined nothing may
 * only mean that production does not show the deploy yet, so it is read again until production
 * runs a version containing the deployed commit or the wait runs out. Without a deployed commit
 * there is nothing to wait for. Nothing is recorded while waiting.
 */
async function waitForLive(
  args: string[],
  deployed: string | undefined,
  inputs: ActionInputs,
  cli: (args: string[]) => Promise<CliResult>,
  cwd: string,
  deps: ActionDeps,
): Promise<CliResult> {
  const poll = (deps.pollSeconds ?? 10) * 1000;
  const clock = deps.clock ?? Date.now;
  const deadline = clock() + inputs.waitSeconds * 1000;
  for (;;) {
    const r = await cli([...args, '--no-record']);
    if (r.code === 0 || r.code === EXIT_USAGE || r.code === 4 || deployed === undefined) return r;
    if (await showsDeploy(r, deployed, cwd)) {
      deps.log(`seamkit: production runs a version that contains ${deployed.slice(0, 12)}, so waiting longer would not change the result`);
      return r;
    }
    const left = deadline - clock();
    if (left <= 0) return r;
    deps.log(`seamkit: production does not show ${deployed.slice(0, 12)} yet (exit ${r.code}); reading it again in ${Math.round(Math.min(poll, left) / 1000)}s`);
    await deps.sleep(Math.min(poll, left));
  }
}

/** Where a run's result goes: the check run, the job summary and the step outputs. */
async function report(
  ctx: GitHubContext,
  name: string,
  token: string,
  sha: string,
  result: Report,
  outcome: Outcome | 'error',
  code: number,
  deps: ActionDeps,
): Promise<void> {
  const runUrl = ctx.runId === '' ? '' : `${ctx.serverUrl}/${ctx.repository}/actions/runs/${ctx.runId}`;
  const check = sha === '' ? { ok: false, problem: 'no commit to attach a check run to' } : await postCheckRun(deps.fetch, ctx, token, name, sha, result, runUrl);
  if (check.ok) deps.log(`seamkit: posted check run "${name}" on ${sha.slice(0, 12)}${check.url ? `: ${check.url}` : ''}`);
  else deps.warn(`seamkit: ${check.problem ?? 'no check run was posted'}`);
  await appendSummary(ctx.summaryPath, jobSummary(name, result));
  await setOutput(ctx.outputPath, 'outcome', outcome);
  await setOutput(ctx.outputPath, 'exit-code', String(code));
  await setOutput(ctx.outputPath, 'title', result.title);
  if (check.ok && check.url) await setOutput(ctx.outputPath, 'check-run-url', check.url);
}

const PERMISSION = /\b403\b|denied|permission|not allowed|authentication/i;

/** Runs the action and returns its exit code: seamkit's own, 0 only for a pass or a skipped event. */
export async function runAction(deps: ActionDeps): Promise<number> {
  let ctx: GitHubContext;
  try {
    ctx = readContext(deps.env);
  } catch (err) {
    if (!(err instanceof ActionInputError)) throw err;
    deps.warn(`seamkit: ${err.message}`);
    return EXIT_USAGE;
  }
  const event = await readEvent(ctx.eventPath);
  let inputs: ActionInputs;
  try {
    inputs = readInputs(deps.env);
  } catch (err) {
    if (!(err instanceof ActionInputError)) throw err;
    // A misconfigured step still shows on the commit, as a check with no verdict.
    deps.warn(`seamkit: ${err.message}`);
    const raw = (name: string): string => (deps.env[`INPUT_${name}`] ?? '').trim();
    await report(ctx, raw('CHECK-NAME') || 'seamkit readback', raw('TOKEN'), headSha(ctx, event, raw('SHA')), errorReport(err.message, raw('URL') || 'the url input'), 'error', EXIT_USAGE, deps);
    return EXIT_USAGE;
  }
  const skip = skipReason(ctx, event);
  if (skip !== undefined) {
    deps.log(`seamkit: skipped, because ${skip}`);
    await setOutput(ctx.outputPath, 'outcome', 'skipped');
    return 0;
  }
  const cwd = ctx.workspace;
  const cli = cliRunner(cwd, deps);
  const sha = headSha(ctx, event, inputs.sha);
  const deployed = deployedCommit(ctx, event, inputs.sha);

  await prepareCheckout(cwd, defaultBranchOf(event), deps);
  const recording = await openLedger(inputs, cli, deps);
  const args = readbackArgs(inputs, deployed);
  let result = await waitForLive(args, deployed, inputs, cli, cwd, deps);
  let recorded = false;
  if (recording && result.code !== EXIT_USAGE) {
    // The run that counts is read again and recorded, so the ledger holds what was judged. A
    // recording that fails leaves the verdict as it was read, and says it was not recorded.
    const again = await cli(args);
    if (again.code === EXIT_USAGE) deps.warn(`seamkit: the verdict was not recorded: ${again.err.trim()}`);
    else result = again;
  }

  let out: Report;
  let outcome: Outcome | 'error' = 'error';
  if (result.code === EXIT_USAGE) {
    out = errorReport(result.err, inputs.url);
    deps.warn(result.err.trim());
  } else {
    const parsed = JSON.parse(result.out) as { outcome: Outcome; verdicts: Verdict[]; recorded?: { id: string } };
    outcome = parsed.outcome;
    out = readbackReport(parsed.outcome, parsed.verdicts, inputs.url);
    deps.log(renderReadback(parsed.verdicts));
    if (parsed.recorded) {
      recorded = true;
      deps.log(`seamkit: recorded as event ${parsed.recorded.id.slice(0, 12)}`);
    }
  }

  if (recording) {
    const pushed = await cli(['state', 'sync']);
    if (pushed.code === 0) deps.log(`seamkit: ${pushed.out.trim()}`);
    else {
      const why = PERMISSION.test(pushed.err)
        ? 'give the job "permissions: contents: write"'
        : 'another run may have pushed at the same moment; give the workflow a concurrency group so runs take turns';
      deps.warn(`seamkit: ${recorded ? 'the verdict was recorded here but not pushed, so it is lost with this runner' : 'the ledger could not be pushed'}; ${why}: ${pushed.err.trim()}`);
    }
  }

  await report(ctx, inputs.checkName, inputs.token, sha, out, outcome, result.code, deps);
  return result.code;
}
