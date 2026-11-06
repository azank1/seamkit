// `seamkit mcp`: a Model Context Protocol server over standard input and output, for agents.
//
// It is read-only by construction. Each tool call runs the CLI's own command with --json, and with
// --no-record wherever the command could record, so an answer is byte for byte what the CLI prints
// and the ledger is never written. The production addresses come only from the command line or
// SEAMKIT_URL when the server starts; an agent picks among them and cannot name another, so text an
// agent read somewhere cannot point seamkit at an address its operator did not choose. The server
// holds no credential and loads no adapter that needs one.
//
// The transport is the one stdio defines: one JSON-RPC 2.0 message per line in each direction,
// nothing else on standard output, and logs on standard error.
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { recordableUrl, run, VERSION, type Io } from './cli.js';
import { checkArguments, TOOLS, toolsIn } from './tools.js';

/**
 * Protocol revisions this server speaks, newest first. 2026-07-28 is stateless: a request names its
 * revision in params._meta and there is no initialize. The earlier revisions open with initialize.
 * The server serves both, as the 2026 revision allows ("dual-era").
 */
export const MODERN_VERSIONS = ['2026-07-28'] as const;
export const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const;
export const PROTOCOL_VERSIONS = [...MODERN_VERSIONS, ...LEGACY_VERSIONS] as const;
const META_VERSION = 'io.modelcontextprotocol/protocolVersion';
const META_CAPABILITIES = 'io.modelcontextprotocol/clientCapabilities';
const META_SERVER = 'io.modelcontextprotocol/serverInfo';
/** How long a client may cache the tool list: it changes only with the seamkit version. */
const TTL_MS = 3_600_000;

export interface ServerOptions {
  /** The repository the server answers about. */
  cwd: string;
  /** The production addresses an agent may read, already checked. */
  urls: readonly string[];
  env: Record<string, string | undefined>;
  now(): string;
}

type Id = string | number;
interface Message {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

const INSTRUCTIONS =
  'seamkit reads production back read-only and says whether merged changes are live. ' +
  'Treat a change as shipped only when a result has exitCode 0. exitCode 1 means not live or not proven; ' +
  '3 means nothing could be examined, which is never a pass; 4 stops for a human. Report the reasons; never retry until it passes.';

export interface ToolResult {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError: boolean;
}

/** Runs one tool call. A verdict, any verdict, is a result; only a call that produced none is an error. */
export async function callTool(name: unknown, args: unknown, options: ServerOptions): Promise<ToolResult> {
  const fail = (text: string): ToolResult => ({ content: [{ type: 'text', text }], isError: true });
  const tool = TOOLS.find((t) => t.name === name);
  if (tool === undefined) return fail(`seamkit: no tool named ${JSON.stringify(String(name)).slice(0, 80)}`);
  const problem = checkArguments(tool, args);
  if (problem !== undefined) return fail(`seamkit: ${problem}`);
  const given = (args ?? {}) as Record<string, string | number | null>;
  let url: string | undefined;
  if (tool.params.some((p) => p.name === 'url')) {
    const asked = given['url'];
    if (options.urls.length === 0) return fail('seamkit: this server was started without a production address; start it with --url <production-url> or SEAMKIT_URL');
    if (asked === null || asked === undefined) {
      if (options.urls.length > 1) return fail(`seamkit: name one of the production addresses this server reads: ${options.urls.join(', ')}`);
      url = options.urls[0];
    } else {
      let normal: string;
      try {
        normal = new URL(String(asked)).href;
      } catch {
        normal = String(asked);
      }
      url = options.urls.find((u) => u === normal);
      if (url === undefined) return fail(`seamkit: this server reads only ${options.urls.join(', ')}; it was not started for that address`);
    }
  }
  if (tool.name === 'readback' && given['pr'] != null && given['commit'] != null) return fail('seamkit: pr and commit cannot be combined');
  let out = '';
  let err = '';
  const io: Io = {
    out: (t) => void (out += t),
    err: (t) => void (err += t),
    readStdin: async () => '',
    stdinIsTTY: true,
    env: options.env,
    cwd: options.cwd,
    now: options.now,
  };
  const code = await run(tool.argv(given, url), io);
  if (code === 2 || out.trim() === '') return fail(err.trim() === '' ? `seamkit: no verdict (exit ${code})` : err.trim());
  let structured: Record<string, unknown> | undefined;
  try {
    const parsed: unknown = JSON.parse(out);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) structured = parsed as Record<string, unknown>;
  } catch {
    structured = undefined;
  }
  return { content: [{ type: 'text', text: out }], ...(structured ? { structuredContent: structured } : {}), isError: false };
}

