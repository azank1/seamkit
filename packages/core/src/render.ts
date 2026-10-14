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

/** A change's reasons, then the gaps its reasons do not already state. */
function explanation(v: Verdict): string[] {
  return [...v.reasons, ...v.notExamined.filter((g) => !v.reasons.includes(`${g.item}: ${g.reason}`)).map((g) => `not examined: ${g.item} (${g.reason})`)];
}

const READBACK_GROUPS = [
  ['not_live', 'NOT LIVE'],
  ['not_proven', 'NOT PROVEN'],
  ['nothing_to_prove', 'NOTHING TO PROVE'],
  ['live', 'LIVE'],
] as const;

/**
 * Renders a readback run (its summary verdict first, then one verdict per change) grouped by state,
 * problems first. Every group states its denominator, and every change lists its own gaps.
 */
export function renderReadback(verdicts: readonly Verdict[]): string {
  const [summary, ...parts] = verdicts;
  if (summary === undefined) return '0 verdicts';
  const total = parts.length;
  const width = Math.max(0, ...parts.map((p) => p.subject.length));
  const lines: string[] = [];
  for (const [state, label] of READBACK_GROUPS) {
    const group = parts.filter((p) => p.state === state);
    if (group.length === 0) continue;
    const outcomes = OUTCOMES.filter((o) => group.some((p) => p.outcome === o)).map(
      (o) => `${group.filter((p) => p.outcome === o).length} ${OUTCOME_LABELS[o].toLowerCase()}`,
    );
    lines.push(`${label}  ${group.length} of ${total}  (${outcomes.join(', ')})`);
    // Changes with exactly the same explanation are listed together under it, so a reason shared by
    // every change (production serving no version document, say) is printed once, not once per change.
    const clusters = new Map<string, Verdict[]>();
    for (const p of group) {
      const key = JSON.stringify([p.outcome, explanation(p)]);
      clusters.set(key, [...(clusters.get(key) ?? []), p]);
    }
    const title = (p: Verdict): string => p.evidence.find((e) => e.label === 'title')?.value ?? '';
    for (const members of clusters.values()) {
      const first = members[0] as Verdict;
      if (members.length >= 3) {
        lines.push(`  ${members.length} changes, each for the same reason:`);
        for (const line of explanation(first)) lines.push(`      ${line}`);
        for (const p of members) lines.push(`    ${p.subject.padEnd(width)}  ${title(p)}`);
        continue;
      }
      for (const p of members) {
        lines.push(`  ${p.subject.padEnd(width)}  ${title(p)}`);
        for (const line of explanation(p)) lines.push(`${' '.repeat(width + 4)}${line}`);
      }
    }
    lines.push('');
  }
  const prefixes = parts.map((p) => `${p.subject}: `);
  const runGaps = summary.notExamined.filter((g) => !prefixes.some((prefix) => g.item.startsWith(prefix)));
  lines.push(`${OUTCOME_LABELS[summary.outcome]}  ${summary.check}  ${summary.subject}`);
  for (const r of summary.reasons) lines.push(`  ${r}`);
  for (const g of runGaps) lines.push(`  not examined: ${g.item} (${g.reason})`);
  const perChange = summary.notExamined.length - runGaps.length;
  if (perChange > 0) lines.push(`  not examined: ${perChange} item${perChange === 1 ? '' : 's'} listed with the changes above`);
  if (summary.notExamined.length === 0) lines.push('  not examined: none listed');
  return lines.join('\n');
}
