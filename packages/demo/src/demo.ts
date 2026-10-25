import { FakeProduction } from '@seamkit/adapters';
import { run, type Io } from '@seamkit/cli';
import { buildAt } from './build.js';
import { FIRST_DEPLOY, ROLLBACK_TO } from './history.js';
import { seedDemo } from './seed.js';

export interface DemoIo {
  out(text: string): void;
  err(text: string): void;
  now(): string;
}

export interface DemoResult {
  merges: Map<number, string>;
  url: string;
  /** Exit codes of the two readbacks, then of the replay of the ledger. */
  codes: { first: number; second: number; replay: number };
}

/**
 * Seeds the demo repository in `dir`, serves the build of pull request 17 from a fake production
 * and records a readback, then rolls production back to the build of pull request 14 and reads
 * back again. Changes 15 to 17 were seen live by the first run, so the second calls them not live
 * rather than merely not proven. `readbackArgs` is appended to both readbacks, for example --json;
 * `recordFirst: false` keeps the first run out of the ledger, which is the demo's negative control.
 */
export async function runDemo(dir: string, io: DemoIo, readbackArgs: readonly string[] = [], options: { recordFirst?: boolean } = {}): Promise<DemoResult> {
  const merges = await seedDemo(dir);
  const prod = await FakeProduction.start();
  const cli: Io = { out: io.out, err: io.err, readStdin: async () => '', stdinIsTTY: true, env: {}, cwd: dir, now: io.now };
  const say = (text: string): void => io.err(`\n== ${text}\n`);
  try {
    await run(['state', 'init'], cli);
    prod.deploy(await buildAt(dir, merges.get(FIRST_DEPLOY) as string));
    say(`production serves the build of pr#${FIRST_DEPLOY}; reading back the last 20 changes and recording what was seen`);
    const first = await run(['readback', '--url', prod.url, ...readbackArgs, ...(options.recordFirst === false ? ['--no-record'] : [])], cli);
    prod.deploy(await buildAt(dir, merges.get(ROLLBACK_TO) as string));
    say(`production is rolled back to the build of pr#${ROLLBACK_TO}; reading back again`);
    const second = await run(['readback', '--url', prod.url, ...readbackArgs], cli);
    say('replaying every recorded verdict from the ledger');
    const replay = await run(['replay', ...(readbackArgs.includes('--json') ? ['--json'] : [])], cli);
    return { merges, url: prod.url, codes: { first, second, replay } };
  } finally {
    await prod.close();
  }
}
