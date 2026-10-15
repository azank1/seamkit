import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { COMMIT_PATTERN, VERSION_DOC_SCHEMA, versionDocText, type VersionDoc } from '@seamkit/core';
import { runGit } from '@seamkit/state';

/** CI variables that carry the commit being built, checked in this order when git cannot say. */
export const STAMP_ENV_VARS: readonly string[] = [
  'VERCEL_GIT_COMMIT_SHA',
  'GITHUB_SHA',
  'CF_PAGES_COMMIT_SHA',
  'COMMIT_REF',
  'RENDER_GIT_COMMIT',
  'CI_COMMIT_SHA',
  'BITBUCKET_COMMIT',
  'SOURCE_VERSION',
];

export interface StampRequest {
  out?: string;
  commit?: string;
  requireClean: boolean;
}

export class StampError extends Error {
  override name = 'StampError';
}

async function gitText(args: string[], cwd: string): Promise<string | undefined> {
  const r = await runGit(args, { cwd });
  return r.code === 0 ? r.stdout.toString('utf8').trim() : undefined;
}

/** Paths with uncommitted changes, from `git status -z`, the stamp's own output excluded. */
async function uncommitted(top: string, outPath: string | undefined): Promise<string[]> {
  const r = await runGit(['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: top });
  if (r.code !== 0) throw new StampError(`git status failed: ${r.stderr.trim()}`);
  const tokens = r.stdout.toString('utf8').split('\0');
  const paths: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const entry = tokens[i] as string;
    if (entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    paths.push(entry.slice(3));
    if (xy.includes('R') || xy.includes('C')) i++; // the original path of a rename or copy follows
  }
  const own = outPath === undefined ? undefined : relative(top, outPath).split('\\').join('/');
  return paths.filter((p) => p !== own);
}

/**
 * Builds the version document for the build about to happen. Git is preferred, because only git
 * can tell a clean tree from one with uncommitted changes; CI variables are the fallback for build
 * systems that copy the source without its history.
 */
export async function makeStamp(cwd: string, req: StampRequest, env: Record<string, string | undefined>, builtAt: string): Promise<{ doc: VersionDoc; uncommitted: string[] }> {
  const outPath = req.out === undefined ? undefined : resolve(cwd, req.out);
  const top = await gitText(['rev-parse', '--show-toplevel'], cwd);
  if (req.commit !== undefined) {
    // Inside a repository the commit must exist there; outside one, only a full id is accepted.
    let full: string | undefined;
    if (req.commit.startsWith('-')) full = undefined;
    else if (top !== undefined) full = await gitText(['rev-parse', '--verify', '--quiet', `${req.commit}^{commit}`], top);
    else if (COMMIT_PATTERN.test(req.commit.toLowerCase())) full = req.commit.toLowerCase();
    if (full === undefined) throw new StampError(`--commit ${req.commit} does not name a commit${top === undefined ? '; outside a repository give the full commit id' : ''}`);
    return { doc: { schema: VERSION_DOC_SCHEMA, commit: full, source: 'argument', builtAt }, uncommitted: [] };
  }
  if (top !== undefined) {
    const head = await gitText(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], top);
    if (head !== undefined) {
      const changed = await uncommitted(top, outPath);
      const doc: VersionDoc = { schema: VERSION_DOC_SCHEMA, commit: head, dirty: changed.length > 0, source: 'git', builtAt };
      const ref = await gitText(['symbolic-ref', '--short', '-q', 'HEAD'], top);
      if (ref) doc.ref = ref;
      return { doc, uncommitted: changed };
    }
  }
  for (const name of STAMP_ENV_VARS) {
    const value = env[name]?.trim().toLowerCase();
    if (value !== undefined && COMMIT_PATTERN.test(value)) {
      return { doc: { schema: VERSION_DOC_SCHEMA, commit: value, source: `env:${name}`, builtAt }, uncommitted: [] };
    }
  }
  throw new StampError(`cannot tell which commit this build is from: run stamp inside the repository, pass --commit, or set one of ${STAMP_ENV_VARS.join(', ')}`);
}

export async function writeStamp(cwd: string, out: string, doc: VersionDoc): Promise<string> {
  const path = resolve(cwd, out);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, versionDocText(doc));
  return path;
}
