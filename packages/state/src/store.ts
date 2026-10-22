import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eventFileContent, eventId, eventPath, type SeamEvent } from '@seamkit/core';
import { git, GitError, runGit } from './git.js';

export const STATE_BRANCH = 'seamkit/state';
export const STATE_REF = `refs/heads/${STATE_BRANCH}`;

/**
 * State commits are written by the tool, not by a person, so they carry a fixed identity. That keeps
 * them out of anyone's contribution history and commit budget, and says plainly who wrote them.
 * Who caused an event is recorded inside the event, as provenance.
 */
const STATE_IDENTITY = {
  GIT_AUTHOR_NAME: 'seamkit',
  GIT_AUTHOR_EMAIL: 'seamkit@localhost',
  GIT_COMMITTER_NAME: 'seamkit',
  GIT_COMMITTER_EMAIL: 'seamkit@localhost',
};

const README = `# seamkit state

This branch is written by seamkit and holds its ledger: one file per event under \`events/\`, named by
the event's time and the SHA-256 of its content. Files are only ever added. Nothing here is edited
by hand, and the branch is never merged into any other branch.

Check every file against its name with \`seamkit state verify\`.
`;

export interface StoredFile {
  path: string;
  oid: string;
  content: string;
}

export interface AppendResult {
  id: string;
  path: string;
  commit: string;
  /** False when the identical event was already present, which makes appends safe to retry. */
  created: boolean;
}

export type SyncStatus = 'up_to_date' | 'pushed' | 'pulled' | 'merged' | 'empty' | 'no_remote';

export interface SyncResult {
  status: SyncStatus;
  remote: string;
  local?: string;
  attempts: number;
}

export class NotAGitRepository extends Error {
  override name = 'NotAGitRepository';
}

const MAX_APPEND_ATTEMPTS = 25;
/**
 * A push that loses a race to another writer is tried again, for about a minute at most. One that
 * fails while the remote stands still, for want of permission or of a network, is no race and is
 * given up sooner.
 */
const MAX_SYNC_ATTEMPTS = 12;
const MAX_STALLED_PUSHES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The append-only event store on the `seamkit/state` branch. It writes with git plumbing (blobs,
 * a private index, commit-tree and a compare-and-swap ref update), so it never touches the working
 * tree, the index or HEAD, and concurrent writers on one machine retry rather than overwrite.
 */
export class GitStateStore {
  private constructor(readonly cwd: string) {}

  static async open(cwd: string): Promise<GitStateStore> {
    const inside = await runGit(['rev-parse', '--git-dir'], { cwd });
    if (inside.code !== 0) throw new NotAGitRepository(`not a git repository: ${cwd}`);
    return new GitStateStore(cwd);
  }

  private git(args: readonly string[], input?: string, env?: Record<string, string>): Promise<string> {
    const opts: { cwd: string; input?: string; env?: Record<string, string> } = { cwd: this.cwd };
    if (input !== undefined) opts.input = input;
    if (env !== undefined) opts.env = env;
    return git(args, opts);
  }

  /** The commit the state branch points to, or undefined when it does not exist yet. */
  async head(): Promise<string | undefined> {
    const r = await runGit(['rev-parse', '--verify', '--quiet', `${STATE_REF}^{commit}`], { cwd: this.cwd });
    return r.code === 0 ? r.stdout.toString('utf8').trim() : undefined;
  }

  async exists(): Promise<boolean> {
    return (await this.head()) !== undefined;
  }

  /** Creates the branch with only its README. Does nothing when it already exists. */
  async init(): Promise<{ created: boolean; commit: string }> {
    for (let attempt = 0; attempt < MAX_APPEND_ATTEMPTS; attempt++) {
      const existing = await this.head();
      if (existing !== undefined) return { created: false, commit: existing };
      const blob = await this.git(['hash-object', '-w', '--stdin'], README);
      const tree = await this.treeWith(undefined, [{ path: 'README.md', oid: blob }]);
      const commit = await this.commitTree(tree, [], 'seamkit: create state branch');
      if (await this.casRef(commit, undefined)) return { created: true, commit };
    }
    throw new Error('could not create the state branch');
  }

