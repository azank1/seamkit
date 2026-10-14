/**
 * What a commit on the default branch says about the change it brought in. GitHub's first line for
 * a merged pull request depends on the repository's merge settings: "Merge pull request #12 from
 * owner/branch", with the pull request title on the third line, or "Title (#12)", for merge
 * commits and squash merges alike. Only the setting "Pull request title and description" also
 * writes the description, from the third line on, and so carries a scope card into the history.
 * Anything else is a change that reached the branch without a pull request, which readback still
 * has to prove.
 */
export interface ChangeMessage {
  kind: 'pull_request' | 'merge' | 'commit';
  pr?: number;
  title: string;
}

const MERGE_PR = /^Merge pull request #(\d+) from (\S+)/;
const TITLED_PR = /^(.*\S)\s+\(#(\d+)\)$/;

export function parseChangeMessage(message: string, parentCount: number): ChangeMessage {
  const lines = message.replace(/\r\n?/g, '\n').split('\n');
  const subject = (lines[0] ?? '').trim();
  const firstBodyLine = lines
    .slice(1)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  const merge = parentCount >= 2;
  if (merge) {
    const m = MERGE_PR.exec(subject);
    if (m) return { kind: 'pull_request', pr: Number(m[1]), title: firstBodyLine ?? (m[2] as string) };
  }
  const titled = TITLED_PR.exec(subject);
  if (titled) return { kind: 'pull_request', pr: Number(titled[2]), title: titled[1] as string };
  return { kind: merge ? 'merge' : 'commit', title: subject || '(no message)' };
}
