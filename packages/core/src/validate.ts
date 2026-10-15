import { InputError } from './check.js';
import { DIGEST_PATTERN } from './canonical.js';

/**
 * Strict readers for check inputs. Every error names the field by its path, for example
 * `changes[3].markers[0].text`, and says what was expected, so an agent can repair the input in
 * one pass. Unknown fields are always rejected rather than ignored.
 */
export function fail(message: string): never {
  throw new InputError(message);
}

export type JsonObject = Record<string, unknown>;

export const ISO_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;
/** A full commit id: SHA-1 (40 hex) or SHA-256 (64 hex), lower case. */
export const COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export function object(value: unknown, path: string, allowed: readonly string[]): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(`${path} must be a JSON object`);
  const obj = value as JsonObject;
  const unknown = Object.keys(obj).filter((k) => !allowed.includes(k));
  if (unknown.length > 0) fail(`${path} has unknown field(s): ${unknown.join(', ')}; allowed: ${allowed.join(', ')}`);
  return obj;
}

export function string(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) fail(`${path} must be a non-empty string`);
  return value;
}

export function optionalString(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : string(value, path);
}

export function matching(value: unknown, path: string, pattern: RegExp, what: string): string {
  if (typeof value !== 'string' || !pattern.test(value)) fail(`${path} must be ${what}, got ${JSON.stringify(value)}`);
  return value;
}

export function commit(value: unknown, path: string): string {
  return matching(value, path, COMMIT_PATTERN, 'a full lower-case commit id (40 or 64 hex characters)');
}

export function isoTime(value: unknown, path: string): string {
  return matching(value, path, ISO_TIME_PATTERN, 'an ISO 8601 UTC time such as 2026-10-14T12:00:00.000Z');
}

export function digestHex(value: unknown, path: string): string {
  return matching(value, path, DIGEST_PATTERN, 'a sha256 hex digest');
}

export function count(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    fail(`${path} must be a non-negative integer, got ${JSON.stringify(value)}`);
  }
  return value;
}

export function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(`${path} must be true or false, got ${JSON.stringify(value)}`);
  return value;
}

export function oneOf<T extends string>(value: unknown, path: string, options: readonly T[]): T {
  if (typeof value !== 'string' || !(options as readonly string[]).includes(value)) {
    fail(`${path} must be one of ${options.join(', ')}; got ${JSON.stringify(value)}`);
  }
  return value as T;
}

export function array<T>(value: unknown, path: string, item: (v: unknown, path: string) => T, max = Infinity): T[] {
  if (!Array.isArray(value)) fail(`${path} must be an array`);
  if (value.length > max) fail(`${path} holds at most ${max} entries, got ${value.length}`);
  return value.map((v, i) => item(v, `${path}[${i}]`));
}

/** An absolute http or https URL. Credentials in the URL are refused, since URLs are recorded. */
export function httpUrl(value: unknown, path: string): string {
  const text = string(value, path);
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    fail(`${path} must be an absolute http or https URL, got ${JSON.stringify(text)}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') fail(`${path} must use http or https, got ${url.protocol}`);
  if (url.username !== '' || url.password !== '') fail(`${path} must not contain a user name or password`);
  return text;
}

/** Reports the first value that appears twice, by the given key. */
export function unique<T>(items: readonly T[], path: string, key: (item: T) => string): void {
  const seen = new Set<string>();
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) fail(`${path} lists ${k} more than once`);
    seen.add(k);
  }
}
