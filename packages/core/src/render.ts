import { OUTCOME_LABELS, OUTCOMES, type Outcome } from './outcome.js';
import type { Verdict } from './verdict.js';

function examinedText(e: Verdict['examined'][number]): string {
  if (e.count === undefined) return e.item;
  return e.of === undefined ? `${e.item} (${e.count})` : `${e.item} (${e.count} of ${e.of})`;
}

/**
 * Plain-text rendering shared by every surface. It never colours anything, and it always prints
 * the not-examined list, saying "none listed" rather than leaving the line out.
 */
export function renderVerdict(v: Verdict): string {
  const lines = [`${OUTCOME_LABELS[v.outcome]}  ${v.check}  ${v.subject}${v.state ? `  (${v.state})` : ''}`];
  for (const r of v.reasons) lines.push(`  why: ${r}`);
  if (v.examined.length === 0) lines.push('  examined: nothing');
  for (const e of v.examined) lines.push(`  examined: ${examinedText(e)}`);
  if (v.notExamined.length === 0) lines.push('  not examined: none listed');
  for (const g of v.notExamined) lines.push(`  not examined: ${g.item} (${g.reason})`);
  for (const ev of v.evidence) lines.push(`  evidence: ${ev.label ? `${ev.label} ` : ''}${ev.value}`);
  return lines.join('\n');
}

/** "3 verdicts: 1 pass, 1 fail, 1 examined nothing", listing every outcome that occurred. */
export function renderSummary(verdicts: readonly Verdict[]): string {
  const counts = new Map<Outcome, number>();
  for (const v of verdicts) counts.set(v.outcome, (counts.get(v.outcome) ?? 0) + 1);
  const parts = OUTCOMES.filter((o) => counts.has(o)).map((o) => `${counts.get(o)} ${OUTCOME_LABELS[o].toLowerCase()}`);
  const noun = verdicts.length === 1 ? 'verdict' : 'verdicts';
  return parts.length === 0 ? `0 ${noun}` : `${verdicts.length} ${noun}: ${parts.join(', ')}`;
}
