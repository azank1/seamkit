import { mkdir, readFile } from 'node:fs/promises';
import { devNull } from 'node:os';
import { join } from 'node:path';
import { git, runGit, GitError } from '@seamkit/state';
import { INITIAL_FILES, PULL_REQUESTS, type PullRequest } from './history.js';

/** Fixed identities and the user's own git configuration kept out, so commit ids never vary. */
export const DEMO_GIT_ENV: Record<string, string> = { GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: '1' };

const START = Date.UTC(2026, 9, 1, 9, 0, 0) / 1000;
const AGENT = 'notes-agent <agent@notes.invalid>';
const MERGER = 'merge-bot <merge@notes.invalid>';

function data(text: string): string {
  return `data ${Buffer.byteLength(text, 'utf8')}\n${text}\n`;
}

/** The message GitHub writes for a merge commit when the repository uses "Pull request title and description". */
function mergeMessage(pr: PullRequest): string {
  const card = pr.card === undefined ? '' : `\n\`\`\`seamkit-card\n${pr.card}\n\`\`\`\n`;
  return `${pr.title} (#${pr.n})\n\n${pr.summary}\n${card}`;
}

/** The whole history as one git fast-import stream: an initial commit, then a branch and a merge per pull request. */
export function importStream(): string {
  const files = new Map<string, string>(Object.entries(INITIAL_FILES));
  const out: string[] = [];
  const modify = (paths: Iterable<string>): string => [...paths].map((p) => `M 100644 inline ${p}\n${data(files.get(p) as string)}`).join('');
  const who = (person: string, at: number): string => `author ${person} ${at} +0000\ncommitter ${person} ${at} +0000\n`;
  out.push(`commit refs/heads/main\nmark :1\n${who(AGENT, START)}${data('Initial commit')}${modify(files.keys())}\n`);
  let main = 1;
  for (const pr of PULL_REQUESTS) {
    for (const e of pr.edits) files.set(e.path, (files.get(e.path) ?? '') + e.add);
    const changed = pr.edits.map((e) => e.path);
    const at = START + pr.n * 3600;
    const branchMark = 2 * pr.n;
    const mergeMark = 2 * pr.n + 1;
    out.push(`commit refs/heads/agents/${pr.branch}\nmark :${branchMark}\n${who(AGENT, at)}${data(pr.title)}from :${main}\n${modify(changed)}\n`);
    out.push(`commit refs/heads/main\nmark :${mergeMark}\n${who(MERGER, at + 1200)}${data(mergeMessage(pr))}from :${main}\nmerge :${branchMark}\n${modify(changed)}\n`);
    main = mergeMark;
  }
  return out.join('');
}

/**
 * Creates the demo repository in `dir` (which must not hold one yet) and returns the merge commit
 * of every pull request, by number.
 */
export async function seedDemo(dir: string): Promise<Map<number, string>> {
  await mkdir(dir, { recursive: true });
  await git(['init', '-q', '-b', 'main', dir], { cwd: dir, env: DEMO_GIT_ENV });
  const marks = join(dir, '.git', 'seed-marks');
  const r = await runGit(['fast-import', '--quiet', `--export-marks=${marks}`], { cwd: dir, input: importStream(), env: DEMO_GIT_ENV });
  if (r.code !== 0) throw new GitError(['fast-import'], r);
  await git(['reset', '-q', '--hard', 'main'], { cwd: dir, env: DEMO_GIT_ENV });
  const byMark = new Map(
    (await readFile(marks, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => {
        const [mark, sha] = line.split(' ');
        return [Number((mark as string).slice(1)), sha as string] as const;
      }),
  );
  return new Map(PULL_REQUESTS.map((pr) => [pr.n, byMark.get(2 * pr.n + 1) as string]));
}
