import { runAction } from './action.js';

/** Workflow commands carry their message on one line; GitHub decodes these escapes. */
const escape = (s: string): string => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

const code = await runAction({
  env: process.env,
  now: () => new Date().toISOString(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  fetch: (url, init) => fetch(url, init),
  log: (line) => process.stdout.write(`${line}\n`),
  warn: (line) => process.stdout.write(`::warning title=seamkit::${escape(line)}\n`),
});
process.exitCode = code;
