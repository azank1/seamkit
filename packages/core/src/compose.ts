import { digest } from './canonical.js';
import { combine } from './outcome.js';
import { assertVerdict, type Verdict } from './verdict.js';

/**
 * Combines several verdicts about one subject into a composite, for example the gate verdict for
 * one pull request. The outcome is the most severe part; gaps, evidence and reasons are carried
 * over with the part's check name in front, so aggregation never hides a gap.
 *
 * A composite of no parts is `examined_nothing`.
 */
export function compose(check: string, subject: string, parts: readonly Verdict[], at: string): Verdict {
  const outcome = combine(parts.map((p) => p.outcome));
  const reasons =
    parts.length === 0
      ? ['no checks were evaluated, so nothing was examined']
      : parts
          .filter((p) => p.outcome !== 'pass')
          .flatMap((p) => p.reasons.map((r) => `${p.check} (${p.subject}): ${r}`));
  return assertVerdict({
    check,
    subject,
    outcome,
    examined: parts.flatMap((p) => p.examined.map((e) => ({ ...e, item: `${p.check}: ${e.item}` }))),
    notExamined: parts.flatMap((p) => p.notExamined.map((g) => ({ ...g, item: `${p.check}: ${g.item}` }))),
    evidence: parts.flatMap((p) => p.evidence),
    reasons,
    inputs: digest({ compose: check, subject, parts: parts.map((p) => p.inputs) }),
    at,
  });
}