  /** Adds one event file. Retries when another writer moved the branch first. */
  async append(event: SeamEvent): Promise<AppendResult> {
    const id = eventId(event);
    const path = eventPath(event.at, id);
    const blob = await this.git(['hash-object', '-w', '--stdin'], eventFileContent(event));
    for (let attempt = 0; attempt < MAX_APPEND_ATTEMPTS; attempt++) {
      const parent = await this.head();
      if (parent !== undefined) {
        const existing = await this.git(['ls-tree', parent, '--', path]);
        if (existing.length > 0) return { id, path, commit: parent, created: false };
      }
      const files = parent === undefined ? [{ path: 'README.md', oid: await this.git(['hash-object', '-w', '--stdin'], README) }] : [];
      files.push({ path, oid: blob });
      const tree = await this.treeWith(parent, files);
      const commit = await this.commitTree(tree, parent === undefined ? [] : [parent], `seamkit: ${event.kind} ${id.slice(0, 12)}`);
      if (await this.casRef(commit, parent)) return { id, path, commit, created: true };
      await sleep(Math.floor(Math.random() * 20) + attempt * 5);
    }
    throw new Error(`could not append event ${id.slice(0, 12)} after ${MAX_APPEND_ATTEMPTS} attempts`);
  }

  /** Every event file on the branch, in path order (which is time order). */
  async list(): Promise<StoredFile[]> {
    const head = await this.head();
    if (head === undefined) return [];
    return this.filesAt(head, 'events');
  }

  /**
   * Merges the local branch with the remote's and pushes the result, never forcing. Because every
   * event file is named by its content, two writers can only ever add different paths, so the
   * merge is a union of files and cannot conflict.
   */
  async sync(remote = 'origin'): Promise<SyncResult> {
    const hasRemote = await runGit(['remote', 'get-url', remote], { cwd: this.cwd });
    if (hasRemote.code !== 0) return { status: 'no_remote', remote, attempts: 0 };
    let stalled = 0;
    for (let attempt = 1; attempt <= MAX_SYNC_ATTEMPTS; attempt++) {
      const remoteHead = await this.remoteHead(remote);
      if (remoteHead !== undefined) {
        await this.git(['fetch', '--quiet', '--no-tags', remote, `+${STATE_REF}:refs/remotes/${remote}/${STATE_BRANCH}`]);
      }
      const local = await this.head();
      if (local === undefined && remoteHead === undefined) return { status: 'empty', remote, attempts: attempt };
      if (local === undefined) {
        if (await this.casRef(remoteHead as string, undefined)) return { status: 'pulled', remote, local: remoteHead as string, attempts: attempt };
        continue;
      }
      if (remoteHead === local) return { status: 'up_to_date', remote, local, attempts: attempt };
      if (remoteHead !== undefined && (await this.isAncestor(local, remoteHead))) {
        if (await this.casRef(remoteHead, local)) return { status: 'pulled', remote, local: remoteHead, attempts: attempt };
        continue;
      }
      let toPush = local;
      let status: SyncStatus = 'pushed';
      if (remoteHead !== undefined && !(await this.isAncestor(remoteHead, local))) {
        const merged = await this.mergeCommit(remoteHead, local);
        if (!(await this.casRef(merged, local))) continue;
        toPush = merged;
        status = 'merged';
      }
      const pushed = await runGit(['push', '--quiet', remote, `${toPush}:${STATE_REF}`], { cwd: this.cwd });
      if (pushed.code === 0) return { status, remote, local: toPush, attempts: attempt };
      if ((await this.remoteHead(remote)) === remoteHead) stalled++;
      if (stalled === MAX_STALLED_PUSHES) {
        throw new Error(`${remote} refused the push to ${STATE_BRANCH} while no other writer was pushing: ${pushed.stderr.trim()}`);
      }
      if (attempt === MAX_SYNC_ATTEMPTS) throw new GitError(['push', remote, STATE_REF], pushed);
      // Writers that collided each wait a random time, up to twice as long after each collision, so
      // that runs which started together stop moving in step.
      await sleep(Math.floor(Math.random() * Math.min(8000, 500 * 2 ** attempt)));
    }
    throw new Error(`could not synchronise ${STATE_BRANCH} with ${remote} after ${MAX_SYNC_ATTEMPTS} attempts`);
  }

