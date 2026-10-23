import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  EXIT_USAGE,
  InputError,
  assertVerdict,
  combine,
  compose,
  defaultRegistry,
  digest,
  exitCodeFor,
  oneLine,
  parseEventFile,
  readbackCheck,
  renderReadback,
  renderSummary,
  renderVerdict,
  replayVerdict,
  runCheck,
  versionDocText,
  type Actor,
  type CheckRun,
  type Outcome,
  type SeamEvent,
  type Verdict,
} from '@seamkit/core';
import { GitStateStore, NotAGitRepository, STATE_BRANCH, type StoredFile } from '@seamkit/state';
import { auditAdvice, gatherReadback, type ReadbackRequest } from './readback.js';
import { makeStamp, writeStamp } from './stamp.js';

export interface Io {
  out(text: string): void;
  err(text: string): void;
  readStdin(): Promise<string>;
  stdinIsTTY: boolean;
  env: Record<string, string | undefined>;
  cwd: string;
  /** The clock lives here, outside every check. */
  now(): string;
}

export const VERSION: string = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
).version;

const HELP = `seamkit ${VERSION}: deterministic production checks.

Usage:
  seamkit audit --url <production-url> [--last <n>] [--branch <ref>] [--json]
  seamkit readback --url <production-url> [--pr <n> | --commit <rev>] [--last <n>]
                   [--branch <ref>] [--deployed <rev>] [--version-url <url>]
                   [--record|--no-record|--no-ledger] [--json]
  seamkit stamp [--out <file>] [--commit <rev>] [--require-clean]
  seamkit check <name> [--input <file>|-] [--record|--no-record] [--json]
  seamkit checks
  seamkit replay [<event-id-prefix>] [--json]
  seamkit state init
  seamkit state list [--json]
  seamkit state verify [--json]
  seamkit state sync [--remote <name>]
  seamkit version

readback proves whether production holds each merged change: by the commit production says it
runs (a version document, which "seamkit stamp" writes at build time), and by the markers in a
change's seamkit-card. audit is readback over the last changes with advice for every gap. The
production URL can also come from SEAMKIT_URL. After a deploy, --deployed names the commit just
deployed. When the ledger holds a run that read this address, a change merged after it that was
never seen live here, nor in any build production was seen running here, is left to the next
deploy; any other is still judged, so a rollback fails. Without such a run, or once production here
was seen running a commit this repository does not have, every change is judged. --last counts
the changes judged. --no-ledger judges without reading the ledger, as if there were none, and
records nothing.

Every command that produces a verdict exits with its outcome:
  0 pass   1 fail   3 examined nothing   4 unclassified (stops for a human)
  2 usage or configuration error (no verdict was produced)

Verdicts are recorded on the ${STATE_BRANCH} branch when it exists (create it with
"seamkit state init"), or always with --record. Nothing else in the repository is touched.
`;

class UsageError extends Error {
  override name = 'UsageError';
}

type Flags = {
  input?: string;
  json?: boolean;
  record?: boolean;
  'no-record'?: boolean;
  'no-ledger'?: boolean;
  remote?: string;
  cwd?: string;
  help?: boolean;
  version?: boolean;
  url?: string;
  pr?: string;
  commit?: string;
  last?: string;
  branch?: string;
  'version-url'?: string;
  deployed?: string;
  out?: string;
  'require-clean'?: boolean;
};

