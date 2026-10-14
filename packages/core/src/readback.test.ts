import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  InputError,
  VERSION_DOC_SCHEMA,
  canonicalJson,
  defaultRegistry,
  markerKey,
  readVersionDoc,
  readbackCheck,
  readbackSightings,
  renderReadback,
  replayRun,
  runCheck,
  versionDocText,
  type BundleObservation,
  type Marker,
  type ReadbackChange,
  type ReadbackInput,
  type Verdict,
} from './index.js';

const AT = '2026-10-14T12:00:00.000Z';
const EARLIER = '2026-10-13T09:30:00.000Z';
const c = (n: number): string => n.toString(16).padStart(40, '0');
const RUNNING = c(0xabc);
const PAGE = 'https://notes.example/';
const VERSION = 'https://notes.example/version.json';
const DIGEST = 'd'.repeat(64);
const EVENT = 'e'.repeat(64);

const versionMarker: Marker = { kind: 'version', url: VERSION };
const bundle = (text: string): Marker => ({ kind: 'bundle', url: PAGE, text });

function change(n: number, markers: Marker[] = [versionMarker], over: Partial<ReadbackChange> = {}): ReadbackChange {
  return { subject: `pr#${n}`, commit: c(n), title: `change ${n}`, markerSource: 'card', markers, ...over };
}

const implicit = (n: number): ReadbackChange => change(n, [versionMarker], { markerSource: 'implicit' });

function page(over: Partial<BundleObservation> = {}): BundleObservation {
  return { url: PAGE, at: AT, status: 'ok', complete: true, files: 3, bytes: 1200, digest: DIGEST, searched: [], found: [], versionUrl: VERSION, ...over };
}

function input(over: Partial<ReadbackInput> = {}): ReadbackInput {
  return {
    subject: 'main',
    changes: [],
    versions: [{ url: VERSION, at: AT, status: 'ok', reported: RUNNING, commit: RUNNING, digest: DIGEST }],
    ancestry: [],
    bundles: [],
    history: [],
    ...over,
  };
}

/** Runs the check and returns its verdicts by subject, plus the summary. */
function run(i: ReadbackInput): { summary: Verdict; by: Map<string, Verdict>; verdicts: Verdict[] } {
  const { verdicts } = runCheck(readbackCheck, i, AT);
  const [summary, ...parts] = verdicts;
  return { summary: summary as Verdict, by: new Map(parts.map((p) => [p.subject, p])), verdicts };
}

const contains = (n: number, yes: boolean | null, reason?: string) =>
  reason === undefined ? { change: c(n), running: RUNNING, contains: yes } : { change: c(n), running: RUNNING, contains: yes, reason };

describe('version documents', () => {
  it('reads a seamkit stamp strictly, and round-trips what stamp writes', () => {
    const text = versionDocText({ schema: VERSION_DOC_SCHEMA, commit: RUNNING, dirty: false, source: 'git', ref: 'main' });
    assert.deepEqual(readVersionDoc(text), { ok: true, commit: RUNNING, field: 'commit', dirty: false });
    assert.equal(readVersionDoc(JSON.stringify({ schema: VERSION_DOC_SCHEMA, commit: 'abc1234' })).ok, false);
    assert.equal(readVersionDoc(JSON.stringify({ schema: VERSION_DOC_SCHEMA, commit: RUNNING, dirty: 'no' })).ok, false);
  });

  it('reads the common shapes other tools serve', () => {
    assert.deepEqual(readVersionDoc('{"sha":"ABC1234"}'), { ok: true, commit: 'abc1234', field: 'sha' });
    assert.deepEqual(readVersionDoc(`{"git":{"commit":{"id":"${RUNNING}"},"dirty":"true"}}`), {
      ok: true,
      commit: RUNNING,
      field: 'git.commit.id',
      dirty: true,
    });
    // Two abbreviations of one commit agree, and the longest is kept.
    assert.deepEqual(readVersionDoc(`{"commit":"${RUNNING}","sha":"${RUNNING.slice(0, 7)}"}`), { ok: true, commit: RUNNING, field: 'commit' });
  });

  it('refuses to guess', () => {
    const disagree = readVersionDoc(`{"commit":"${c(1)}","sha":"${c(2)}"}`);
    assert.equal(disagree.ok, false);
    assert.match(disagree.ok ? '' : disagree.problem, /name different commits/);
    assert.match((readVersionDoc('<!doctype html><html>') as { problem: string }).problem, /not JSON/);
    assert.match((readVersionDoc('[1]') as { problem: string }).problem, /not an object/);
    assert.match((readVersionDoc('{"version":"1.2.3"}') as { problem: string }).problem, /names no commit/);
    assert.match((readVersionDoc('{"commit":"unknown"}') as { problem: string }).problem, /holds no commit id/);
  });

  it('never quotes the document in its problems', () => {
    const r = readVersionDoc('{"commit":"secret-token-value"}');
    assert.equal(r.ok, false);
    assert.doesNotMatch(r.ok ? '' : r.problem, /secret/);
  });
});

