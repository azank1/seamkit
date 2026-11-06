// The cross-surface differential test: for every fixture, the MCP tool's answer must be byte for
// byte what the CLI prints for the same question. The fixtures are the demo's twenty pull requests,
// with production serving several builds, a rollback, and a ledger, asked through every tool.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeProduction } from '@seamkit/adapters';
import { run, type Io } from '@seamkit/cli';
import { callTool } from '@seamkit/cli/mcp';
import { buildAt } from './build.js';
import { seedDemo } from './seed.js';

const AT = '2026-11-06T09:00:00.000Z';
let dir: string;
let prod: FakeProduction;
let merges: Map<number, string>;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'seamkit-mcp-diff-'));
  merges = await seedDemo(dir);
  prod = await FakeProduction.start();
});

after(async () => {
  await prod.close();
  await rm(dir, { recursive: true, force: true });
});

async function cli(args: string[]): Promise<{ code: number; out: string }> {
  let out = '';
  const io: Io = { out: (t) => void (out += t), err: () => {}, readStdin: async () => '', stdinIsTTY: true, env: {}, cwd: dir, now: () => AT };
  return { code: await run(args, io), out };
}

describe('CLI and MCP give the same answer', () => {
  it('matches byte for byte over at least 30 fixtures', async () => {
    const opts = { cwd: dir, urls: [prod.url], env: {}, now: () => AT };
    const fixtures: { deploy: number | 'none'; tool: string; args: Record<string, string | number | null>; argv: string[] }[] = [];
    const add = (deploy: number | 'none', tool: string, args: Record<string, string | number | null>, argv: string[]): void => void fixtures.push({ deploy, tool, args, argv });
    for (const deploy of [1, 10, 14, 17, 20, 'none'] as const) {
      add(deploy, 'audit', {}, ['audit', '--json', '--no-record', '--url', prod.url]);
      add(deploy, 'audit', { last: 5 }, ['audit', '--json', '--no-record', '--url', prod.url, '--last', '5']);
      add(deploy, 'readback', { pr: 11 }, ['readback', '--json', '--no-record', '--url', prod.url, '--pr', '11']);
      add(deploy, 'readback', { pr: 17 }, ['readback', '--json', '--no-record', '--url', prod.url, '--pr', '17']);
      add(deploy, 'readback', { last: 3, branch: 'main' }, ['readback', '--json', '--no-record', '--url', prod.url, '--last', '3', '--branch', 'main']);
      add(deploy, 'readback', { deployed: (merges.get(14) as string).slice(0, 12) }, ['readback', '--json', '--no-record', '--url', prod.url, '--deployed', (merges.get(14) as string).slice(0, 12)]);
    }
    fixtures.push({ deploy: 'none', tool: 'readback', args: { commit: (merges.get(3) as string).slice(0, 10) }, argv: ['readback', '--json', '--no-record', '--url', prod.url, '--commit', (merges.get(3) as string).slice(0, 10)] });
    assert.ok(fixtures.length >= 30, `${fixtures.length} fixtures`);

    const codes = new Set<number>();
    let deployed: number | 'none' | undefined;
    for (const f of fixtures) {
      if (f.deploy !== deployed) {
        prod.deploy(f.deploy === 'none' ? {} : await buildAt(dir, merges.get(f.deploy) as string));
        deployed = f.deploy;
      }
      const viaCli = await cli(f.argv);
      const viaMcp = await callTool(f.tool, f.args, opts);
      assert.equal(viaMcp.isError, false, `${f.tool} ${JSON.stringify(f.args)} at ${f.deploy}: ${viaMcp.content[0]?.text}`);
      assert.equal(viaMcp.content[0]!.text, viaCli.out, `${f.tool} ${JSON.stringify(f.args)} at ${f.deploy}`);
      assert.deepEqual(viaMcp.structuredContent, JSON.parse(viaCli.out));
      assert.equal(viaMcp.structuredContent!['exitCode'], viaCli.code);
      codes.add(viaCli.code);
    }
    // The fixtures reach a pass, a fail and examined nothing, so the comparison covers each outcome.
    assert.deepEqual([...codes].sort(), [0, 1, 3]);
  });

  it('matches for replay and the ledger check once runs are recorded', async () => {
    assert.equal((await cli(['state', 'init'])).code, 0);
    prod.deploy(await buildAt(dir, merges.get(17) as string));
    await cli(['readback', '--url', prod.url]);
    prod.deploy(await buildAt(dir, merges.get(14) as string));
    await cli(['readback', '--url', prod.url]);
    const opts = { cwd: dir, urls: [prod.url], env: {}, now: () => AT };
    for (const [tool, argv] of [['replay', ['replay', '--json']], ['ledger_verify', ['state', 'verify', '--json']]] as const) {
      const viaCli = await cli([...argv]);
      const viaMcp = await callTool(tool, {}, opts);
      assert.equal(viaMcp.content[0]!.text, viaCli.out, tool);
      assert.equal(viaCli.code, 0, viaCli.out);
    }
  });
});
