import { appendFile, readFile } from 'node:fs/promises';
import type { Report } from './report.js';

export type LedgerMode = 'auto' | 'true' | 'false';

/** The action's inputs, as GitHub passes them: INPUT_<NAME> environment variables. */
export interface ActionInputs {
  url: string;
  last: string;
  pr: string;
  branch: string;
  versionUrl: string;
  waitSeconds: number;
  ledger: LedgerMode;
  checkName: string;
  token: string;
  sha: string;
}

/** The run's surroundings, from the variables every GitHub Actions job sets. */
export interface GitHubContext {
  apiUrl: string;
  serverUrl: string;
  repository: string;
  runId: string;
  eventName: string;
  eventPath: string;
  sha: string;
  workspace: string;
  outputPath: string;
  summaryPath: string;
}

export class ActionInputError extends Error {
  override name = 'ActionInputError';
}

type Env = Record<string, string | undefined>;

const input = (env: Env, name: string): string => (env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`] ?? '').trim();

export function readInputs(env: Env): ActionInputs {
  const url = input(env, 'url');
  if (url === '') throw new ActionInputError('the url input is required: the production address to read back, such as https://your.app');
  const wait = input(env, 'wait') || '60';
  if (!/^[0-9]+$/.test(wait) || Number(wait) > 1800) throw new ActionInputError('wait must be a whole number of seconds from 0 to 1800');
  const ledger = input(env, 'ledger') || 'auto';
  if (ledger !== 'auto' && ledger !== 'true' && ledger !== 'false') throw new ActionInputError('ledger must be auto, true or false');
  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    // seamkit itself reports an unusable URL, with the reason, as a usage error.
  }
  return {
    url,
    last: input(env, 'last'),
    pr: input(env, 'pr'),
    branch: input(env, 'branch'),
    versionUrl: input(env, 'version-url'),
    waitSeconds: Number(wait),
    ledger,
    checkName: input(env, 'check-name') || `seamkit readback (${host})`,
    token: input(env, 'token'),
    sha: input(env, 'sha'),
  };
}

export function readContext(env: Env): GitHubContext {
  const need = (name: string): string => {
    const v = env[name];
    if (v === undefined || v === '') throw new ActionInputError(`${name} is not set; this action runs inside a GitHub Actions job`);
    return v;
  };
  return {
    apiUrl: env['GITHUB_API_URL'] || 'https://api.github.com',
    serverUrl: env['GITHUB_SERVER_URL'] || 'https://github.com',
    repository: need('GITHUB_REPOSITORY'),
    runId: env['GITHUB_RUN_ID'] ?? '',
    eventName: env['GITHUB_EVENT_NAME'] ?? '',
    eventPath: env['GITHUB_EVENT_PATH'] ?? '',
    sha: env['GITHUB_SHA'] ?? '',
    workspace: env['GITHUB_WORKSPACE'] || process.cwd(),
    outputPath: env['GITHUB_OUTPUT'] ?? '',
    summaryPath: env['GITHUB_STEP_SUMMARY'] ?? '',
  };
}

export async function readEvent(path: string): Promise<Record<string, unknown>> {
  if (path === '') return {};
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const field = (o: unknown, ...keys: string[]): unknown => keys.reduce<unknown>((v, k) => (v !== null && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined), o);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

/**
 * The commit the check run belongs to: the one deployed for deployment_status, the one the other
 * workflow ran on for workflow_run, else the job's own commit. An explicit sha input wins.
 */
export function headSha(ctx: GitHubContext, event: Record<string, unknown>, explicit: string): string {
  if (explicit !== '') return explicit;
  if (ctx.eventName === 'deployment_status' || ctx.eventName === 'deployment') return str(field(event, 'deployment', 'sha')) ?? ctx.sha;
  if (ctx.eventName === 'workflow_run') return str(field(event, 'workflow_run', 'head_sha')) ?? ctx.sha;
  return ctx.sha;
}

/** Why this event is not a finished deploy, or undefined when it should be read back. */
export function skipReason(ctx: GitHubContext, event: Record<string, unknown>): string | undefined {
  if (ctx.eventName === 'deployment_status') {
    const state = str(field(event, 'deployment_status', 'state'));
    if (state !== 'success') return `the deployment is ${state ?? 'in an unknown state'}, not success; readback runs once it succeeds`;
  }
  if (ctx.eventName === 'workflow_run') {
    const conclusion = str(field(event, 'workflow_run', 'conclusion'));
    if (conclusion !== 'success') return `the deploy workflow concluded ${conclusion ?? 'without a conclusion'}, not success`;
  }
  return undefined;
}

export interface CheckRunResult {
  ok: boolean;
  url?: string;
  problem?: string;
}

export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ status: number; text(): Promise<string> }>;

/** Posts a completed check run. A refusal is returned, not thrown: the verdict stands without it. */
export async function postCheckRun(fetchFn: Fetch, ctx: GitHubContext, token: string, name: string, sha: string, report: Report, detailsUrl: string): Promise<CheckRunResult> {
  if (token === '') return { ok: false, problem: 'no token was given, so no check run was posted' };
  const output: Record<string, string> = { title: report.title, summary: report.summary };
  if (report.text !== '') output['text'] = report.text;
  const body = { name, head_sha: sha, status: 'completed', conclusion: report.conclusion, ...(detailsUrl ? { details_url: detailsUrl } : {}), output };
  let res: { status: number; text(): Promise<string> };
  try {
    res = await fetchFn(`${ctx.apiUrl}/repos/${ctx.repository}/check-runs`, {
      method: 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'user-agent': 'seamkit-action',
        'x-github-api-version': '2022-11-28',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, problem: `the check run could not be posted: ${(err as Error).message}` };
  }
  const text = await res.text();
  if (res.status === 201) {
    let url: string | undefined;
    try {
      url = str((JSON.parse(text) as { html_url?: unknown }).html_url);
    } catch {
      url = undefined;
    }
    return url === undefined ? { ok: true } : { ok: true, url };
  }
  if (res.status === 403 || res.status === 404) {
    return { ok: false, problem: `GitHub refused the check run (${res.status}); give the job "permissions: checks: write". Pull requests from forks get a read-only token and cannot post one.` };
  }
  return { ok: false, problem: `GitHub answered ${res.status} to the check run: ${text.slice(0, 300)}` };
}

/** Appends one output in the multi-line form, which is safe for any value. */
export async function setOutput(path: string, name: string, value: string): Promise<void> {
  if (path === '') return;
  const delimiter = `seamkit_${Math.random().toString(36).slice(2)}`;
  await appendFile(path, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}

export async function appendSummary(path: string, markdown: string): Promise<void> {
  if (path !== '') await appendFile(path, markdown);
}
