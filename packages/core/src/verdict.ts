import { DIGEST_PATTERN } from './canonical.js';
import { isOutcome, type Outcome } from './outcome.js';

/** Something a check actually looked at. `count` is how many rows or objects; `of` is a denominator when known. */
export interface Examined {
  item: string;
  count?: number;
  of?: number;
}

/** Something a check did not look at, and why. A verdict never omits its gaps. */
export interface Gap {
  item: string;
  reason: string;
}

export interface EvidenceRef {
  kind: 'url' | 'commit' | 'hash' | 'count' | 'event' | 'text';
  value: string;
  label?: string;
}

/** The one result type every check returns. */
export interface Verdict {
  check: string;
  subject: string;
  outcome: Outcome;
  /** Module-specific detail, for example the read-back state `not_proven`. */
  state?: string;
  examined: Examined[];
  notExamined: Gap[];
  evidence: EvidenceRef[];
  /** Why this outcome, in order, phrased so an agent can act on it. Required for every outcome but pass. */
  reasons: string[];
  /** Digest of everything the verdict was computed from, which is what makes it replayable. */
  inputs: string;
  /** ISO 8601 time supplied by the caller. Checks never read a clock. */
  at: string;
}

/** What a check's evaluate function returns; the runner adds `inputs` and `at`, and `check` by default. */
export type VerdictDraft = Omit<Verdict, 'check' | 'inputs' | 'at' | 'notExamined' | 'evidence' | 'reasons'> & {
  check?: string;
  notExamined?: Gap[];
  evidence?: EvidenceRef[];
  reasons?: string[];
};

export class VerdictInvariantError extends Error {
  override name = 'VerdictInvariantError';
  constructor(readonly violations: string[]) {
    super(`invalid verdict: ${violations.join('; ')}`);
  }
}

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;

function isCount(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0;
}

/** Returns every invariant the verdict breaks; an empty list means it is valid. */
export function verdictViolations(v: Verdict): string[] {
  const out: string[] = [];
  if (typeof v.check !== 'string' || v.check.length === 0) out.push('check must be a non-empty string');
  if (typeof v.subject !== 'string' || v.subject.length === 0) out.push('subject must be a non-empty string');
  if (!isOutcome(v.outcome)) out.push(`outcome must be one of the four outcomes, got ${String(v.outcome)}`);
  if (typeof v.at !== 'string' || !ISO_TIME.test(v.at)) out.push('at must be an ISO 8601 UTC time');
  if (typeof v.inputs !== 'string' || !DIGEST_PATTERN.test(v.inputs)) out.push('inputs must be a sha256 hex digest');
  if (!Array.isArray(v.examined)) out.push('examined must be an array');
  if (!Array.isArray(v.notExamined)) out.push('notExamined must be an array, even when empty');
  if (!Array.isArray(v.evidence)) out.push('evidence must be an array');
  if (!Array.isArray(v.reasons)) out.push('reasons must be an array');
  if (out.length > 0) return out;

  v.examined.forEach((e, i) => {
    if (typeof e.item !== 'string' || e.item.length === 0) out.push(`examined[${i}].item must be a non-empty string`);
    if (e.count !== undefined && !isCount(e.count)) out.push(`examined[${i}].count must be a non-negative integer`);
    if (e.of !== undefined && !isCount(e.of)) out.push(`examined[${i}].of must be a non-negative integer`);
    if (isCount(e.count) && isCount(e.of) && e.count > e.of) out.push(`examined[${i}].count exceeds its denominator`);
  });
  v.notExamined.forEach((g, i) => {
    if (typeof g.item !== 'string' || g.item.length === 0) out.push(`notExamined[${i}].item must be a non-empty string`);
    if (typeof g.reason !== 'string' || g.reason.length === 0) out.push(`notExamined[${i}].reason must be a non-empty string`);
  });

  // Zero rows is never a pass: a pass must rest on at least one thing actually looked at.
  if (v.outcome === 'pass' && !v.examined.some((e) => e.count === undefined || e.count > 0)) {
    out.push('a pass must have examined at least one thing (zero rows is never a pass)');
  }
  // Every stop says why, so an agent can act on it.
  if (v.outcome !== 'pass' && v.reasons.length === 0) {
    out.push(`a ${v.outcome} verdict must give at least one reason`);
  }
  return out;
}

export function assertVerdict(v: Verdict): Verdict {
  const violations = verdictViolations(v);
  if (violations.length > 0) throw new VerdictInvariantError(violations);
  return v;
}

/** Completes a draft with the runner-owned fields and validates it. */
export function finalize(draft: VerdictDraft, defaults: { check: string; inputs: string; at: string }): Verdict {
  const v: Verdict = {
    check: draft.check ?? defaults.check,
    subject: draft.subject,
    outcome: draft.outcome,
    examined: draft.examined,
    notExamined: draft.notExamined ?? [],
    evidence: draft.evidence ?? [],
    reasons: draft.reasons ?? [],
    inputs: defaults.inputs,
    at: defaults.at,
  };
  if (draft.state !== undefined) v.state = draft.state;
  return assertVerdict(v);
}
