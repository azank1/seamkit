import { canonicalJson, digest } from './canonical.js';
import { finalize, type Verdict, type VerdictDraft } from './verdict.js';

export interface CheckContext {
  /** The time of evaluation, supplied by the caller so that the check stays a pure function. */
  at: string;
}

/**
 * A check is a pure function from a JSON input to one or more verdicts. It reads no clock, file or
 * network. `version` changes whenever the meaning of a verdict changes, and replay always uses the
 * version that was recorded.
 */
export interface CheckDef<I> {
  name: string;
  version: number;
  summary: string;
  /** Validates raw JSON input. Throws InputError with a message an agent can act on. */
  parseInput(raw: unknown): I;
  evaluate(input: I, ctx: CheckContext): VerdictDraft | VerdictDraft[];
}

export class InputError extends Error {
  override name = 'InputError';
}

/** What gets recorded so that a run can be replayed: the check, its version and the raw input. */
export interface CheckRecord {
  check: string;
  version: number;
  input: unknown;
}

export interface CheckRun {
  record: CheckRecord;
  verdicts: Verdict[];
}

export function runCheck<I>(def: CheckDef<I>, rawInput: unknown, at: string): CheckRun {
  const input = def.parseInput(rawInput);
  const record: CheckRecord = { check: def.name, version: def.version, input: rawInput };
  const inputs = digest(record);
  const drafts = def.evaluate(input, { at });
  const list = Array.isArray(drafts) ? drafts : [drafts];
  if (list.length === 0) throw new Error(`check ${def.name}@${def.version} returned no verdicts`);
  return { record, verdicts: list.map((d) => finalize(d, { check: def.name, inputs, at })) };
}

export class CheckRegistry {
  private readonly defs = new Map<string, CheckDef<unknown>>();

  register<I>(def: CheckDef<I>): this {
    const key = `${def.name}@${def.version}`;
    if (this.defs.has(key)) throw new Error(`check ${key} is already registered`);
    if (!Number.isInteger(def.version) || def.version < 1) throw new Error(`check ${def.name} has an invalid version`);
    this.defs.set(key, def as CheckDef<unknown>);
    return this;
  }

  /** The exact version, or the latest version when none is given. */
  get(name: string, version?: number): CheckDef<unknown> | undefined {
    if (version !== undefined) return this.defs.get(`${name}@${version}`);
    let latest: CheckDef<unknown> | undefined;
    for (const def of this.defs.values()) {
      if (def.name === name && (latest === undefined || def.version > latest.version)) latest = def;
    }
    return latest;
  }

  list(): CheckDef<unknown>[] {
    return [...this.defs.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.version - b.version));
  }
}

export type ReplayStatus = 'match' | 'mismatch' | 'not_replayable';

export interface ReplayResult {
  status: ReplayStatus;
  /** Why the replay did not match or could not run. Empty on a match. */
  reasons: string[];
  verdictCount: number;
}

/** Recomputes a recorded run from its record and compares it byte for byte with what was recorded. */
export function replayRun(registry: CheckRegistry, recorded: CheckRun): ReplayResult {
  const { record, verdicts } = recorded;
  const verdictCount = Array.isArray(verdicts) ? verdicts.length : 0;
  const first = verdicts?.[0];
  if (first === undefined) {
    return { status: 'not_replayable', reasons: ['the recorded run holds no verdicts'], verdictCount };
  }
  const def = registry.get(record.check, record.version);
  if (def === undefined) {
    return {
      status: 'not_replayable',
      reasons: [`check ${record.check}@${record.version} is not known to this version of seamkit`],
      verdictCount,
    };
  }
  const expectedInputs = digest(record);
  const reasons: string[] = [];
  verdicts.forEach((v, i) => {
    if (v.inputs !== expectedInputs) reasons.push(`verdict ${i}: inputs digest does not match the recorded input`);
  });
  let recomputed: CheckRun;
  try {
    recomputed = runCheck(def, record.input, first.at);
  } catch (err) {
    reasons.push(`recomputing failed: ${(err as Error).message}`);
    return { status: 'mismatch', reasons, verdictCount };
  }
  if (recomputed.verdicts.length !== verdicts.length) {
    reasons.push(`recorded ${verdicts.length} verdicts, recomputed ${recomputed.verdicts.length}`);
  } else {
    recomputed.verdicts.forEach((v, i) => {
      const was = verdicts[i] as Verdict;
      if (canonicalJson(v) === canonicalJson(was)) return;
      const fields = new Set([...Object.keys(v), ...Object.keys(was)]);
      for (const field of [...fields].sort()) {
        const a = (was as unknown as Record<string, unknown>)[field];
        const b = (v as unknown as Record<string, unknown>)[field];
        if (canonicalJson(a ?? null) !== canonicalJson(b ?? null)) {
          reasons.push(`verdict ${i}: ${field} was ${canonicalJson(a ?? null)}, recomputed ${canonicalJson(b ?? null)}`);
        }
      }
    });
  }
  return { status: reasons.length === 0 ? 'match' : 'mismatch', reasons, verdictCount };
}
