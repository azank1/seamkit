import { GitError, NotAGitRepository, git, runGit } from '@seamkit/state';

/** One commit as readback needs it. */
export interface GitCommit {
  commit: string;
  parents: string[];
  message: string;
}

const HEX = /^[0-9a-f]{4,64}$/;

/**
 * Whether git accepts `name` as a branch name, exactly as written: never HEAD, an option, or an
 * @{-N} that git would expand. Anything git accepts is safe as one argument of a refspec.
 */
export async function isBranchName(cwd: string, name: string): Promise<boolean> {
  if (name === '' || name.startsWith('-')) return false;
  const r = await runGit(['check-ref-format', '--branch', name], { cwd });
  return r.code === 0 && r.stdout.toString('utf8').trim() === name;
}

/** Read-only questions to the local repository: history, ancestry and commit ids. */
export class GitRepo {
  private constructor(readonly cwd: string) {}

  static async open(cwd: string): Promise<GitRepo> {
    const r = await runGit(['rev-parse', '--show-toplevel'], { cwd });
    if (r.code !== 0) throw new NotAGitRepository(cwd);
    return new GitRepo(r.stdout.toString('utf8').trim());
  }

  private async rev(name: string): Promise<string | undefined> {
    const r = await runGit(['rev-parse', '--verify', '--quiet', `${name}^{commit}`], { cwd: this.cwd });
    return r.code === 0 ? r.stdout.toString('utf8').trim() : undefined;
  }

