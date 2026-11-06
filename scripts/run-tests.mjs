// Runs the compiled tests and the scripts' own tests, and only those. Node 22 strips TypeScript types natively, so its default
// test discovery also picks up the src/*.test.ts sources; passing an explicit file list keeps the
// suite identical on every supported Node version. Finding no test files is a failure, not a pass.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const files = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (path.endsWith('.test.js')) files.push(path);
  }
}
for (const pkg of readdirSync('packages')) {
  const dist = join('packages', pkg, 'dist');
  if (existsSync(dist)) walk(dist);
}
// The repository's own scripts carry their tests beside them, as plain modules.
for (const name of readdirSync('scripts')) if (name.endsWith('.test.mjs')) files.push(join('scripts', name));
files.sort();
if (files.length === 0) {
  console.error('run-tests: no compiled test files found under packages/*/dist; run "npm run build" first');
  process.exit(1);
}
// A test that hangs fails rather than holding the run open. From Node 24 the limit applies to each
// test, so two minutes is ample; Node 20 and 22 apply it to each test file as a whole, so there it
// is ten minutes, far above the slowest file. Flags given here come after, so they can change it.
const major = Number(process.versions.node.split('.')[0]);
const timeout = major >= 24 ? 120000 : 600000;
// Every test process loads the egress guard, so a test that reaches past this machine fails (NFR2).
const result = spawnSync(process.execPath, ['--import', './scripts/no-egress.mjs', '--test', `--test-timeout=${timeout}`, ...process.argv.slice(2), ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
