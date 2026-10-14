import { spawn } from 'node:child_process';

export interface GitResult {
  code: number;
  stdout: Buffer;
  stderr: string;
}

export class GitError extends Error {
  override name = 'GitError';
  constructor(
    readonly args: readonly string[],
    readonly result: GitResult,
  ) {
    super(`git ${args.join(' ')} exited ${result.code}: ${result.stderr.trim()}`);
  }
}

export interface GitOptions {
  cwd: string;
  input?: string;
  env?: Record<string, string>;
}

/** Runs git without a shell. Never prompts: a missing credential fails instead of hanging. */
export function runGit(args: readonly string[], opts: GitOptions): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: opts.cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', ...opts.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (b: Buffer) => out.push(b));
    child.stderr.on('data', (b: Buffer) => err.push(b));
    child.on('error', reject);
    child.on('close', (code) =>
      resolve({ code: code ?? 1, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString('utf8') }),
    );
    child.stdin.on('error', () => undefined);
    child.stdin.end(opts.input ?? '');
  });
}

/** Runs git and returns trimmed stdout, throwing GitError on a non-zero exit. */
export async function git(args: readonly string[], opts: GitOptions): Promise<string> {
  const result = await runGit(args, opts);
  if (result.code !== 0) throw new GitError(args, result);
  return result.stdout.toString('utf8').trim();
}
