/**
 * What a commit on the default branch says about the change it brought in. GitHub writes
 * "Merge pull request #12 from owner/branch" with the pull request title on the next paragraph for
 * a merge, and "Title (#12)" for a squash merge. Anything else is a change that reached the branch
 * without a pull request, which readback still has to prove.
 */
export interface ChangeMessage {
  kind: 'pull_request' | 'merge' | 'commit';
  pr?: number;
  title: string;
}

const MERGE_PR = /^Merge pull request #(\d+) from (\S+)/;
const SQUASH_PR = /^(.*\S)\s+\(#(\d+)\)$/;

export function parseChangeMessage(message: string, parentCount: number): ChangeMessage {
  const lines = message.replace(/\r\n?/g, '\n').split('\n');
  const subject = (lines[0] ?? '').trim();
  const firstBodyLine = lines
    .slice(1)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (parentCount >= 2) {
    const m = MERGE_PR.exec(subject);
    if (m) return { kind: 'pull_request', pr: Number(m[1]), title: firstBodyLine ?? (m[2] as string) };
    return { kind: 'merge', title: subject || '(no message)' };
  }
  const squash = SQUASH_PR.exec(subject);
  if (squash) return { kind: 'pull_request', pr: Number(squash[2]), title: squash[1] as string };
  return { kind: 'commit', title: subject || '(no message)' };
}
