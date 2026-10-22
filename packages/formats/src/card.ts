import { parseDocument } from 'yaml';

/**
 * A scope card is a fenced block in a pull request body, or in the commit message a merge leaves
 * behind, so any agent that can write a description can write one:
 *
 * ````markdown
 * ```seamkit-card
 * card: 1
 * intent: Show a saved indicator after a note is synced.
 * layers: [frontend]
 * targets: [web]
 * markers:
 *   - kind: bundle
 *     text: "data-sync-state"
 * releaseNote: Notes now show when they were last saved.
 * ```
 * ````
 *
 * A marker's `url` may be a path, such as `/version.json`, which readback resolves against the
 * production URL it is given; that keeps hosts out of cards and lets one card serve staging too.
 *
 * The parser is strict and collects every problem in one pass, each naming the field and the fix,
 * so an agent can repair a card with one edit. A bundle marker must be text the built output
 * contains: text that exists only in source files, such as comments or component names, never
 * reaches a production bundle.
 */
export const CARD_FENCE_INFO = 'seamkit-card';
export const LAYERS = ['frontend', 'function', 'schema', 'data', 'config'] as const;
export type Layer = (typeof LAYERS)[number];
export const RISKS = ['ship_alone', 'stop_for_human'] as const;
export type Risk = (typeof RISKS)[number];
export const MARKER_KINDS = ['bundle', 'version', 'db_object', 'none'] as const;

export type CardMarker =
  | { kind: 'bundle'; text: string; url?: string }
  | { kind: 'version'; url?: string }
  | { kind: 'db_object'; object: string }
  | { kind: 'none'; reason: string };

export interface Card {
  card: 1;
  intent: string;
  layers: Layer[];
  targets: string[];
  markers: CardMarker[];
  releaseNote?: string;
  risk?: Risk;
}

export type CardParse = { ok: true; card: Card } | { ok: false; problems: string[] };
export type CardLookup = ({ found: true } & CardParse) | { found: false };

const FIELDS = ['card', 'intent', 'layers', 'targets', 'markers', 'releaseNote', 'risk'];
const MAX_CARD_BYTES = 16 * 1024;
const MIN_MARKER_TEXT = 4;

