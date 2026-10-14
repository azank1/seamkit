import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDemo } from './demo.js';

// Runs the demo in a temporary directory, which is removed afterwards unless --keep is given.
const keep = process.argv.includes('--keep');
const dir = await mkdtemp(join(tmpdir(), 'seamkit-demo-'));
try {
  await runDemo(join(dir, 'notes'), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
    now: () => new Date().toISOString(),
  });
} finally {
  if (keep) process.stderr.write(`\nthe demo repository is kept at ${join(dir, 'notes')}\n`);
  else await rm(dir, { recursive: true, force: true });
}
