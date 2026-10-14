import { createHash } from 'node:crypto';
import { canonicalJson, type BundleObservation } from '@seamkit/core';
import { fetchLimited, isHtml, type HttpOptions } from './http.js';

export interface BundleOptions extends HttpOptions {
  /** Files read at most, the page included. */
  maxFiles?: number;
  maxTotalBytes?: number;
  concurrency?: number;
}

interface Ref {
  url: string;
  /** Referenced by the page itself, so a failure to read it makes the search incomplete. */
  required: boolean;
}

const TAG = /<(script|link)\b([^>]*)>/gi;
const ATTR = /([^\s"'=<>`/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
/** A quoted path in a script that names another script or stylesheet, such as import("./chunk-1a2b.js"). */
const SCRIPT_REF = /["'`]((?:\.{1,2}\/|\/)[^"'`\s<>()]*?\.(?:m?js|css))["'`]/g;

function attributes(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of text.matchAll(ATTR)) out.set((m[1] as string).toLowerCase(), (m[2] ?? m[3] ?? m[4] ?? '').replace(/&amp;/g, '&'));
  return out;
}

/** Scripts, stylesheets and preloads a page references. */
export function pageRefs(html: string): string[] {
  const refs: string[] = [];
  for (const m of html.matchAll(TAG)) {
    const attrs = attributes(m[2] as string);
    if ((m[1] as string).toLowerCase() === 'script') {
      const src = attrs.get('src');
      if (src) refs.push(src);
      continue;
    }
    const rel = (attrs.get('rel') ?? '').toLowerCase().split(/\s+/);
    const as = (attrs.get('as') ?? '').toLowerCase();
    const href = attrs.get('href');
    if (href && (rel.includes('stylesheet') || rel.includes('modulepreload') || (rel.includes('preload') && (as === 'script' || as === 'style')))) {
      refs.push(href);
    }
  }
  return refs;
}

/** Other scripts and stylesheets a script names by path. */
export function scriptRefs(js: string): string[] {
  return [...js.matchAll(SCRIPT_REF)].map((m) => m[1] as string);
}

function resolveRef(ref: string, base: string): URL | undefined {
  try {
    const u = new URL(ref, base);
    u.hash = '';
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : undefined;
  } catch {
    return undefined;
  }
}

const MAX_FILE_BYTES = 10 * 1024 * 1024;

const isStyleOrScript = (contentType: string, url: string): boolean =>
  /javascript|ecmascript|text\/css/.test(contentType) || /\.(?:m?js|css)$/i.test(new URL(url).pathname);

/**
 * Reads a page and the scripts and stylesheets it loads from its own origin, following chunk paths
 * named inside scripts, and reports which of `texts` occur anywhere in what was read. The search is
 * complete only when every file the page references was read within the limits; a path guessed from
 * a script that turns out not to exist is skipped rather than counted as a failure.
 */
export async function observeBundle(pageUrl: string, texts: readonly string[], at: string, opts: BundleOptions = {}): Promise<BundleObservation> {
  const maxFiles = opts.maxFiles ?? 100;
  const maxTotalBytes = opts.maxTotalBytes ?? 25 * 1024 * 1024;
  const concurrency = opts.concurrency ?? 6;
  const searched = [...new Set(texts)].sort();
  const unreadable = (reason: string): BundleObservation => ({ url: pageUrl, at, status: 'unreadable', complete: false, files: 0, bytes: 0, searched, found: [], reason });

  const page = await fetchLimited(pageUrl, { ...opts, accept: 'text/html,*/*' });
  if (!page.ok) return unreadable(page.reason);
  const origin = new URL(pageUrl).origin;
  const read = new Map<string, Buffer>([[pageUrl, page.body]]);
  const seen = new Set<string>([pageUrl]);
  const failures: string[] = [];
  const otherOrigins = new Set<string>();
  let total = page.body.length;
  let capped = false;

  const enqueue = (refs: string[], base: string, required: boolean, into: Ref[]): void => {
    for (const ref of refs) {
      const u = resolveRef(ref, base);
      if (u === undefined) continue;
      if (u.origin !== origin) {
        if (required) otherOrigins.add(u.origin);
        continue;
      }
      if (seen.has(u.href)) continue;
      seen.add(u.href);
      into.push({ url: u.href, required });
    }
  };

  let level: Ref[] = [];
  if (isHtml(page)) enqueue(pageRefs(page.body.toString('utf8')), pageUrl, true, level);
  while (level.length > 0 && !capped) {
    level.sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
    const room = maxFiles - read.size;
    if (level.length > room) {
      level = level.slice(0, room);
      capped = true;
    }
    const next: Ref[] = [];
    for (let i = 0; i < level.length; i += concurrency) {
      const batch = level.slice(i, i + concurrency);
      const results = await Promise.all(batch.map((ref) => fetchLimited(ref.url, { ...opts, maxBytes: MAX_FILE_BYTES })));
      batch.forEach((ref, j) => {
        const r = results[j]!;
        const path = new URL(ref.url).pathname;
        if (!r.ok) {
          if (!ref.required && r.status === 404) return;
          failures.push(`${path}: ${r.reason}`);
          return;
        }
        if (!ref.required && (isHtml(r) || !isStyleOrScript(r.contentType, ref.url))) return;
        if (ref.required && isHtml(r) && /\.(?:m?js|css)$/i.test(path)) {
          // A stale page can name files the server no longer has, which some servers answer with the page itself.
          failures.push(`${path}: the server answered with a web page instead of the file`);
          return;
        }
        if (total + r.body.length > maxTotalBytes) {
          capped = true;
          return;
        }
        read.set(ref.url, r.body);
        total += r.body.length;
        if (!/text\/css/.test(r.contentType)) enqueue(scriptRefs(r.body.toString('utf8')), ref.url, false, next);
      });
    }
    level = next;
  }

  const found = searched.filter((text) => {
    const needle = Buffer.from(text, 'utf8');
    for (const body of read.values()) if (body.includes(needle)) return true;
    return false;
  });
  const listing = [...read].map(([url, body]) => [url, createHash('sha256').update(body).digest('hex')]).sort((a, b) => ((a[0] as string) < (b[0] as string) ? -1 : 1));
  const obs: BundleObservation = {
    url: pageUrl,
    at,
    status: 'ok',
    complete: failures.length === 0 && !capped,
    files: read.size,
    bytes: total,
    digest: createHash('sha256').update(canonicalJson(listing)).digest('hex'),
    searched,
    found,
  };
  if (otherOrigins.size > 0) obs.otherOrigins = [...otherOrigins].sort().slice(0, 20);
  const problems: string[] = [];
  if (failures.length > 0) problems.push(`${failures.length} referenced file${failures.length === 1 ? '' : 's'} could not be read (${failures.slice(0, 3).join('; ')})`);
  if (capped) problems.push(`the search stopped at its limit of ${maxFiles} files or ${maxTotalBytes} bytes`);
  if (problems.length > 0) obs.reason = problems.join('; ');
  return obs;
}
