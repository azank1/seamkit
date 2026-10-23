import { isBranchName } from '@seamkit/adapters';
import { renderReadback, type Outcome, type Verdict } from '@seamkit/core';
import { runGit } from '@seamkit/state';
import { run, type Io } from 'seamkit';
import {
  ActionInputError,
  appendSummary,
  checkNameFor,
  defaultBranchOf,
  displayUrl,
  deployedCommit,
  headSha,
  postCheckRun,
  readContext,
  readEvent,
  rawInput,
  readInputs,
  scrub,
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

/** Fetches a branch as origin has it now. Returns git's reason when it cannot. */
async function fetchBranch(cwd: string, name: string): Promise<string | undefined> {
  const tip = await runGit(['fetch', '--quiet', '--no-tags', 'origin', `+refs/heads/${name}:refs/remotes/origin/${name}`], { cwd });
  return tip.code === 0 ? undefined : tip.stderr.trim() || `git exited ${tip.code}`;
}

/**
 * Prepares the checkout as readback expects a clone: the full history, because readback decides by
 * ancestry; the branch it reads as the remote has it, because actions/checkout points
 * origin/<branch> at the job's own commit when the branch has moved on, which would hide every
 * change merged since; and origin/HEAD pointing at the default branch the event names, which
 * actions/checkout does not set and a cached or self-hosted checkout may keep stale. Returns why
 * there can be no verdict: a branch that is not a branch name, or one that cannot be fetched,
 * would leave readback on the job's own commit, where a rollback passes.
 */
async function prepareCheckout(cwd: string, defaultBranch: string | undefined, branchInput: string, deps: ActionDeps): Promise<string | undefined> {
  const shallow = await runGit(['rev-parse', '--is-shallow-repository'], { cwd });
  if (shallow.stdout.toString('utf8').trim() === 'true') {
    deps.log('seamkit: the checkout is shallow; fetching the full history (set fetch-depth: 0 on actions/checkout to skip this)');
    const fetched = await runGit(['fetch', '--quiet', '--unshallow', '--no-tags', 'origin'], { cwd });
    if (fetched.code !== 0) deps.warn(`seamkit: could not fetch the full history, so older changes are not examined: ${fetched.stderr.trim()}`);
  }
  const read = branchInput !== '' ? branchInput : defaultBranch;
  if (read !== undefined) {
    if (!(await isBranchName(cwd, read))) return `${branchInput !== '' ? 'the branch input' : "the event's default branch"} ${read} is not a branch name; give the branch changes are merged into, such as main`;
    const failed = await fetchBranch(cwd, read);
    if (failed !== undefined) return `could not fetch ${read} from origin, so changes merged since this job's commit cannot be examined: ${failed}`;
  }
  if (defaultBranch === undefined || !(await isBranchName(cwd, defaultBranch))) return undefined;
  const target = `refs/remotes/origin/${defaultBranch}`;
  if ((await runGit(['rev-parse', '--verify', '--quiet', target], { cwd })).code !== 0) return undefined;
  const head = await runGit(['symbolic-ref', '-q', 'refs/remotes/origin/HEAD'], { cwd });
  if (head.code === 0 && head.stdout.toString('utf8').trim() === target) return undefined;
  await runGit(['symbolic-ref', 'refs/remotes/origin/HEAD', target], { cwd });
  return undefined;
}

/** The full id of a commit given perhaps abbreviated, or undefined when git does not know it. */
async function knownCommit(cwd: string, rev: string): Promise<string | undefined> {
  const r = await runGit(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], { cwd });
  return r.code === 0 ? r.stdout.toString('utf8').trim() : undefined;
}

/**
 * The full id of a commit given perhaps abbreviated, or the text unchanged when git does not know
 * it. When text that looks like an abbreviated commit gives a commit that does not start with it,
 * the text is kept and `not` says what it names instead: an annotated tag, named by its own id, or
 * a tag or branch named like it, since git looks a name up as a ref before as an abbreviation.
 */
