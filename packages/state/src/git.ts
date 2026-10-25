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
 * The environment git runs with, its tracing off: trace lines would mix with the errors seamkit
 * reports, and they show a remote's URL and request headers as sent, credentials included. git
 * traces curl whenever GIT_CURL_VERBOSE is set, whatever its value, so the variables are removed
 * rather than set to 0. trace2 also takes its targets from git config, where the environment wins,
 * so its three are set to 0, which it reads as off.
 */
function quietEnv(extra: Record<string, string> | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_TRACE') || key === 'GIT_CURL_VERBOSE') delete env[key];
  }
  return { ...env, GIT_TRACE2: '0', GIT_TRACE2_PERF: '0', GIT_TRACE2_EVENT: '0', GIT_TRACE_REDACT: '1', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', ...extra };
}

/**
 * A URL's user name and password, removed from text git wrote: everything up to the last @ on the
 * line, since a password can hold an @, a slash, a quote or a space that is not encoded. A newline
 * in either puts the @ on a later line, so with none on the URL's own line the match runs on to
 * the next @. A // with a mistyped scheme or none, which git reads as a local path, starts a match
 * too. Removing too much only hides text.
 */
const USERINFO = /((?:[a-z][a-z0-9+.-]*:?)?\/\/)(?:[^\r\n]*@|[^@]*@)/gi;

/**
 * git quotes a remote it reads as a local path whole, so quoted text loses everything up to its
 * last @, line breaks included, as a path with no // at all, such as token@host/o/r, gives no
 * other sign. A trace prints that path unquoted, but seamkit's own runs trace nothing.
 */
const QUOTED = /'[^']*@/g;

/**
 * git and curl split a URL's authority at its first @, ended by its first / ? or #, and seamkit
 * removes everything up to the last @, so the host curl names can be part of a password. A URL
 * missing its scheme reads as host:path, so the host ssh names can be its user name or token.
 * Those names are hidden; for curl, the URL git prints beside them still shows the host meant.
 */
const NAMED_HOST = /(Could not resolve (?:host|proxy|hostname):? |Failed to connect to (?:proxy )?|connect to host |target host name '|in connection to )[^\s':]+/gi;

/** What git says when a URL holds a line break. It refuses such a URL, and prints it whole. */
const SPLIT_URL = /url contains a newline in its [a-z ]+ component/i;

/**
 * Text git wrote, with no URL's credentials left in it. git refuses a URL holding a line break, so
 * its words about one are replaced by the reason. Elsewhere the removal repeats until no URL is
 * followed by an @, since a user name or password can hold both an @ and a line break. Quoted text
 * then loses what is left up to its last @, which only takes text away, so no URL can match again.
 */
export function scrubGitText(text: string): string {
  if (SPLIT_URL.test(text)) return "fatal: the remote's URL holds a line break, which git refuses (check the secret it is built from)\n";
  let scrubbed = text;
  let before: string;
  do {
    before = scrubbed;
    scrubbed = scrubbed.replace(USERINFO, '$1');
  } while (scrubbed !== before);
  return scrubbed.replace(QUOTED, "'").replace(NAMED_HOST, '$1(host not shown)');
}

/**
 * Runs git without a shell. Never prompts: a missing credential fails instead of hanging. Its
 * error text never holds a URL's credentials, since it may reach a report anyone can read.
 */
export function runGit(args: readonly string[], opts: GitOptions): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: opts.cwd,
      env: quietEnv(opts.env),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (b: Buffer) => out.push(b));
    child.stderr.on('data', (b: Buffer) => err.push(b));
    child.on('error', reject);
    child.on('close', (code) =>
      resolve({ code: code ?? 1, stdout: Buffer.concat(out), stderr: scrubGitText(Buffer.concat(err).toString('utf8')) }),
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