describe('readback by version ancestry', () => {
  it('sorts changes into live and not proven, and counts with denominators', () => {
    const { summary, by } = run(input({ changes: [implicit(2), implicit(1)], ancestry: [contains(1, true), contains(2, false)] }));
    assert.equal(by.get('pr#1')?.state, 'live');
    assert.equal(by.get('pr#1')?.outcome, 'pass');
    assert.equal(by.get('pr#2')?.state, 'not_proven');
    assert.equal(by.get('pr#2')?.outcome, 'fail');
    assert.match(by.get('pr#2')?.reasons[0] ?? '', /does not contain this change/);
    assert.equal(summary.outcome, 'fail');
    assert.equal(summary.reasons[0], 'proven live 1 of 2 changes');
    assert.deepEqual(summary.examined, [{ item: 'merged changes', count: 2 }]);
  });

  it('calls a change not live only when it was seen live before', () => {
    const sighting = { change: c(3), marker: markerKey(versionMarker), at: EARLIER, event: EVENT };
    const { by } = run(input({ changes: [implicit(3)], ancestry: [contains(3, false)], history: [sighting] }));
    const v = by.get('pr#3') as Verdict;
    assert.equal(v.state, 'not_live');
    assert.equal(v.outcome, 'fail');
    assert.match(v.reasons[0] ?? '', /seen live at 2026-10-13T09:30:00.000Z \(event eeeeeeeeeeee\)/);
    assert.ok(v.evidence.some((e) => e.kind === 'event' && e.value === EVENT));

    // Negative control: the same observation without the sighting is only not proven.
    assert.equal(run(input({ changes: [implicit(3)], ancestry: [contains(3, false)] })).by.get('pr#3')?.state, 'not_proven');
  });

  it('says so when no ledger was read, since not live cannot then be told apart', () => {
    const { by } = run(input({ changes: [implicit(3)], ancestry: [contains(3, false)], history: null }));
    assert.ok(by.get('pr#3')?.notExamined.some((g) => g.item === 'earlier sightings'));
  });

  it('examines nothing when production does not say what it runs', () => {
    const unreadable = input({
      changes: [implicit(1)],
      versions: [{ url: VERSION, at: AT, status: 'unreadable', reason: 'HTTP 404' }],
    });
    const v = run(unreadable).by.get('pr#1') as Verdict;
    assert.equal(v.outcome, 'examined_nothing');
    assert.equal(v.state, 'not_proven');
    assert.deepEqual(v.notExamined, [{ item: `version document ${VERSION}`, reason: 'HTTP 404' }]);

    const nothing = run(input({ changes: [change(1, [], { markerSource: 'implicit' })], versions: [] })).by.get('pr#1') as Verdict;
    assert.equal(nothing.outcome, 'examined_nothing');
    assert.match(nothing.reasons[0] ?? '', /no usable card, and production serves no version document/);
  });

  it('does not trust a running commit it cannot place, or a dirty build', () => {
    const unknown = input({
      changes: [implicit(1)],
      versions: [{ url: VERSION, at: AT, status: 'ok', reported: 'abc1234', digest: DIGEST }],
    });
    assert.match(run(unknown).by.get('pr#1')?.notExamined[0]?.reason ?? '', /reports abc1234, which this repository does not have/);

    const dirty = input({
      changes: [implicit(1)],
      versions: [{ url: VERSION, at: AT, status: 'ok', reported: RUNNING, commit: RUNNING, dirty: true, digest: DIGEST }],
      ancestry: [contains(1, true)],
    });
    const v = run(dirty).by.get('pr#1') as Verdict;
    assert.equal(v.outcome, 'examined_nothing');
    assert.match(v.notExamined[0]?.reason ?? '', /uncommitted changes/);

    const undetermined = run(input({ changes: [implicit(1)], ancestry: [contains(1, null, 'git failed')] })).by.get('pr#1') as Verdict;
    assert.equal(undetermined.outcome, 'examined_nothing');
    assert.equal(undetermined.notExamined[0]?.reason, 'git failed');
  });
});

