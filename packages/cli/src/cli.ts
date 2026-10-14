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
  parseEventFile,
  renderSummary,
  renderVerdict,
  replayVerdict,
  runCheck,
  type Actor,
  type CheckRun,
  type Outcome,
  type SeamEvent,
  type Verdict,
} from '@seamkit/core';
import { GitStateStore, NotAGitRepository, STATE_BRANCH, type StoredFile } from '@seamkit/state';

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
  seamkit check <name> [--input <file>|-] [--record|--no-record] [--json]
  seamkit checks
  seamkit replay [<event-id-prefix>] [--json]
  seamkit state init
  seamkit state list [--json]
  seamkit state verify [--json]
  seamkit state sync [--remote <name>]
  seamkit version

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
  remote?: string;
  cwd?: string;
  help?: boolean;
  version?: boolean;
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
        remote: { type: 'string' },
        cwd: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    }) as { values: Flags; positionals: string[] });
  } catch (err) {
    io.err(`seamkit: ${(err as Error).message}\n\n${HELP}`);
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
      default:
        throw new UsageError(`unknown command: ${command}`);
    }
  } catch (err) {
    if (err instanceof UsageError) io.err(`seamkit: ${err.message}\nRun "seamkit help" for usage.\n`);
    else if (err instanceof InputError) io.err(`seamkit: input error: ${err.message}\n`);
    else if (err instanceof NotAGitRepository) io.err(`seamkit: ${err.message}\n`);
    else io.err(`seamkit: ${(err as Error).message}\n`);
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
    io.out(`${JSON.stringify({ outcome, exitCode: exitCodeFor(outcome), verdicts, ...extra })}\n`);
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

  let recorded: { id: string; path: string } | undefined;
  if (!flags['no-record']) {
    let store: GitStateStore | undefined;
    try {
      store = await GitStateStore.open(cwd);
    } catch (err) {
      if (!(err instanceof NotAGitRepository) || flags.record) throw err;
    }
    if (store !== undefined && (flags.record || (await store.exists()))) {
      const event: SeamEvent = { v: 1, kind: 'verdict', at, actor: detectActor(io.env), tool: { name: 'seamkit', version: VERSION }, body: { run } };
      const r = await store.append(event);
      recorded = { id: r.id, path: r.path };
    }
  }
  print(run.verdicts, outcome, io, flags.json === true, recorded ? { recorded } : {});
  if (!flags.json) {
    io.err(recorded ? `recorded as event ${recorded.id.slice(0, 12)} on ${STATE_BRANCH}\n` : `not recorded (no ${STATE_BRANCH} branch; run "seamkit state init" or pass --record)\n`);
  }
  return exitCodeFor(outcome);
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
      if (flags.json) io.out(`${JSON.stringify(rows)}\n`);
      else {
        for (const r of rows) {
          io.out(
            r.ok
              ? `${String(r.at)}  ${(r.id as string).slice(0, 12)}  ${r.kind}  ${r.check ?? ''}  ${(r.outcomes ?? []).join(',')}\n`
              : `${r.path}  CORRUPT  ${(r.problems ?? []).join('; ')}\n`,
          );
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
      if (flags.json) io.out(`${JSON.stringify(r)}\n`);
      else io.out(`${messages[r.status]}\n`);
      return r.status === 'no_remote' ? EXIT_USAGE : 0;
    }
    default:
      throw new UsageError(sub === undefined ? 'state needs a subcommand: init, list, verify or sync' : `unknown state subcommand: ${sub}`);
  }
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
