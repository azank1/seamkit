// Installs the packed `seamkit` package into an empty project, the way a user would, and runs it: the version,
// a stamp, and an audit against a production that does not answer, which must examine nothing (exit 3), never pass.
// Run `npm run pack:cli` first.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const release = fileURLToPath(new URL('../release/seamkit/', import.meta.url));
const { version } = JSON.parse(await readFile(join(release, 'package.json'), 'utf8'));
const dir = await mkdtemp(join(tmpdir(), 'seamkit-smoke-'));
const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', SEAMKIT_URL: '' };
const fail = (message) => {
  process.stderr.write(`smoke: ${message}\n`);
  process.exitCode = 1;
};

try {
  const tgz = execFileSync('npm', ['pack', '--silent', '--pack-destination', dir], { cwd: release, encoding: 'utf8' }).trim().split('\n').pop();
  const app = join(dir, 'app');
  execFileSync('git', ['init', '-q', '-b', 'main', app], { env });
  await writeFile(join(app, 'package.json'), '{ "name": "app", "private": true }\n');
  execFileSync('npm', ['install', '--no-audit', '--no-fund', '--silent', join(dir, tgz)], { cwd: app, env });
  execFileSync('git', ['add', 'package.json'], { cwd: app, env });
  execFileSync('git', ['-c', 'user.name=smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '-q', '-m', 'init'], { cwd: app, env });
  const seamkit = (...args) => spawnSync(join(app, 'node_modules', '.bin', 'seamkit'), args, { cwd: app, env, encoding: 'utf8' });

  const v = seamkit('version');
  if (v.status !== 0 || v.stdout.trim() !== version) fail(`"seamkit version" printed ${JSON.stringify(v.stdout)} with exit ${v.status}, expected ${version}`);

  const stamp = seamkit('stamp');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: app, encoding: 'utf8' }).trim();
  if (stamp.status !== 0 || JSON.parse(stamp.stdout).commit !== head) fail(`"seamkit stamp" gave exit ${stamp.status}: ${stamp.stdout}${stamp.stderr}`);

  const audit = seamkit('audit', '--url', 'http://127.0.0.1:9/');
  if (audit.status !== 3 || !/EXAMINED NOTHING/.test(audit.stdout)) fail(`"seamkit audit" against a closed port gave exit ${audit.status}, expected 3:\n${audit.stdout}${audit.stderr}`);

  if (process.exitCode !== 1) process.stdout.write(`smoke: ${tgz} installs and runs (version, stamp, audit exit 3)\n`);
} finally {
  await rm(dir, { recursive: true, force: true });
}
