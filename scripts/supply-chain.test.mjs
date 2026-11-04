// Negative controls for the supply-chain gate and the egress guard: each check must fail on the
// fixture it exists to catch, or a green gate proves nothing.
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { connectHost, isLoopback } from './no-egress.mjs';
import { judge, judgeLicence, readRepository } from './supply-chain.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const YAML_LICENCE = 'Copyright Eemeli Aro <eemeli@gmail.com>\n\nPermission to use, copy, modify...';
const yaml = { name: 'yaml', version: '2.9.1', license: 'ISC', shipped: true };
const notice = { file: 'bundle/THIRD_PARTY_NOTICES', text: `bundles\n\nyaml 2.9.1 (ISC)\n\n${YAML_LICENCE}\n` };
const base = { packages: [yaml], allowed: ['yaml'], notices: [notice], licenceTexts: { yaml: YAML_LICENCE } };

test('the repository as installed passes the gate', () => {
  const repository = readRepository(root);
  assert.ok(repository.packages.length > 0, 'no packages were read; run npm ci first');
  assert.deepEqual(judge(repository), []);
});

test('the fixture without defects passes, so the controls below fail for their own reason', () => {
  assert.deepEqual(judge(base), []);
});

test('an AGPL dependency fails, shipped or dev-only', () => {
  for (const shipped of [true, false]) {
    const agpl = { name: 'copyleft', version: '1.0.0', license: 'AGPL-3.0-only', shipped };
    const problems = judge({ ...base, packages: [yaml, agpl], allowed: ['yaml', 'copyleft'], notices: [], licenceTexts: { ...base.licenceTexts, copyleft: 'x' } });
    assert.ok(problems.some((p) => p.startsWith('copyleft@1.0.0: licence AGPL-3.0-only is not allowed')), problems.join('\n'));
  }
});

test('MPL-2.0 passes only when it is not shipped', () => {
  assert.equal(judgeLicence('MPL-2.0', false), 'ok');
  assert.match(judgeLicence('MPL-2.0', true), /Category B, which may be used but never bundled/);
});

test('source-available, field-of-use and unknown licences fail', () => {
  for (const id of ['Elastic-2.0', 'SSPL-1.0', 'BUSL-1.1', 'FSL-1.1-MIT', 'FCL-1.0-ALv2', 'MIT AND Commons-Clause', 'LicenseRef-Proprietary', 'SEE LICENSE IN LICENSE', 'Apache-2.0 WITH LLVM-exception', '', undefined]) {
    for (const shipped of [true, false]) assert.notEqual(judgeLicence(id, shipped), 'ok', `${id} (shipped ${shipped})`);
  }
});

test('a dual licence passes when one alternative is allowed', () => {
  assert.equal(judgeLicence('(MIT OR GPL-3.0-only)', true), 'ok');
  assert.notEqual(judgeLicence('MIT AND GPL-3.0-only', true), 'ok');
});

test('a shipped package outside the allowlist fails, and a model SDK fails by name', () => {
  const extra = (name) => judge({ ...base, packages: [yaml, { name, version: '1.0.0', license: 'MIT', shipped: true }], notices: [], licenceTexts: { ...base.licenceTexts, [name]: 'x' } });
  assert.ok(extra('left-pad').some((p) => p.includes('not in scripts/shipped-dependencies.json')));
  for (const sdk of ['openai', '@anthropic-ai/sdk', '@google/genai', '@ai-sdk/openai', 'ollama']) {
    assert.ok(extra(sdk).some((p) => p.includes('ships a model SDK')), sdk);
  }
  // A model SDK used only in development does not reach the verdict path, so the allowlist does not judge it.
  assert.deepEqual(judge({ ...base, packages: [yaml, { name: 'openai', version: '1.0.0', license: 'Apache-2.0', shipped: false }] }), []);
});

test('notices that drop a shipped package, or its licence text, fail', () => {
  const unnamed = judge({ ...base, notices: [{ ...notice, text: notice.text.replace('yaml 2.9.1 (ISC)', '') }] });
  assert.ok(unnamed.some((p) => p.includes('does not name yaml 2.9.1 (ISC)')), unnamed.join('\n'));
  const stripped = judge({ ...base, notices: [{ ...notice, text: notice.text.replace(YAML_LICENCE, '') }] });
  assert.ok(stripped.some((p) => p.includes('does not carry the licence text of yaml')), stripped.join('\n'));
  assert.ok(judge({ ...base, licenceTexts: {} }).some((p) => p.includes('has no licence file')));
});

test('connect targets are read from every calling convention', () => {
  assert.equal(connectHost([{ host: 'api.example.com', port: 443 }]), 'api.example.com');
  assert.equal(connectHost([[{ host: '127.0.0.1', port: 80 }, () => {}]]), '127.0.0.1');
  assert.equal(connectHost([443, 'api.example.com']), 'api.example.com');
  assert.equal(connectHost([443]), 'localhost');
  assert.equal(connectHost(['/tmp/socket']), undefined);
  assert.equal(connectHost([{ path: '/tmp/socket' }]), undefined);
  for (const host of ['localhost', '127.0.0.1', '127.1.2.3', '::1', '[::1]', '::ffff:127.0.0.1']) assert.ok(isLoopback(host), host);
  for (const host of ['10.0.0.1', '127.example.com', 'localhost.example.com', '::2']) assert.ok(!isLoopback(host), host);
});

test('under the guard, a call to a model endpoint fails and a loopback call does not', () => {
  const script = `
    import { createServer } from 'node:http';
    const server = createServer((_, res) => res.end('ok'));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const local = await (await fetch('http://127.0.0.1:' + server.address().port)).text();
    server.close();
    let outside = 'reached';
    try { await fetch('https://api.anthropic.com/v1/messages', { method: 'POST' }); } catch (e) { outside = e.cause?.code ?? e.code ?? String(e); }
    console.log(JSON.stringify({ local, outside }));`;
  const run = spawnSync(process.execPath, ['--import', fileURLToPath(new URL('./no-egress.mjs', import.meta.url)), '--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), { local: 'ok', outside: 'SEAMKIT_EGRESS' });
});