describe('readback by markers', () => {
  it('proves a change live by a marker in the served files', () => {
    const { by } = run(input({ changes: [change(1, [bundle('data-sync-state')])], ancestry: [contains(1, true)], bundles: [page({ searched: ['data-sync-state'], found: ['data-sync-state'] })] }));
    const v = by.get('pr#1') as Verdict;
    assert.equal(v.state, 'live');
    assert.deepEqual(v.examined, [{ item: `bundle marker "data-sync-state" at ${PAGE}`, count: 3 }]);
  });

  it('explains an absent marker by what the version says', () => {
    const absent = (yes: boolean) =>
      run(input({ changes: [change(1, [bundle('only-in-a-comment')])], ancestry: [contains(1, yes)], bundles: [page({ searched: ['only-in-a-comment'] })] })).by.get('pr#1') as Verdict;
    const deployed = absent(true);
    assert.equal(deployed.outcome, 'fail');
    assert.match(deployed.reasons[0] ?? '', /probably not in the built output/);
    assert.match(absent(false).reasons[0] ?? '', /which does not contain this change/);
  });

  it('names the origins it did not read when a marker is absent', () => {
    const v = run(input({ changes: [change(1, [bundle('data-sync-state')])], bundles: [page({ searched: ['data-sync-state'], otherOrigins: ['https://cdn.example.net'] })] })).by.get('pr#1') as Verdict;
    assert.equal(v.outcome, 'fail');
    assert.deepEqual(v.notExamined, [{ item: 'files on https://cdn.example.net', reason: 'the page references them, but only files on its own origin are read' }]);
  });

  it('refuses a marker found in a build that does not contain the change', () => {
    const v = run(input({ changes: [change(1, [bundle('Save note')])], ancestry: [contains(1, false)], bundles: [page({ searched: ['Save note'], found: ['Save note'] })] })).by.get('pr#1') as Verdict;
    assert.equal(v.outcome, 'fail');
    assert.equal(v.state, 'not_proven');
    assert.match(v.reasons[0] ?? '', /not unique to it/);
  });

  it('never calls a marker absent when the search was incomplete or never ran', () => {
    const incomplete = run(
      input({
        changes: [change(1, [bundle('data-sync-state')])],
        bundles: [page({ complete: false, reason: '2 of 5 files could not be read', searched: ['data-sync-state'] })],
      }),
    ).by.get('pr#1') as Verdict;
    assert.equal(incomplete.outcome, 'examined_nothing');
    assert.match(incomplete.notExamined[0]?.reason ?? '', /search was incomplete: 2 of 5 files/);

    const unsearched = run(input({ changes: [change(1, [bundle('data-sync-state')])], bundles: [page()] })).by.get('pr#1') as Verdict;
    assert.equal(unsearched.outcome, 'examined_nothing');
    assert.match(unsearched.notExamined[0]?.reason ?? '', /not searched for/);
  });

  it('reports a database marker as not examined, for want of an adapter', () => {
    const v = run(input({ changes: [change(1, [{ kind: 'db_object', object: 'notes.sync_state' }])] })).by.get('pr#1') as Verdict;
    assert.equal(v.outcome, 'examined_nothing');
    assert.equal(v.notExamined[0]?.reason, 'this version of seamkit has no adapter for database markers');
  });

  it('never reports a change with nothing to prove as live', () => {
    const v = run(input({ changes: [change(1, [{ kind: 'none', reason: 'tests only' }])] })).by.get('pr#1') as Verdict;
    assert.equal(v.state, 'nothing_to_prove');
    assert.equal(v.outcome, 'examined_nothing');
    assert.equal(v.reasons[0], 'nothing to prove, as its card declares: tests only');
  });

  it('needs every marker: one unreadable marker keeps a change from being live', () => {
    const v = run(
      input({
        changes: [change(1, [versionMarker, { kind: 'db_object', object: 'notes.sync_state' }])],
        ancestry: [contains(1, true)],
      }),
    ).by.get('pr#1') as Verdict;
    assert.equal(v.outcome, 'examined_nothing');
    assert.equal(v.reasons[0], '1 of 2 markers could not be read');
  });

  it('keeps a broken card visible after falling back to the version', () => {
    const v = run(
      input({ changes: [change(1, [versionMarker], { markerSource: 'implicit', cardProblems: ['card.markers is required'] })], ancestry: [contains(1, true)] }),
    ).by.get('pr#1') as Verdict;
    assert.equal(v.outcome, 'pass');
    assert.deepEqual(v.notExamined, [{ item: 'card markers', reason: 'the card cannot be used: card.markers is required' }]);
  });
});

