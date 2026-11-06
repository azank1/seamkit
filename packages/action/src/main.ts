import { randomUUID } from 'node:crypto';
import { runAction } from './action.js';
import { appendSummary, plainText, setOutput } from './github.js';

/** Workflow commands carry their message on one line; GitHub decodes these escapes. */
const escape = (s: string): string => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

try {
  process.exitCode = await runAction({
    env: process.env,
    now: () => new Date().toISOString(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    fetch: (url, init) => fetch(url, init),
    log: (line) => process.stdout.write(plainText(line, randomUUID())),
    warn: (line) => process.stdout.write(`::warning title=seamkit::${escape(line)}\n`),
  });
} catch (err) {
  // An error of the action's own is exit 2, as in seamkit: exit 1 would read as a verdict of fail.
  const message = `seamkit: the action failed: ${(err as Error).stack ?? String(err)}`;
  process.stdout.write(`::error title=seamkit::${escape(message)}\n`);
  process.exitCode = 2;
  try {
    await setOutput(process.env['GITHUB_OUTPUT'] ?? '', 'outcome', 'error');
    await setOutput(process.env['GITHUB_OUTPUT'] ?? '', 'exit-code', '2');
    await appendSummary(process.env['GITHUB_STEP_SUMMARY'] ?? '', `### seamkit: the action failed\n\n\`\`\`text\n${message}\n\`\`\`\n`);
  } catch {
    // The annotation above already says what happened.
  }
}
