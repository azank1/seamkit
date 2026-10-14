import { COMMIT_PATTERN } from './validate.js';

/**
 * A version document says which commit a deployed build was made from. `seamkit stamp` writes one
 * at build time, and readback reads it back from production.
 *
 * ```json
 * { "schema": "seamkit.version/1", "commit": "<full commit id>", "dirty": false, "source": "git" }
 * ```
 *
 * `dirty` is true when the build was made from a working tree with uncommitted changes, in which
 * case the commit does not identify what the build contains. `source` says where the commit came
 * from: `git`, `argument`, or `env:<NAME>` for a CI variable, where dirtiness is unknown.
 */
export const VERSION_DOC_SCHEMA = 'seamkit.version/1';

export interface VersionDoc {
  schema: typeof VERSION_DOC_SCHEMA;
  commit: string;
  dirty?: boolean;
  source: string;
  ref?: string;
  builtAt?: string;
}

export function versionDocText(doc: VersionDoc): string {
  const ordered = {
    schema: doc.schema,
    commit: doc.commit,
    dirty: doc.dirty,
    source: doc.source,
    ref: doc.ref,
    builtAt: doc.builtAt,
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

/** What a version document says, or why it says nothing usable. */
export type VersionReading =
  | {
      ok: true;
      /** Lower-case hex as reported; it may be abbreviated when the document is not seamkit's. */
      commit: string;
      /** The field the commit was read from, such as `commit` or `git.commit.id`. */
      field: string;
      dirty?: boolean;
    }
  | { ok: false; problem: string };

const ABBREVIATED = /^[0-9a-fA-F]{7,64}$/;

/** Fields other tools commonly use for the commit, checked in this order. */
export const COMMIT_FIELDS: readonly string[] = [
  'commit',
  'sha',
  'commitSha',
  'commit_sha',
  'gitSha',
  'git_sha',
  'gitCommit',
  'git_commit',
  'revision',
  'git.commit',
  'git.sha',
  'git.commit.id',
  'build.commit',
];

function at(doc: unknown, path: string): unknown {
  let value: unknown = doc;
  for (const key of path.split('.')) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function flag(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

/**
 * Reads the commit from a version document. A seamkit document is read strictly. Any other JSON
 * document is searched for the fields in COMMIT_FIELDS; if two of them name different commits the
 * document is treated as unreadable rather than guessed at. Messages never quote the document, so
 * nothing a server returns is echoed into a verdict.
 */
export function readVersionDoc(text: string): VersionReading {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { ok: false, problem: 'the response is not JSON' };
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    return { ok: false, problem: 'the response is JSON but not an object' };
  }
  const record = doc as Record<string, unknown>;
  if (record['schema'] === VERSION_DOC_SCHEMA) {
    const commit = record['commit'];
    if (typeof commit !== 'string' || !COMMIT_PATTERN.test(commit)) {
      return { ok: false, problem: `the ${VERSION_DOC_SCHEMA} document's commit is not a full lower-case commit id` };
    }
    const dirty = record['dirty'];
    if (dirty !== undefined && typeof dirty !== 'boolean') {
      return { ok: false, problem: `the ${VERSION_DOC_SCHEMA} document's dirty field is not true or false` };
    }
    return dirty === undefined ? { ok: true, commit, field: 'commit' } : { ok: true, commit, field: 'commit', dirty };
  }

  const found: { field: string; commit: string }[] = [];
  const unusable: string[] = [];
  for (const field of COMMIT_FIELDS) {
    const value = at(doc, field);
    if (value === undefined || value === null || typeof value === 'object') continue;
    if (typeof value === 'string' && ABBREVIATED.test(value)) found.push({ field, commit: value.toLowerCase() });
    else unusable.push(field);
  }
  if (found.length === 0) {
    return {
      ok: false,
      problem:
        unusable.length > 0
          ? `field ${unusable.join(', ')} holds no commit id`
          : `the document names no commit (looked for ${COMMIT_FIELDS.join(', ')})`,
    };
  }
  // Abbreviations of the same commit agree; the longest form is kept.
  const longest = found.reduce((a, b) => (b.commit.length > a.commit.length ? b : a));
  const disagreeing = found.filter((f) => !longest.commit.startsWith(f.commit));
  if (disagreeing.length > 0) {
    return { ok: false, problem: `fields ${longest.field} and ${disagreeing[0]!.field} name different commits` };
  }
  const dirty = flag(record['dirty']) ?? flag(at(doc, 'git.dirty'));
  return dirty === undefined ? { ok: true, commit: longest.commit, field: longest.field } : { ok: true, commit: longest.commit, field: longest.field, dirty };
}
