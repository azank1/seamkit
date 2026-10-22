// Runs the committed action bundle the way GitHub does, `node packages/action/bundle/index.js` with
// INPUT_* and GITHUB_* variables, in a throwaway clone of a local origin, against a local production
// and a local stand-in for the GitHub API. The first deploy must pass, start the ledger and push it;
// the second, which production does not run, must fail as not live and push its run too. A change
// title written as workflow commands must reach the job log only inside a stop-commands fence.
import { execFile, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeProduction } from '../packages/adapters/dist/index.js';

const bundle = fileURLToPath(new URL('../packages/action/bundle/index.js', import.meta.url));
const root = await mkdtemp(join(tmpdir(), 'seamkit-smoke-action-'));
const origin = join(root, 'origin.git');
const dev = join(root, 'dev');
const ci = join(root, 'ci');
const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=dev', '-c', 'user.email=dev@example.invalid', ...args], { cwd, encoding: 'utf8' });
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

const deploy = (commit) => prod.deploy({ 'version.json': JSON.stringify({ schema: 'seamkit.version/1', commit, dirty: false, source: 'git' }) });

/** One job: the bundle in a child process, so that the servers in this one stay responsive. */
async function job(n, deployed, inputs) {
  const event = join(root, `event-${n}.json`);
  const output = join(root, `output-${n}`);
  const summary = join(root, `summary-${n}.md`);
  await writeFile(event, JSON.stringify({ deployment: { sha: deployed }, deployment_status: { state: 'success' }, repository: { default_branch: 'main' } }));
  await writeFile(output, '');
  await writeFile(summary, '');
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    GIT_CONFIG_GLOBAL: join(root, 'gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'ci',
    GIT_AUTHOR_EMAIL: 'ci@example.invalid',
    GIT_COMMITTER_NAME: 'ci',
    GIT_COMMITTER_EMAIL: 'ci@example.invalid',
    GITHUB_API_URL: `http://127.0.0.1:${api.address().port}`,
    GITHUB_REPOSITORY: 'o/r',
    GITHUB_RUN_ID: String(n),
    GITHUB_EVENT_NAME: 'deployment_status',
    GITHUB_EVENT_PATH: event,
    GITHUB_WORKSPACE: ci,
    GITHUB_OUTPUT: output,
    GITHUB_STEP_SUMMARY: summary,
    INPUT_URL: prod.url,
    INPUT_WAIT: '0',
    INPUT_TOKEN: 'smoke',
    ...inputs,
  };
  const before = posts.length;
  const r = await new Promise((resolve) =>
    execFile(process.execPath, [bundle], { cwd: ci, env }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr })),
  );
  process.stdout.write(`${r.stdout}${r.stderr}`);
  const outcome = /^outcome<<(\S+)\n([\s\S]*?)\n\1$/m.exec(await readFile(output, 'utf8'))?.[2];
  return { code: r.code, stdout: r.stdout, post: posts.length === before + 1 ? posts[posts.length - 1] : undefined, outcome, summary: await readFile(summary, 'utf8') };
}

/** Lines holding `word` that a runner would read with commands on: outside every fence, or in one whose token was used before. */
function unfenced(stdout, word) {
  const tokens = new Set();
  let open;
  const bad = [];
  for (const line of stdout.split(/\r\n|\r|\n/)) {
    const start = /^::stop-commands::(.+)$/.exec(line);
    if (open === undefined && start) {
      if (tokens.has(start[1])) bad.push(`token reused: ${start[1]}`);
      tokens.add(start[1]);
      open = start[1];
    } else if (open !== undefined && line === `::${open}::`) open = undefined;
    else if (open === undefined && line.includes(word)) bad.push(line);
  }
  return bad;
}

const ledgerEvents = () => git(origin, 'ls-tree', '-r', '--name-only', 'refs/heads/seamkit/state', 'events/').split('\n').filter((l) => l.length > 0).length;
const problems = [];
const expect = (ok, what) => {
  if (!ok) problems.push(what);
};

try {
  await writeFile(join(root, 'gitconfig'), '');
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  await mkdir(dev);
  git(dev, 'init', '-q', '-b', 'main');
  await writeFile(join(dev, 'README.md'), 'x\n');
  git(dev, 'add', 'README.md');
  git(dev, 'commit', '-q', '-m', 'Initial commit');
  const first = git(dev, 'rev-parse', 'HEAD');
  await writeFile(join(dev, 'a.txt'), 'a\n');
  git(dev, 'add', 'a.txt');
  git(dev, 'commit', '-q', '-m', 'Add the list ##[warning]forged ::warning::forged (#1)');
  const head = git(dev, 'rev-parse', 'HEAD');
  git(dev, 'push', '-q', origin, 'main');
  git(root, 'clone', '-q', `file://${origin}`, ci);

  deploy(head);
  const pass = await job(1, head, { INPUT_LEDGER: 'true' });
  expect(pass.code === 0, `the first deploy exits 0, not ${pass.code}`);
  expect(pass.post?.conclusion === 'success' && pass.post?.head_sha === head, `the first deploy posts a success on ${head}, not ${JSON.stringify(pass.post)}`);
  expect(pass.outcome === 'pass', `the first deploy's outcome is pass, not ${pass.outcome}`);
  expect(pass.summary.startsWith(`### ${pass.post?.name}: ${pass.post?.output?.title}`), `the first deploy writes its job summary, not ${JSON.stringify(pass.summary.slice(0, 80))}`);
  expect(pass.stdout.includes('forged'), 'the first deploy logs the change title');
  expect(unfenced(pass.stdout, 'forged').length === 0, `the first deploy logs a change title outside a fence: ${JSON.stringify(unfenced(pass.stdout, 'forged'))}`);
  const pushed = spawnSync('git', ['ls-remote', origin, 'refs/heads/seamkit/state'], { encoding: 'utf8' }).stdout.trim();
  expect(pushed !== '', 'the first deploy pushes the seamkit/state branch to origin');

  // Production rolls back to the first commit, but the deploy reported is still the head.
  deploy(first);
  const fail = await job(2, head, {});
  expect(fail.code === 1, `the second deploy exits 1, not ${fail.code}`);
  expect(fail.post?.conclusion === 'failure', `the second deploy posts a failure, not ${JSON.stringify(fail.post)}`);
  expect(/1 not live/.test(fail.post?.output?.title ?? ''), `the second deploy's title says not live, not ${fail.post?.output?.title}`);
  expect(fail.outcome === 'fail', `the second deploy's outcome is fail, not ${fail.outcome}`);
  expect(unfenced(fail.stdout, 'forged').length === 0, `the second deploy logs a change title outside a fence: ${JSON.stringify(unfenced(fail.stdout, 'forged'))}`);
  if (pushed !== '') expect(ledgerEvents() === 2, `origin's ledger holds both runs, not ${ledgerEvents()}`);

  if (problems.length > 0) {
    process.stderr.write(`smoke-action:\n${problems.map((p) => `  - ${p}`).join('\n')}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`smoke-action: the bundle posted "${pass.post.output.title}" and then "${fail.post.output.title}", and pushed both runs to the ledger\n`);
  }
} finally {
  await prod.close();
  api.closeAllConnections();
  await new Promise((resolve) => api.close(resolve));
  await rm(root, { recursive: true, force: true });
}
