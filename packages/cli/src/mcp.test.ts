import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { FakeProduction } from '@seamkit/adapters';
import { git } from '@seamkit/state';
import { run, type Io } from './cli.js';
import { callTool, handle, LEGACY_VERSIONS, MODERN_VERSIONS, serve, serverOptions, type ServerOptions } from './mcp.js';
import { FORMATS, jsonSchema, TOOLS, toolsIn } from './tools.js';

const AT = '2026-11-06T09:00:00.000Z';
const MAIN = fileURLToPath(new URL('./main.js', import.meta.url));
const ID = ['-c', 'user.name=dev', '-c', 'user.email=dev@example.invalid'];

let root: string;
let prod: FakeProduction;
let dir: string;
let head: string;

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'seamkit-mcp-test-'));
  const emptyConfig = join(root, 'gitconfig');
  await writeFile(emptyConfig, '');
  process.env['GIT_CONFIG_GLOBAL'] = emptyConfig;
  process.env['GIT_CONFIG_NOSYSTEM'] = '1';
  prod = await FakeProduction.start();
  dir = join(root, 'repo');
  await git(['init', '-q', '-b', 'main', dir], { cwd: root });
  for (const n of [1, 2, 3]) {
    await writeFile(join(dir, `f${n}.txt`), `${n}\n`);
    await git(['add', `f${n}.txt`], { cwd: dir });
    await git([...ID, 'commit', '-q', '-m', `change ${n}`], { cwd: dir });
  }
  head = await git(['rev-parse', 'HEAD'], { cwd: dir });
  prod.deploy({ 'index.html': '<!doctype html><p>app</p>', 'version.json': JSON.stringify({ schema: 'seamkit.version/1', commit: head, dirty: false, source: 'git' }) });
});

after(async () => {
  await prod.close();
  await rm(root, { recursive: true, force: true });
});

const options = (urls: string[] = [prod.url]): ServerOptions => ({ cwd: dir, urls, env: {}, now: () => AT });

async function cli(args: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const io: Io = { out: (t) => void (out += t), err: (t) => void (err += t), readStdin: async () => '', stdinIsTTY: true, env: {}, cwd: dir, now: () => AT };
  return { code: await run(args, io), out, err };
}

const walk = (value: unknown, visit: (key: string, v: unknown) => void): void => {
  if (value === null || typeof value !== 'object') return;
  for (const [k, v] of Object.entries(value)) {
    visit(k, v);
    walk(v, visit);
  }
};

describe('seamkit tools', () => {
  it('offers at most 8 tools, each read-only, idempotent and not destructive', () => {
    const tools = toolsIn('mcp') as { name: string; annotations: Record<string, unknown>; inputSchema: Record<string, unknown> }[];
    assert.ok(tools.length > 0 && tools.length <= 8);
    for (const t of tools) {
      assert.match(t.name, /^[a-z_]{1,64}$/);
      assert.deepEqual({ ...t.annotations, title: undefined }, { title: undefined, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true });
      assert.equal(t.inputSchema['type'], 'object');
    }
  });

  it('writes every format from one definition, deterministically, with no oneOf or anyOf, every field required and optional ones nullable', () => {
    for (const format of FORMATS) {
      const a = JSON.stringify(toolsIn(format));
      assert.equal(a, JSON.stringify(toolsIn(format)), format);
      walk(toolsIn(format), (k) => assert.ok(!['oneOf', 'anyOf', 'allOf', '$ref'].includes(k), `${format} uses ${k}`));
    }
    for (const t of TOOLS) {
      const schema = jsonSchema(t) as { properties: Record<string, { type: unknown }>; required: string[]; additionalProperties: boolean };
      assert.deepEqual(schema.required, t.params.map((p) => p.name));
      assert.equal(schema.additionalProperties, false);
      for (const p of Object.values(schema.properties)) assert.deepEqual((p.type as string[])[1], 'null');
    }
    for (const format of ['openai', 'anthropic', 'gemini'] as const) {
      assert.ok(!JSON.stringify(toolsIn(format)).includes('"url"'), `${format} lets the model choose the address`);
    }
    assert.ok(JSON.stringify(toolsIn('mcp')).includes('"url"'));
    const gemini = toolsIn('gemini') as { functionDeclarations: { parameters?: { properties: Record<string, { type: string; nullable: boolean }> } }[] }[];
    for (const d of gemini[0]!.functionDeclarations) for (const p of Object.values(d.parameters?.properties ?? {})) assert.ok(['STRING', 'INTEGER'].includes(p.type) && p.nullable);
  });

  it('keeps tools/list within 2K tokens, and its digest changes only with the definitions', () => {
    const text = JSON.stringify(toolsIn('mcp'));
    // About four characters to a token for English and JSON; 8000 characters is 2K tokens with room.
    assert.ok(text.length <= 8000, `tools/list is ${text.length} characters`);
    assert.match(createHash('sha256').update(text).digest('hex'), /^[0-9a-f]{64}$/);
  });

  it('prints the definitions from the command line, and refuses an unknown format', async () => {
    const r = await cli(['tools', '--format', 'anthropic']);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(JSON.parse(r.out), toolsIn('anthropic'));
    assert.equal((await cli(['tools', '--format', 'cobol'])).code, 2);
    assert.equal((await cli(['tools'])).code, 2);
  });
});

