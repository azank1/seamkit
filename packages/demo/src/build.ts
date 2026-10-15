import { createHash } from 'node:crypto';
import { VERSION_DOC_SCHEMA, versionDocText } from '@seamkit/core';
import { runGit } from '@seamkit/state';
import { DEMO_GIT_ENV } from './seed.js';

/**
 * The demo's build: what a bundler does that matters to readback. Comments are dropped, files
 * get content-hashed names, and a version document is stamped with the commit. Text that exists
 * only in a comment therefore never reaches production, exactly as with a real minifier.
 */
export async function buildAt(dir: string, commit: string): Promise<Record<string, string>> {
  const read = async (path: string): Promise<string | undefined> => {
    const r = await runGit(['show', `${commit}:${path}`], { cwd: dir, env: DEMO_GIT_ENV });
    return r.code === 0 ? r.stdout.toString('utf8') : undefined;
  };
  const time = Number((await runGit(['show', '-s', '--format=%ct', commit], { cwd: dir, env: DEMO_GIT_ENV })).stdout.toString('utf8').trim());
  const stamp = versionDocText({ schema: VERSION_DOC_SCHEMA, commit, dirty: false, source: 'git', ref: 'main', builtAt: new Date(time * 1000).toISOString() });
  const hash = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 8);

  const js = ((await read('web/app.js')) ?? '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
  const css = ((await read('web/style.css')) ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
  const jsName = `assets/app-${hash(js)}.js`;
  const cssName = `assets/style-${hash(css)}.css`;
  const html = ((await read('web/index.html')) ?? '').replace('src="app.js"', `src="/${jsName}"`).replace('href="style.css"', `href="/${cssName}"`);

  const files: Record<string, string> = { 'index.html': html, [jsName]: js, [cssName]: css, 'version.json': stamp };
  for (const fn of ['notes-sync', 'notes-export']) {
    if ((await read(`functions/${fn}.js`)) !== undefined) files[`api/${fn}/version.json`] = stamp;
  }
  return files;
}