async function fullCommit(cwd: string, rev: string): Promise<{ commit: string; not?: 'tag' | 'ref' }> {
  const known = await knownCommit(cwd, rev);
  if (known === undefined) return { commit: rev };
  const lower = rev.toLowerCase();
  if (!/^[0-9a-f]{4,64}$/.test(lower) || known.startsWith(lower)) return { commit: known };
  // A ref is any of the names git tries for the text, one or several; text that names none and
  // still peels to another commit names a tag. for-each-ref also lists refs below a name, so the
  // names are compared exactly.
  const names = [`refs/${rev}`, `refs/tags/${rev}`, `refs/heads/${rev}`, `refs/remotes/${rev}`, `refs/remotes/${rev}/HEAD`];
  const r = await runGit(['for-each-ref', '--format=%(refname)', ...names], { cwd });
  const refs = r.code === 0 ? r.stdout.toString('utf8').split('\n') : [];
  return { commit: rev, not: refs.some((n) => names.includes(n)) ? 'ref' : 'tag' };
}

/** Production's own version document, the one for the url input, as readback --json reports it. */
interface Production {
  status: 'ok' | 'unreadable';
  reported?: string;
  commit?: string;
}

/**
 * Where production stands against the deployed commit, from its own version document only: a
 * card's version marker can name another service, which says nothing about this address.
 * `runs_it`: it reports the deployed commit. `later`: a commit that contains it, which a later
 * deploy explains, or a rollback that has not landed. `other`: a commit that does not contain it,
 * or one this repository does not have. `unknown`: no commit was read.
 */
type Landing = 'runs_it' | 'later' | 'other' | 'unknown';

function productionOf(result: CliResult): Production | undefined {
  try {
    return (JSON.parse(result.out) as { production?: Production }).production;
  } catch {
    return undefined;
  }
}

async function landing(prod: Production | undefined, deployed: string, cwd: string): Promise<Landing> {
  if (prod?.status !== 'ok' || prod.reported === undefined) return 'unknown';
  if (prod.commit === deployed) return 'runs_it';
  if (prod.commit !== undefined && (await runGit(['merge-base', '--is-ancestor', deployed, prod.commit], { cwd })).code === 0) return 'later';
  return 'other';
}

/**
 * What the wait read: its last result, the last reading that named a commit, the seconds it took,
 * and for each commit production reported that the clone lacked, whether fetching the branch
 * again for it last succeeded.
 */
interface Waited {
  result: CliResult;
  lastKnown?: Production;
  seconds: number;
  fetched: ReadonlyMap<string, boolean>;
}

/**
 * Reads production back until the result is final. After a deploy, the result is final once
 * production's version document reports the deployed commit. Until then any result, a pass
 * included, may describe the build before the deploy, so production is read again until it does
 * or the wait runs out. When no read has named a commit, a pass is final, because nothing would
 * tell when the deploy landed; once one has, a read that names none is a failed read, not an
 * answer. Without a deployed commit there is nothing to wait for, and nothing is recorded while
 * waiting.
 */
async function waitForLive(
  args: string[],
  deployed: string | undefined,
  read: string | undefined,
  inputs: ActionInputs,
  cli: (args: string[]) => Promise<CliResult>,
  cwd: string,
  deps: ActionDeps,
): Promise<Waited> {
  const poll = (deps.pollSeconds ?? 10) * 1000;
  const clock = deps.clock ?? Date.now;
  const start = clock();
  const deadline = start + inputs.waitSeconds * 1000;
  let lastKnown: Production | undefined;
  // A commit production reports that this clone lacks may be one merged and deployed since the
  // branch was fetched: the branch is fetched again until that succeeds once for each such commit,
  // and read at once. At most one fetch and one such read follow each poll, so a document that
  // names a new commit every time cannot keep the wait from ending.
  const fetched = new Map<string, boolean>();
  let reread = false;
  const done = (result: CliResult): Waited => ({ result, ...(lastKnown ? { lastKnown } : {}), seconds: Math.round((clock() - start) / 1000), fetched });
  for (;;) {
    const r = await cli([...args, '--no-record']);
    if (r.code === EXIT_USAGE || r.code === 4 || deployed === undefined) return done(r);
    const prod = productionOf(r);
    // Kept before any fetch, so a read that fails afterwards cannot undo what this one saw.
    const where = await landing(prod, deployed, cwd);
    if (where !== 'unknown') lastKnown = prod;
    if (!reread && prod?.status === 'ok' && prod.reported !== undefined && prod.commit === undefined && read !== undefined && fetched.get(prod.reported) !== true) {
      const failed = await fetchBranch(cwd, read);
      fetched.set(prod.reported, failed === undefined);
      if (failed === undefined) {
        // As the CLI resolves it: a tag or a ref named like the abbreviation is not that commit.
        const commit = await knownCommit(cwd, prod.reported);
        if (commit !== undefined && commit.startsWith(prod.reported)) lastKnown = { ...prod, commit };
        deps.log(`seamkit: production reports ${prod.reported.slice(0, 12)}, which this checkout did not have; fetched ${read} again`);
        reread = true;
        continue;
      }
      deps.warn(`seamkit: could not fetch ${read} from origin again: ${failed}`);
    }
    if (where === 'runs_it') {
      deps.log(`seamkit: production runs the deployed commit ${deployed.slice(0, 12)}`);
      return done(r);
    }
    if (where === 'unknown' && r.code === 0 && lastKnown === undefined) return done(r);
    const left = deadline - clock();
    if (left <= 0) return done(r);
    const now = where === 'unknown' ? 'gives no commit' : `reports ${(prod?.reported ?? '').slice(0, 12)}`;
    deps.log(`seamkit: production ${now}, not the deployed commit ${deployed.slice(0, 12)} yet (exit ${r.code}); reading it again in ${Math.round(Math.min(poll, left) / 1000)}s`);
    await deps.sleep(Math.min(poll, left));
    reread = false;
  }
}

