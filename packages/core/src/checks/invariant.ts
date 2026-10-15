import { InputError, type CheckDef } from '../check.js';
import type { Gap, VerdictDraft } from '../verdict.js';

/**
 * An invariant over a set of rows, such as "every note has an owner". The caller runs its own query
 * and reports two numbers: how many rows were in scope, and how many of them violate the invariant.
 *
 * Reporting only the violations is how an invariant suite prints PASS on an empty table, because
 * zero violations out of zero rows looks exactly like zero violations out of a million. This check
 * needs both numbers, and zero rows in scope is `examined_nothing`.
 */
export interface InvariantInput {
  subject: string;
  scope: string;
  examined: number;
  violations: number;
  samples?: string[];
  notExamined?: Gap[];
}

const KEYS = new Set(['subject', 'scope', 'examined', 'violations', 'samples', 'notExamined']);
const MAX_SAMPLES = 20;

function fail(message: string): never {
  throw new InputError(message);
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) fail(`${field} must be a non-empty string`);
  return value;
}

function count(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    fail(`${field} must be a non-negative integer, got ${JSON.stringify(value)}`);
  }
  return value;
}

export const invariantCheck: CheckDef<InvariantInput> = {
  name: 'invariant',
  version: 1,
  summary: 'An invariant over rows: passes only when rows were examined and none violate it.',

  parseInput(raw: unknown): InvariantInput {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail('input must be a JSON object');
    const obj = raw as Record<string, unknown>;
    const unknown = Object.keys(obj).filter((k) => !KEYS.has(k));
    if (unknown.length > 0) fail(`unknown field(s): ${unknown.join(', ')}; allowed: ${[...KEYS].join(', ')}`);
    const input: InvariantInput = {
      subject: nonEmptyString(obj['subject'], 'subject'),
      scope: nonEmptyString(obj['scope'], 'scope'),
      examined: count(obj['examined'], 'examined'),
      violations: count(obj['violations'], 'violations'),
    };
    if (input.violations > input.examined) {
      fail(`violations (${input.violations}) cannot exceed examined (${input.examined})`);
    }
    if (obj['samples'] !== undefined) {
      const samples = obj['samples'];
      if (!Array.isArray(samples) || samples.some((s) => typeof s !== 'string')) fail('samples must be an array of strings');
      if (samples.length > MAX_SAMPLES) fail(`samples holds at most ${MAX_SAMPLES} entries`);
      input.samples = samples as string[];
    }
    if (obj['notExamined'] !== undefined) {
      const gaps = obj['notExamined'];
      if (!Array.isArray(gaps)) fail('notExamined must be an array of {item, reason}');
      input.notExamined = gaps.map((g, i) => {
        if (typeof g !== 'object' || g === null) fail(`notExamined[${i}] must be an object`);
        const gap = g as Record<string, unknown>;
        return { item: nonEmptyString(gap['item'], `notExamined[${i}].item`), reason: nonEmptyString(gap['reason'], `notExamined[${i}].reason`) };
      });
    }
    return input;
  },

  evaluate(input: InvariantInput): VerdictDraft {
    const notExamined = input.notExamined ?? [];
    if (input.examined === 0) {
      return {
        subject: input.subject,
        outcome: 'examined_nothing',
        state: 'no_rows',
        examined: [{ item: input.scope, count: 0 }],
        notExamined,
        reasons: [`no rows were in scope (${input.scope}), and a check over zero rows is not a pass`],
      };
    }
    const evidence = [
      { kind: 'count' as const, value: `${input.violations}/${input.examined}`, label: 'violating rows' },
      ...(input.samples ?? []).map((s) => ({ kind: 'text' as const, value: s, label: 'sample' })),
    ];
    if (input.violations > 0) {
      return {
        subject: input.subject,
        outcome: 'fail',
        state: 'violated',
        examined: [{ item: input.scope, count: input.examined }],
        notExamined,
        evidence,
        reasons: [`${input.violations} of ${input.examined} rows violate ${input.subject}`],
      };
    }
    return {
      subject: input.subject,
      outcome: 'pass',
      state: 'held',
      examined: [{ item: input.scope, count: input.examined }],
      notExamined,
      evidence,
    };
  },
};
