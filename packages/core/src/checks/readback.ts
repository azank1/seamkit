import { canonicalJson } from '../canonical.js';
import type { CheckDef } from '../check.js';
import { combine } from '../outcome.js';
import type { EvidenceRef, Examined, Gap, VerdictDraft } from '../verdict.js';
import * as v from '../validate.js';

/**
 * Readback proves whether production holds each merged change. It is a pure function of what the
 * shell observed: version documents, commit ancestry, the text of served files, and earlier
 * sightings from the ledger. All of it is recorded as the input, so every verdict can be replayed.
 *
 * | state            | condition                                               | outcome          |
 * |------------------|---------------------------------------------------------|------------------|
 * | live             | every marker is present                                 | pass             |
 * | not_live         | a marker was seen live earlier and is absent now        | fail             |
 * | not_proven       | a marker is absent and was never seen, or contradicted  | fail             |
 * | not_proven       | no marker is absent, but some could not be read         | examined_nothing |
 * | nothing_to_prove | the change's card declares `kind: none` with a reason    | examined_nothing |
 *
 * A change with nothing to prove is never reported as live: the card's claim is shown instead, and
 * accepting it is a human's call. The first verdict of every run is a summary of the others.
 */
export type Marker =
  | { kind: 'bundle'; url: string; text: string }
  | { kind: 'version'; url: string }
  | { kind: 'db_object'; object: string }
  | { kind: 'none'; reason: string };

export interface ReadbackChange {
  /** `pr#42`, or `commit:<12 hex>` for a change that reached the branch without a pull request. */
  subject: string;
  commit: string;
  title: string;
  /** `card` when the markers come from the change's card; `implicit` when seamkit derived them. */
  markerSource: 'card' | 'implicit';
  markers: Marker[];
  /** Why the change's card could not be used, when it has one that does not parse. */
  cardProblems?: string[];
}

export interface VersionObservation {
  url: string;
  at: string;
  status: 'ok' | 'unreadable';
  /** The commit as the document reported it, possibly abbreviated. */
  reported?: string;
  /** The full commit id, when the reported one was found in the repository. */
  commit?: string;
  dirty?: boolean;
  digest?: string;
  reason?: string;
}

/** Whether `running` contains `change`, as git answered it. `null` when git could not tell. */
export interface AncestryFact {
  change: string;
  running: string;
  contains: boolean | null;
  reason?: string;
}

export interface BundleObservation {
  url: string;
  at: string;
  status: 'ok' | 'unreadable';
  /** True when every file the page references (on its origin) was read. */
  complete: boolean;
  files: number;
  bytes: number;
  digest?: string;
  searched: string[];
  found: string[];
  /** The version document of the same origin, used to explain absences and catch contradictions. */
  versionUrl?: string;
  /** Origins of files the page references that were not read, such as a CDN. */
  otherOrigins?: string[];
  reason?: string;
}

/** A marker of a change seen present in an earlier, recorded run. */
export interface Sighting {
  change: string;
  marker: string;
  at: string;
  event: string;
}

export interface ReadbackInput {
  subject: string;
  changes: ReadbackChange[];
  versions: VersionObservation[];
  ancestry: AncestryFact[];
  bundles: BundleObservation[];
  /** Earlier sightings, or null when no ledger was consulted, so `not_live` cannot be told apart. */
  history: Sighting[] | null;
  notExamined?: Gap[];
}

export const READBACK_STATES = ['live', 'not_live', 'not_proven', 'nothing_to_prove'] as const;
export type ReadbackState = (typeof READBACK_STATES)[number];

const MIN_MARKER_TEXT = 4;

/** Identifies a marker across runs, so a sighting in one run can be matched in a later one. */
export function markerKey(m: Marker): string {
  switch (m.kind) {
    case 'bundle':
      return canonicalJson(['bundle', m.url, m.text]);
    case 'version':
      return canonicalJson(['version', m.url]);
    case 'db_object':
      return canonicalJson(['db_object', m.object]);
    case 'none':
      return canonicalJson(['none']);
  }
}

