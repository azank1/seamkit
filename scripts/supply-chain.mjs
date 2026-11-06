// The supply-chain gate: judges every installed third-party package's licence, the set of packages
// seamkit ships to users, and the notices that ship beside each bundle. Run after `npm ci` (and, for
// the notices, after `npm run pack:cli` and `npm run pack:action`); it exits 1 on any problem and
// names each one. The judging functions are pure, so the negative controls in supply-chain.test.mjs
// feed them fixtures instead of a broken repository.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ASF Category A: may be bundled into an Apache-2.0 release. https://www.apache.org/legal/resolved.html
export const CATEGORY_A = new Set([
  '0BSD', 'Apache-2.0', 'BlueOak-1.0.0', 'BSD-2-Clause', 'BSD-3-Clause', 'CC0-1.0', 'ISC', 'MIT', 'MIT-0',
  'PSF-2.0', 'Python-2.0', 'Unlicense', 'X11', 'Zlib',
]);
// ASF Category B: may be used, never bundled. seamkit allows them only in packages it does not ship.
export const CATEGORY_B = new Set(['CDDL-1.0', 'CDDL-1.1', 'EPL-1.0', 'EPL-2.0', 'MPL-1.1', 'MPL-2.0']);
// Packages whose name says they call a model. The verdict path never calls one (NFR2), so none may ship.
const MODEL_SDK = /^(?:openai|@anthropic-ai\/|@google\/genai$|@google\/generative-ai$|@google-cloud\/vertexai$|@mistralai\/|cohere-ai$|groq-sdk$|ollama$|@huggingface\/inference$|replicate$|together-ai$|langchain$|@langchain\/|ai$|@ai-sdk\/|llamaindex$)/;

// Splits a SPDX expression into its alternatives, each a list of licences that must all hold. Anything
// this does not understand (WITH exceptions, LicenseRef-*, "SEE LICENSE IN", a missing field) is an
// unknown licence and fails: a gate that guesses is not a gate.
export function alternatives(expression) {
  if (typeof expression !== 'string' || expression.trim() === '') return undefined;
  const text = expression.trim().replace(/^\((.*)\)$/, '$1');
  if (/[()]/.test(text) || /\bWITH\b/.test(text)) return undefined;
  return text.split(/\s+OR\s+/).map((alt) => alt.split(/\s+AND\s+/).map((id) => id.trim()));
}

// The verdict for one package's licence: 'ok', or the reason it may not be where it is.
export function judgeLicence(expression, shipped) {
  const alts = alternatives(expression);
  if (alts === undefined) return `licence ${JSON.stringify(expression ?? null)} is not a SPDX expression this gate can judge`;
  const allowed = shipped ? CATEGORY_A : new Set([...CATEGORY_A, ...CATEGORY_B]);
  if (alts.some((ids) => ids.every((id) => allowed.has(id)))) return 'ok';
  if (shipped && alts.some((ids) => ids.every((id) => CATEGORY_A.has(id) || CATEGORY_B.has(id)))) {
    return `licence ${expression} is ASF Category B, which may be used but never bundled`;
  }
  return `licence ${expression} is not allowed (ASF Category A${shipped ? '' : ' or B'} only)`;
}

// packages: [{ name, version, license, shipped }], where shipped means it reaches users (not dev-only).
// allowed: the names seamkit may ship. notices: [{ file, text }] for each bundle's THIRD_PARTY_NOTICES.
// licenceTexts: name -> the package's own licence file text, which each notices file must carry verbatim.
export function judge({ packages, allowed, notices = [], licenceTexts = {} }) {
  const problems = [];
  for (const pkg of packages) {
    const verdict = judgeLicence(pkg.license, pkg.shipped);
    if (verdict !== 'ok') problems.push(`${pkg.name}@${pkg.version}: ${verdict}`);
    if (!pkg.shipped) continue;
    if (MODEL_SDK.test(pkg.name)) problems.push(`${pkg.name}@${pkg.version}: ships a model SDK, and seamkit's verdicts never call a model`);
    else if (!allowed.includes(pkg.name)) problems.push(`${pkg.name}@${pkg.version}: ships to users but is not in scripts/shipped-dependencies.json`);
  }
  for (const { file, text } of notices) {
    for (const pkg of packages.filter((p) => p.shipped)) {
      if (!text.includes(`${pkg.name} ${pkg.version} (${pkg.license})`)) problems.push(`${file}: does not name ${pkg.name} ${pkg.version} (${pkg.license})`);
      const licence = licenceTexts[pkg.name];
      if (licence === undefined) problems.push(`${pkg.name}@${pkg.version}: has no licence file to carry into the notices`);
      else if (!text.includes(licence.trim())) problems.push(`${file}: does not carry the licence text of ${pkg.name}`);
    }
  }
  return problems;
}

// Reads the repository as `npm ci` left it: the lockfile says what is dev-only, each installed
// package.json says its licence, because the lockfile need not record one.
export function readRepository(root) {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const packages = [];
  const licenceTexts = {};
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if (!path.startsWith('node_modules/') || entry.link) continue;
    const dir = join(root, path);
    const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
    // Optional platform builds for other systems are not installed; they are dev-only here, and judged where they are.
    if (!existsSync(join(dir, 'package.json'))) {
      if (entry.optional && entry.dev) continue;
      packages.push({ name, version: entry.version, license: undefined, shipped: !entry.dev });
      continue;
    }
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const license = typeof manifest.license === 'string' ? manifest.license : undefined;
    packages.push({ name, version: manifest.version, license, shipped: !entry.dev });
    if (!entry.dev) {
      const file = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'LICENCE'].find((f) => existsSync(join(dir, f)));
      if (file !== undefined) licenceTexts[name] = readFileSync(join(dir, file), 'utf8');
    }
  }
  const allowed = JSON.parse(readFileSync(join(root, 'scripts/shipped-dependencies.json'), 'utf8'));
  const notices = ['packages/action/bundle/THIRD_PARTY_NOTICES', 'release/seamkit/THIRD_PARTY_NOTICES']
    .filter((file) => existsSync(join(root, file)))
    .map((file) => ({ file, text: readFileSync(join(root, file), 'utf8') }));
  return { packages, allowed, notices, licenceTexts };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const repository = readRepository(root);
  const problems = judge(repository);
  const shipped = repository.packages.filter((p) => p.shipped).length;
  if (problems.length > 0) {
    for (const problem of problems) process.stderr.write(`supply-chain: ${problem}\n`);
    process.exit(1);
  }
  if (repository.packages.length === 0) {
    process.stderr.write('supply-chain: no installed packages were judged; run npm ci first\n');
    process.exit(3);
  }
  process.stdout.write(`supply-chain: ${repository.packages.length} packages judged (${shipped} shipped), ${repository.notices.length} notices files checked\n`);
}