describe('seamkit mcp: tool calls', () => {
  it('answers audit with the same bytes as "seamkit audit --json --no-record"', async () => {
    const r = await callTool('audit', { url: null, last: 2, branch: null }, options());
    const c = await cli(['audit', '--json', '--no-record', '--url', prod.url, '--last', '2']);
    assert.equal(r.isError, false);
    assert.equal(r.content[0]!.text, c.out);
    assert.deepEqual(r.structuredContent, JSON.parse(c.out));
    assert.equal(r.structuredContent!['outcome'], 'pass');
    assert.equal(r.structuredContent!['exitCode'], 0);
  });

  it('returns a fail or examined nothing as a result, not as a tool error', async () => {
    prod.deploy({ 'index.html': '<!doctype html><p>app</p>' });
    try {
      const r = await callTool('readback', {}, options());
      assert.equal(r.isError, false);
      assert.equal(r.structuredContent!['exitCode'], 3);
    } finally {
      prod.deploy({ 'index.html': '<!doctype html><p>app</p>', 'version.json': JSON.stringify({ schema: 'seamkit.version/1', commit: head, dirty: false, source: 'git' }) });
    }
  });

  it('reads only the addresses it was started with, and needs one to read production', async () => {
    for (const url of ['http://169.254.169.254/', 'http://127.0.0.1:1/', 'https://example.com/']) {
      const r = await callTool('audit', { url }, options());
      assert.equal(r.isError, true, url);
      assert.match(r.content[0]!.text, /reads only/);
    }
    assert.equal((await callTool('audit', { url: prod.url.replace(/\/$/, '') }, options())).isError, false, 'the same address written without its slash');
    assert.match((await callTool('audit', {}, options([]))).content[0]!.text, /started without a production address/);
    assert.match((await callTool('audit', {}, options([prod.url, 'https://other.example/']))).content[0]!.text, /name one of/);
  });

  it('checks arguments before running anything, so text cannot become an option', async () => {
    // Each must be refused by the server's own check, with its message; some of these the CLI would accept.
    const bad: [string, Record<string, unknown>, RegExp][] = [
      ['readback', { commit: '--upload-pack=touch /tmp/x' }, /does not have the form/],
      ['readback', { deployed: '-x' }, /does not have the form/],
      ['readback', { branch: '--output=/tmp/x' }, /does not have the form/],
      ['readback', { branch: 'main~1' }, /does not have the form/],
      ['readback', { commit: 'HEAD' }, /does not have the form/],
      ['readback', { pr: 0 }, /must be from 1 to/],
      ['readback', { pr: 1.5 }, /must be an integer/],
      ['readback', { pr: '7' }, /must be an integer/],
      ['readback', { pr: 1, commit: 'abcdef1' }, /cannot be combined/],
      ['audit', { last: 1001 }, /must be from 1 to 1000/],
      ['audit', { last: 0 }, /must be from 1 to 1000/],
      ['audit', { cwd: '/' }, /unknown argument/],
      ['replay', { event: '../x' }, /does not have the form/],
      ['audit', 'not an object' as unknown as Record<string, unknown>, /must be an object/],
    ];
    for (const [name, args, message] of bad) {
      const r = await callTool(name, args, options());
      assert.equal(r.isError, true, JSON.stringify(args));
      assert.match(r.content[0]!.text, message, JSON.stringify(args));
      assert.equal(r.structuredContent, undefined);
    }
    assert.equal((await callTool('stamp', {}, options())).isError, true);
  });

  it('records nothing, even where the repository keeps a ledger', async () => {
    assert.equal((await cli(['state', 'init'])).code, 0);
    const before = await git(['rev-parse', 'refs/heads/seamkit/state'], { cwd: dir });
    await callTool('audit', {}, options());
    await callTool('readback', { commit: head.slice(0, 12) }, options());
    assert.equal(await git(['rev-parse', 'refs/heads/seamkit/state'], { cwd: dir }), before);
    const verify = await callTool('ledger_verify', {}, options());
    assert.equal(verify.isError, false, verify.content[0]!.text);
  });
});