// ---------------------------------------------------------------------------------------------
// Input parsing

function parseMarker(raw: unknown, path: string): Marker {
  const kind = v.oneOf(v.object(raw, path, ['kind', 'url', 'text', 'object', 'reason'])['kind'], `${path}.kind`, [
    'bundle',
    'version',
    'db_object',
    'none',
  ] as const);
  switch (kind) {
    case 'bundle': {
      const o = v.object(raw, path, ['kind', 'url', 'text']);
      const text = v.string(o['text'], `${path}.text`);
      if (text.trim().length < MIN_MARKER_TEXT) v.fail(`${path}.text must be at least ${MIN_MARKER_TEXT} characters, so it can only match this change`);
      if (text.length > 200) v.fail(`${path}.text must be at most 200 characters`);
      return { kind, url: v.httpUrl(o['url'], `${path}.url`), text };
    }
    case 'version': {
      const o = v.object(raw, path, ['kind', 'url']);
      return { kind, url: v.httpUrl(o['url'], `${path}.url`) };
    }
    case 'db_object': {
      const o = v.object(raw, path, ['kind', 'object']);
      return { kind, object: v.string(o['object'], `${path}.object`) };
    }
    case 'none': {
      const o = v.object(raw, path, ['kind', 'reason']);
      return { kind, reason: v.string(o['reason'], `${path}.reason`) };
    }
  }
}

function parseChange(raw: unknown, path: string): ReadbackChange {
  const o = v.object(raw, path, ['subject', 'commit', 'title', 'markerSource', 'markers', 'cardProblems']);
  const change: ReadbackChange = {
    subject: v.string(o['subject'], `${path}.subject`),
    commit: v.commit(o['commit'], `${path}.commit`),
    title: v.string(o['title'], `${path}.title`),
    markerSource: v.oneOf(o['markerSource'], `${path}.markerSource`, ['card', 'implicit'] as const),
    markers: v.array(o['markers'], `${path}.markers`, parseMarker, 20),
  };
  if (o['cardProblems'] !== undefined) {
    change.cardProblems = v.array(o['cardProblems'], `${path}.cardProblems`, v.string, 20);
    if (change.markerSource === 'card') v.fail(`${path}.cardProblems is only allowed with markerSource implicit`);
  }
  const none = change.markers.filter((m) => m.kind === 'none');
  if (none.length > 0 && change.markers.length > 1) v.fail(`${path}.markers: a none marker must be the only marker`);
  if (change.markerSource === 'implicit' && change.markers.some((m) => m.kind !== 'version')) {
    v.fail(`${path}.markers: implicit markers can only be version markers`);
  }
  v.unique(change.markers, `${path}.markers`, markerKey);
  return change;
}

function parseVersion(raw: unknown, path: string): VersionObservation {
  const o = v.object(raw, path, ['url', 'at', 'status', 'reported', 'commit', 'dirty', 'digest', 'reason']);
  const obs: VersionObservation = {
    url: v.httpUrl(o['url'], `${path}.url`),
    at: v.isoTime(o['at'], `${path}.at`),
    status: v.oneOf(o['status'], `${path}.status`, ['ok', 'unreadable'] as const),
  };
  if (obs.status === 'unreadable') {
    obs.reason = v.string(o['reason'], `${path}.reason`);
    for (const f of ['reported', 'commit', 'dirty', 'digest']) {
      if (o[f] !== undefined) v.fail(`${path}.${f} is only allowed when status is ok`);
    }
    return obs;
  }
  obs.reported = v.matching(o['reported'], `${path}.reported`, /^[0-9a-f]{7,64}$/, 'the commit as reported, in lower-case hex');
  if (o['commit'] !== undefined) {
    obs.commit = v.commit(o['commit'], `${path}.commit`);
    if (!obs.commit.startsWith(obs.reported)) v.fail(`${path}.commit does not start with the reported commit`);
  }
  if (o['dirty'] !== undefined) obs.dirty = v.boolean(o['dirty'], `${path}.dirty`);
  obs.digest = v.digestHex(o['digest'], `${path}.digest`);
  if (o['reason'] !== undefined) v.fail(`${path}.reason is only allowed when status is unreadable`);
  return obs;
}

