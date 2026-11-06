import { inert, run } from './cli.js';

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (c: Buffer) => chunks.push(c));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', reject);
  });
}

// A reader that stops early, as in "seamkit audit | head", is not an error; the exit code still says the verdict.
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code !== 'EPIPE') throw err;
});

// A GitHub Actions runner reads workflow commands from a step's output; reports must not hold any.
const shown = process.env['GITHUB_ACTIONS'] === 'true' ? inert : (text: string): string => text;

const code = await run(process.argv.slice(2), {
  out: (text) => process.stdout.write(shown(text)),
  err: (text) => process.stderr.write(shown(text)),
  readStdin,
  stdinIsTTY: process.stdin.isTTY === true,
  env: process.env,
  cwd: process.cwd(),
  now: () => new Date().toISOString(),
});
process.exitCode = code;
