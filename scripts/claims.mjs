// The claims lint. claims.json lists every public claim seamkit makes, each with the tests that
// prove it in this release; a claim enters only in the release that proves it, and its text never
// changes (a changed claim is a new id). In prose, a claim is quoted after a marker,
//   <!-- claim C-P0 -->
// and the text that follows the marker, up to the next blank line or tag, must be the row's text.
// Usage: node scripts/claims.mjs [--base <claims.json of the base branch>]. Exits 1 on any problem.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIELDS = ['id', 'text', 'firstRelease', 'phase', 'provenBy', 'strengthenedBy'];
const MARKER = /<!--\s*claim\s+(\S+)\s*-->/g;

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const squash = (text) => text.replace(/<[^>]*>/g, ' ').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();

// files: path -> contents, for every test file a row cites and every document to lint.
// base: the base branch's claims.json, parsed, or undefined when the file is new.
export function lint({ claims, files, documents, base }) {
  const problems = [];
  if (claims?.schema !== 'seamkit.claims/1' || !Array.isArray(claims.claims)) return ['claims.json: not a seamkit.claims/1 document'];
  const byId = new Map();
  for (const [i, row] of claims.claims.entries()) {
    const at = `claims.json claims[${i}]`;
    const extra = Object.keys(row).filter((k) => !FIELDS.includes(k));
    if (extra.length > 0) problems.push(`${at}: unknown field ${extra.join(', ')}`);
    if (typeof row.id !== 'string' || !/^C-[A-Z0-9-]+$/.test(row.id)) { problems.push(`${at}: id must look like C-P0`); continue; }
    if (byId.has(row.id)) problems.push(`${at}: id ${row.id} is listed twice`);
    byId.set(row.id, row);
    if (typeof row.text !== 'string' || row.text.trim() === '') problems.push(`${row.id}: has no text`);
    if (!Array.isArray(row.provenBy) || row.provenBy.length === 0) { problems.push(`${row.id}: names no test that proves it`); continue; }
    for (const ref of row.provenBy) {
      const [file, name] = String(ref).split('#');
      const source = files[file];
      if (source === undefined) problems.push(`${row.id}: proving test file ${file} does not exist in this release`);
      else if (!name || !new RegExp(`\\b(?:it|test)\\(\\s*(['"\`])${escapeRegExp(name)}\\1`).test(source)) problems.push(`${row.id}: ${file} has no test named "${name}"`);
    }
  }
  for (const row of base?.claims ?? []) {
    const now = byId.get(row.id);
    if (now !== undefined && now.text !== row.text) problems.push(`${row.id}: its text changed; a claim's text is fixed, so give the new text a new id`);
  }
  for (const [path, text] of Object.entries(documents)) {
    for (const match of text.matchAll(MARKER)) {
      const row = byId.get(match[1]);
      if (row === undefined) { problems.push(`${path}: claims ${match[1]}, which claims.json does not list`); continue; }
      const after = text.slice(match.index + match[0].length).replace(/^\s+/, '');
      const quoted = after.split(/\n\s*\n|<!--/)[0];
      if (squash(quoted) !== squash(row.text)) problems.push(`${path}: the text after the ${row.id} marker is not the claim's text`);
    }
  }
  return problems;
}

function walk(dir, keep, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, keep, out);
    else if (keep(path)) out.push(path);
  }
  return out;
}

export function readRepository(root, basePath) {
  const read = (path) => readFileSync(join(root, path), 'utf8');
  const claims = JSON.parse(read('claims.json'));
  const files = {};
  for (const row of claims.claims ?? []) for (const ref of row.provenBy ?? []) {
    const file = String(ref).split('#')[0];
    if (existsSync(join(root, file))) files[file] = read(file);
  }
  const documents = {};
  const paths = ['README.md', ...walk(join(root, 'docs'), (p) => p.endsWith('.md')), ...walk(join(root, 'site'), (p) => p.endsWith('.html'))];
  for (const path of paths) {
    const relative = path.startsWith(root) ? path.slice(root.length).replace(/^\//, '') : path;
    if (existsSync(join(root, relative))) documents[relative] = read(relative);
  }
  const base = basePath !== undefined && existsSync(basePath) ? JSON.parse(readFileSync(basePath, 'utf8')) : undefined;
  return { claims, files, documents, base };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--base');
  const root = fileURLToPath(new URL('..', import.meta.url));
  const repository = readRepository(root, at > 0 ? process.argv[at + 1] : undefined);
  const problems = lint(repository);
  for (const problem of problems) process.stderr.write(`claims: ${problem}\n`);
  if (problems.length > 0) process.exit(1);
  process.stdout.write(`claims: ${repository.claims.claims.length} claims, ${Object.keys(repository.documents).length} documents checked${repository.base ? ' against the base branch' : ''}\n`);
}