function parseAncestry(raw: unknown, path: string): AncestryFact {
  const o = v.object(raw, path, ['change', 'running', 'contains', 'reason']);
  const contains = o['contains'] === null ? null : v.boolean(o['contains'], `${path}.contains`);
  const fact: AncestryFact = {
    change: v.commit(o['change'], `${path}.change`),
    running: v.commit(o['running'], `${path}.running`),
    contains,
  };
  if (o['reason'] !== undefined) fact.reason = v.string(o['reason'], `${path}.reason`);
  return fact;
}

function parseBundle(raw: unknown, path: string): BundleObservation {
  const o = v.object(raw, path, ['url', 'at', 'status', 'complete', 'files', 'bytes', 'digest', 'searched', 'found', 'versionUrl', 'otherOrigins', 'reason']);
  const obs: BundleObservation = {
    url: v.httpUrl(o['url'], `${path}.url`),
    at: v.isoTime(o['at'], `${path}.at`),
    status: v.oneOf(o['status'], `${path}.status`, ['ok', 'unreadable'] as const),
    complete: v.boolean(o['complete'], `${path}.complete`),
    files: v.count(o['files'], `${path}.files`),
    bytes: v.count(o['bytes'], `${path}.bytes`),
    searched: v.array(o['searched'], `${path}.searched`, v.string, 1000),
    found: v.array(o['found'], `${path}.found`, v.string, 1000),
  };
  if (o['digest'] !== undefined) obs.digest = v.digestHex(o['digest'], `${path}.digest`);
  if (o['versionUrl'] !== undefined) obs.versionUrl = v.httpUrl(o['versionUrl'], `${path}.versionUrl`);
  if (o['otherOrigins'] !== undefined) obs.otherOrigins = v.array(o['otherOrigins'], `${path}.otherOrigins`, v.string, 20);
  if (o['reason'] !== undefined) obs.reason = v.string(o['reason'], `${path}.reason`);
  const searched = new Set(obs.searched);
  for (const text of obs.found) if (!searched.has(text)) v.fail(`${path}.found lists text that was not searched for`);
  if (obs.status === 'ok') {
    if (obs.files < 1) v.fail(`${path}.files must be at least 1 when status is ok (the page itself)`);
    if (obs.digest === undefined) v.fail(`${path}.digest is required when status is ok`);
    if (!obs.complete && obs.reason === undefined) v.fail(`${path}.reason must say why the search was incomplete`);
  } else {
    if (obs.reason === undefined) v.fail(`${path}.reason is required when status is unreadable`);
    if (obs.complete || obs.found.length > 0) v.fail(`${path}: an unreadable page can be neither complete nor have found anything`);
  }
  return obs;
}

function parseSighting(raw: unknown, path: string): Sighting {
  const o = v.object(raw, path, ['change', 'marker', 'at', 'event']);
  return {
    change: v.commit(o['change'], `${path}.change`),
    marker: v.string(o['marker'], `${path}.marker`),
    at: v.isoTime(o['at'], `${path}.at`),
    event: v.digestHex(o['event'], `${path}.event`),
  };
}

function parseGap(raw: unknown, path: string): Gap {
  const o = v.object(raw, path, ['item', 'reason']);
  return { item: v.string(o['item'], `${path}.item`), reason: v.string(o['reason'], `${path}.reason`) };
}

