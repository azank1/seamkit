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
    super(`git ${scrubGitText(args.join(' '))} exited ${result.code}: ${result.stderr.trim()}`);
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
 * too, as do the :: of a remote given as <transport>::<address> and git's words before an
 * address it prints with no // at all, for such a remote or one on git://. Removing too much only
 * hides text.
 */
const USERINFO = /(\/\/|::|url has no scheme: |credential url cannot be parsed: |unable to (?:look up|connect to) )(?:[^\r\n]*@|[^@]*@)/gi;

/**
 * git and curl split a URL's authority at its first @, ended by its first / ? or #, and seamkit
 * removes everything up to the last @, so the host curl names can be part of a password. A URL
 * missing its scheme reads as host:path, so the host ssh names can be its user name or token.
 * Those names are hidden; for curl, the URL git prints beside them still shows the host meant.
 */
const NAMED_HOST = /(Could not resolve (?:host|proxy|hostname):? |Failed to connect to (?:proxy )?|connect to host |target host name '|in connection to |SOCKS[45] connection to |Failed to resolve ")[^\s'":]+/gi;

/** git ends a proxy's authority at its first / ? or #, so the proxy curl quotes can be a user name and part of a password. */
const QUOTED_PROXY = /(Unsupported proxy (?:syntax in |scheme for )?|Couldn't resolve proxy )'[^\r\n]*'/gi;

/**
 * git's words before a line it took from a credential helper and could not use, which it prints
 * as the helper wrote it: a token with no URL around it, or a URL with no @, is the whole line.
 */
const HELPER_LINE = /(invalid credential line: |url has no scheme: |credential url cannot be parsed: )[^\r\n]*/gi;

/** What git says when a URL holds a line break. It refuses such a URL, and prints it whole. */
const SPLIT_URL = /url contains a newline in its [a-z ]+ component/i;

/**
 * Text git wrote, with no URL's credentials left in it. git refuses a URL holding a line break, so
 * its words about one are replaced by the reason. Elsewhere the removal repeats until no URL is
 * followed by an @, since a user name or password can hold both an @ and a line break; every
 * removal ends at an @, so text after the last one is left as it is. git quotes a remote it reads
 * as a local path whole, and a path with no // at all, such as token@host/o/r, gives no other
 * sign, so the text then loses everything from its first quote to its last @, quotes and line
 * breaks included. That only takes text away, so no URL can match again.
 */
export function scrubGitText(text: string): string {
  if (SPLIT_URL.test(text)) return "fatal: the remote's URL holds a line break, which git refuses (check the secret it is built from)\n";
  const last = text.lastIndexOf('@');
  let scrubbed = text.slice(0, last + 1);
  let before: string;
  do {
    before = scrubbed;
    scrubbed = scrubbed.replace(USERINFO, '$1');
  } while (scrubbed !== before);
  scrubbed += text.slice(last + 1);
  const at = scrubbed.lastIndexOf('@');
  const quote = scrubbed.indexOf("'");
  if (quote >= 0 && quote < at) scrubbed = scrubbed.slice(0, quote + 1) + scrubbed.slice(at + 1);
  return scrubbed
    .replace(HELPER_LINE, '$1(not shown)')
    .replace(NAMED_HOST, '$1(host not shown)')
    .replace(QUOTED_PROXY, "$1'(proxy not shown)'");
}

/** The proxy variables curl reads, whose user name and password git may print in any wording. */
const PROXY_VARS = ['http_proxy', 'HTTP_PROXY', 'https_proxy', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY'];

/** Pieces shorter than this are left alone, since they would hide ordinary words. */
const SHORTEST_SECRET = 4;

/**
 * The credential in a URL or address as git would read it: everything before its last @, whole,
 * split at its first colon, and split again wherever git, curl or ssh may cut it, each also as it
 * reads percent-decoded.
 */
function credentialPieces(address: string): string[] {
  const text = address.trim().replace(/^[a-z][a-z0-9+.-]*::/i, '').replace(/^(?:[a-z][a-z0-9+.-]*:?)?\/\//i, '');
  const at = text.lastIndexOf('@');
  if (at < 0) return [];
  return splitPieces(text.slice(0, at));
}

function splitPieces(credential: string): string[] {
  const colon = credential.indexOf(':');
  const halves = colon < 0 ? [credential] : [credential.slice(0, colon), credential.slice(colon + 1)];
  const pieces = [credential, ...halves, ...credential.split(/[@/?#:\s]+/)];
  for (const piece of [...pieces]) {
    try {
      pieces.push(decodeURIComponent(piece));
    } catch {
      // not percent-encoded text
    }
  }
  return pieces;
}

/**
 * A credential helper as the shell may print it when one of its commands fails: whole, as git
 * runs it without its leading !, and the value of each name=value in it, which is how a helper
 * written into config holds a literal token. A helper named by one word, such as store, is a
 * program and holds no credential, so that word is not hidden.
 */
function helperPieces(helper: string): string[] {
  const pieces = /^!|\s/.test(helper) ? [helper, helper.replace(/^!/, '')] : [];
  for (const m of helper.matchAll(/=([^\s;'"`|&)]+)/g)) pieces.push(m[1] ?? '');
  return pieces;
}

/** The credential in an http.extraheader value: its token and, for Basic, the user name and password it encodes. */
function headerPieces(header: string): string[] {
  const words = header.slice(header.indexOf(':') + 1).trim().split(/\s+/);
  const pieces = words.slice(1);
  if (/^basic$/i.test(words[0] ?? '') && words[1] !== undefined) pieces.push(...splitPieces(Buffer.from(words[1], 'base64').toString('utf8')));
  return pieces;
}

/**
 * The credentials git can see from where it runs: in the URLs and addresses its config holds
 * (remotes, rewrites, proxies, and every URL that names a config section), in its http extra
 * headers, in the credential helpers it runs, and in the proxy variables. git, curl and ssh print them in wordings no pattern can
 * list, so whatever holds one of them is hidden too.
 */
function knownSecrets(cwd: string, env: NodeJS.ProcessEnv): Promise<string[]> {
  return new Promise((resolve) => {
    const child = spawn('git', ['config', '--null', '--list'], { cwd, env, stdio: ['ignore', 'pipe', 'ignore'] });
    const out: Buffer[] = [];
    child.stdout.on('data', (b: Buffer) => out.push(b));
    child.on('error', () => resolve([]));
    child.on('close', () => {
      const pieces: string[] = [];
      for (const name of PROXY_VARS) pieces.push(...credentialPieces(env[name] ?? ''));
      for (const entry of Buffer.concat(out).toString('utf8').split('\0')) {
        const newline = entry.indexOf('\n');
        const key = newline < 0 ? entry : entry.slice(0, newline);
        const value = newline < 0 ? '' : entry.slice(newline + 1);
        const first = key.indexOf('.');
        const lastDot = key.lastIndexOf('.');
        if (lastDot > first) pieces.push(...credentialPieces(key.slice(first + 1, lastDot)));
        if (/\.(?:url|pushurl|proxy|insteadof|pushinsteadof)$/i.test(key)) pieces.push(...credentialPieces(value));
        if (/\.extraheader$/i.test(key)) pieces.push(...headerPieces(value));
        if (/^credential\.(?:.+\.)?helper$/i.test(key)) pieces.push(...helperPieces(value.trim()));
      }
      resolve([...new Set(pieces.filter((p) => p.length >= SHORTEST_SECRET))].sort((a, b) => b.length - a.length));
    });
  });
}

/** Text with every known secret in it replaced. */
function hideSecrets(text: string, secrets: readonly string[]): string {
  let hidden = text;
  for (const secret of secrets) hidden = hidden.split(secret).join('***');
  return hidden;
}

/**
 * Runs git without a shell. Never prompts: a missing credential fails instead of hanging. Its
 * error text never holds a URL's credentials, since it may reach a report anyone can read: the
 * credentials git can see are hidden wherever they appear, and the rest is scrubbed.
 */
export function runGit(args: readonly string[], opts: GitOptions): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const env = quietEnv(opts.env);
    const child = spawn('git', args, { cwd: opts.cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (b: Buffer) => out.push(b));
    child.stderr.on('data', (b: Buffer) => err.push(b));
    child.on('error', reject);
    child.on('close', (code) => {
      const result = (stderr: string): void => resolve({ code: code ?? 1, stdout: Buffer.concat(out), stderr });
      const text = Buffer.concat(err).toString('utf8');
      if (text === '') return result('');
      void knownSecrets(opts.cwd, env).then((secrets) => result(scrubGitText(hideSecrets(text, secrets))));
    });
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