export async function run(argv: readonly string[], io: Io): Promise<number> {
  let values: Flags;
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        input: { type: 'string', short: 'i' },
        json: { type: 'boolean' },
        record: { type: 'boolean' },
        'no-record': { type: 'boolean' },
        'no-ledger': { type: 'boolean' },
        remote: { type: 'string' },
        cwd: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
        url: { type: 'string' },
        pr: { type: 'string' },
        commit: { type: 'string' },
        last: { type: 'string' },
        branch: { type: 'string' },
        'version-url': { type: 'string' },
        deployed: { type: 'string' },
        out: { type: 'string' },
        'require-clean': { type: 'boolean' },
      },
    }) as { values: Flags; positionals: string[] });
  } catch (err) {
    io.err(`seamkit: ${oneLine((err as Error).message)}\n\n${HELP}`);
    return EXIT_USAGE;
  }
  const cwd = resolve(io.cwd, values.cwd ?? '.');
  const [command, ...rest] = positionals;
  try {
    if (values.version || command === 'version') {
      io.out(`${VERSION}\n`);
      return 0;
    }
    if (values.help || command === undefined || command === 'help') {
      io.out(HELP);
      return command === undefined && !values.help ? EXIT_USAGE : 0;
    }
    switch (command) {
      case 'check':
        return await cmdCheck(rest, values, cwd, io);
      case 'checks':
        return cmdChecks(io);
      case 'replay':
        return await cmdReplay(rest, values, cwd, io);
      case 'state':
        return await cmdState(rest, values, cwd, io);
      case 'readback':
        return await cmdReadback(rest, values, cwd, io, false);
      case 'audit':
        return await cmdReadback(rest, values, cwd, io, true);
      case 'stamp':
        return await cmdStamp(rest, values, cwd, io);
      default:
        throw new UsageError(`unknown command: ${command}`);
    }
  } catch (err) {
    // A message can quote a ledger path, git's output or an input, so it is shown as one plain line.
    const message = oneLine((err as Error).message);
    if (err instanceof UsageError) io.err(`seamkit: ${message}\nRun "seamkit help" for usage.\n`);
    else if (err instanceof InputError) io.err(`seamkit: input error: ${message}\n`);
    else io.err(`seamkit: ${message}\n`);
    return EXIT_USAGE;
  }
}

/** Provenance only. Every field here can be set by whoever runs the command, agents included. */
export function detectActor(env: Io['env']): Actor {
  const actor: Actor = { kind: 'unknown' };
  if (env['GITHUB_ACTIONS'] === 'true') Object.assign(actor, { kind: 'ci', harness: 'github-actions' });
  else if (env['CI'] === 'true' || env['CI'] === '1') actor.kind = 'ci';
  else if (env['CLAUDECODE'] === '1') {
    Object.assign(actor, { kind: 'agent', harness: 'claude-code' });
    if (env['CLAUDE_CODE_SESSION_ID']) actor.session = env['CLAUDE_CODE_SESSION_ID'];
  }
  const kind = env['SEAMKIT_ACTOR_KIND'];
  if (kind === 'human' || kind === 'agent' || kind === 'ci') actor.kind = kind;
  const handle = env['SEAMKIT_HANDLE'];
  if (handle) {
    if (handle.includes('@')) throw new UsageError('SEAMKIT_HANDLE must be a handle, not an email address');
    actor.handle = handle;
  }
  return actor;
}

async function readInput(flags: Flags, cwd: string, io: Io): Promise<unknown> {
  let text: string;
  if (flags.input === undefined || flags.input === '-') {
    if (flags.input === undefined && io.stdinIsTTY) throw new UsageError('give the input with --input <file>, or pipe it on stdin');
    text = await io.readStdin();
  } else {
    text = await readFile(resolve(cwd, flags.input), 'utf8');
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new InputError(`input is not valid JSON: ${(err as Error).message}`);
  }
}

function print(verdicts: readonly Verdict[], outcome: Outcome, io: Io, json: boolean, extra: Record<string, unknown> = {}): void {
  if (json) {
    io.out(jsonLine({ outcome, exitCode: exitCodeFor(outcome), verdicts, ...extra }));
    return;
  }
  for (const v of verdicts) io.out(`${renderVerdict(v)}\n\n`);
  io.out(`${renderSummary(verdicts)}\n`);
}

