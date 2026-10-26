import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { canonicalJson, COMMIT_PATTERN, VERSION_DOC_SCHEMA, versionDocText, type VersionDoc } from '@seamkit/core';
import { runGit, type GitResult } from '@seamkit/state';

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

/** Whether there is a git to run at all. */
async function gitInstalled(cwd: string): Promise<boolean> {
  try {
    await runGit(['--version'], { cwd });
    return true;
  } catch {
    return false;
  }
}

async function gitText(args: string[], cwd: string, unset: readonly string[] = []): Promise<string | undefined> {
  const r = await runGit(args, { cwd, unset });
  return r.code === 0 ? r.stdout.toString('utf8').trim() : undefined;
}

/** A path with every symbolic link in the part of it that exists resolved, so two spellings of one file compare equal. */
function physical(path: string): string {
  let dir = path;
  const rest: string[] = [];
  while (!existsSync(dir) && dirname(dir) !== dir) {
    rest.unshift(basename(dir));
    dir = dirname(dir);
  }
  return join(realpathSync(dir), ...rest);
}

/** An index entry as `git ls-files -v -s -z` lists it, its path kept as bytes, since a name need not be UTF-8. */
interface IndexEntry {
  tag: string;
  mode: string;
  blob: string;
  /** The entry as `git update-index --index-info -z` reads it: mode, blob, stage, a tab and the path. */
  info: Buffer;
  pathBytes: Buffer;
  path: string;
}

async function indexEntries(top: string, unset: readonly string[]): Promise<IndexEntry[]> {
  const r = await runGit(['--no-optional-locks', 'ls-files', '-v', '-s', '-z'], { cwd: top, unset });
  if (r.code !== 0) throw new StampError(`git ls-files failed: ${r.stderr.trim()}`);
  const entries: IndexEntry[] = [];
  for (let at = 0; at < r.stdout.length; ) {
    const end = r.stdout.indexOf(0, at);
    const record = r.stdout.subarray(at, end < 0 ? r.stdout.length : end);
    at = end < 0 ? r.stdout.length : end + 1;
    const tab = record.indexOf(9);
    if (tab < 0) continue;
    const [tag = '', mode = '', blob = ''] = record.subarray(0, tab).toString('latin1').split(' ');
    const pathBytes = record.subarray(tab + 1);
    entries.push({ tag, mode, blob, info: record.subarray(2), pathBytes, path: pathBytes.toString('utf8') });
  }
  return entries;
}

/** Whether a path exists in the work tree, a dangling symbolic link included. */
function present(top: string, path: Buffer): boolean {
  return lstatSync(Buffer.concat([Buffer.from(`${top}/`), path]), { throwIfNoEntry: false }) !== undefined;
}

/**
 * git status that sees files marked skip-worktree or assume-unchanged, which status otherwise never
 * looks at: it runs on a copy of the index, outside the repository, in which those entries are
 * written again without the mark and without the file data git compares first, so git reads each
 * of them. Nothing is copied when no file is marked. In a sparse checkout, a file marked
 * skip-worktree and absent from the work tree is left out of the checkout on purpose, so it keeps
 * its mark.
 */
