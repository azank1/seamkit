import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CanonicalJsonError,
  CheckRegistry,
  EXIT_CODES,
  EXIT_USAGE,
  InputError,
  OUTCOMES,
  VerdictInvariantError,
  assertVerdict,
  canonicalJson,
  combine,
  compose,
  defaultRegistry,
  digest,
  exitCodeFor,
  invariantCheck,
  renderReadback,
  renderSummary,
  renderVerdict,
  replayRun,
  replayVerdict,
  runCheck,
  type CheckDef,
  type Outcome,
  type Verdict,
} from './index.js';

const AT = '2026-10-14T12:00:00.000Z';
const H = 'a'.repeat(64);

function v(outcome: Outcome, over: Partial<Verdict> = {}): Verdict {
  return assertVerdict({
    check: 'test.check',
    subject: 'thing',
    outcome,
    examined: outcome === 'pass' ? [{ item: 'rows', count: 1 }] : [],
    notExamined: [],
    evidence: [],
    reasons: outcome === 'pass' ? [] : ['because'],
    inputs: H,
    at: AT,
    ...over,
  });
}

describe('outcomes', () => {
  it('combines by severity: fail > unclassified > examined_nothing > pass', () => {
    assert.equal(combine(['pass', 'pass']), 'pass');
    assert.equal(combine(['pass', 'examined_nothing']), 'examined_nothing');
    assert.equal(combine(['examined_nothing', 'unclassified', 'pass']), 'unclassified');
    assert.equal(combine(['unclassified', 'fail', 'examined_nothing']), 'fail');
  });

  it('combines nothing into examined_nothing, unlike the vacuous truth of [].every', () => {
    // Negative control: the naive aggregation that prints PASS on an empty table.
    assert.equal(([] as boolean[]).every(Boolean), true);
    assert.equal(combine([]), 'examined_nothing');
  });

  it('maps outcomes to distinct exit codes, all non-zero except pass, none equal to the usage code', () => {
    assert.deepEqual(EXIT_CODES, { pass: 0, fail: 1, examined_nothing: 3, unclassified: 4 });
    const codes = OUTCOMES.map(exitCodeFor);
    assert.equal(new Set(codes).size, OUTCOMES.length);
    assert.ok(!codes.includes(EXIT_USAGE));
    for (const o of OUTCOMES) if (o !== 'pass') assert.notEqual(exitCodeFor(o), 0);
  });
});