async function cmdCheck(args: string[], flags: Flags, cwd: string, io: Io): Promise<number> {
  const [name, ...extra] = args;
  if (name === undefined) throw new UsageError('check needs a check name; see "seamkit checks"');
  if (extra.length > 0) throw new UsageError(`unexpected argument: ${extra[0]}`);
  if (flags.record && flags['no-record']) throw new UsageError('--record and --no-record cannot be combined');
  const def = defaultRegistry().get(name);
  if (def === undefined) throw new UsageError(`unknown check: ${name}; see "seamkit checks"`);
  const at = io.now();
  const run = runCheck(def, await readInput(flags, cwd, io), at);
  const outcome = combine(run.verdicts.map((v) => v.outcome));
  const recorded = await recordRun(run, at, flags, cwd, io);
  print(run.verdicts, outcome, io, flags.json === true, recorded ? { recorded } : {});
  if (!flags.json) noteRecording(recorded, flags, io);
  return exitCodeFor(outcome);
}

/** Records a run when the state branch exists, or always with --record; never with --no-record. */
async function recordRun(run: CheckRun, at: string, flags: Flags, cwd: string, io: Io): Promise<{ id: string; path: string } | undefined> {
  if (flags.record && flags['no-record']) throw new UsageError('--record and --no-record cannot be combined');
  if (flags['no-record'] || flags['no-ledger']) return undefined;
  let store: GitStateStore | undefined;
  try {
    store = await GitStateStore.open(cwd);
  } catch (err) {
    if (!(err instanceof NotAGitRepository) || flags.record) throw err;
  }
  if (store === undefined || !(flags.record || (await store.exists()))) return undefined;
  const event: SeamEvent = { v: 1, kind: 'verdict', at, actor: detectActor(io.env), tool: { name: 'seamkit', version: VERSION }, body: { run } };
  const r = await store.append(event);
  return { id: r.id, path: r.path };
}

function noteRecording(recorded: { id: string } | undefined, flags: Flags, io: Io): void {
  io.err(
    recorded
      ? `recorded as event ${recorded.id.slice(0, 12)} on ${STATE_BRANCH}\n`
      : flags['no-record'] || flags['no-ledger']
        ? `not recorded (${flags['no-ledger'] ? '--no-ledger' : '--no-record'})\n`
        : `not recorded (no ${STATE_BRANCH} branch; run "seamkit state init" or pass --record)\n`,
  );
}

/**
 * One JSON value on one line. A merged change's words can hold ##[, which a GitHub Actions runner
 * reads as a workflow command anywhere on a line; JSON's own escape keeps the value the same.
 */
function jsonLine(value: unknown): string {
  return `${JSON.stringify(value).replace(/##\[/g, '##\\u005b')}\n`;
}

/**
 * Output as a GitHub Actions step may print it. The runner reads a line as a workflow command when
 * it starts with :: once leading whitespace is trimmed, or holds ##[ anywhere, and it ends lines at
 * a lone CR too. Reports carry merged changes' own words, so a zero-width space goes before such a
 * line and inside ##[; nothing else changes. Fencing the output instead would add lines to what a
 * script captures, as in version=$(seamkit version).
 */