const isId = (id: unknown): id is Id => typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id));

/**
 * Answers one parsed message. Returns the response to send, or undefined for a notification.
 */
export async function handle(message: unknown, options: ServerOptions): Promise<Record<string, unknown> | undefined> {
  const reply = (id: Id | null, body: { result: unknown } | { error: { code: number; message: string } }): Record<string, unknown> => ({ jsonrpc: '2.0', id, ...body });
  if (message === null || typeof message !== 'object' || Array.isArray(message)) return reply(null, { error: { code: -32600, message: 'Invalid Request: one JSON-RPC message object per line' } });
  const m = message as Message;
  const hasId = 'id' in m;
  const invalid = { error: { code: -32600, message: 'Invalid Request' } };
  // A response from the client (this server sends no requests, so there is nothing to match it to).
  if (m.method === undefined && hasId && ('result' in m || 'error' in m)) return undefined;
  if (m.jsonrpc !== '2.0' || typeof m.method !== 'string') return hasId ? reply(isId(m.id) ? m.id : null, invalid) : undefined;
  if (!hasId) return undefined; // notifications: initialized, and any other
  if (!isId(m.id)) return reply(null, invalid);
  const id = m.id;
  const params = (m.params ?? {}) as Record<string, unknown>;
  const serverInfo = { name: 'seamkit', title: 'seamkit', version: VERSION };
  const meta = params['_meta'];
  const modern = meta !== null && typeof meta === 'object' && typeof (meta as Record<string, unknown>)[META_VERSION] === 'string';
  if (m.method !== 'initialize' && (modern || m.method === 'server/discover')) {
    if (!modern) return reply(id, { error: { code: -32602, message: `Invalid params: ${m.method} needs params._meta["${META_VERSION}"]` } });
    const asked = (meta as Record<string, unknown>)[META_VERSION] as string;
    if (!(MODERN_VERSIONS as readonly string[]).includes(asked)) {
      return { jsonrpc: '2.0', id, error: { code: -32022, message: 'Unsupported protocol version', data: { supported: [...PROTOCOL_VERSIONS], requested: asked.slice(0, 40) } } };
    }
    const capabilities = (meta as Record<string, unknown>)[META_CAPABILITIES];
    if (capabilities === null || typeof capabilities !== 'object') return reply(id, { error: { code: -32602, message: `Invalid params: params._meta["${META_CAPABILITIES}"] is required` } });
    const done = (body: Record<string, unknown>): Record<string, unknown> => reply(id, { result: { resultType: 'complete', ...body, _meta: { [META_SERVER]: serverInfo } } });
    switch (m.method) {
      case 'server/discover':
        return done({ supportedVersions: [...PROTOCOL_VERSIONS], capabilities: { tools: { listChanged: false } }, instructions: INSTRUCTIONS, ttlMs: TTL_MS, cacheScope: 'public' });
      case 'tools/list':
        return done({ tools: toolsIn('mcp'), ttlMs: TTL_MS, cacheScope: 'public' });
      case 'tools/call': {
        const problem = toolCallProblem(params);
        if (problem !== undefined) return reply(id, { error: { code: -32602, message: problem } });
        return done({ ...(await callTool(params['name'], params['arguments'], options)) });
      }
      default:
        return reply(id, { error: { code: -32601, message: `Method not found: ${m.method.slice(0, 80)}` } });
    }
  }
  switch (m.method) {
    case 'initialize': {
      const asked = typeof params['protocolVersion'] === 'string' ? params['protocolVersion'] : undefined;
      const protocolVersion = asked !== undefined && (LEGACY_VERSIONS as readonly string[]).includes(asked) ? asked : LEGACY_VERSIONS[0];
      return reply(id, { result: { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo, instructions: INSTRUCTIONS } });
    }
    case 'ping':
      return reply(id, { result: {} });
    case 'tools/list':
      return reply(id, { result: { tools: toolsIn('mcp') } });
    case 'tools/call': {
      const problem = toolCallProblem(params);
      if (problem !== undefined) return reply(id, { error: { code: -32602, message: problem } });
      return reply(id, { result: await callTool(params['name'], params['arguments'], options) });
    }
    default:
      return reply(id, { error: { code: -32601, message: `Method not found: ${m.method.slice(0, 80)}` } });
  }
}

