// Runs the committed action bundle the way GitHub does, `node packages/action/bundle/index.js` with
// INPUT_* and GITHUB_* variables, in a throwaway repository against a local production and a local
// stand-in for the GitHub API. Fails unless the bundle passes and posts a successful check run.
import { execFile, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeProduction } from '../packages/adapters/dist/index.js';

const bundle = fileURLToPath(new URL('../packages/action/bundle/index.js', import.meta.url));
const dir = await mkdtemp(join(tmpdir(), 'seamkit-smoke-action-'));
const git = (...args) => {
  const r = spawnSync('git', ['-c', 'user.name=dev', '-c', 'user.email=dev@example.invalid', ...args], { cwd: dir, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

const prod = await FakeProduction.start();
const posts = [];
const api = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    posts.push(JSON.parse(body));
    res.writeHead(201, { 'content-type': 'application/json' }).end('{"html_url":"https://github.example/check"}');
  });
});
await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));

try {
  git('init', '-q', '-b', 'main');
  await writeFile(join(dir, 'README.md'), 'x\n');
  git('add', 'README.md');
  git('commit', '-q', '-m', 'Initial commit');
  await writeFile(join(dir, 'a.txt'), 'a\n');
  git('add', 'a.txt');
  git('commit', '-q', '-m', 'Add the list (#1)');
  const head = git('rev-parse', 'HEAD');
  prod.deploy({ 'version.json': JSON.stringify({ schema: 'seamkit.version/1', commit: head, dirty: false, source: 'git' }) });
  const event = join(dir, '.event.json');
  const output = join(dir, '.output');
  await writeFile(event, JSON.stringify({ deployment: { sha: head }, deployment_status: { state: 'success' } }));
  await writeFile(output, '');

  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    GITHUB_API_URL: `http://127.0.0.1:${api.address().port}`,
    GITHUB_REPOSITORY: 'o/r',
    GITHUB_RUN_ID: '1',
    GITHUB_EVENT_NAME: 'deployment_status',
    GITHUB_EVENT_PATH: event,
    GITHUB_WORKSPACE: dir,
    GITHUB_OUTPUT: output,
    INPUT_URL: prod.url,
    INPUT_WAIT: '0',
    INPUT_LEDGER: 'auto',
    INPUT_TOKEN: 'smoke',
  };
  // The bundle runs in a child process, so the servers in this one must stay responsive meanwhile.
  const r = await new Promise((resolve) =>
    execFile(process.execPath, [bundle], { cwd: dir, env }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr })),
  );
  const outputs = await readFile(output, 'utf8');
  const post = posts[0];
  const ok = r.code === 0 && post?.conclusion === 'success' && post?.head_sha === head && /^outcome<<.*\npass\n/m.test(outputs);
  process.stdout.write(`${r.stdout}${r.stderr}`);
  if (!ok) {
    process.stderr.write(`smoke-action: expected exit 0 and a successful check run on ${head}; got exit ${r.code}, check run ${JSON.stringify(post)}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`smoke-action: the bundle passed and posted "${post.output.title}" on ${head.slice(0, 12)}\n`);
  }
} finally {
  await prod.close();
  api.closeAllConnections();
  await new Promise((resolve) => api.close(resolve));
  await rm(dir, { recursive: true, force: true });
}
