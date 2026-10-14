import { createHash } from 'node:crypto';
import { readVersionDoc, type VersionObservation } from '@seamkit/core';
import { fetchLimited, isHtml, type HttpOptions } from './http.js';

/** Where seamkit looks for a version document when none is named, in this order. */
export const VERSION_PATHS: readonly string[] = ['/version.json', '/api/version', '/version'];

/** Finds the full commit id for a reported, possibly abbreviated one, or undefined when the repository lacks it. */
export type ResolveCommit = (reported: string) => Promise<string | undefined>;

type Probe = { ok: true; commit: string; dirty?: boolean; digest: string } | { ok: false; reason: string };

async function probe(url: string, opts: HttpOptions): Promise<Probe> {
  const r = await fetchLimited(url, { ...opts, maxBytes: 64 * 1024, accept: 'application/json' });
  if (!r.ok) return { ok: false, reason: r.reason };
  if (isHtml(r)) {
    return { ok: false, reason: 'the response is a web page, not a version document (sites often answer unknown paths with their index page)' };
  }
  const reading = readVersionDoc(r.body.toString('utf8'));
  if (!reading.ok) return { ok: false, reason: reading.problem };
  const digest = createHash('sha256').update(r.body).digest('hex');
  return reading.dirty === undefined ? { ok: true, commit: reading.commit, digest } : { ok: true, commit: reading.commit, dirty: reading.dirty, digest };
}

async function observed(url: string, at: string, p: Extract<Probe, { ok: true }>, resolve: ResolveCommit): Promise<VersionObservation> {
  const obs: VersionObservation = { url, at, status: 'ok', reported: p.commit, digest: p.digest };
  const full = await resolve(p.commit);
  if (full !== undefined) obs.commit = full;
  if (p.dirty !== undefined) obs.dirty = p.dirty;
  return obs;
}

/** Reads the version document at a known URL. */
export async function observeVersion(url: string, at: string, resolve: ResolveCommit, opts: HttpOptions = {}): Promise<VersionObservation> {
  const p = await probe(url, opts);
  return p.ok ? observed(url, at, p, resolve) : { url, at, status: 'unreadable', reason: p.reason };
}

/**
 * Looks for a version document on an origin at the paths in VERSION_PATHS and returns the first
 * that names a commit. When none does, the observation is unreadable and says what each path gave.
 */
export async function discoverVersion(origin: string, at: string, resolve: ResolveCommit, opts: HttpOptions = {}): Promise<VersionObservation> {
  const tried: string[] = [];
  for (const path of VERSION_PATHS) {
    const url = new URL(path, origin).href;
    const p = await probe(url, opts);
    if (p.ok) return observed(url, at, p, resolve);
    tried.push(`${path}: ${p.reason}`);
  }
  return {
    url: new URL(VERSION_PATHS[0] as string, origin).href,
    at,
    status: 'unreadable',
    reason: `production serves no version document (${tried.join('; ')})`,
  };
}
