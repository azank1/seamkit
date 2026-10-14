/**
 * The four outcomes every seamkit check returns, in ascending order of severity.
 *
 * `examined_nothing` is a result in its own right: a check that looked at zero rows never passes.
 * `unclassified` means neither policy nor a ruling covers the case, and it stops for a human.
 */
export const OUTCOMES = ['pass', 'examined_nothing', 'unclassified', 'fail'] as const;
export type Outcome = (typeof OUTCOMES)[number];

const SEVERITY: Readonly<Record<Outcome, number>> = {
  pass: 0,
  examined_nothing: 1,
  unclassified: 2,
  fail: 3,
};

/** Process exit codes. Every code other than 0 means "not a pass". */
export const EXIT_CODES: Readonly<Record<Outcome, number>> = {
  pass: 0,
  fail: 1,
  examined_nothing: 3,
  unclassified: 4,
};

/** Exit code for a usage or configuration error, when no verdict was produced. */
export const EXIT_USAGE = 2;

export function isOutcome(value: unknown): value is Outcome {
  return typeof value === 'string' && (OUTCOMES as readonly string[]).includes(value);
}

export function exitCodeFor(outcome: Outcome): number {
  return EXIT_CODES[outcome];
}

/**
 * Combines outcomes by severity: any fail, then any unclassified, then any examined_nothing, else pass.
 *
 * Combining no outcomes at all gives `examined_nothing`, never `pass`. This is deliberate: the
 * vacuous truth of `[].every(...)` is how a suite prints PASS on an empty table.
 */
export function combine(outcomes: readonly Outcome[]): Outcome {
  let worst: Outcome | undefined;
  for (const outcome of outcomes) {
    if (!isOutcome(outcome)) throw new TypeError(`not an outcome: ${String(outcome)}`);
    if (worst === undefined || SEVERITY[outcome] > SEVERITY[worst]) worst = outcome;
  }
  return worst ?? 'examined_nothing';
}

/** Labels used by every surface. Only `pass` may ever be rendered as a success. */
export const OUTCOME_LABELS: Readonly<Record<Outcome, string>> = {
  pass: 'PASS',
  fail: 'FAIL',
  examined_nothing: 'EXAMINED NOTHING',
  unclassified: 'UNCLASSIFIED',
};