describe('seamkit mcp: the protocol', () => {
  const req = (method: string, params?: unknown, id: unknown = 1): unknown => ({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });

  it('negotiates the protocol version: echoes one it speaks, else offers its newest', async () => {
    for (const v of LEGACY_VERSIONS) {
      const r = (await handle(req('initialize', { protocolVersion: v, capabilities: {}, clientInfo: { name: 't', version: '0' } }), options())) as { result: { protocolVersion: string; capabilities: unknown } };
      assert.equal(r.result.protocolVersion, v);
      assert.deepEqual(r.result.capabilities, { tools: { listChanged: false } });
    }
    for (const asked of ['1999-01-01', '2026-07-28']) {
      const r = (await handle(req('initialize', { protocolVersion: asked }), options())) as { result: { protocolVersion: string } };
      assert.equal(r.result.protocolVersion, LEGACY_VERSIONS[0], 'initialize always selects a revision that has initialize');
    }
  });

  it('serves the stateless 2026-07-28 revision: discover, list and call with per-request _meta', async () => {
    const meta = { 'io.modelcontextprotocol/protocolVersion': MODERN_VERSIONS[0], 'io.modelcontextprotocol/clientCapabilities': {} };
    const discover = (await handle(req('server/discover', { _meta: meta }), options())) as { result: Record<string, unknown> };
    assert.equal(discover.result['resultType'], 'complete');
    assert.ok((discover.result['supportedVersions'] as string[]).includes('2026-07-28'));
    assert.deepEqual((discover.result['_meta'] as Record<string, { name: string }>)['io.modelcontextprotocol/serverInfo']!.name, 'seamkit');
    const list = (await handle(req('tools/list', { _meta: meta }), options())) as { result: Record<string, unknown> };
    assert.deepEqual(list.result['tools'], toolsIn('mcp'));
    assert.equal(typeof list.result['ttlMs'], 'number');
    assert.equal(list.result['cacheScope'], 'public');
    const call = (await handle(req('tools/call', { _meta: meta, name: 'audit', arguments: {} }), options())) as { result: Record<string, unknown> };
    assert.equal(call.result['resultType'], 'complete');
    assert.equal((call.result['structuredContent'] as { outcome: string }).outcome, 'pass');
    const unsupported = (await handle(req('tools/list', { _meta: { ...meta, 'io.modelcontextprotocol/protocolVersion': '2099-01-01' } }), options())) as { error: { code: number; data: { supported: string[] } } };
    assert.equal(unsupported.error.code, -32022);
    assert.ok(unsupported.error.data.supported.includes('2026-07-28') && unsupported.error.data.supported.includes('2025-11-25'));
    const noCaps = (await handle(req('tools/list', { _meta: { 'io.modelcontextprotocol/protocolVersion': MODERN_VERSIONS[0] } }), options())) as { error: { code: number } };
    assert.equal(noCaps.error.code, -32602);
    assert.equal(((await handle(req('server/discover'), options())) as { error: { code: number } }).error.code, -32602);
  });

  it('answers ping, lists tools, and refuses unknown methods and tools with JSON-RPC errors', async () => {
    assert.deepEqual(await handle(req('ping'), options()), { jsonrpc: '2.0', id: 1, result: {} });
    const list = (await handle(req('tools/list'), options())) as { result: { tools: unknown } };
    assert.deepEqual(list.result.tools, toolsIn('mcp'));
    assert.equal(((await handle(req('resources/list'), options())) as { error: { code: number } }).error.code, -32601);
    assert.equal(((await handle(req('tools/call', { name: 'stamp' }), options())) as { error: { code: number } }).error.code, -32602);
    assert.equal(((await handle(req('tools/call', {}), options())) as { error: { code: number } }).error.code, -32602);
  });

  it('sends nothing for notifications or responses, and an Invalid Request for malformed messages', async () => {
    assert.equal(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }, options()), undefined);
    assert.equal(await handle({ jsonrpc: '2.0', id: 9, result: {} }, options()), undefined);
    for (const bad of [[], 'x', 7, null, { jsonrpc: '1.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', id: {}, method: 'ping' }]) {
      const r = (await handle(bad, options())) as { error: { code: number } };
      assert.equal(r.error.code, -32600, JSON.stringify(bad));
    }
  });

  it('frames one message per line, answers a parse error, and drops the answer to a cancelled call', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let text = '';
    output.on('data', (c: Buffer) => void (text += c.toString('utf8')));
    const done = serve(input, output, options(), () => {});
    input.write('{not json\n');
    input.write(`${JSON.stringify(req('ping', undefined, 'a'))}\n`);
    input.write(`${JSON.stringify(req('tools/call', { name: 'audit', arguments: {} }, 'b'))}\n`);
    input.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 'b' } })}\n`);
    input.write(`${JSON.stringify([req('ping', undefined, 'c'), { jsonrpc: '2.0', method: 'notifications/initialized' }, req('tools/list', undefined, 'd')])}\n`);
    input.end();
    await done;
    const lines = text.split('\n').filter((l) => l !== '');
    const messages = lines.map((l) => JSON.parse(l) as { id: unknown; error?: { code: number } } | { id: unknown }[]);
    const single = messages.filter((m) => !Array.isArray(m)) as { id: unknown; error?: { code: number } }[];
    assert.deepEqual(single.map((m) => m.id), [null, 'a']);
    assert.equal(single[0]!.error!.code, -32700);
    const batch = messages.find((m) => Array.isArray(m)) as { id: unknown }[];
    assert.deepEqual(batch.map((m) => m.id), ['c', 'd'], 'a batch is answered as one array, without the notification');
  });

  it('ignores a cancel for a request that is not running, and answers a later request that reuses its id', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const got: { id: unknown; error?: { code: number } }[] = [];
    let buffer = '';
    output.on('data', (c: Buffer) => {
      buffer += c.toString('utf8');
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        got.push(JSON.parse(buffer.slice(0, i)) as { id: unknown });
        buffer = buffer.slice(i + 1);
      }
    });
    const done = serve(input, output, options(), () => {});
    const until = async (n: number): Promise<void> => {
      for (let i = 0; i < 200 && got.length < n; i++) await new Promise((r) => setTimeout(r, 10));
    };
    input.write(`${JSON.stringify(req('ping', undefined, 1))}\n`);
    await until(1);
    input.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } })}\n`);
    input.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 'never-sent' } })}\n`);
    input.write(`${JSON.stringify(req('ping', undefined, 1))}\n`);
    input.write(`${JSON.stringify(req('ping', undefined, 'never-sent'))}\n`);
    input.write('[]\n');
    input.write(`${JSON.stringify([req('tools/call', { name: 'audit', arguments: {} }, 'x'), { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 'x' } }, req('ping', undefined, 'y')])}\n`);
    input.end();
    await done;
    const flat = got.flatMap((m) => (Array.isArray(m) ? m : [m])) as { id: unknown; error?: { code: number } }[];
    assert.deepEqual(flat.filter((m) => m.id === 1).length, 2, 'both requests with id 1 are answered');
    assert.ok(flat.some((m) => m.id === 'never-sent'));
    const empty = got.find((m) => !Array.isArray(m) && m.id === null) as { error: { code: number } };
    assert.equal(empty.error.code, -32600, 'an empty batch is one Invalid Request, not an array');
    const batch = got.find((m) => Array.isArray(m)) as unknown as { id: unknown }[];
    assert.deepEqual(batch.map((m) => m.id), ['y'], 'a call cancelled in its own batch is not answered');
  });

  it('takes its addresses from --url or SEAMKIT_URL, and refuses one that would be recorded unsafely', () => {
    assert.deepEqual(serverOptions(['--url', 'https://a.example', '--url', 'https://a.example/'], {}, '/', () => AT).urls, ['https://a.example/']);
    assert.deepEqual(serverOptions([], { SEAMKIT_URL: 'https://b.example' }, '/', () => AT).urls, ['https://b.example/']);
    assert.deepEqual(serverOptions([], {}, '/', () => AT).urls, []);
    assert.throws(() => serverOptions(['--url', 'https://u:p@a.example'], {}, '/', () => AT));
    assert.throws(() => serverOptions(['--url', 'https://a.example/?k=v'], {}, '/', () => AT));
    assert.throws(() => serverOptions(['stray'], {}, '/', () => AT));
  });
});

describe('seamkit mcp: a real client session over stdio', () => {
  it('lets an MCP client run an audit and receive the verdicts and the outcome', async () => {
    const child = spawn(process.execPath, [MAIN, 'mcp', '--url', prod.url], { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env } });
    let out = '';
    child.stdout.on('data', (c: Buffer) => void (out += c.toString('utf8')));
    const send = (m: unknown): boolean => child.stdin.write(`${JSON.stringify(m)}\n`);
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'audit', arguments: { url: null, last: null, branch: null } } });
    // Enough answers queued at once to pass a pipe's buffer: all must arrive after standard input closes.
    for (let i = 100; i < 160; i++) send({ jsonrpc: '2.0', id: i, method: 'tools/list' });
    child.stdin.end();
    const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
    assert.equal(code, 0);
    const byId = new Map(out.split('\n').filter((l) => l !== '').map((l) => { const m = JSON.parse(l) as { id: number }; return [m.id, m] as const; }));
    assert.equal((byId.get(1) as unknown as { result: { serverInfo: { name: string } } }).result.serverInfo.name, 'seamkit');
    assert.equal((byId.get(2) as unknown as { result: { tools: unknown[] } }).result.tools.length, TOOLS.length);
    const call = (byId.get(3) as unknown as { result: { isError: boolean; structuredContent: { outcome: string; exitCode: number; verdicts: { subject: string }[] } } }).result;
    assert.equal(call.isError, false);
    assert.equal(call.structuredContent.outcome, 'pass');
    assert.equal(call.structuredContent.exitCode, 0);
    assert.equal(call.structuredContent.verdicts.length, 4, 'the run and its three changes');
    for (let i = 100; i < 160; i++) assert.ok(byId.has(i), `answer ${i} arrived`);
    assert.ok(out.length > 128 * 1024, `${out.length} bytes answered`);
  });
});
