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

/**
 * git's tracing, switched off: its lines would mix with the errors seamkit reports, and they show a
 * remote's URL as configured, credentials included.
 */
const NO_TRACE: Record<string, string> = Object.fromEntries(
  ['GIT_TRACE', 'GIT_TRACE_SETUP', 'GIT_TRACE_PERFORMANCE', 'GIT_TRACE_PACKET', 'GIT_TRACE_PACKFILE', 'GIT_TRACE_CURL', 'GIT_CURL_VERBOSE', 'GIT_TRACE2', 'GIT_TRACE2_EVENT', 'GIT_TRACE2_PERF'].map((k) => [k, '0']),
);

/** A URL's user name and password, removed from text git wrote. */
const USERINFO = /([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi;

/**
 * Runs git without a shell. Never prompts: a missing credential fails instead of hanging. Its
 * error text never holds a URL's credentials, since it may reach a report anyone can read.
 */
export function runGit(args: readonly string[], opts: GitOptions): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: opts.cwd,
      env: { ...process.env, ...NO_TRACE, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', ...opts.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (b: Buffer) => out.push(b));
    child.stderr.on('data', (b: Buffer) => err.push(b));
    child.on('error', reject);
    child.on('close', (code) =>
      resolve({ code: code ?? 1, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString('utf8').replace(USERINFO, '$1') }),
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