async function statusSeeingMarked(top: string, entries: readonly IndexEntry[], unset: readonly string[], args: readonly string[]): Promise<GitResult> {
  const sparse = (await gitText(['config', '--bool', 'core.sparseCheckout'], top, unset)) === 'true';
  const marked = entries.filter((e) => (e.tag === 'S' || /^[a-z]$/.test(e.tag)) && !(sparse && e.tag.toUpperCase() === 'S' && !present(top, e.pathBytes)));
  if (marked.length === 0) return runGit(args, { cwd: top, unset });
  const where = await gitText(['rev-parse', '--git-path', 'index'], top, unset);
  if (where === undefined) throw new StampError('git cannot say where the index is');
  let dir: string;
  try {
    dir = await mkdtemp(join(tmpdir(), 'seamkit-stamp-'));
  } catch (err) {
    throw new StampError(`stamp needs a temporary directory to check the files marked skip-worktree or assume-unchanged, and ${tmpdir()} is not usable (${(err as NodeJS.ErrnoException).code ?? 'error'}): set TMPDIR to a writable directory`);
  }
  try {
    const index = join(dir, 'index');
    await copyFile(resolve(top, where), index);
    const env = { GIT_INDEX_FILE: index };
    const rewrite = await runGit(['update-index', '-z', '--index-info'], { cwd: top, env, unset, input: Buffer.concat(marked.flatMap((e) => [e.info, Buffer.from([0])])) });
    if (rewrite.code !== 0) throw new StampError(`git update-index failed: ${rewrite.stderr.trim()}`);
    return await runGit(args, { cwd: top, env, unset });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * The variables that tie git to one repository, which git removes when it enters a submodule, so
 * that a value a hook or a build sets for the superproject does not reach it.
 */
const LOCAL_REPO_ENV = ['GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_CONFIG', 'GIT_DIR', 'GIT_GRAFT_FILE', 'GIT_IMPLICIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_NAMESPACE', 'GIT_NO_REPLACE_OBJECTS', 'GIT_OBJECT_DIRECTORY', 'GIT_PREFIX', 'GIT_REPLACE_REF_BASE', 'GIT_SHALLOW_FILE', 'GIT_WORK_TREE'];

/**
 * Paths with uncommitted changes, from `git status -z`, the stamp's own output excluded. A file
 * marked skip-worktree or assume-unchanged counts as git would count it unmarked, and so does a
 * submodule, whatever its ignore setting, where a change inside it is named by its own path. git
 * is asked not to refresh the repository's index, so stamp writes nothing to the repository.
 */
async function uncommitted(top: string, outPath: string | undefined, unset: readonly string[] = []): Promise<string[]> {
  const entries = await indexEntries(top, unset);
  const r = await statusSeeingMarked(top, entries, unset, ['--no-optional-locks', 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none']);
  if (r.code !== 0) throw new StampError(`git status failed: ${r.stderr.trim()}`);
  const tokens = r.stdout.toString('utf8').split('\0');
  const listed = new Map<string, string>();
  for (let i = 0; i < tokens.length; i++) {
    const entry = tokens[i] as string;
    if (entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    listed.set(entry.slice(3), xy);
    // The original path of a rename or copy follows. A renamed file is gone from where HEAD has it;
    // a copied one is still there.
    if (xy.includes('R')) listed.set(tokens[i + 1] ?? '', xy);
    if (xy.includes('R') || xy.includes('C')) i++;
  }
  const paths = [...listed.keys()];
  // A checked-out submodule on the commit the index records is judged by what is inside it, so a
  // marked file there counts, and stamp's own output there does not.
  for (const link of entries.filter((e) => e.mode === '160000' && present(top, Buffer.concat([e.pathBytes, Buffer.from('/.git')])))) {
    // A path git holds in bytes that are not UTF-8 cannot be entered, so that submodule counts as changed.
    if (!Buffer.from(link.path, 'utf8').equals(link.pathBytes)) {
      paths.push(link.path);
      continue;
    }
    const inner = resolve(top, link.path);
    const head = await gitText(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], inner, LOCAL_REPO_ENV);
    if (head !== link.blob || (listed.get(link.path) ?? ' ')[0] !== ' ') continue;
    const changes = await uncommitted(inner, outPath, LOCAL_REPO_ENV);
    const at = paths.indexOf(link.path);
    if (at >= 0) paths.splice(at, 1);
    paths.push(...changes.map((p) => `${link.path}/${p}`));
  }
  const own = outPath === undefined ? undefined : relative(realpathSync(top), physical(outPath)).split('\\').join('/');
  return [...new Set(paths)].filter((p) => p !== own);
}

/** Whether this is Vercel's build of HEAD, whose checkout Vercel has written into before the build. */
function onVercel(env: Record<string, string | undefined>, head: string): boolean {
  return env['VERCEL'] === '1' && env['VERCEL_GIT_COMMIT_SHA']?.trim().toLowerCase() === head;
}

/**
 * Whether an uncommitted path is the vercel.json that Vercel's build writes into the checkout: the
 * committed settings reformatted, or {} when none is committed. Only a file that holds exactly the
 * settings the commit holds is left out; any other content is a change like any other.
 */
async function writtenByVercel(top: string, path: string): Promise<boolean> {
  if (path.split('/').pop() !== 'vercel.json') return false;
  try {
    const written = canonicalJson(JSON.parse(await readFile(resolve(top, path), 'utf8')));
    const committed = await runGit(['cat-file', 'blob', `HEAD:${path}`], { cwd: top });
    return written === canonicalJson(committed.code === 0 ? JSON.parse(committed.stdout.toString('utf8')) : {});
  } catch {
    return false;
  }
}

/** Whether a .git, or GIT_DIR, says this directory is in a checkout git could have read. */
function inCheckout(cwd: string, env: Record<string, string | undefined>): boolean {
  if (env['GIT_DIR'] !== undefined) return true;
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    if (existsSync(resolve(dir, '.git'))) return true;
    if (dirname(dir) === dir) return false;
  }
}

/**
 * The top of the repository stamp runs in, undefined outside one, or why git cannot read it. Only
 * git's own "not a git repository" means there is none: a repository it refuses, such as one owned
 * by another user or written by a newer git, still has a tree whose cleanliness counts.
 */
async function repositoryTop(cwd: string): Promise<{ top?: string; refused?: string }> {
  if (!existsSync(cwd)) throw new StampError(`${cwd} is not a directory`);
  let r;
  try {
    r = await runGit(['rev-parse', '--show-toplevel'], { cwd });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
  if (r.code === 0) return { top: r.stdout.toString('utf8').trim() };
  if (/^fatal: not a git repository/m.test(r.stderr)) return {};
  const reason = r.stderr.trim().split('\n')[0] ?? `git exited ${r.code}`;
  return { refused: /dubious ownership/.test(reason) ? `${reason} (git config --global --add safe.directory <dir> trusts it)` : reason };
}

/** The tree's uncommitted changes against HEAD, and the files left out because the host's build wrote them. */
async function treeChanges(top: string, head: string, outPath: string | undefined, env: Record<string, string | undefined>): Promise<{ changed: string[]; hostWritten: string[] }> {
  const vercel = onVercel(env, head);
  const changed: string[] = [];
  const hostWritten: string[] = [];
  for (const path of await uncommitted(top, outPath)) {
    if (vercel && (await writtenByVercel(top, path))) hostWritten.push(path);
    else changed.push(path);
  }
  return { changed, hostWritten };
}

/**
 * Builds the version document for the build about to happen. Git is preferred, because only git
 * can tell a clean tree from one with uncommitted changes; CI variables are the fallback for build
 * systems that copy the source without its history. `hostWritten` lists the files left out of the
 * uncommitted changes because the host's build wrote them. With requireClean, a stamp that cannot
 * say whether the tree is clean is refused, since only one that says so can be refused when dirty.
 */
export async function makeStamp(cwd: string, req: StampRequest, env: Record<string, string | undefined>, builtAt: string): Promise<{ doc: VersionDoc; uncommitted: string[]; hostWritten: string[] }> {
  const outPath = req.out === undefined ? undefined : resolve(cwd, req.out);
  const { top, refused } = await repositoryTop(cwd);
  const unclear = (reason: string): StampError => new StampError(`--require-clean cannot tell whether the tree is clean: ${reason}`);
  if (req.commit !== undefined) {
    // Inside a repository the commit must exist there; outside one, only a full id is accepted.
    let full: string | undefined;
    if (req.commit.startsWith('-')) full = undefined;
    else if (top !== undefined) full = await gitText(['rev-parse', '--verify', '--quiet', `${req.commit}^{commit}`], top);
    else if (COMMIT_PATTERN.test(req.commit.toLowerCase())) full = req.commit.toLowerCase();
    if (full === undefined) throw new StampError(`--commit ${req.commit} does not name a commit${top === undefined ? '; outside a repository give the full commit id' : ''}`);
    const doc: VersionDoc = { schema: VERSION_DOC_SCHEMA, commit: full, source: 'argument', builtAt };
    if (!req.requireClean) return { doc, uncommitted: [], hostWritten: [] };
    if (refused !== undefined) throw unclear(`git cannot read this repository: ${refused}`);
    if (top === undefined) throw unclear('--commit was given outside a repository git can read');
    if (full !== (await gitText(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], top))) throw unclear(`--commit ${req.commit} is not the commit checked out, so the tree is not that commit's`);
    const { changed, hostWritten } = await treeChanges(top, full, outPath, env);
    return { doc: { ...doc, dirty: changed.length > 0 }, uncommitted: changed, hostWritten };
  }
  if (refused !== undefined) throw new StampError(`git cannot read this repository, so stamp cannot tell whether the tree is clean: ${refused}`);
  if (top === undefined && inCheckout(cwd, env) && !(await gitInstalled(cwd))) {
    throw new StampError('git is not installed, so this checkout cannot be checked for uncommitted changes: install git, or pass --commit with the full commit id');
  }
  if (top !== undefined) {
    const head = await gitText(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], top);
    if (head !== undefined) {
      const { changed, hostWritten } = await treeChanges(top, head, outPath, env);
      const doc: VersionDoc = { schema: VERSION_DOC_SCHEMA, commit: head, dirty: changed.length > 0, source: 'git', builtAt };
      // Vercel's checkout is on a branch named master, whatever branch it builds; that one is in VERCEL_GIT_COMMIT_REF.
      const ref = (onVercel(env, head) ? env['VERCEL_GIT_COMMIT_REF']?.trim() : undefined) || (await gitText(['symbolic-ref', '--short', '-q', 'HEAD'], top));
      if (ref) doc.ref = ref;
      return { doc, uncommitted: changed, hostWritten };
    }
  }
  if (req.requireClean) throw unclear(top === undefined ? 'this is not a repository git can read, so there is no tree to check' : 'the repository has no commit checked out');
  for (const name of STAMP_ENV_VARS) {
    const value = env[name]?.trim().toLowerCase();
    if (value !== undefined && COMMIT_PATTERN.test(value)) {
      return { doc: { schema: VERSION_DOC_SCHEMA, commit: value, source: `env:${name}`, builtAt }, uncommitted: [], hostWritten: [] };
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
