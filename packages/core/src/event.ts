import { canonicalJson, sha256Hex } from './canonical.js';
import type { CheckRun } from './check.js';
import { verdictViolations, type Verdict } from './verdict.js';

/**
 * Events are the ledger: append-only, one file each, never edited. An event's id is the SHA-256 of
 * its canonical JSON, and its file holds exactly that canonical JSON plus one newline, so anyone can
 * check a file against its name with standard tools.
 */
export const EVENT_VERSION = 1;

export const ACTOR_KINDS = ['human', 'agent', 'ci', 'unknown'] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

/** Who caused an event. This is provenance, not authentication: an agent can read and set all of it. */
export interface Actor {
  kind: ActorKind;
  /** A handle configured by the team. Never an email address or a personal name. */
  handle?: string;
  harness?: string;
  session?: string;
}

export interface ToolInfo {
  name: 'seamkit';
  version: string;
}

export interface VerdictEvent {
  v: typeof EVENT_VERSION;
  kind: 'verdict';
  at: string;
  actor: Actor;
  tool: ToolInfo;
  body: { run: CheckRun };
}

/** The kinds this version can write and validate. Later milestones add rulings and approvals. */
export type SeamEvent = VerdictEvent;
export const KNOWN_EVENT_KINDS: readonly string[] = ['verdict'];

export function eventJson(event: SeamEvent): string {
  return canonicalJson(event);
}

export function eventId(event: SeamEvent): string {
  return sha256Hex(eventJson(event));
}

export function eventFileContent(event: SeamEvent): string {
  return `${eventJson(event)}\n`;
}

const ISO_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/;

/** `events/YYYY/MM/DD/<compact time>-<id>.json`, which sorts by time and names the content. */
export function eventPath(at: string, id: string): string {
  const m = ISO_TIME.exec(at);
  if (m === null) throw new Error(`event time is not an ISO 8601 UTC time: ${at}`);
  const [, y, mo, d, h, mi, s, frac] = m;
  return `events/${y}/${mo}/${d}/${y}${mo}${d}T${h}${mi}${s}${frac ?? ''}Z-${id}.json`;
}

export const EVENT_PATH_PATTERN = /^events\/(\d{4})\/(\d{2})\/(\d{2})\/(\d{8}T\d{6,15}Z)-([0-9a-f]{64})\.json$/;

export type ParsedEventFile =
  | { ok: true; id: string; kind: string; known: boolean; event: Record<string, unknown> }
  | { ok: false; problems: string[] };

/**
 * Checks one event file: its path shape, its trailing newline, that its bytes are canonical JSON,
 * and that the hash of those bytes is the id in its name. Schema validation is applied only to
 * kinds this version knows; other kinds pass the integrity check and are reported as unknown.
 */
export function parseEventFile(path: string, content: string): ParsedEventFile {
  const problems: string[] = [];
  const m = EVENT_PATH_PATTERN.exec(path);
  if (m === null) return { ok: false, problems: [`path does not match events/YYYY/MM/DD/<time>-<sha256>.json`] };
  const id = m[5] as string;
  if (!content.endsWith('\n') || content.endsWith('\n\n')) problems.push('file must end with exactly one newline');
  const body = content.endsWith('\n') ? content.slice(0, -1) : content;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, problems: [...problems, 'file is not valid JSON'] };
  }
  let canonical: string | undefined;
  try {
    canonical = canonicalJson(parsed);
  } catch (err) {
    problems.push(`content is not canonical JSON data: ${(err as Error).message}`);
  }
  if (canonical !== undefined && canonical !== body) problems.push('content is not in canonical form');
  if (sha256Hex(body) !== id) problems.push('sha256 of the content does not match the id in the file name');
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, problems: [...problems, 'event must be a JSON object'] };
  }
  const event = parsed as Record<string, unknown>;
  const kind = typeof event['kind'] === 'string' ? (event['kind'] as string) : '';
  const known = KNOWN_EVENT_KINDS.includes(kind);
  if (known) problems.push(...eventViolations(event));
  else if (kind === '') problems.push('event has no kind');
  if (typeof event['at'] === 'string') {
    try {
      const expected = eventPath(event['at'] as string, id);
      if (expected !== path) problems.push(`path does not match the event time (expected ${expected})`);
    } catch (err) {
      problems.push((err as Error).message);
    }
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, id, kind, known, event };
}

/** Schema violations for an event of a known kind. */
export function eventViolations(e: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (e['v'] !== EVENT_VERSION) out.push(`v must be ${EVENT_VERSION}`);
  if (e['kind'] !== 'verdict') out.push(`unknown kind ${String(e['kind'])}`);
  if (typeof e['at'] !== 'string' || !ISO_TIME.test(e['at'] as string)) out.push('at must be an ISO 8601 UTC time');
  const actor = e['actor'] as Record<string, unknown> | undefined;
  if (typeof actor !== 'object' || actor === null) out.push('actor must be an object');
  else {
    if (!(ACTOR_KINDS as readonly string[]).includes(actor['kind'] as string)) out.push('actor.kind is not a known kind');
    for (const f of ['handle', 'harness', 'session']) {
      if (actor[f] !== undefined && typeof actor[f] !== 'string') out.push(`actor.${f} must be a string`);
    }
    if (typeof actor['handle'] === 'string' && (actor['handle'] as string).includes('@')) {
      out.push('actor.handle must be a handle, not an email address');
    }
  }
  const tool = e['tool'] as Record<string, unknown> | undefined;
  if (typeof tool !== 'object' || tool === null || tool['name'] !== 'seamkit' || typeof tool['version'] !== 'string') {
    out.push('tool must be {name: "seamkit", version}');
  }
  const body = e['body'] as Record<string, unknown> | undefined;
  const run = body?.['run'] as Record<string, unknown> | undefined;
  if (typeof run !== 'object' || run === null) {
    out.push('body.run must be an object');
    return out;
  }
  const record = run['record'] as Record<string, unknown> | undefined;
  if (typeof record !== 'object' || record === null) out.push('body.run.record must be an object');
  else {
    if (typeof record['check'] !== 'string' || (record['check'] as string).length === 0) out.push('record.check must be a string');
    if (!Number.isInteger(record['version']) || (record['version'] as number) < 1) out.push('record.version must be a positive integer');
    if (!('input' in record)) out.push('record.input is missing');
  }
  const verdicts = run['verdicts'];
  if (!Array.isArray(verdicts) || verdicts.length === 0) out.push('body.run.verdicts must be a non-empty array');
  else verdicts.forEach((v, i) => out.push(...verdictViolations(v as Verdict).map((x) => `verdicts[${i}]: ${x}`)));
  return out;
}
