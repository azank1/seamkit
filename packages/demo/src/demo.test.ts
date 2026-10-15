import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Verdict } from '@seamkit/core';
import { run } from 'seamkit';
import { runDemo, type DemoResult } from './demo.js';

let root: string;
before(async () => {
  root = await mkdtemp(join(tmpdir(), 'seamkit-demo-test-'));
});
after(async () => {
  await rm(root, { recursive: true, force: true });
});

interface Captured {
  result: DemoResult;
  runs: { outcome: string; exitCode: number; verdicts: Verdict[] }[];
  dir: string;
}

async function demo(name: string, options: { recordFirst?: boolean } = {}): Promise<Captured> {
  const dir = join(root, name);
  const out: string[] = [];
  let tick = 0;
  // A clock that moves, so the two runs are distinguishable in the ledger.
  const now = (): string => new Date(Date.UTC(2026, 9, 14, 12, 0, 0) + 1000 * tick++).toISOString();
  const result = await runDemo(dir, { out: (t) => out.push(t), err: () => undefined, now }, ['--json'], options);
  const runs = out
    .join('')
    .split('\n')
    .filter((l) => l.startsWith('{'))
    .map((l) => JSON.parse(l));
  return { result, runs, dir };
}

/** subject -> state, outcome */
function states(verdicts: Verdict[]): Record<string, string> {
  return Object.fromEntries(verdicts.slice(1).map((v) => [v.subject, `${v.state} ${v.outcome}`]));
}

const NOTHING = { 'pr#4': 'nothing_to_prove examined_nothing', 'pr#9': 'nothing_to_prove examined_nothing', 'pr#13': 'nothing_to_prove examined_nothing' };
const ALWAYS_NOT_PROVEN = {
  'pr#11': 'not_proven fail', // its marker exists only in a source comment
  'pr#12': 'not_proven examined_nothing', // a database marker, with no adapter yet
  'pr#18': 'not_proven fail',
  'pr#19': 'not_proven fail',
  'pr#20': 'not_proven fail',
};
const LIVE_THROUGH_14 = Object.fromEntries([1, 2, 3, 5, 6, 7, 8, 10, 14].map((n) => [`pr#${n}`, 'live pass']));

describe('the demo', () => {
  let d: Captured;
  before(async () => {
    d = await demo('notes');
  });

  it('seeds the same history on every machine', () => {
    assert.equal(d.result.merges.get(20), '264b11fa07f30be961285848782ce24dd15a7546');
    assert.equal(d.result.merges.size, 20);
  });

  it('first sorts the changes against the build of pr#17', () => {
    const first = d.runs[0]!;
    assert.equal(first.exitCode, 1);
    assert.deepEqual(states(first.verdicts), {
      ...LIVE_THROUGH_14,
      'pr#15': 'live pass',
      'pr#16': 'live pass',
      'pr#17': 'live pass',
      ...ALWAYS_NOT_PROVEN,
      ...NOTHING,
    });
  });

  it('after the rollback to pr#14, sorts them into live, not live, not proven and nothing to prove', () => {
    const second = d.runs[1]!;
    assert.equal(second.outcome, 'fail');
    assert.deepEqual(states(second.verdicts), {
      ...LIVE_THROUGH_14,
      'pr#15': 'not_live fail',
      'pr#16': 'not_live fail',
      'pr#17': 'not_live fail',
      ...ALWAYS_NOT_PROVEN,
      ...NOTHING,
    });
    const summary = second.verdicts[0]!;
    assert.equal(summary.reasons[0], 'proven live 9 of 20 changes');
    assert.ok(summary.reasons.includes('not live 3: seen live earlier, absent now'));
    assert.ok(summary.reasons.includes('not proven 5: 4 absent or contradicted, 1 could not be read'));
  });

  it('explains each not-proven change in terms an agent can act on', () => {
    const by = new Map(d.runs[1]!.verdicts.map((v) => [v.subject, v]));
    assert.match(by.get('pr#11')!.reasons[0]!, /although production's version e48d7758f6ec contains this change; the text is probably not in the built output/);
    assert.match(by.get('pr#18')!.reasons[0]!, /production runs e48d7758f6ec, which does not contain this change$/);
    assert.match(by.get('pr#17')!.reasons[0]!, /it was seen live at 2026-10-14T12:00:\d\d\.000Z \(event [0-9a-f]{12}\)$/);
  });

  it('replays every recorded verdict, and the ledger verifies', async () => {
    assert.equal(d.result.codes.replay, 0);
    const out: string[] = [];
    const code = await run(['state', 'verify', '--json'], {
      out: (t) => out.push(t),
      err: () => undefined,
      readStdin: async () => '',
      stdinIsTTY: true,
      env: {},
      cwd: d.dir,
      now: () => '2026-10-14T13:00:00.000Z',
    });
    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(out.join('')).verdicts[0].examined, [{ item: 'event files', count: 2 }]);
  });

  it('without the recorded first run, cannot tell not live from not proven (negative control)', async () => {
    const control = await demo('control', { recordFirst: false });
    const second = states(control.runs[1]!.verdicts);
    assert.equal(second['pr#15'], 'not_proven fail');
    assert.equal(second['pr#16'], 'not_proven fail');
    assert.equal(second['pr#17'], 'not_proven fail');
  });
});