/**
 * What the action adds to a verdict after a deploy: a note when production does not run the
 * deployed commit, and, when it runs a commit that does not contain it, a fail in place of a pass,
 * because a check on the deployed commit must not read as success while that commit is not live.
 */
async function deployNote(
  read: Production | undefined,
  deployed: string,
  waited: number,
  refetch: 'fetched' | 'failed' | undefined,
  cwd: string,
): Promise<{ note?: string; notLive: boolean; title?: string }> {
  const prod = read;
  const where = await landing(prod, deployed, cwd);
  const d = deployed.slice(0, 12);
  const running = (prod?.reported ?? '').slice(0, 12);
  if (where === 'later') {
    return { notLive: false, note: `Production runs ${running}, which comes after the deployed commit ${d}. A later deploy has landed, or, if this deploy is a rollback, it has not landed yet. The verdict is for what production runs.` };
  }
  if (where === 'other' && prod?.commit === undefined) {
    return {
      notLive: true,
      note: `Production runs ${running}, a commit this repository does not have ${refetch === 'fetched' ? 'even after fetching the branch again' : refetch === 'failed' ? 'because fetching the branch again failed' : 'as the branch was fetched for this job'}, so whether it contains the deployed commit ${d} is not known, after waiting ${waited}s.`,
      title: `FAIL: production runs ${running}, which this repository does not have`,
    };
  }
  if (where === 'other') {
    return {
      notLive: true,
      note: `Production runs ${running}, which does not contain the deployed commit ${d}, after waiting ${waited}s. The deploy of ${d} has not landed at this address.`,
      title: `FAIL: production does not run the deployed commit ${d}`,
    };
  }
  if (where === 'unknown') {
    return { notLive: false, note: `Production's version document gave no commit, so whether it runs the deployed commit ${d} is not known. The verdict rests on the markers that were read.` };
  }
  return { notLive: false };
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
  // The outputs and the summary go first: the check run is the one place a verdict can read as
  // success, so nothing that can fail comes after it.
  await written(deps, () => appendSummary(ctx.summaryPath, jobSummary(name, result)));
  await written(deps, () => writeOutputs(ctx.outputPath, { outcome, 'exit-code': String(code), title: result.title }));
  const runUrl = ctx.runId === '' ? '' : `${ctx.serverUrl}/${ctx.repository}/actions/runs/${ctx.runId}`;
  const check = sha === '' ? { ok: false, problem: 'no commit to attach a check run to' } : await postCheckRun(deps.fetch, ctx, token, name, sha, result, runUrl);
  if (check.ok) deps.log(`seamkit: posted check run "${name}" on ${sha.slice(0, 12)}${check.url ? `: ${check.url}` : ''}`);
  else deps.warn(`seamkit: ${check.problem ?? 'no check run was posted'}`);
  if (check.ok && check.url) await written(deps, () => setOutput(ctx.outputPath, 'check-run-url', check.url as string));
}

