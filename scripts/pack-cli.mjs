// Builds the publishable `seamkit` package into release/seamkit: the compiled CLI and its one third-party
// dependency bundled into dist/seamkit.js, a launcher, the licence notices, and a package.json generated from
// packages/cli/package.json. The workspace packages stay private; only this directory is published.
// Run `npm run build` first; `npm run pack:cli` does both.
import { build } from 'esbuild';
import { chmod, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('..', import.meta.url);
const at = (path) => fileURLToPath(new URL(path, root));
const out = (path = '') => at(`release/seamkit/${path}`);

const cli = JSON.parse(await readFile(at('packages/cli/package.json'), 'utf8'));
const yaml = JSON.parse(await readFile(at('node_modules/yaml/package.json'), 'utf8'));

await rm(out(), { recursive: true, force: true });
await mkdir(out('bin'), { recursive: true });

await build({
  entryPoints: [at('packages/cli/dist/main.js')],
  outfile: out('dist/seamkit.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // Some bundled modules call require(); an ES module has none until it is made here.
  banner: { js: "import { createRequire as __seamkitCreateRequire } from 'node:module';\nconst require = __seamkitCreateRequire(import.meta.url);" },
  legalComments: 'none',
  logLevel: 'warning',
});

await writeFile(out('bin/seamkit.js'), '#!/usr/bin/env node\nimport "../dist/seamkit.js";\n');
await chmod(out('bin/seamkit.js'), 0o755);
await copyFile(at('LICENSE'), out('LICENSE'));
await copyFile(at('README.md'), out('README.md'));
await writeFile(
  out('THIRD_PARTY_NOTICES'),
  `dist/seamkit.js bundles the following package.\n\n${yaml.name} ${yaml.version} (${yaml.license})\n\n${await readFile(at('node_modules/yaml/LICENSE'), 'utf8')}`,
);

const manifest = {
  name: 'seamkit',
  version: cli.version,
  description: cli.description,
  keywords: ['deploy', 'production', 'readback', 'verification', 'ci', 'agents', 'ai-agents', 'release'],
  homepage: 'https://github.com/azank1/seamkit#readme',
  bugs: { url: 'https://github.com/azank1/seamkit/issues' },
  repository: { type: 'git', url: 'git+https://github.com/azank1/seamkit.git' },
  license: cli.license,
  type: 'module',
  bin: { seamkit: 'bin/seamkit.js' },
  files: ['bin', 'dist', 'THIRD_PARTY_NOTICES'],
  engines: cli.engines,
};
await writeFile(out('package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`release/seamkit: seamkit ${manifest.version}, bundling ${yaml.name} ${yaml.version}\n`);
