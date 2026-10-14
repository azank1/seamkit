import { run } from './cli.js';

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

const code = await run(process.argv.slice(2), {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
  readStdin,
  stdinIsTTY: process.stdin.isTTY === true,
  env: process.env,
  cwd: process.cwd(),
  now: () => new Date().toISOString(),
});
process.exitCode = code;