  /** The state branch's commit on the remote, or undefined when the remote has none. */
  private async remoteHead(remote: string): Promise<string | undefined> {
    // ls-remote matches patterns against the tail of ref names, so keep only the exact ref.
    const advertised = await this.git(['ls-remote', remote, STATE_REF]);
    return advertised
      .split('\n')
      .map((line) => line.split('\t'))
      .find(([, ref]) => ref === STATE_REF)?.[0];
  }

  private async isAncestor(ancestor: string, descendant: string): Promise<boolean> {
    const r = await runGit(['merge-base', '--is-ancestor', ancestor, descendant], { cwd: this.cwd });
    if (r.code === 0) return true;
    if (r.code === 1) return false;
    throw new GitError(['merge-base', '--is-ancestor', ancestor, descendant], r);
  }

  private async mergeCommit(remoteHead: string, local: string): Promise<string> {
    const theirs = new Map((await this.entries(remoteHead)).map((e) => [e.path, e.oid]));
    const added: { path: string; oid: string }[] = [];
    for (const e of await this.entries(local)) {
      const other = theirs.get(e.path);
      if (other === undefined) added.push(e);
      else if (other !== e.oid && e.path.startsWith('events/')) {
        throw new Error(`state branches disagree about ${JSON.stringify(e.path)}; one copy has been altered, run seamkit state verify`);
      }
    }
    const tree = await this.treeWith(remoteHead, added);
    return this.commitTree(tree, [remoteHead, local], 'seamkit: merge state');
  }

  private async entries(commit: string): Promise<{ path: string; oid: string }[]> {
    const out = await runGit(['ls-tree', '-r', '-z', '--full-tree', commit], { cwd: this.cwd });
    if (out.code !== 0) throw new GitError(['ls-tree', commit], out);
    return out.stdout
      .toString('utf8')
      .split('\0')
      .filter((line) => line.length > 0)
      .map((line) => {
        const tab = line.indexOf('\t');
        const [, , oid] = line.slice(0, tab).split(' ');
        return { path: line.slice(tab + 1), oid: oid as string };
      });
  }

  private async filesAt(commit: string, prefix: string): Promise<StoredFile[]> {
    const entries = (await this.entries(commit)).filter((e) => e.path.startsWith(`${prefix}/`));
    if (entries.length === 0) return [];
    const batch = await runGit(['cat-file', '--batch'], { cwd: this.cwd, input: entries.map((e) => e.oid).join('\n') + '\n' });
    if (batch.code !== 0) throw new GitError(['cat-file', '--batch'], batch);
    const buf = batch.stdout;
    const files: StoredFile[] = [];
    let offset = 0;
    for (const entry of entries) {
      const headerEnd = buf.indexOf(0x0a, offset);
      const header = buf.subarray(offset, headerEnd).toString('utf8');
      const size = Number(header.split(' ')[2]);
      if (!Number.isInteger(size)) throw new Error(`unexpected cat-file header: ${header}`);
      const start = headerEnd + 1;
      files.push({ path: entry.path, oid: entry.oid, content: buf.subarray(start, start + size).toString('utf8') });
      offset = start + size + 1;
    }
    return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  /** Writes a tree equal to `parent`'s tree plus `files`, using a private index file. */
  private async treeWith(parent: string | undefined, files: readonly { path: string; oid: string }[]): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'seamkit-index-'));
    const env = { GIT_INDEX_FILE: join(dir, 'index') };
    try {
      await this.git(parent === undefined ? ['read-tree', '--empty'] : ['read-tree', parent], undefined, env);
      if (files.length > 0) {
        const info = files.map((f) => `100644 ${f.oid}\t${f.path}`).join('\n') + '\n';
        await this.git(['update-index', '--add', '--index-info'], info, env);
      }
      return await this.git(['write-tree'], undefined, env);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private commitTree(tree: string, parents: readonly string[], message: string): Promise<string> {
    const args = ['commit-tree', '--no-gpg-sign', tree, ...parents.flatMap((p) => ['-p', p]), '-m', message];
    return this.git(args, undefined, STATE_IDENTITY);
  }

  /** Moves the branch from `expected` (undefined: must not exist) to `next`, or reports that it lost a race. */
  private async casRef(next: string, expected: string | undefined): Promise<boolean> {
    const r = await runGit(['update-ref', STATE_REF, next, expected ?? ''], { cwd: this.cwd });
    return r.code === 0;
  }
}
