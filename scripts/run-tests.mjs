// Runs the compiled tests, and only those. Node 22 strips TypeScript types natively, so its default
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
files.sort();
if (files.length === 0) {
  console.error('run-tests: no compiled test files found under packages/*/dist; run "npm run build" first');
  process.exit(1);
}
const result = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
