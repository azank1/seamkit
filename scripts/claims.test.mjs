// Negative controls for the claims lint: each rule must fail on the fixture it exists to catch.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { lint, readRepository } from './claims.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const TEXT = 'seamkit never passes when it examined nothing.';
const row = { id: 'C-P0', text: TEXT, firstRelease: '0.2.0', phase: 'P0', provenBy: ['a.test.ts#never passes on nothing'], strengthenedBy: [] };
const fixture = (over = {}) => ({
  claims: { schema: 'seamkit.claims/1', claims: [row] },
  files: { 'a.test.ts': "it('never passes on nothing', () => {});" },
  documents: { 'README.md': `# seamkit\n\n<!-- claim C-P0 -->\n${TEXT}\n` },
  base: undefined,
  ...over,
});

test('the repository as committed passes the claims lint', () => {
  assert.deepEqual(lint(readRepository(root)), []);
});

test('the fixture without defects passes, so the controls below fail for their own reason', () => {
  assert.deepEqual(lint(fixture()), []);
});

test('a document claiming an id claims.json does not list fails', () => {
  const problems = lint(fixture({ documents: { 'README.md': `<!-- claim C-P3 -->\nseamkit checks certificates.\n` } }));
  assert.deepEqual(problems, ['README.md: claims C-P3, which claims.json does not list']);
});

test('a marked claim whose text differs from its row fails, while markup and line breaks do not count', () => {
  assert.deepEqual(lint(fixture({ documents: { 'README.md': `<!-- claim C-P0 -->\nseamkit never fails.\n` } })), ['README.md: the text after the C-P0 marker is not the claim\'s text']);
  assert.deepEqual(lint(fixture({ documents: { 'site/index.html': `<!-- claim C-P0 --><p>seamkit <b>never</b> passes when\nit examined nothing.</p>` } })), []);
});

test('a row whose proving test does not exist in this release fails', () => {
  const later = { ...row, id: 'C-P3', text: 'Adds certificate checks.', provenBy: ['packages/core/src/cert.test.ts#checks certificates'] };
  const problems = lint(fixture({ claims: { schema: 'seamkit.claims/1', claims: [row, later] } }));
  assert.deepEqual(problems, ['C-P3: proving test file packages/core/src/cert.test.ts does not exist in this release']);
  assert.deepEqual(lint(fixture({ files: { 'a.test.ts': "it('something else', () => {});" } })), ['C-P0: a.test.ts has no test named "never passes on nothing"']);
  assert.deepEqual(lint(fixture({ claims: { schema: 'seamkit.claims/1', claims: [{ ...row, provenBy: [] }] } })), ['C-P0: names no test that proves it']);
});

test('an edited text under an existing id fails, and the same text under a new id passes', () => {
  const base = { schema: 'seamkit.claims/1', claims: [row] };
  const edited = { ...row, text: 'seamkit never passes on nothing at all.' };
  assert.deepEqual(lint(fixture({ base, claims: { schema: 'seamkit.claims/1', claims: [edited] }, documents: {} })), ["C-P0: its text changed; a claim's text is fixed, so give the new text a new id"]);
  assert.deepEqual(lint(fixture({ base, claims: { schema: 'seamkit.claims/1', claims: [row, { ...edited, id: 'C-P0B' }] } })), []);
});

test('malformed files and rows fail with their path', () => {
  assert.deepEqual(lint(fixture({ claims: { claims: [] } })), ['claims.json: not a seamkit.claims/1 document']);
  assert.deepEqual(lint(fixture({ claims: { schema: 'seamkit.claims/1', claims: [{ ...row, colour: 'red' }] } })), ['claims.json claims[0]: unknown field colour']);
  assert.deepEqual(lint(fixture({ claims: { schema: 'seamkit.claims/1', claims: [row, row] }, documents: {} })), ['claims.json claims[1]: id C-P0 is listed twice']);
});