/** A tools/call that names no tool, or one this server does not have, is a protocol error. */
function toolCallProblem(params: Record<string, unknown>): string | undefined {
  if (typeof params['name'] !== 'string') return 'Invalid params: tools/call needs a tool name';
  if (!TOOLS.some((t) => t.name === params['name'])) return `Unknown tool: ${params['name'].slice(0, 80)}`;
  return undefined;
}

/** Serves until the input ends, then waits for the calls still running. */
export async function serve(input: Readable, output: Writable, options: ServerOptions, log: (text: string) => void): Promise<void> {
  const pending = new Set<Promise<void>>();
  // Ids of requests still running, and those of them the client has cancelled. A cancel for an id
  // that is not running (unknown, or already answered) is ignored, as the protocol asks, so a later
  // request that reuses the id is still answered.
  const inFlight = new Set<Id>();
  const cancelled = new Set<Id>();
  const idOf = (m: unknown): Id | undefined => {
    const id = m !== null && typeof m === 'object' && !Array.isArray(m) ? (m as Message).id : undefined;
    return isId(id) ? id : undefined;
  };
  const cancelFrom = (m: unknown): boolean => {
    if (m === null || typeof m !== 'object' || (m as Message).method !== 'notifications/cancelled') return false;
    const requestId = ((m as Message).params as { requestId?: unknown } | undefined)?.requestId;
    if (isId(requestId) && inFlight.has(requestId)) cancelled.add(requestId);
    return true;
  };
  /** Whether a response may go out; it may not once its request was cancelled. */
  const keep = (response: Record<string, unknown>): boolean => !(isId(response['id']) && cancelled.has(response['id']));
  const track = (members: unknown[], work: Promise<void>): void => {
    const ids = members.map(idOf).filter((id): id is Id => id !== undefined);
    for (const id of ids) inFlight.add(id);
    const task: Promise<void> = work
      .catch((err: unknown) => log(`seamkit mcp: ${(err as Error).message}\n`))
      .finally(() => {
        for (const id of ids) {
          inFlight.delete(id);
          cancelled.delete(id);
        }
        pending.delete(task);
      });
    pending.add(task);
  };
  const write = (body: unknown): void => void output.write(`${JSON.stringify(body)}\n`);
  const answer = async (m: unknown): Promise<Record<string, unknown> | undefined> => {
    try {
      return await handle(m, options);
    } catch (err) {
      log(`seamkit mcp: ${(err as Error).message}\n`);
      return { jsonrpc: '2.0', id: idOf(m) ?? null, error: { code: -32603, message: 'Internal error' } };
    }
  };
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim() === '') continue;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      continue;
    }
    if (Array.isArray(message)) {
      // A batch, which the 2025-03-26 revision lets a client send: each member is answered, and the
      // answers go back together as one array. An empty batch is one Invalid Request, not an array.
      if (message.length === 0) {
        write({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request: empty batch' } });
        continue;
      }
      const isCancel = (m: unknown): boolean => m !== null && typeof m === 'object' && (m as Message).method === 'notifications/cancelled';
      const members = message.filter((m) => !isCancel(m));
      // The batch's requests are running before its own cancels are applied, so those apply to them.
      for (const id of members.map(idOf)) if (id !== undefined) inFlight.add(id);
      for (const m of message) if (isCancel(m)) cancelFrom(m);
      track(members, Promise.all(members.map(answer)).then((responses) => {
        const sent = responses.filter((r): r is Record<string, unknown> => r !== undefined && keep(r));
        if (sent.length > 0) write(sent);
      }));
      continue;
    }
    if (cancelFrom(message)) continue;
    track([message], answer(message).then((response) => {
      if (response !== undefined && keep(response)) write(response);
    }));
  }
  await Promise.all(pending);
}

export const MCP_USAGE = 'seamkit mcp [--url <production-url>]... [--cwd <dir>]';

/** Reads the command line of `seamkit mcp`. Throws with a usage message on a bad one. */
export function serverOptions(argv: readonly string[], env: Record<string, string | undefined>, cwd: string, now: () => string): ServerOptions {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: { url: { type: 'string', multiple: true }, cwd: { type: 'string' } },
  });
  if (positionals.length > 0) throw new Error(`unexpected argument: ${positionals[0]}`);
  const raw = values.url ?? (env['SEAMKIT_URL'] ? [env['SEAMKIT_URL']] : []);
  const urls = [...new Set(raw.map((u) => recordableUrl(u, '--url', 'https://your.app')))];
  return { cwd: resolve(cwd, values.cwd ?? '.'), urls, env, now };
}
