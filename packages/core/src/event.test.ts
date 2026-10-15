import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createHash } from 'node:crypto';
import {
  eventFileContent,
  eventId,
  eventPath,
  invariantCheck,
  parseEventFile,
  runCheck,
  type SeamEvent,
} from './index.js';

const AT = '2026-10-14T12:34:56.789Z';

function event(over: Partial<SeamEvent> = {}): SeamEvent {
  return {
    v: 1,
    kind: 'verdict',
    at: AT,
    actor: { kind: 'agent', harness: 'claude-code', session: 's-1' },
    tool: { name: 'seamkit', version: '0.0.0' },
    body: { run: runCheck(invariantCheck, { subject: 's', scope: 'rows', examined: 1, violations: 0 }, AT) },
    ...over,
  };
}

describe('event files', () => {
  it('names a file by time and by the sha256 of its canonical content', () => {
    const e = event();
    const id = eventId(e);
    const content = eventFileContent(e);
    assert.equal(createHash('sha256').update(content.slice(0, -1)).digest('hex'), id);
    assert.equal(eventPath(e.at, id), `events/2026/10/14/20261014T123456789Z-${id}.json`);
    const parsed = parseEventFile(eventPath(e.at, id), content);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.ok && parsed.known, true);
  });

  it('detects edited, re-formatted, misplaced and truncated files', () => {
    const e = event();
    const id = eventId(e);
    const path = eventPath(e.at, id);
    const content = eventFileContent(e);

    const edited = parseEventFile(path, content.replace('"examined":[{"count":1', '"examined":[{"count":2'));
    assert.equal(edited.ok, false);
    assert.ok(!edited.ok && edited.problems.some((p) => p.includes('does not match the id')));

    const pretty = parseEventFile(path, `${JSON.stringify(JSON.parse(content), null, 2)}\n`);
    assert.ok(!pretty.ok && pretty.problems.includes('content is not in canonical form'));

    const moved = parseEventFile(path.replace('/14/', '/15/'), content);
    assert.ok(!moved.ok && moved.problems.some((p) => p.includes('does not match the event time')));

    const noNewline = parseEventFile(path, content.slice(0, -1));
    assert.ok(!noNewline.ok && noNewline.problems.includes('file must end with exactly one newline'));

    assert.equal(parseEventFile('events/x.json', content).ok, false);
  });

  it('checks the integrity of unknown kinds without claiming to validate them', () => {
    const later = { v: 1, kind: 'ruling', at: AT, body: {} };
    const json = JSON.stringify({ at: AT, body: {}, kind: 'ruling', v: 1 });
    const id = createHash('sha256').update(json).digest('hex');
    const parsed = parseEventFile(eventPath(later.at, id), `${json}\n`);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.ok && parsed.known, false);
  });

  it('refuses an email address as an actor handle', () => {
    const e = event({ actor: { kind: 'human', handle: 'someone@example.com' } });
    const id = eventId(e);
    const parsed = parseEventFile(eventPath(e.at, id), eventFileContent(e));
    assert.ok(!parsed.ok && parsed.problems.some((p) => p.includes('not an email address')));
  });
});
