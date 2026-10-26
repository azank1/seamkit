// Builds the GitHub Action's one runnable file, packages/action/bundle/index.js, from the compiled
// action and everything it imports. The bundle is committed, because GitHub runs an action from the
// repository as it is, with no install step; CI rebuilds it and fails when the committed copy differs.
// Run `npm run build` first; `npm run pack:action` does both.
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isBuiltin } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = new URL('..', import.meta.url);
const at = (path) => fileURLToPath(new URL(path, root));
const out = (path) => at(`packages/action/bundle/${path}`);

const yaml = JSON.parse(await readFile(at('node_modules/yaml/package.json'), 'utf8'));
const action = JSON.parse(await readFile(at('packages/action/package.json'), 'utf8'));
const cli = JSON.parse(await readFile(at('packages/cli/package.json'), 'utf8'));
// The CLI reads its version from the package.json beside the bundle's directory, which is the action's.
if (action.version !== cli.version) throw new Error(`packages/action is ${action.version} but seamkit is ${cli.version}; make them equal`);

await mkdir(out(''), { recursive: true });
const built = await build({
  metafile: true,
  entryPoints: [at('packages/action/dist/main.js')],
  outfile: out('index.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // Some bundled modules call require(); an ES module has none until it is made here.
  banner: { js: "import { createRequire as __seamkitCreateRequire } from 'node:module';\nconst require = __seamkitCreateRequire(import.meta.url);" },
  legalComments: 'none',
  logLevel: 'warning',
});
// GitHub runs the bundle with no install step, so it may import nothing but Node's own modules.
const external = Object.values(built.metafile.outputs).flatMap((o) => o.imports).filter((i) => i.external && !isBuiltin(i.path)).map((i) => i.path);
if (external.length > 0) throw new Error(`the bundle would import ${[...new Set(external)].join(', ')}, which a checkout of the action does not hold`);
await writeFile(
  out('THIRD_PARTY_NOTICES'),
  `index.js bundles the following package.\n\n${yaml.name} ${yaml.version} (${yaml.license})\n\n${await readFile(at('node_modules/yaml/LICENSE'), 'utf8')}`,
);
process.stdout.write(`packages/action/bundle: seamkit ${cli.version} action, bundling ${yaml.name} ${yaml.version}\n`);