export function parseReadbackInput(raw: unknown): ReadbackInput {
  const o = v.object(raw, 'input', ['subject', 'changes', 'versions', 'ancestry', 'bundles', 'history', 'notExamined']);
  const input: ReadbackInput = {
    subject: v.string(o['subject'], 'subject'),
    changes: v.array(o['changes'], 'changes', parseChange, 1000),
    versions: v.array(o['versions'], 'versions', parseVersion, 100),
    ancestry: v.array(o['ancestry'], 'ancestry', parseAncestry, 100_000),
    bundles: v.array(o['bundles'], 'bundles', parseBundle, 100),
    history: o['history'] === null ? null : v.array(o['history'], 'history', parseSighting, 100_000),
  };
  if (o['notExamined'] !== undefined) input.notExamined = v.array(o['notExamined'], 'notExamined', parseGap, 100);
  v.unique(input.changes, 'changes', (c) => c.subject);
  v.unique(input.changes, 'changes', (c) => c.commit);
  v.unique(input.versions, 'versions', (o) => o.url);
  v.unique(input.bundles, 'bundles', (o) => o.url);
  v.unique(input.ancestry, 'ancestry', (f) => `${f.change} in ${f.running}`);
  const versionUrls = new Set(input.versions.map((o) => o.url));
  input.bundles.forEach((b, i) => {
    if (b.versionUrl !== undefined && !versionUrls.has(b.versionUrl)) v.fail(`bundles[${i}].versionUrl has no entry in versions`);
  });
  return input;
}

// ---------------------------------------------------------------------------------------------
// Evaluation

type Read = { marker: Marker; status: 'present' | 'absent' | 'contradicted'; why: string; examined: Examined; evidence: EvidenceRef[]; gap?: Gap };
type Unread = { marker: Marker; status: 'unreadable'; gap: Gap; evidence: EvidenceRef[] };
type MarkerStatus = Read | Unread;

const short = (commit: string): string => commit.slice(0, 12);
const files = (n: number): string => `${n} file${n === 1 ? '' : 's'}`;

class Facts {
  readonly versions: Map<string, VersionObservation>;
  readonly bundles: Map<string, BundleObservation>;
  readonly ancestry: Map<string, AncestryFact>;

  constructor(readonly input: ReadbackInput) {
    this.versions = new Map(input.versions.map((o) => [o.url, o]));
    this.bundles = new Map(input.bundles.map((o) => [o.url, o]));
    this.ancestry = new Map(input.ancestry.map((f) => [`${f.change} in ${f.running}`, f]));
  }

  /** Whether a usable version document says the change is in production; undefined when it cannot say. */
  containedBy(versionUrl: string | undefined, change: string): { contains: boolean; running: string } | undefined {
    const doc = versionUrl === undefined ? undefined : this.versions.get(versionUrl);
    if (doc?.status !== 'ok' || doc.commit === undefined || doc.dirty === true) return undefined;
    const fact = this.ancestry.get(`${change} in ${doc.commit}`);
    return fact === undefined || fact.contains === null ? undefined : { contains: fact.contains, running: doc.commit };
  }
}

function bundleStatus(facts: Facts, change: ReadbackChange, m: Extract<Marker, { kind: 'bundle' }>): MarkerStatus {
  const item = `bundle marker ${JSON.stringify(m.text)} at ${m.url}`;
  const obs = facts.bundles.get(m.url);
  if (obs === undefined) return { marker: m, status: 'unreadable', gap: { item, reason: 'no observation of this page was recorded' }, evidence: [] };
  if (obs.status === 'unreadable') return { marker: m, status: 'unreadable', gap: { item, reason: obs.reason as string }, evidence: [] };
  const evidence: EvidenceRef[] = [
    { kind: 'url', value: m.url, label: 'page' },
    { kind: 'hash', value: obs.digest as string, label: 'served files' },
  ];
  if (!obs.searched.includes(m.text)) {
    return { marker: m, status: 'unreadable', gap: { item, reason: 'the served files were read, but this text was not searched for' }, evidence };
  }
  const examined: Examined = { item, count: obs.files };
  const context = facts.containedBy(obs.versionUrl, change.commit);
  const where = `${files(obs.files)} served from ${m.url}`;
  if (obs.found.includes(m.text)) {
    if (context?.contains === false) {
      return {
        marker: m,
        status: 'contradicted',
        why: `marker ${JSON.stringify(m.text)} was found, but production's version ${short(context.running)} does not contain this change, so the text is not unique to it; choose a marker that only this change adds`,
        examined,
        evidence,
      };
    }
    return { marker: m, status: 'present', why: `marker ${JSON.stringify(m.text)} found in ${where}`, examined, evidence };
  }
  if (!obs.complete) {
    return {
      marker: m,
      status: 'unreadable',
      gap: { item, reason: `not found in the ${files(obs.files)} read, and the search was incomplete: ${obs.reason as string}` },
      evidence,
    };
  }
  const elsewhere = obs.otherOrigins ?? [];
  const gap: Gap | undefined =
    elsewhere.length === 0 ? undefined : { item: `files on ${elsewhere.join(', ')}`, reason: 'the page references them, but only files on its own origin are read' };
  let why = `marker ${JSON.stringify(m.text)} not found in ${where}`;
  if (context?.contains === true) {
    why += `, although production's version ${short(context.running)} contains this change; the text is probably not in the built output (text that exists only in source, such as a comment or a component name, never reaches a bundle)`;
  } else if (context?.contains === false) {
    why += `; production runs ${short(context.running)}, which does not contain this change`;
  }
  return gap === undefined ? { marker: m, status: 'absent', why, examined, evidence } : { marker: m, status: 'absent', why, examined, evidence, gap };
}