  /**
   * The branch changes are merged into: the one named, else the remote's default branch, else
   * main or master, else whatever is checked out. The remote-tracking branch is preferred,
   * because it is what was merged as of the last fetch.
   */
  async resolveBranch(name?: string): Promise<{ name: string; head: string }> {
    if (name !== undefined) {
      if (name.startsWith('-')) throw new Error(`there is no branch or commit called ${name}`);
      // A branch name means the remote's branch: a CI checkout often has it only as
      // origin/<name>, and its local branch of that name sits at the commit the job was given.
      // HEAD, a commit or any other revision means what git says it means.
      const remote = !name.startsWith('refs/') && (await isBranchName(this.cwd, name)) ? await this.rev(`refs/remotes/origin/${name}`) : undefined;
      if (remote !== undefined) return { name, head: remote };
      const head = await this.rev(name);
      if (head === undefined) throw new Error(`there is no branch or commit called ${name}`);
      return { name, head };
    }
    const originHead = await runGit(['symbolic-ref', '-q', 'refs/remotes/origin/HEAD'], { cwd: this.cwd });
    const candidates = [
      ...(originHead.code === 0 ? [originHead.stdout.toString('utf8').trim()] : []),
      'refs/remotes/origin/main',
      'refs/remotes/origin/master',
      'refs/heads/main',
      'refs/heads/master',
    ];
    for (const ref of candidates) {
      const head = await this.rev(ref);
      if (head !== undefined) return { name: ref.replace(/^refs\/(?:remotes|heads)\//, ''), head };
    }
    const head = await this.rev('HEAD');
    if (head === undefined) throw new Error('the repository has no commits yet');
    const branch = await runGit(['symbolic-ref', '--short', '-q', 'HEAD'], { cwd: this.cwd });
    return { name: branch.code === 0 ? branch.stdout.toString('utf8').trim() : 'HEAD', head };
  }

  /** The newest `limit` commits on the first-parent line of `head`, newest first. */
  async firstParent(head: string, limit: number): Promise<GitCommit[]> {
    if (limit <= 0) return [];
    const list = await git(['rev-list', '--first-parent', `--max-count=${limit}`, head], { cwd: this.cwd });
    return this.read(list.split('\n').filter((l) => l.length > 0));
  }

  async commit(rev: string): Promise<GitCommit | undefined> {
    const full = rev.startsWith('-') ? undefined : await this.rev(rev);
    return full === undefined ? undefined : (await this.read([full]))[0];
  }

  /** How many commits on the first-parent line of `head` are not reachable from `exclude`. */
  async countFirstParent(head: string, exclude: string): Promise<number> {
    return Number(await git(['rev-list', '--first-parent', '--count', head, `^${exclude}`], { cwd: this.cwd }));
  }

  /**
   * The full ids of many abbreviated commits in one git process, in order: undefined for one that
   * is missing, ambiguous or not a commit.
   */
  async resolveAll(abbrevs: readonly string[]): Promise<(string | undefined)[]> {
    const asked = abbrevs.filter((a) => HEX.test(a));
    if (asked.length === 0) return abbrevs.map(() => undefined);
    const r = await runGit(['cat-file', `--batch-check=%(objectname) %(objecttype)`], { cwd: this.cwd, input: asked.map((a) => `${a}^{commit}\n`).join('') });
    if (r.code !== 0) throw new GitError(['cat-file', '--batch-check'], r);
    const answers = r.stdout.toString('utf8').split('\n');
    const found = new Map<string, string>();
    asked.forEach((a, i) => {
      const [id, type] = (answers[i] ?? '').split(' ');
      if (type === 'commit' && id !== undefined && /^[0-9a-f]{40,64}$/.test(id)) found.set(a, id);
    });
    return abbrevs.map((a) => found.get(a));
  }

  /** The full id of an abbreviated commit, or undefined when it is missing or ambiguous. */
  async resolve(abbrev: string): Promise<string | undefined> {
    return HEX.test(abbrev) ? this.rev(abbrev) : undefined;
  }

  /** Whether `running` contains `change`; null, with git's reason, when git cannot tell. */
  async contains(running: string, change: string): Promise<{ contains: boolean | null; reason?: string }> {
    const r = await runGit(['merge-base', '--is-ancestor', change, running], { cwd: this.cwd });
    if (r.code === 0) return { contains: true };
    if (r.code === 1) return { contains: false };
    return { contains: null, reason: `git could not compare the commits: ${r.stderr.trim().split('\n')[0] ?? `exit ${r.code}`}` };
  }

  /** The commits reachable from any of `tips`, full ids, and not from `exclude`. */
  async reachableFrom(tips: readonly string[], exclude: string): Promise<Set<string>> {
    if (tips.length === 0) return new Set();
    const r = await runGit(['rev-list', '--stdin'], { cwd: this.cwd, input: `${[...tips, `^${exclude}`].join('\n')}\n` });
    if (r.code !== 0) throw new GitError(['rev-list', '--stdin'], r);
    return new Set(r.stdout.toString('utf8').split('\n').filter((l) => l.length > 0));
  }

  async isShallow(): Promise<boolean> {
    return (await git(['rev-parse', '--is-shallow-repository'], { cwd: this.cwd })) === 'true';
  }

  private async read(ids: readonly string[]): Promise<GitCommit[]> {
    if (ids.length === 0) return [];
    const batch = await runGit(['cat-file', '--batch'], { cwd: this.cwd, input: `${ids.join('\n')}\n` });
    if (batch.code !== 0) throw new GitError(['cat-file', '--batch'], batch);
    const buf = batch.stdout;
    const out: GitCommit[] = [];
    let offset = 0;
    for (const id of ids) {
      const headerEnd = buf.indexOf(0x0a, offset);
      const [oid, type, size] = buf.subarray(offset, headerEnd).toString('utf8').split(' ');
      if (oid !== id || type !== 'commit' || !Number.isInteger(Number(size))) throw new Error(`cannot read commit ${id}`);
      const start = headerEnd + 1;
      const raw = buf.subarray(start, start + Number(size)).toString('utf8');
      offset = start + Number(size) + 1;
      const split = raw.indexOf('\n\n');
      const headers = (split === -1 ? raw : raw.slice(0, split)).split('\n');
      out.push({
        commit: id,
        parents: headers.filter((h) => h.startsWith('parent ')).map((h) => h.slice('parent '.length)),
        message: split === -1 ? '' : raw.slice(split + 2),
      });
    }
    return out;
  }
}