describe('readback summary', () => {
  it('is examined nothing over no changes, never a pass', () => {
    const { summary, verdicts } = run(input());
    assert.equal(verdicts.length, 1);
    assert.equal(summary.outcome, 'examined_nothing');
  });

  it('takes the most severe outcome and carries every gap', () => {
    const { summary } = run(
      input({
        changes: [implicit(1), change(2, [{ kind: 'db_object', object: 'notes.x' }]), change(3, [{ kind: 'none', reason: 'docs' }])],
        ancestry: [contains(1, true)],
        notExamined: [{ item: 'changes before the last 3', reason: 'outside --last' }],
      }),
    );
    assert.equal(summary.outcome, 'examined_nothing');
    assert.deepEqual(
      summary.notExamined.map((g) => g.item),
      ['changes before the last 3', 'pr#2: database object notes.x'],
    );
    assert.ok(summary.reasons.includes(`production at ${VERSION} runs ${RUNNING.slice(0, 12)}`));
  });

  it('names the change production runs, when it is one of them', () => {
    const { summary } = run(input({ changes: [change(0xabc, [versionMarker], { markerSource: 'implicit' })], ancestry: [{ change: RUNNING, running: RUNNING, contains: true }] }));
    assert.ok(summary.reasons.includes(`production at ${VERSION} runs ${RUNNING.slice(0, 12)} (pr#2748)`));
    assert.equal(summary.outcome, 'pass');
  });

  it('prints a reason shared by many changes once, above them', () => {
    const { verdicts } = run(input({ changes: [implicit(4), implicit(3), implicit(2), implicit(1)], versions: [{ url: VERSION, at: AT, status: 'unreadable', reason: 'HTTP 404' }] }));
    const text = renderReadback(verdicts);
    assert.match(text, /NOT PROVEN {2}4 of 4 {2}\(4 examined nothing\)\n {2}4 changes, each for the same reason:\n {6}1 of 1 marker could not be read\n {6}version document https:\/\/notes\.example\/version\.json: HTTP 404\n {4}pr#4 {2}change 4\n/);
    assert.equal(text.split('HTTP 404').length - 1, 1);
  });

  it('renders groups with their denominators, problems first', () => {
    const { verdicts } = run(input({ changes: [implicit(2), implicit(1)], ancestry: [contains(1, true), contains(2, false)] }));
    const text = renderReadback(verdicts);
    assert.ok(text.indexOf('NOT PROVEN  1 of 2  (1 fail)') < text.indexOf('LIVE  1 of 2  (1 pass)'));
    assert.match(text, /FAIL {2}readback {2}main\n {2}proven live 1 of 2 changes/);
    assert.match(text, /pr#2 {2}change 2/);
  });
});

describe('readback input', () => {
  const bad = (raw: unknown, pattern: RegExp) => assert.throws(() => readbackCheck.parseInput(raw), (e: unknown) => e instanceof InputError && pattern.test(e.message));

  it('rejects unknown fields and malformed values, naming the path', () => {
    bad({ ...input(), extra: 1 }, /input has unknown field\(s\): extra/);
    bad(input({ changes: [{ ...implicit(1), commit: 'abc' }] }), /changes\[0\]\.commit must be a full lower-case commit id/);
    bad(input({ changes: [change(1, [bundle('abc')])] }), /changes\[0\]\.markers\[0\]\.text must be at least 4 characters/);
    bad(input({ changes: [change(1, [{ kind: 'bundle', url: 'ftp://x/', text: 'abcd' }])] }), /must use http or https/);
    bad(input({ changes: [change(1, [{ kind: 'version', url: 'https://user:pw@x.example/v' }])] }), /must not contain a user name or password/);
  });

  it('enforces the marker rules', () => {
    bad(input({ changes: [change(1, [{ kind: 'none', reason: 'x' }, versionMarker])] }), /a none marker must be the only marker/);
    bad(input({ changes: [change(1, [bundle('abcd')], { markerSource: 'implicit' })] }), /implicit markers can only be version markers/);
    bad(input({ changes: [change(1, [versionMarker], { cardProblems: ['x'] })] }), /cardProblems is only allowed with markerSource implicit/);
    bad(input({ changes: [change(1, [versionMarker, versionMarker])] }), /lists .* more than once/);
    bad(input({ changes: [implicit(1), { ...implicit(2), subject: 'pr#1' }] }), /changes lists pr#1 more than once/);
  });

  it('keeps observations consistent', () => {
    bad(input({ bundles: [page({ found: ['x-y-z'] })] }), /found lists text that was not searched for/);
    bad(input({ bundles: [page({ versionUrl: 'https://other.example/v' })] }), /versionUrl has no entry in versions/);
    const unreadablePage: BundleObservation = { url: PAGE, at: AT, status: 'unreadable', complete: false, files: 0, bytes: 0, searched: ['q'], found: ['q'], reason: 'x' };
    bad(input({ bundles: [unreadablePage] }), /an unreadable page/);
    bad(input({ versions: [{ url: VERSION, at: AT, status: 'unreadable' }] }), /versions\[0\]\.reason must be a non-empty string/);
    bad(input({ versions: [{ url: VERSION, at: AT, status: 'ok', reported: 'abc1234', commit: RUNNING, digest: DIGEST }] }), /does not start with the reported commit/);
  });
});

describe('readback replay and sightings', () => {
  const recorded = input({
    changes: [change(2, [bundle('data-sync-state')]), implicit(1)],
    ancestry: [contains(1, true), contains(2, true)],
    bundles: [page({ searched: ['data-sync-state'], found: ['data-sync-state'] })],
    history: null,
  });

  it('is registered, and a recorded run replays byte for byte', () => {
    const r = runCheck(readbackCheck, recorded, AT);
    assert.equal(defaultRegistry().get('readback', 1), readbackCheck as never);
    assert.equal(replayRun(defaultRegistry(), r).status, 'match');
    const edited = structuredClone(r);
    (edited.verdicts[1] as Verdict).outcome = 'pass';
    (edited.verdicts[1] as Verdict).state = 'live';
    (edited.verdicts[1] as Verdict).reasons = ['edited'];
    assert.equal(replayRun(defaultRegistry(), edited).status, 'mismatch');
  });

  it('turns present markers into sightings, and contradicted ones into nothing', () => {
    const sightings = readbackSightings(readbackCheck.parseInput(recorded), EVENT);
    assert.deepEqual(
      sightings.map((s) => [s.change, s.marker]),
      [
        [c(2), markerKey(bundle('data-sync-state'))],
        [c(1), markerKey(versionMarker)],
      ],
    );
    const contradicted = { ...recorded, ancestry: [contains(1, true), contains(2, false)] };
    assert.deepEqual(readbackSightings(contradicted, EVENT).map((s) => s.change), [c(1)]);
  });

  it('keys markers unambiguously', () => {
    assert.notEqual(markerKey(bundle('a|b')), markerKey({ kind: 'bundle', url: `${PAGE}|a`, text: 'b' } as Marker));
    assert.equal(markerKey(versionMarker), canonicalJson(['version', VERSION]));
  });
});