describe('canonical JSON', () => {
  it('matches the RFC 8785 example', () => {
    const input = JSON.parse(
      '{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],"string":"\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/","literals":[null,true,false]}',
    );
    assert.equal(
      canonicalJson(input),
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });

  it('sorts keys, drops undefined properties and is stable', () => {
    assert.equal(canonicalJson({ b: 1, a: { d: [1, 'x'], c: null }, e: undefined }), '{"a":{"c":null,"d":[1,"x"]},"b":1}');
    assert.equal(digest({ x: 1, y: 2 }), digest({ y: 2, x: 1 }));
    assert.match(digest({}), /^[0-9a-f]{64}$/);
    assert.equal(canonicalJson(-0), '0');
  });

  it('rejects anything that is not plain JSON data', () => {
    for (const bad of [NaN, Infinity, 1n, new Date(0), new Map(), () => 1, Symbol('s'), [undefined], '\uD800']) {
      assert.throws(() => canonicalJson(bad), CanonicalJsonError, String(typeof bad));
    }
  });
});

describe('verdict invariants', () => {
  it('refuses a pass that examined nothing (zero rows is never a pass)', () => {
    assert.throws(() => v('pass', { examined: [] }), VerdictInvariantError);
    assert.throws(() => v('pass', { examined: [{ item: 'rows', count: 0 }] }), /zero rows is never a pass/);
    assert.doesNotThrow(() => v('pass', { examined: [{ item: 'the version endpoint' }] }));
  });

  it('requires a reason for every outcome but pass', () => {
    for (const o of OUTCOMES) {
      if (o === 'pass') continue;
      assert.throws(() => v(o, { reasons: [] }), /must give at least one reason/);
    }
  });

  it('checks counts, denominators, time and digest', () => {
    assert.throws(() => v('fail', { examined: [{ item: 'rows', count: 5, of: 3 }] }), /exceeds its denominator/);
    assert.throws(() => v('fail', { examined: [{ item: 'rows', count: -1 }] }), /non-negative integer/);
    assert.throws(() => v('fail', { at: '14 Oct 2026' }), /ISO 8601/);
    assert.throws(() => v('fail', { inputs: 'abc' }), /sha256/);
    assert.throws(() => v('fail', { notExamined: [{ item: 'x', reason: '' }] }), /reason/);
  });
});

describe('compose', () => {
  it('turns no parts into examined_nothing', () => {
    const c = compose('gate', 'pr#1', [], AT);
    assert.equal(c.outcome, 'examined_nothing');
    assert.match(c.reasons[0] ?? '', /no checks were evaluated/);
  });

  it('keeps every gap and reason, prefixed by the part that produced it', () => {
    const parts = [
      v('pass', { check: 'ci', examined: [{ item: 'runs on head', count: 2 }] }),
      v('examined_nothing', {
        check: 'sandbox',
        notExamined: [{ item: 'sandbox evidence', reason: 'no_adapter' }],
        reasons: ['no sandbox adapter is configured'],
      }),
    ];
    const c = compose('gate', 'pr#1', parts, AT);
    assert.equal(c.outcome, 'examined_nothing');
    assert.deepEqual(c.notExamined, [{ item: 'sandbox (thing): sandbox evidence', reason: 'no_adapter' }]);
    assert.deepEqual(c.reasons, ['sandbox (thing): no sandbox adapter is configured']);
    assert.deepEqual(c.examined, [{ item: 'ci (thing): runs on head', count: 2 }]);
  });

  it('fails when any part fails, and its inputs digest depends on the parts', () => {
    const a = compose('gate', 's', [v('pass'), v('fail')], AT);
    assert.equal(a.outcome, 'fail');
    const b = compose('gate', 's', [v('pass'), v('fail', { inputs: 'b'.repeat(64) })], AT);
    assert.notEqual(a.inputs, b.inputs);
  });
});

describe('invariant check', () => {
  const run = (input: unknown) => runCheck(invariantCheck, input, AT).verdicts[0] as Verdict;

  it('returns examined_nothing for an empty table, where counting violations alone would pass', () => {
    const input = { subject: 'notes.owner_set', scope: 'rows in notes', examined: 0, violations: 0 };
    // Negative control: the suite that only counts violations reports success here.
    assert.equal(input.violations === 0, true);
    const verdict = run(input);
    assert.equal(verdict.outcome, 'examined_nothing');
    assert.equal(verdict.state, 'no_rows');
    assert.deepEqual(verdict.examined, [{ item: 'rows in notes', count: 0 }]);
  });

  it('fails with a denominator when rows violate it', () => {
    const verdict = run({ subject: 'notes.owner_set', scope: 'rows in notes', examined: 1204, violations: 3, samples: ['n1'] });
    assert.equal(verdict.outcome, 'fail');
    assert.deepEqual(verdict.reasons, ['3 of 1204 rows violate notes.owner_set']);
    assert.deepEqual(verdict.evidence[0], { kind: 'count', value: '3/1204', label: 'violating rows' });
  });

  it('passes only when rows were examined and none violate it', () => {
    const verdict = run({ subject: 'notes.owner_set', scope: 'rows in notes', examined: 1204, violations: 0 });
    assert.equal(verdict.outcome, 'pass');
    assert.equal(verdict.check, 'invariant');
    assert.equal(verdict.at, AT);
  });

  it('rejects malformed input with a message an agent can act on', () => {
    const ok = { subject: 's', scope: 'rows', examined: 2, violations: 0 };
    assert.throws(() => run({ ...ok, extra: 1 }), /unknown field\(s\): extra/);
    assert.throws(() => run({ ...ok, examined: -1 }), InputError);
    assert.throws(() => run({ ...ok, examined: 1.5 }), /non-negative integer/);
    assert.throws(() => run({ ...ok, violations: 3 }), /cannot exceed examined/);
    assert.throws(() => run({ ...ok, subject: '' }), /subject/);
    assert.throws(() => run({ ...ok, samples: Array.from({ length: 21 }, () => 'x') }), /at most 20/);
    assert.throws(() => run([]), /JSON object/);
  });
});

describe('run and replay', () => {
  const input = { subject: 'notes.owner_set', scope: 'rows in notes', examined: 10, violations: 0 };

  it('records the raw input and stamps every verdict with its digest', () => {
    const r = runCheck(invariantCheck, input, AT);
    assert.deepEqual(r.record, { check: 'invariant', version: 1, input });
    assert.equal(r.verdicts[0]?.inputs, digest(r.record));
  });

  it('reproduces a recorded run exactly', () => {
    const r = runCheck(invariantCheck, input, AT);
    const recorded = JSON.parse(JSON.stringify(r));
    assert.deepEqual(replayRun(defaultRegistry(), recorded), { status: 'match', reasons: [], verdictCount: 1 });
  });

  it('detects an edited verdict and an edited input', () => {
    const r = runCheck(invariantCheck, input, AT);
    const editedVerdict = structuredClone(r);
    (editedVerdict.verdicts[0] as Verdict).outcome = 'fail';
    const a = replayRun(defaultRegistry(), editedVerdict);
    assert.equal(a.status, 'mismatch');
    assert.ok(a.reasons.some((x) => x.includes('outcome was "fail", recomputed "pass"')));

    const editedInput = structuredClone(r);
    (editedInput.record.input as { examined: number }).examined = 0;
    const b = replayRun(defaultRegistry(), editedInput);
    assert.equal(b.status, 'mismatch');
    assert.ok(b.reasons.some((x) => x.includes('inputs digest does not match')));
  });

  it('catches a check that is not a pure function', () => {
    // Negative control: a check that reads a random source cannot be replayed.
    let calls = 0;
    const impure: CheckDef<null> = {
      name: 'impure',
      version: 1,
      summary: 'reads state outside its input',
      parseInput: () => null,
      evaluate: () => ({ subject: 's', outcome: 'pass', examined: [{ item: 'rows', count: ++calls }] }),
    };
    const registry = new CheckRegistry().register(impure);
    const recorded = runCheck(impure, null, AT);
    assert.equal(replayRun(registry, recorded).status, 'mismatch');
  });

  it('reports a retired check version as examined_nothing, never a pass', () => {
    const r = runCheck(invariantCheck, input, AT);
    const retired = { ...r, record: { ...r.record, version: 99 } };
    const verdict = replayVerdict(defaultRegistry(), 'f'.repeat(64), retired, AT);
    assert.equal(verdict.outcome, 'examined_nothing');
    assert.equal(verdict.state, 'not_replayable');
    assert.match(verdict.reasons[0] ?? '', /invariant@99 is not known/);
  });

  it('turns matches into passes and mismatches into failures', () => {
    const r = runCheck(invariantCheck, input, AT);
    assert.equal(replayVerdict(defaultRegistry(), 'e'.repeat(64), r, AT).outcome, 'pass');
    const edited = structuredClone(r);
    (edited.verdicts[0] as Verdict).subject = 'other';
    assert.equal(replayVerdict(defaultRegistry(), 'e'.repeat(64), edited, AT).outcome, 'fail');
  });

  it('keeps one definition per name and version', () => {
    const registry = defaultRegistry();
    assert.throws(() => registry.register(invariantCheck), /already registered/);
    assert.equal(registry.get('invariant')?.version, 1);
    assert.equal(registry.get('invariant', 2), undefined);
  });
});

describe('rendering', () => {
  it('always prints the not-examined line and counts outcomes with a total', () => {
    const text = renderVerdict(v('pass'));
    assert.match(text, /^PASS {2}test\.check {2}thing/);
    assert.match(text, /not examined: none listed/);
    assert.equal(renderSummary([v('pass'), v('fail'), v('pass')]), '3 verdicts: 2 pass, 1 fail');
    assert.equal(renderSummary([]), '0 verdicts');
    assert.match(renderVerdict(v('examined_nothing')), /^EXAMINED NOTHING/);
  });

  it('keeps text from a change on its own line, so it cannot write lines that look like the report', () => {
    const forged = 'docs only\n\nPASS  readback  main\r  proven live 3 of 3 changes\u2028x\u0085y';
    const summary = v('fail', { check: 'readback', subject: 'main', notExamined: [{ item: 'pr#1: card', reason: forged }] });
    const change = v('fail', { check: 'readback', subject: 'pr#1', state: 'not_proven', reasons: [forged], evidence: [{ kind: 'text', value: `Fix\nPASS  readback  main`, label: 'title' }] });
    for (const text of [renderReadback([summary, change]), renderVerdict(change)]) {
      assert.ok(!text.split(/\r\n|\r|\n|\u2028|\u2029|\u0085/).some((line) => /^(?:PASS|  proven live)/.test(line)), text);
      assert.ok(text.includes('docs only PASS  readback  main   proven live 3 of 3 changes x y'), text);
    }
  });

  it('turns terminal escapes, backspaces and direction overrides in a change\'s words into spaces', () => {
    const forged = [
      'Tidy\u001b[1EPASS  readback  main\u001b[8m',
      `Tidy\v${'\b'.repeat(8)}PASS  readback  main`,
      'Tidy\fPASS\u001cx\u007f\u009b2J\u202ePASS\u2066',
    ];
    const summary = v('fail', { check: 'readback', subject: 'main', notExamined: forged.map((reason, i) => ({ item: `pr#${i}: card`, reason })) });
    const change = v('fail', { check: 'readback', subject: 'pr#1', state: 'not_proven', reasons: forged, evidence: forged.map((value) => ({ kind: 'text' as const, value, label: 'title' })) });
    for (const text of [renderReadback([summary, change]), renderVerdict(change)]) {
      assert.ok(!/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/.test(text), JSON.stringify(text));
      assert.ok(text.includes('Tidy PASS  readback  main'), text);
    }
  });
});