async function writeOutputs(path: string, values: Record<string, string>): Promise<void> {
  for (const [k, v] of Object.entries(values)) await setOutput(path, k, v);
}

/** A step output or summary that cannot be written is a warning: the verdict stands without it. */
async function written(deps: ActionDeps, write: () => Promise<void>): Promise<void> {
  try {
    await write();
  } catch (err) {
    deps.warn(`seamkit: could not write the step outputs or summary: ${(err as Error).message}`);
  }
}

const PERMISSION = /\b403\b|denied|permission|not allowed|authentication/i;

/** What to change when the ledger could not be pushed, or undefined when the error does not say. */
export function pushAdvice(err: string): string | undefined {
  if (PERMISSION.test(err)) return 'give the job "permissions: contents: write"';
  if (/refused the push to seamkit\/state while no other writer was pushing/.test(err)) {
    return 'allow this workflow to push the seamkit/state branch, which a ruleset or branch protection may block, or set ledger: false';
  }
  if (/\bgit push \S+ refs\/heads\/seamkit\/state exited|could not synchronise/.test(err)) {
    return 'other runs kept pushing while this one retried; when many readbacks record at once, give them one concurrency group so they take turns';
  }
  return undefined;
}

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
  // An event that is not a finished production deploy is skipped before anything else, so a
  // misconfigured step does not post a check on a run that would have been skipped.
  const skip = skipReason(ctx, event);
  if (skip !== undefined) {
    deps.log(`seamkit: skipped, because ${skip}`);
    await written(deps, () => writeOutputs(ctx.outputPath, { outcome: 'skipped', 'exit-code': '0', title: `Skipped: ${skip}` }));
    return 0;
  }
  let inputs: ActionInputs;
  try {
    inputs = readInputs(deps.env);
  } catch (err) {
    if (!(err instanceof ActionInputError)) throw err;
    // A misconfigured step still shows on the commit, as a check with no verdict.
    deps.warn(`seamkit: ${err.message}`);
    const url = rawInput(deps.env, 'url');
    // An abbreviated sha input is expanded as the normal path expands it, since a check run needs
    // the full commit; one git does not know, or knows as something else, is used as given.
    const sha = (await fullCommit(ctx.workspace, headSha(ctx, event, rawInput(deps.env, 'sha')))).commit;
    await report(ctx, checkNameFor(deps.env), rawInput(deps.env, 'token'), sha, errorReport(err.message, url === '' ? 'the url input' : displayUrl(url)), 'error', EXIT_USAGE, deps);
    return EXIT_USAGE;
  }
  const cwd = ctx.workspace;
  const cli = cliRunner(cwd, deps);
  const given = deployedCommit(ctx, event, inputs.sha);
  const where = displayUrl(inputs.url);

  const defaultBranch = defaultBranchOf(ctx, event);
  const unready = await prepareCheckout(cwd, defaultBranch, inputs.branch, deps);
  const expanded = given === undefined ? undefined : await fullCommit(cwd, given);
  const deployed = expanded?.commit;
  let sha = headSha(ctx, event, inputs.sha);
  if (given !== undefined && sha === given && deployed !== undefined) sha = deployed;
  // A deployed commit that names a tag, or that a tag or branch shadows, would be read as the
  // tag's commit, so the run ends with no verdict rather than judge another commit.
  const problem =
    unready ??
    (expanded?.not === 'ref'
      ? `the deployed commit ${given} is also the name of a tag or branch that points at another commit; give the full commit id`
      : expanded?.not === 'tag'
        ? `the deployed commit ${given} is an annotated tag, not a commit; give the commit it points at`
        : undefined);
  if (problem !== undefined) {
    deps.warn(`seamkit: ${problem}`);
    await report(ctx, inputs.checkName, inputs.token, sha, errorReport(problem, where), 'error', EXIT_USAGE, deps);
    return EXIT_USAGE;
  }
  const read = inputs.branch !== '' ? inputs.branch : defaultBranch;
  const recording = await openLedger(inputs, cli, deps);
  const args = readbackArgs(inputs, deployed);
  const waited = await waitForLive(args, deployed, read, inputs, cli, cwd, deps);
  let result = waited.result;
  let recorded = false;
  let fetchedAfter: boolean | undefined;
  // CLI messages can repeat an input; a URL in one is shown as displayUrl shows it.
  const clean = (text: string): string => scrub(text, [inputs.url, inputs.versionUrl]);
  if (recording && result.code !== EXIT_USAGE) {
    // The run that counts is read again and recorded, so the ledger holds what was judged. Other
    // runs may have pushed to the ledger, and changes may have merged, during the wait, so both
    // are fetched again first. A recording that fails leaves the verdict as it was read, and says
    // it was not recorded.
    const resync = await cli(['state', 'sync', '--json']);
    if (resync.code !== 0) deps.warn(`seamkit: the ledger could not be fetched again after the wait, so this run judges it as it was: ${clean(resync.err.trim())}`);
    const refetch = read === undefined ? undefined : await fetchBranch(cwd, read);
    if (read !== undefined) fetchedAfter = refetch === undefined;
    if (refetch !== undefined) deps.warn(`seamkit: could not fetch ${read} from origin again: ${refetch}`);
    const again = await cli(args);
    if (again.code === EXIT_USAGE) deps.warn(`seamkit: the verdict was not recorded: ${clean(again.err.trim())}`);
    else result = again;
  }

  let out: Report;
  let outcome: Outcome | 'error' = 'error';
  let code = result.code;
  if (result.code === EXIT_USAGE) {
    out = errorReport(clean(result.err), where);
    deps.warn(clean(result.err.trim()));
  } else {
    const parsed = JSON.parse(result.out) as { outcome: Outcome; verdicts: Verdict[]; recorded?: { id: string } };
    outcome = parsed.outcome;
    // The counted read decides, unless it named no commit after an earlier read did: a failed read
    // must not undo what the wait saw.
    const counted = productionOf(result);
    let reading = deployed !== undefined && (await landing(counted, deployed, cwd)) === 'unknown' && waited.lastKnown !== undefined ? waited.lastKnown : counted;
    // A fetch since that read may have brought its commit in; it is resolved as the wait resolves one.
    if (reading?.status === 'ok' && reading.reported !== undefined && reading.commit === undefined) {
      const commit = await knownCommit(cwd, reading.reported);
      if (commit !== undefined && commit.startsWith(reading.reported)) reading = { ...reading, commit };
    }
    // The note says what this repository holds now. The fetch after the wait, then the fetches made
    // for the reported commit, decide; only for a commit no fetch was made for does a fetch that
    // succeeded for another commit count.
    const during = reading?.reported === undefined ? undefined : waited.fetched.get(reading.reported);
    const fetchedOnce = [...waited.fetched.values()].some((ok) => ok);
    const refetch =
      fetchedAfter === true || during === true ? 'fetched' : fetchedAfter === false || during === false ? 'failed' : fetchedOnce ? 'fetched' : undefined;
    const deploy = deployed === undefined || result.code === 4 ? { notLive: false } : await deployNote(reading, deployed, waited.seconds, refetch, cwd);
    const overruled = deploy.notLive && outcome === 'pass';
    if (overruled) {
      outcome = 'fail';
      code = 1;
    }
    out = readbackReport(outcome, parsed.verdicts, where, deploy.note === undefined ? [] : [deploy.note]);
    if (overruled && deploy.title !== undefined) out = { ...out, title: deploy.title };
    deps.log(renderReadback(parsed.verdicts));
    if (deploy.note !== undefined) deps.log(`seamkit: ${deploy.note}`);
    if (parsed.recorded) {
      recorded = true;
      deps.log(`seamkit: recorded as event ${parsed.recorded.id.slice(0, 12)}`);
    }
  }

  if (recording) {
    const pushed = await cli(['state', 'sync']);
    if (pushed.code === 0) deps.log(`seamkit: ${pushed.out.trim()}`);
    else {
      const why = pushAdvice(pushed.err);
      deps.warn(`seamkit: ${recorded ? 'the verdict was recorded here but not pushed, so it is lost with this runner' : 'the ledger could not be pushed'}${why === undefined ? '' : `; ${why}`}: ${pushed.err.trim()}`);
    }
  }

  await report(ctx, inputs.checkName, inputs.token, sha, out, outcome, code, deps);
  return code;
}
