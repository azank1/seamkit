import { createHash } from 'node:crypto';

/**
 * Canonical JSON in the sense of RFC 8785 (JSON Canonicalization Scheme), for seamkit's own
 * event files and input digests: object keys sorted by UTF-16 code units, no insignificant
 * whitespace, ECMAScript number formatting, and I-JSON strings.
 *
 * This is not a receipt format and never verifies one. Agent-run receipts belong to receipt tools.
 *
 * Object properties whose value is `undefined` are omitted, so optional fields can be absent.
 * Anything that is not plain JSON data (functions, symbols, bigints, class instances, dates,
 * non-finite numbers, lone surrogates, `undefined` inside arrays) is rejected rather than coerced.
 */
export class CanonicalJsonError extends Error {
  override name = 'CanonicalJsonError';
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

export function canonicalJson(value: unknown): string {
  return serialize(value, '$');
}

function serialize(value: unknown, path: string): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new CanonicalJsonError(`${path}: non-finite number`);
      return JSON.stringify(value);
    case 'string':
      if (LONE_SURROGATE.test(value)) throw new CanonicalJsonError(`${path}: string contains a lone surrogate`);
      return JSON.stringify(value);
    case 'object':
      break;
    default:
      throw new CanonicalJsonError(`${path}: ${typeof value} is not JSON data`);
  }
  if (Array.isArray(value)) {
    const items = value.map((item, i) => {
      if (item === undefined) throw new CanonicalJsonError(`${path}[${i}]: undefined inside an array`);
      return serialize(item, `${path}[${i}]`);
    });
    return `[${items.join(',')}]`;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new CanonicalJsonError(`${path}: only plain objects are JSON data`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  const members = keys.map((key) => {
    if (LONE_SURROGATE.test(key)) throw new CanonicalJsonError(`${path}: key contains a lone surrogate`);
    return `${JSON.stringify(key)}:${serialize(record[key], `${path}.${key}`)}`;
  });
  return `{${members.join(',')}}`;
}

/** SHA-256 of a UTF-8 string, as 64 lowercase hex characters. */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** SHA-256 of the canonical JSON of a value. */
export function digest(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

export const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
