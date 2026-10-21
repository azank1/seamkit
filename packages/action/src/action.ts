import { renderReadback, type Outcome, type Verdict } from '@seamkit/core';
import { runGit } from '@seamkit/state';
import { run, type Io } from 'seamkit';
import {
  ActionInputError,
  appendSummary,
  headSha,
  postCheckRun,
  readContext,
  readEvent,
  readInputs,
  setOutput,
  skipReason,
  type ActionInputs,
  type Fetch,
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

function readbackArgs(inputs: ActionInputs): string[] {
  const args = ['readback', '--url', inputs.url, '--json'];
  if (inputs.last !== '') args.push('--last', inputs.last);
  if (inputs.pr !== '') args.push('--pr', inputs.pr);
  if (inputs.branch !== '') args.push('--branch', inputs.branch);
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

/** Fetches the full history when the checkout is shallow, because readback needs ancestry. */
async function unshallow(cwd: string, deps: ActionDeps): Promise<void> {
  const shallow = await runGit(['rev-parse', '--is-shallow-repository'], { cwd });
  if (shallow.stdout.toString('utf8').trim() !== 'true') return;
  deps.log('seamkit: the checkout is shallow; fetching the full history (set fetch-depth: 0 on actions/checkout to skip this)');
  const fetched = await runGit(['fetch', '--quiet', '--unshallow', '--no-tags', 'origin'], { cwd });
  if (fetched.code !== 0) deps.warn(`seamkit: could not fetch the full history, so older changes are not examined: ${fetched.stderr.trim()}`);
}

/**
 * Reads production back until it passes or the wait runs out. A fail or examined nothing may only
 * mean that production does not show the deploy yet, so those are retried; a usage error or an
 * unclassified result is final at once. Nothing is recorded while waiting.
 */
async function waitForLive(args: string[], inputs: ActionInputs, cli: (args: string[]) => Promise<CliResult>, deps: ActionDeps): Promise<CliResult> {
  const poll = (deps.pollSeconds ?? 10) * 1000;
  const clock = deps.clock ?? Date.now;
  const deadline = clock() + inputs.waitSeconds * 1000;
  for (;;) {
    const r = await cli([...args, '--no-record']);
    if (r.code === 0 || r.code === EXIT_USAGE || r.code === 4) return r;
    const left = deadline - clock();
    if (left <= 0) return r;
    deps.log(`seamkit: not a pass yet (exit ${r.code}); reading production again in ${Math.round(Math.min(poll, left) / 1000)}s`);
    await deps.sleep(Math.min(poll, left));
  }
}

/** Runs the action and returns its exit code: seamkit's own, 0 only for a pass or a skipped event. */
export async function runAction(deps: ActionDeps): Promise<number> {
  let inputs: ActionInputs;
  let ctx: ReturnType<typeof readContext>;
  try {
    inputs = readInputs(deps.env);
    ctx = readContext(deps.env);
  } catch (err) {
    if (!(err instanceof ActionInputError)) throw err;
    deps.warn(`seamkit: ${err.message}`);
    return EXIT_USAGE;
  }
  const event = await readEvent(ctx.eventPath);
  const skip = skipReason(ctx, event);
  if (skip !== undefined) {
    deps.log(`seamkit: skipped, because ${skip}`);
    await setOutput(ctx.outputPath, 'outcome', 'skipped');
    return 0;
  }
  const cwd = ctx.workspace;
  const cli = cliRunner(cwd, deps);
  const sha = headSha(ctx, event, inputs.sha);

  await unshallow(cwd, deps);
  const recording = await openLedger(inputs, cli, deps);
  const args = readbackArgs(inputs);
  let result = await waitForLive(args, inputs, cli, deps);
  if (recording && result.code !== EXIT_USAGE) {
    // The run that counts is read again and recorded, so the ledger holds what was judged.
    result = await cli(args);
  }

  let report: Report;
  let outcome: Outcome | 'error' = 'error';
  if (result.code === EXIT_USAGE) {
    report = errorReport(result.err, inputs.url);
    deps.warn(result.err.trim());
  } else {
    const parsed = JSON.parse(result.out) as { outcome: Outcome; verdicts: Verdict[]; recorded?: { id: string } };
    outcome = parsed.outcome;
    report = readbackReport(parsed.outcome, parsed.verdicts, inputs.url);
    deps.log(renderReadback(parsed.verdicts));
    if (parsed.recorded) deps.log(`seamkit: recorded as event ${parsed.recorded.id.slice(0, 12)}`);
  }

  if (recording) {
    const pushed = await cli(['state', 'sync']);
    if (pushed.code !== 0) deps.warn(`seamkit: the verdict was recorded here but not pushed; give the job "permissions: contents: write": ${pushed.err.trim()}`);
    else deps.log(`seamkit: ${pushed.out.trim()}`);
  }

  const runUrl = ctx.runId === '' ? '' : `${ctx.serverUrl}/${ctx.repository}/actions/runs/${ctx.runId}`;
  const check = sha === '' ? { ok: false, problem: 'no commit to attach a check run to' } : await postCheckRun(deps.fetch, ctx, inputs.token, inputs.checkName, sha, report, runUrl);
  if (check.ok) deps.log(`seamkit: posted check run "${inputs.checkName}" on ${sha.slice(0, 12)}${check.url ? `: ${check.url}` : ''}`);
  else deps.warn(`seamkit: ${check.problem ?? 'no check run was posted'}`);

  await appendSummary(ctx.summaryPath, jobSummary(inputs.checkName, report));
  await setOutput(ctx.outputPath, 'outcome', outcome);
  await setOutput(ctx.outputPath, 'exit-code', String(result.code));
  await setOutput(ctx.outputPath, 'title', report.title);
  if (check.ok && check.url) await setOutput(ctx.outputPath, 'check-run-url', check.url);
  return result.code;
}
