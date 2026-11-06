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

const argv = process.argv.slice(2);
if (argv[0] === 'mcp') {
  // Standard output carries protocol messages only; everything else goes to standard error.
  const { serve, serverOptions, MCP_USAGE } = await import('./mcp.js');
  let options;
  try {
    options = serverOptions(argv.slice(1), process.env, process.cwd(), () => new Date().toISOString());
  } catch (err) {
    process.stderr.write(`seamkit: ${(err as Error).message}\nUsage: ${MCP_USAGE}\n`);
    process.exit(2);
  }
  if (options.urls.length === 0) process.stderr.write('seamkit mcp: no production address; tools that read production will refuse until the server is started with --url or SEAMKIT_URL\n');
  await serve(process.stdin, process.stdout, options, (text) => process.stderr.write(text));
  // No process.exit: on a pipe that writes asynchronously it would cut off answers still queued.
  // With standard input ended and every call answered, the process ends once the output drains.
} else {
const code = await run(argv, {
  out: (text) => process.stdout.write(shown(text)),
  err: (text) => process.stderr.write(shown(text)),
  readStdin,
  stdinIsTTY: process.stdin.isTTY === true,
  env: process.env,
  cwd: process.cwd(),
  now: () => new Date().toISOString(),
});
process.exitCode = code;
}