export function inert(text: string): string {
  return text.replace(/##\[/g, '##\u200b[').replace(/(^|[\r\n])(?=(?:[^\S\r\n]|\u0085)*::)/g, '$1\u200b');
}

/** The production URL, refused when it carries anything that must not be recorded. */
function productionUrl(flags: Flags, env: Io['env']): string {
  const raw = flags.url ?? env['SEAMKIT_URL'];
  if (raw === undefined || raw === '') throw new UsageError('give the production URL with --url, or set SEAMKIT_URL');
  return recordableUrl(raw, '--url', 'https://your.app');
}

/** An address the ledger may record. Never echoed: a malformed URL can still hold a token, and these messages reach reports. */
function recordableUrl(raw: string, flag: string, example: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UsageError(`${flag} is not an absolute URL; give one such as ${example}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new UsageError(`${flag} must be an http or https URL`);
  if (url.username !== '' || url.password !== '') throw new UsageError(`${flag} must not contain a user name or password, because URLs are recorded in the ledger`);
  if (url.search !== '') throw new UsageError(`${flag} must not carry a query string, because URLs are recorded in the ledger`);
  url.hash = '';
  return url.href;
}

function positive(value: string | undefined, flag: string, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (!/^[1-9][0-9]*$/.test(value) || Number(value) > max) throw new UsageError(`${flag} must be a whole number from 1 to ${max}`);
  return Number(value);
}

async function cmdReadback(args: string[], flags: Flags, cwd: string, io: Io, audit: boolean): Promise<number> {
  if (args.length > 0) throw new UsageError(`unexpected argument: ${args[0]}`);
  const command = audit ? 'audit' : 'readback';
  if (audit && (flags.pr !== undefined || flags.commit !== undefined)) throw new UsageError('audit covers the last changes; use readback for one pull request or commit');
  if (flags.pr !== undefined && flags.commit !== undefined) throw new UsageError('--pr and --commit cannot be combined');
  if (flags.record && flags['no-record']) throw new UsageError('--record and --no-record cannot be combined');
  if (flags['no-ledger'] && (audit || flags.record)) throw new UsageError(audit ? 'audit reads the ledger; --no-ledger is for readback' : '--no-ledger records nothing, so it cannot be combined with --record');
  const req: ReadbackRequest = { url: productionUrl(flags, io.env), last: positive(flags.last, '--last', 20, 1000) };
  if (flags.pr !== undefined) req.pr = positive(flags.pr, '--pr', 0, Number.MAX_SAFE_INTEGER);
  if (flags.commit !== undefined) req.commit = flags.commit;
  if (flags.branch !== undefined) req.branch = flags.branch;
  if (flags.deployed !== undefined) {
    if (flags.deployed === '' || flags.deployed.startsWith('-')) throw new UsageError('--deployed needs a commit, such as the one the host reports for this deploy');
    req.deployed = flags.deployed;
  }
  if (flags['no-ledger']) req.noLedger = true;
  if (flags['version-url'] !== undefined) req.versionUrl = recordableUrl(flags['version-url'], '--version-url', 'https://your.app/version.json');
  const { input, context } = await gatherReadback(cwd, req, io.now, { userAgent: `seamkit/${VERSION} (${command})` });
  const at = io.now();
  const run = runCheck(readbackCheck, input, at);
  const outcome = combine(run.verdicts.map((v) => v.outcome));
  const recorded = await recordRun(run, at, flags, cwd, io);
  const advice = audit ? auditAdvice(context) : [];
  if (flags.json) {
    // What production said it runs, from the version document this run read first: the fact a
    // caller waiting for a deploy needs, whether or not any change was in scope.
    const v = context.primaryVersion;
    const production = { url: v.url, status: v.status, ...(v.commit ? { commit: v.commit } : {}), ...(v.reported ? { reported: v.reported } : {}), ...(v.reason ? { reason: v.reason } : {}) };
    io.out(jsonLine({ outcome, exitCode: exitCodeFor(outcome), verdicts: run.verdicts, production, ...(audit ? { advice } : {}), ...(recorded ? { recorded } : {}) }));
    return exitCodeFor(outcome);
  }
  io.out(`${renderReadback(run.verdicts)}\n`);
  if (advice.length > 0) io.out(`\nTo examine more:\n${advice.map((a) => `  - ${a}`).join('\n')}\n`);
  noteRecording(recorded, flags, io);
  return exitCodeFor(outcome);
}

async function cmdStamp(args: string[], flags: Flags, cwd: string, io: Io): Promise<number> {
  if (args.length > 0) throw new UsageError(`unexpected argument: ${args[0]}`);
  const req = { requireClean: flags['require-clean'] === true, ...(flags.out ? { out: flags.out } : {}), ...(flags.commit ? { commit: flags.commit } : {}) };
  const { doc, uncommitted } = await makeStamp(cwd, req, io.env, io.now());
  const changes = `${uncommitted.length} uncommitted change${uncommitted.length === 1 ? '' : 's'} (such as ${oneLine(uncommitted[0] ?? '')})`;
  if (doc.dirty === true && req.requireClean) {
    io.err(`seamkit: refusing to stamp a build with ${changes}\n`);
    return 1;
  }
  const state = doc.dirty === true ? 'with uncommitted changes' : doc.dirty === false ? 'clean' : 'cleanliness unknown';
  if (flags.out) {
    const path = await writeStamp(cwd, flags.out, doc);
    io.err(`stamped ${oneLine(path)}: ${doc.commit.slice(0, 12)} from ${doc.source}, ${state}\n`);
  } else {
    io.out(versionDocText(doc));
  }
  if (doc.dirty === true) {
    io.err(`warning: ${changes}, so this build does not match ${doc.commit.slice(0, 12)}, and readback will not treat its version as proof\n`);
  }
  return 0;
}

function cmdChecks(io: Io): number {
  for (const def of defaultRegistry().list()) io.out(`${def.name}@${def.version}  ${def.summary}\n`);
  return 0;
}

async function loadFiles(cwd: string): Promise<{ store: GitStateStore; exists: boolean; files: StoredFile[] }> {
  const store = await GitStateStore.open(cwd);
  const exists = await store.exists();
  return { store, exists, files: exists ? await store.list() : [] };
}

async function cmdReplay(args: string[], flags: Flags, cwd: string, io: Io): Promise<number> {
  const [prefix, ...extra] = args;
  if (extra.length > 0) throw new UsageError(`unexpected argument: ${extra[0]}`);
  if (prefix !== undefined && !/^[0-9a-f]{4,64}$/.test(prefix)) throw new UsageError('an event id prefix is 4 to 64 hex characters');
  const at = io.now();
  const { files } = await loadFiles(cwd);
  const registry = defaultRegistry();
  const parts: Verdict[] = [];
  for (const file of files) {
    const parsed = parseEventFile(file.path, file.content);
    if (parsed.ok && (parsed.kind !== 'verdict' || (prefix !== undefined && !parsed.id.startsWith(prefix)))) continue;
    if (!parsed.ok) {
      if (prefix !== undefined && !file.path.includes(`-${prefix}`)) continue;
      parts.push(
        assertVerdict({
          check: 'replay',
          subject: file.path,
          outcome: 'fail',
          state: 'corrupt',
          examined: [{ item: 'event file', count: 1 }],
          notExamined: [],
          evidence: [{ kind: 'hash', value: file.oid, label: 'blob' }],
          reasons: parsed.problems.map((p) => `the event file cannot be trusted: ${p}`),
          inputs: digest({ replay: file.path, blob: file.oid }),
          at,
        }),
      );
      continue;
    }
    const run = (parsed.event['body'] as { run: CheckRun }).run;
    parts.push(replayVerdict(registry, parsed.id, run, at));
  }
  const composite = compose('replay', prefix === undefined ? STATE_BRANCH : `event:${prefix}`, parts, at);
  if (flags.json) print([composite, ...parts], composite.outcome, io, true);
  else {
    for (const v of parts) if (v.outcome !== 'pass') io.out(`${renderVerdict(v)}\n\n`);
    io.out(`${renderVerdict(composite)}\n\n${renderSummary(parts)} replayed\n`);
  }
  return exitCodeFor(composite.outcome);
}

async function cmdState(args: string[], flags: Flags, cwd: string, io: Io): Promise<number> {
  const [sub, ...extra] = args;
  if (extra.length > 0) throw new UsageError(`unexpected argument: ${extra[0]}`);
  switch (sub) {
    case 'init': {
      const store = await GitStateStore.open(cwd);
      const r = await store.init();
      io.out(r.created ? `created ${STATE_BRANCH} at ${r.commit.slice(0, 12)}\n` : `${STATE_BRANCH} already exists at ${r.commit.slice(0, 12)}\n`);
      return 0;
    }
    case 'list': {
      const { files } = await loadFiles(cwd);
      const rows = files.map((f) => {
        const parsed = parseEventFile(f.path, f.content);
        if (!parsed.ok) return { path: f.path, ok: false, problems: parsed.problems };
        const run = parsed.kind === 'verdict' ? (parsed.event['body'] as { run: CheckRun }).run : undefined;
        return {
          path: f.path,
          ok: true,
          id: parsed.id,
          kind: parsed.kind,
          at: parsed.event['at'],
          check: run ? `${run.record.check}@${run.record.version}` : undefined,
          outcomes: run ? run.verdicts.map((v) => v.outcome) : undefined,
        };
      });
      if (flags.json) io.out(jsonLine(rows));
      else {
        // A ledger file's name and fields are anyone's who can push to the branch, so no row can
        // carry a terminal escape or a line break.
        for (const r of rows) {
          const row = r.ok
            ? `${typeof r.at === 'string' ? r.at : '(no time)'}  ${(r.id as string).slice(0, 12)}  ${r.kind}  ${r.check ?? ''}  ${outcomesText(r.outcomes ?? [])}`
            : `${r.path}  CORRUPT  ${(r.problems ?? []).join('; ')}`;
          io.out(`${oneLine(row)}\n`);
        }
        io.out(`${rows.length} event${rows.length === 1 ? '' : 's'} on ${STATE_BRANCH}\n`);
      }
      return 0;
    }
    case 'verify': {
      const at = io.now();
      const { exists, files } = await loadFiles(cwd);
      const verdict = integrityVerdict(exists, files, at);
      print([verdict], verdict.outcome, io, flags.json === true);
      return exitCodeFor(verdict.outcome);
    }
    case 'sync': {
      const store = await GitStateStore.open(cwd);
      const r = await store.sync(flags.remote ?? 'origin');
      const messages: Record<string, string> = {
        up_to_date: `${STATE_BRANCH} is up to date with ${r.remote}`,
        pushed: `pushed ${STATE_BRANCH} to ${r.remote}`,
        pulled: `updated ${STATE_BRANCH} from ${r.remote}`,
        merged: `merged ${STATE_BRANCH} with ${r.remote} and pushed the result`,
        empty: `${STATE_BRANCH} exists neither here nor on ${r.remote}; nothing to do`,
        no_remote: `there is no remote called ${r.remote}`,
      };
      if (flags.json) io.out(jsonLine(r));
      else io.out(`${messages[r.status]}\n`);
      return r.status === 'no_remote' ? EXIT_USAGE : 0;
    }
    default:
      throw new UsageError(sub === undefined ? 'state needs a subcommand: init, list, verify or sync' : `unknown state subcommand: ${sub}`);
  }
}

/** A run's outcomes; a long run is shown by its combined outcome and its size. */
function outcomesText(outcomes: readonly Outcome[]): string {
  return outcomes.length <= 3 ? outcomes.join(',') : `${combine(outcomes)} (${outcomes.length} verdicts)`;
}

/** Checks every event file against its name and its canonical form. */
export function integrityVerdict(exists: boolean, files: readonly StoredFile[], at: string): Verdict {
  const inputs = digest({ integrity: STATE_BRANCH, files: files.map((f) => [f.path, f.oid]) });
  const base = { check: 'state.integrity', subject: STATE_BRANCH, inputs, at, evidence: [] };
  if (!exists || files.length === 0) {
    return assertVerdict({
      ...base,
      outcome: 'examined_nothing',
      examined: [{ item: 'event files', count: 0 }],
      notExamined: [],
      reasons: [exists ? `${STATE_BRANCH} holds no event files yet` : `the ${STATE_BRANCH} branch does not exist; run "seamkit state init"`],
    });
  }
  const problems: string[] = [];
  const unknownKinds = new Map<string, number>();
  for (const f of files) {
    const parsed = parseEventFile(f.path, f.content);
    if (!parsed.ok) problems.push(...parsed.problems.map((p) => `${f.path}: ${p}`));
    else if (!parsed.known) unknownKinds.set(parsed.kind, (unknownKinds.get(parsed.kind) ?? 0) + 1);
  }
  const notExamined = [...unknownKinds].map(([kind, n]) => ({
    item: `schema of ${n} "${kind}" event${n === 1 ? '' : 's'}`,
    reason: 'kind not known to this version; hash and canonical form were still checked',
  }));
  const shown = problems.slice(0, 20);
  if (problems.length > shown.length) shown.push(`and ${problems.length - shown.length} more problems`);
  return assertVerdict({
    ...base,
    outcome: problems.length > 0 ? 'fail' : 'pass',
    examined: [{ item: 'event files', count: files.length }],
    notExamined,
    reasons: shown,
  });
}
