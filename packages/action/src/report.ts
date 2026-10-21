import { OUTCOME_LABELS, renderReadback, type Outcome, type ReadbackState, type Verdict } from '@seamkit/core';

/** A GitHub check run conclusion. */
export type Conclusion = 'success' | 'failure' | 'action_required';

/**
 * Only a pass is a success. Examined nothing fails the check, because GitHub counts a neutral check
 * as passing for required checks, and a check that looked at nothing must never read as a pass.
 * Unclassified asks for a human, which is what action_required means.
 */
export const CONCLUSIONS: Readonly<Record<Outcome, Conclusion>> = {
  pass: 'success',
  fail: 'failure',
  examined_nothing: 'failure',
  unclassified: 'action_required',
};

const STATE_LABELS: Readonly<Record<ReadbackState, string>> = {
  live: 'live',
  not_live: 'not live',
  not_proven: 'not proven',
  nothing_to_prove: 'nothing to prove',
};

/** What one readback run says, in the shape a check run and a job summary need. */
export interface Report {
  conclusion: Conclusion;
  title: string;
  summary: string;
  text: string;
}

/** GitHub refuses check run output fields over 65535 characters. */
export const OUTPUT_LIMIT = 65535;

function clip(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const note = '\n… cut to fit; the full report is in the job log';
  return text.slice(0, limit - note.length) + note;
}

/** Per-state counts, problems first, each with its denominator. */
export function stateCounts(parts: readonly Verdict[]): { state: ReadbackState; count: number }[] {
  const order: ReadbackState[] = ['not_live', 'not_proven', 'nothing_to_prove', 'live'];
  return order.map((state) => ({ state, count: parts.filter((p) => p.state === state).length })).filter((c) => c.count > 0);
}

/** Builds the check run output for a readback run: its summary verdict first, then one per change. */
export function readbackReport(outcome: Outcome, verdicts: readonly Verdict[], url: string): Report {
  const [summary, ...parts] = verdicts;
  const label = OUTCOME_LABELS[outcome];
  const counts = stateCounts(parts);
  const tally = counts.map((c) => `${c.count} ${STATE_LABELS[c.state]}`).join(', ');
  const title = parts.length === 0 ? `${label}: no changes examined` : `${label}: ${tally} of ${parts.length}`;
  const lines = [`**${label}** for ${url}`, ''];
  for (const r of summary?.reasons ?? []) lines.push(`- ${r}`);
  if (counts.length > 0) {
    lines.push('', '| State | Changes |', '|---|---|');
    for (const c of counts) lines.push(`| ${STATE_LABELS[c.state]} | ${c.count} of ${parts.length} |`);
  }
  const problems = parts.filter((p) => p.outcome !== 'pass');
  if (problems.length > 0) {
    lines.push('', '| Change | Outcome | Why |', '|---|---|---|');
    for (const p of problems.slice(0, 50)) {
      const why = (p.reasons[0] ?? p.notExamined[0]?.reason ?? '').replace(/\|/g, '\\|');
      lines.push(`| ${p.subject} | ${OUTCOME_LABELS[p.outcome]} | ${why} |`);
    }
    if (problems.length > 50) lines.push(`| … | | and ${problems.length - 50} more, in the report below |`);
  }
  return {
    conclusion: CONCLUSIONS[outcome],
    title: clip(title, 1000),
    summary: clip(lines.join('\n'), OUTPUT_LIMIT),
    text: clip(`\`\`\`text\n${renderReadback(verdicts)}\n\`\`\``, OUTPUT_LIMIT),
  };
}

/** A run that produced no verdict, because seamkit could not run (exit 2). */
export function errorReport(message: string, url: string): Report {
  const first = message.trim().split('\n')[0] ?? 'seamkit could not run';
  return {
    conclusion: 'failure',
    title: clip(`No verdict: ${first.replace(/^seamkit: /, '')}`, 1000),
    summary: clip(`**No verdict** for ${url}: seamkit could not run, so nothing was proven.\n\n\`\`\`text\n${message.trim()}\n\`\`\``, OUTPUT_LIMIT),
    text: '',
  };
}

/** The job summary: the same content as the check run, under one heading. */
export function jobSummary(name: string, report: Report): string {
  return [`### ${name}: ${report.title}`, '', report.summary, '', report.text ? `<details><summary>Full report</summary>\n\n${report.text}\n\n</details>` : '', ''].join('\n');
}