function versionStatus(facts: Facts, change: ReadbackChange, m: Extract<Marker, { kind: 'version' }>): MarkerStatus {
  const item = `version document ${m.url}`;
  const doc = facts.versions.get(m.url);
  if (doc === undefined) return { marker: m, status: 'unreadable', gap: { item, reason: 'no observation of this document was recorded' }, evidence: [] };
  if (doc.status === 'unreadable') return { marker: m, status: 'unreadable', gap: { item, reason: doc.reason as string }, evidence: [] };
  const reported = doc.reported as string;
  if (doc.commit === undefined) {
    return {
      marker: m,
      status: 'unreadable',
      gap: {
        item,
        reason: `production reports ${reported}, which this repository does not have; run git fetch, or look for a build made from a commit that was never pushed`,
      },
      evidence: [{ kind: 'url', value: m.url, label: 'version document' }],
    };
  }
  const evidence: EvidenceRef[] = [
    { kind: 'url', value: m.url, label: 'version document' },
    { kind: 'commit', value: doc.commit, label: 'running version' },
  ];
  if (doc.dirty === true) {
    return {
      marker: m,
      status: 'unreadable',
      gap: { item, reason: `production's build of ${short(doc.commit)} was made with uncommitted changes, so its version does not show what it contains` },
      evidence,
    };
  }
  const fact = facts.ancestry.get(`${change.commit} in ${doc.commit}`);
  if (fact === undefined || fact.contains === null) {
    return {
      marker: m,
      status: 'unreadable',
      gap: { item, reason: fact?.reason ?? `whether ${short(doc.commit)} contains this change could not be determined` },
      evidence,
    };
  }
  const examined: Examined = { item: `${item} (running ${short(doc.commit)})` };
  // An implicit marker reads production's own version document, which the summary names. A card can
  // name any document, such as a server function's, so its reasons say which one was read.
  if (change.markerSource === 'card') {
    const runs = `production at ${m.url} runs ${short(doc.commit)}`;
    return fact.contains
      ? { marker: m, status: 'present', why: `${runs}, which contains this change`, examined, evidence }
      : { marker: m, status: 'absent', why: `${runs}, which does not contain this change`, examined, evidence };
  }
  return fact.contains
    ? { marker: m, status: 'present', why: `production's version ${short(doc.commit)} contains this change`, examined, evidence }
    : { marker: m, status: 'absent', why: `production runs ${short(doc.commit)}, which does not contain this change`, examined, evidence };
}

function markerStatus(facts: Facts, change: ReadbackChange, m: Marker): MarkerStatus {
  switch (m.kind) {
    case 'bundle':
      return bundleStatus(facts, change, m);
    case 'version':
      return versionStatus(facts, change, m);
    case 'db_object':
      return {
        marker: m,
        status: 'unreadable',
        gap: { item: `database object ${m.object}`, reason: 'this version of seamkit has no adapter for database markers' },
        evidence: [],
      };
    case 'none':
      throw new Error('a none marker has no status');
  }
}

