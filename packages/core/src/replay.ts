import { digest } from './canonical.js';
import { replayRun, type CheckRegistry, type CheckRun } from './check.js';
import { assertVerdict, type Verdict } from './verdict.js';

/**
 * Turns the replay of one recorded run into a verdict: a match is a pass, a mismatch is a fail,
 * and a run that cannot be recomputed (for example because its check version was retired) is
 * `examined_nothing`, never a pass.
 */
export function replayVerdict(registry: CheckRegistry, eventId: string, run: CheckRun, at: string): Verdict {
  const result = replayRun(registry, run);
  const label = `${run.record.check}@${run.record.version}`;
  const base = {
    check: 'replay',
    subject: `event:${eventId.slice(0, 12)}`,
    inputs: digest({ replay: eventId }),
    at,
    evidence: [{ kind: 'event' as const, value: eventId }],
  };
  if (result.status === 'match') {
    return assertVerdict({
      ...base,
      outcome: 'pass',
      state: 'match',
      examined: [{ item: `recorded verdicts of ${label}`, count: result.verdictCount }],
      notExamined: [],
      reasons: [],
    });
  }
  if (result.status === 'mismatch') {
    return assertVerdict({
      ...base,
      outcome: 'fail',
      state: 'mismatch',
      examined: [{ item: `recorded verdicts of ${label}`, count: result.verdictCount }],
      notExamined: [],
      reasons: result.reasons,
    });
  }
  return assertVerdict({
    ...base,
    outcome: 'examined_nothing',
    state: 'not_replayable',
    examined: [],
    notExamined: [{ item: `recorded verdicts of ${label}`, reason: result.reasons.join('; ') }],
    reasons: result.reasons,
  });
}