/** The contents of every `seamkit-card` fenced block, following CommonMark fence rules. */
export function extractCardBlocks(text: string): { blocks: string[]; unclosed: boolean } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: string[] = [];
  let open: { char: string; length: number; indent: number; body: string[] } | undefined;
  for (const line of lines) {
    if (open === undefined) {
      const m = /^( {0,3})(`{3,}|~{3,})[ \t]*seamkit-card[ \t]*$/.exec(line);
      if (m) open = { char: (m[2] as string)[0] as string, length: (m[2] as string).length, indent: (m[1] as string).length, body: [] };
      continue;
    }
    const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
    if (close && (close[1] as string)[0] === open.char && (close[1] as string).length >= open.length) {
      blocks.push(open.body.join('\n'));
      open = undefined;
      continue;
    }
    // Content lines lose up to the fence's own indentation, as CommonMark does.
    open.body.push(line.replace(new RegExp(`^ {0,${open.indent}}`), ''));
  }
  return { blocks, unclosed: open !== undefined };
}

/** Finds and parses the card in a pull request body or commit message. */
export function readCard(text: string): CardLookup {
  const { blocks, unclosed } = extractCardBlocks(text);
  if (blocks.length === 0 && !unclosed) return { found: false };
  if (unclosed) return { found: true, ok: false, problems: ['the seamkit-card block is never closed; end it with a line of three backticks'] };
  if (blocks.length > 1) return { found: true, ok: false, problems: [`there are ${blocks.length} seamkit-card blocks; a change has exactly one`] };
  return { found: true, ...parseCard(blocks[0] as string) };
}

/** A key as a problem names it: as written when it is a plain name, else quoted, so it cannot break the report's lines. */
const keyName = (k: string): string => (/^[A-Za-z0-9_.-]{1,64}$/.test(k) ? k : JSON.stringify(k));

const describe = (v: unknown): string => (v === null ? 'null' : Array.isArray(v) ? 'a list' : typeof v === 'object' ? 'a mapping' : JSON.stringify(v));

/** Parses the YAML inside a card block. */
export function parseCard(yamlText: string): CardParse {
  if (Buffer.byteLength(yamlText, 'utf8') > MAX_CARD_BYTES) return { ok: false, problems: [`the card is larger than ${MAX_CARD_BYTES / 1024} KiB`] };
  // logLevel error: yaml would otherwise print some warnings, card text included, on stderr.
  const doc = parseDocument(yamlText, { version: '1.2', schema: 'core', uniqueKeys: true, strict: true, logLevel: 'error' });
  const yamlProblems = [...doc.errors, ...doc.warnings].map((e) => `the card is not valid YAML: ${(e.message.split('\n')[0] as string).replace(/:$/, '')}`);
  if (yamlProblems.length > 0) return { ok: false, problems: yamlProblems };
  let raw: unknown;
  try {
    raw = doc.toJS({ maxAliasCount: 0 });
  } catch (err) {
    return { ok: false, problems: [`the card is not valid YAML: ${(err as Error).message.split('\n')[0]}`] };
  }
  const problems: string[] = [];
  const card = checkCard(raw, problems);
  return problems.length > 0 || card === undefined ? { ok: false, problems } : { ok: true, card };
}

function str(value: unknown, field: string, problems: string[], required: string): string | undefined {
  if (value === undefined) {
    problems.push(`${field} is required: ${required}`);
    return undefined;
  }
  if (typeof value !== 'string') {
    problems.push(
      typeof value === 'number' || typeof value === 'boolean'
        ? `${field} must be a string; quote it, for example ${field.split('.').pop()}: "${String(value)}"`
        : `${field} must be a string, got ${describe(value)}`,
    );
    return undefined;
  }
  if (value.trim().length === 0) {
    problems.push(`${field} must not be empty: ${required}`);
    return undefined;
  }
  // YAML's \uD800 escape gives half a character, which no recorded event can hold.
  if (LONE_SURROGATE.test(value)) {
    problems.push(`${field} holds half of a character (an escape such as \\uD800 without its pair); write the character itself`);
    return undefined;
  }
  return value;
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** An absolute http or https URL, or a path such as /version.json that readback resolves against the production URL. */
function url(value: unknown, field: string, problems: string[]): string | undefined {
  if (value === undefined) return undefined;
  const text = str(value, field, problems, 'an absolute http or https URL, or a path such as /version.json');
  if (text === undefined) return undefined;
  if (/^\/(?!\/)[^\s?#]*$/.test(text)) return text;
  try {
    const u = new URL(text);
    if ((u.protocol === 'http:' || u.protocol === 'https:') && u.username === '' && u.password === '') return text;
  } catch {
    // fall through
  }
  problems.push(`${field} must be a path such as /version.json, or an absolute http or https URL without a user name or password`);
  return undefined;
}

function list(value: unknown, field: string, problems: string[], hint: string): unknown[] | undefined {
  if (value === undefined) {
    problems.push(`${field} is required: ${hint}`);
    return undefined;
  }
  if (!Array.isArray(value)) {
    problems.push(`${field} must be a list, got ${describe(value)}: ${hint}`);
    return undefined;
  }
  return value;
}

function checkMarker(raw: unknown, field: string, problems: string[]): CardMarker | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    problems.push(`${field} must be a mapping with a kind, such as - kind: bundle`);
    return undefined;
  }
  const m = raw as Record<string, unknown>;
  const kind = m['kind'];
  if (typeof kind !== 'string' || !(MARKER_KINDS as readonly string[]).includes(kind)) {
    problems.push(`${field}.kind must be one of ${MARKER_KINDS.join(', ')}; got ${describe(kind)}`);
    return undefined;
  }
  const allowed: Record<string, string[]> = {
    bundle: ['kind', 'text', 'url'],
    version: ['kind', 'url'],
    db_object: ['kind', 'object'],
    none: ['kind', 'reason'],
  };
  const extra = Object.keys(m).filter((k) => !(allowed[kind] as string[]).includes(k));
  if (extra.length > 0) problems.push(`${field} has unknown field(s) for kind ${kind}: ${extra.map(keyName).join(', ')}; allowed: ${(allowed[kind] as string[]).join(', ')}`);
  switch (kind) {
    case 'bundle': {
      const text = str(m['text'], `${field}.text`, problems, 'text the built output contains, not text that exists only in source');
      if (text !== undefined && text.trim().length < MIN_MARKER_TEXT) {
        problems.push(`${field}.text must be at least ${MIN_MARKER_TEXT} characters, so that only this change adds it`);
      } else if (text !== undefined && text.length > 200) {
        problems.push(`${field}.text must be at most 200 characters`);
      }
      const u = url(m['url'], `${field}.url`, problems);
      if (text === undefined) return undefined;
      return u === undefined ? { kind, text } : { kind, text, url: u };
    }
    case 'version': {
      const u = url(m['url'], `${field}.url`, problems);
      return u === undefined ? { kind } : { kind, url: u };
    }
    case 'db_object': {
      const object = str(m['object'], `${field}.object`, problems, 'the database object whose presence proves the change, such as schema.table');
      return object === undefined ? undefined : { kind, object };
    }
    default: {
      const reason = str(m['reason'], `${field}.reason`, problems, 'why this change has nothing to prove in production, such as "tests only"');
      return reason === undefined ? undefined : { kind: 'none', reason };
    }
  }
}

function checkCard(raw: unknown, problems: string[]): Card | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    problems.push('the card must be a YAML mapping of fields, starting with card: 1');
    return undefined;
  }
  const c = raw as Record<string, unknown>;
  const unknown = Object.keys(c).filter((k) => !FIELDS.includes(k));
  if (unknown.length > 0) problems.push(`card has unknown field(s): ${unknown.map(keyName).join(', ')}; allowed: ${FIELDS.join(', ')}`);
  if (c['card'] !== 1) problems.push(`card must be 1, the card format version; got ${describe(c['card'])}`);
  const intent = str(c['intent'], 'intent', problems, 'one sentence saying what the change does and why');

  const layers: Layer[] = [];
  const rawLayers = list(c['layers'], 'layers', problems, `drawn from ${LAYERS.join(', ')}; use [] when nothing deployed changes`);
  rawLayers?.forEach((l, i) => {
    if (typeof l !== 'string' || !(LAYERS as readonly string[]).includes(l)) problems.push(`layers[${i}] must be one of ${LAYERS.join(', ')}; got ${describe(l)}`);
    else if (layers.includes(l as Layer)) problems.push(`layers lists ${l} twice`);
    else layers.push(l as Layer);
  });

  const targets: string[] = [];
  const rawTargets = list(c['targets'], 'targets', problems, 'what the change deploys, such as web or fn:notes-sync; use [] when nothing deployed changes');
  rawTargets?.forEach((t, i) => {
    const s = str(t, `targets[${i}]`, problems, 'a target name');
    if (s !== undefined) targets.push(s);
  });

  const markers: CardMarker[] = [];
  const rawMarkers = list(c['markers'], 'markers', problems, 'how readback proves the change live; use - kind: none with a reason when there is nothing to prove');
  if (rawMarkers !== undefined && rawMarkers.length === 0) {
    problems.push('markers must list at least one marker; use - kind: none with a reason when there is nothing to prove');
  }
  rawMarkers?.forEach((m, i) => {
    const marker = checkMarker(m, `markers[${i}]`, problems);
    if (marker !== undefined) markers.push(marker);
  });
  if (markers.some((m) => m.kind === 'none') && (rawMarkers?.length ?? 0) > 1) {
    problems.push('markers: a none marker must be the only marker, since a change either has something to prove or does not');
  }
  const keys = markers.map((m) => JSON.stringify(m));
  if (new Set(keys).size !== keys.length) problems.push('markers lists the same marker twice');

  let releaseNote: string | undefined;
  if (c['releaseNote'] !== undefined) releaseNote = str(c['releaseNote'], 'releaseNote', problems, 'one sentence for the people who use the product');
  let risk: Risk | undefined;
  if (c['risk'] !== undefined) {
    if (typeof c['risk'] === 'string' && (RISKS as readonly string[]).includes(c['risk'])) risk = c['risk'] as Risk;
    else problems.push(`risk must be one of ${RISKS.join(', ')}; got ${describe(c['risk'])}`);
  }
  if (problems.length > 0 || intent === undefined) return undefined;
  const card: Card = { card: 1, intent, layers, targets, markers };
  if (releaseNote !== undefined) card.releaseNote = releaseNote;
  if (risk !== undefined) card.risk = risk;
  return card;
}