/** The latest sighting per change and marker. */
function latestSightings(history: readonly Sighting[]): Map<string, Sighting> {
  const latest = new Map<string, Sighting>();
  for (const s of history) {
    const key = `${s.change} ${s.marker}`;
    const prev = latest.get(key);
    if (prev === undefined || s.at > prev.at || (s.at === prev.at && s.event > prev.event)) latest.set(key, s);
  }
  return latest;
}

function changeEvidence(change: ReadbackChange): EvidenceRef[] {
  return [
    { kind: 'commit', value: change.commit, label: 'change' },
    { kind: 'text', value: change.title, label: 'title' },
  ];
}

function dedupe(evidence: EvidenceRef[]): EvidenceRef[] {
  const seen = new Set<string>();
  return evidence.filter((e) => {
    const key = canonicalJson(e);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function evaluateChange(facts: Facts, change: ReadbackChange, seen: Map<string, Sighting> | null): VerdictDraft {
  const base = { subject: change.subject };
  const cardGap: Gap[] =
    change.cardProblems === undefined
      ? []
      : [{ item: 'card markers', reason: `the card cannot be used: ${change.cardProblems.join('; ')}` }];
  const only = change.markers[0];
  if (change.markers.length === 1 && only?.kind === 'none') {
    return {
      ...base,
      outcome: 'examined_nothing',
      state: 'nothing_to_prove',
      examined: [],
      evidence: changeEvidence(change),
      reasons: [`nothing to prove, as its card declares: ${only.reason}`],
    };
  }
  if (change.markers.length === 0) {
    return {
      ...base,
      outcome: 'examined_nothing',
      state: 'not_proven',
      examined: [],
      notExamined: cardGap,
      evidence: changeEvidence(change),
      reasons: [
        change.markerSource === 'card'
          ? 'its card lists no markers, so there is nothing to check it against'
          : 'there is nothing to check this change against: it has no usable card, and production serves no version document',
      ],
    };
  }

  const statuses = change.markers.map((m) => markerStatus(facts, change, m));
  const read = statuses.filter((s): s is Read => s.status !== 'unreadable');
  const unreadable = statuses.filter((s): s is Unread => s.status === 'unreadable');
  const evidence = [...changeEvidence(change), ...statuses.flatMap((s) => s.evidence)];
  const examined = read.map((s) => s.examined);
  const gaps = [...unreadable.map((s) => s.gap), ...read.flatMap((s) => (s.gap === undefined ? [] : [s.gap])), ...cardGap];

  const notLive: string[] = [];
  const failing: string[] = [];
  for (const s of read) {
    if (s.status === 'contradicted') failing.push(s.why);
    if (s.status !== 'absent') continue;
    const sighting = seen?.get(`${change.commit} ${markerKey(s.marker)}`);
    if (sighting === undefined) {
      failing.push(s.why);
    } else {
      notLive.push(`${s.why}; it was seen live at ${sighting.at} (event ${sighting.event.slice(0, 12)})`);
      evidence.push({ kind: 'event', value: sighting.event, label: 'seen live earlier' });
    }
  }
  if (notLive.length + failing.length > 0) {
    const absentUnseen = read.some((s) => s.status === 'absent') && seen === null;
    if (absentUnseen) {
      gaps.push({
        item: 'earlier sightings',
        reason: 'no ledger was read, so a change that left production shows as not proven rather than not live',
      });
    }
    return {
      ...base,
      outcome: 'fail',
      state: notLive.length > 0 ? 'not_live' : 'not_proven',
      examined,
      notExamined: gaps,
      evidence: dedupe(evidence),
      reasons: [...notLive, ...failing],
    };
  }
  if (unreadable.length > 0) {
    return {
      ...base,
      outcome: 'examined_nothing',
      state: 'not_proven',
      examined,
      notExamined: gaps,
      evidence: dedupe(evidence),
      reasons: [
        `${unreadable.length} of ${statuses.length} marker${statuses.length === 1 ? '' : 's'} could not be read`,
        ...unreadable.map((s) => `${s.gap.item}: ${s.gap.reason}`),
      ],
    };
  }
  return {
    ...base,
    outcome: 'pass',
    state: 'live',
    examined,
    notExamined: gaps,
    evidence: dedupe(evidence),
    reasons: read.map((s) => s.why),
  };
}

function summarize(input: ReadbackInput, parts: VerdictDraft[]): VerdictDraft {
  const n = parts.length;
  const runGaps = input.notExamined ?? [];
  if (n === 0) {
    return {
      subject: input.subject,
      outcome: 'examined_nothing',
      examined: [{ item: 'merged changes', count: 0 }],
      notExamined: runGaps,
      reasons: ['no merged changes were in scope, and a readback over no changes is not a pass'],
    };
  }
  const count = (state: ReadbackState): number => parts.filter((p) => p.state === state).length;
  const reasons = [`proven live ${count('live')} of ${n} change${n === 1 ? '' : 's'}`];
  if (count('not_live') > 0) reasons.push(`not live ${count('not_live')}: seen live earlier, absent now`);
  if (count('not_proven') > 0) {
    const failing = parts.filter((p) => p.state === 'not_proven' && p.outcome === 'fail').length;
    reasons.push(`not proven ${count('not_proven')}: ${failing} absent or contradicted, ${count('not_proven') - failing} could not be read`);
  }
  if (count('nothing_to_prove') > 0) {
    reasons.push(`nothing to prove ${count('nothing_to_prove')}, by their cards' claims, which a human has to accept`);
  }
  const evidence: EvidenceRef[] = [];
  for (const doc of input.versions) {
    if (doc.status !== 'ok') continue;
    const running = doc.commit ?? (doc.reported as string);
    const match = input.changes.find((c) => c.commit === doc.commit);
    reasons.push(`production at ${doc.url} runs ${short(running)}${match ? ` (${match.subject})` : ''}${doc.dirty ? ' with uncommitted changes' : ''}`);
    evidence.push({ kind: 'commit', value: running, label: `running at ${doc.url}` });
  }
  for (const b of input.bundles) {
    if (b.status === 'ok') evidence.push({ kind: 'hash', value: b.digest as string, label: `${files(b.files)} served from ${b.url}` });
  }
  return {
    subject: input.subject,
    outcome: combine(parts.map((p) => p.outcome)),
    examined: [{ item: 'merged changes', count: n }],
    notExamined: [...runGaps, ...parts.flatMap((p) => (p.notExamined ?? []).map((g) => ({ ...g, item: `${p.subject}: ${g.item}` })))],
    evidence,
    reasons,
  };
}

export const readbackCheck: CheckDef<ReadbackInput> = {
  name: 'readback',
  version: 1,
  summary: 'Proves whether production holds each merged change, by version ancestry and markers.',
  parseInput: parseReadbackInput,
  evaluate(input: ReadbackInput): VerdictDraft[] {
    const facts = new Facts(input);
    const seen = input.history === null ? null : latestSightings(input.history);
    const parts = input.changes.map((c) => evaluateChange(facts, c, seen));
    return [summarize(input, parts), ...parts];
  },
};

/**
 * The markers a recorded run saw present, as sightings for later runs. A contradicted marker is
 * not a sighting, because its presence did not show the change was live.
 */
export function readbackSightings(input: ReadbackInput, event: string): Sighting[] {
  const facts = new Facts(input);
  const out: Sighting[] = [];
  for (const change of input.changes) {
    for (const m of change.markers) {
      if (m.kind === 'none' || m.kind === 'db_object') continue;
      const s = markerStatus(facts, change, m);
      if (s.status !== 'present') continue;
      const at = m.kind === 'bundle' ? facts.bundles.get(m.url)?.at : facts.versions.get(m.url)?.at;
      out.push({ change: change.commit, marker: markerKey(m), at: at as string, event });
    }
  }
  return out;
}
