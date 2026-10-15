import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractCardBlocks, parseCard, parseChangeMessage, readCard } from './index.js';

const CARD = [
  'card: 1',
  'intent: Show a saved indicator after a note is synced.',
  'layers: [frontend]',
  'targets: [web]',
  'markers:',
  '  - kind: bundle',
  '    text: "data-sync-state"',
  '  - kind: version',
  '    url: https://notes.example/version.json',
  'releaseNote: Notes now show when they were last saved.',
  'risk: ship_alone',
].join('\n');

const body = (card: string, fence = '```'): string => `Adds the indicator.\n\n${fence}seamkit-card\n${card}\n${fence}\n\nThanks.`;

const problemsOf = (text: string): string[] => {
  const r = parseCard(text);
  assert.equal(r.ok, false, 'expected the card to be refused');
  return r.ok ? [] : r.problems;
};

describe('scope card', () => {
  it('reads a card from a pull request body', () => {
    const r = readCard(body(CARD));
    assert.ok(r.found && r.ok);
    assert.deepEqual(r.card, {
      card: 1,
      intent: 'Show a saved indicator after a note is synced.',
      layers: ['frontend'],
      targets: ['web'],
      markers: [
        { kind: 'bundle', text: 'data-sync-state' },
        { kind: 'version', url: 'https://notes.example/version.json' },
      ],
      releaseNote: 'Notes now show when they were last saved.',
      risk: 'ship_alone',
    });
  });

  it('reads Windows line endings and tilde fences, and finds no card where there is none', () => {
    const r = readCard(body(CARD, '~~~~').replace(/\n/g, '\r\n'));
    assert.ok(r.found && r.ok);
    assert.deepEqual(readCard('No card here.\n```yaml\ncard: 1\n```'), { found: false });
  });

  it('refuses two cards and an unclosed one', () => {
    const two = readCard(`${body(CARD)}\n${body(CARD)}`);
    assert.ok(two.found && !two.ok && /2 seamkit-card blocks/.test(two.problems[0] ?? ''));
    const open = readCard('```seamkit-card\ncard: 1\n');
    assert.ok(open.found && !open.ok && /never closed/.test(open.problems[0] ?? ''));
  });

  it('collects every problem in one pass, each naming the field and the fix', () => {
    const problems = problemsOf(['card: 2', 'risks: high', 'layers: [backend]', 'targets: web', 'markers:', '  - kind: bundel'].join('\n'));
    assert.deepEqual(problems, [
      'card has unknown field(s): risks; allowed: card, intent, layers, targets, markers, releaseNote, risk',
      'card must be 1, the card format version; got 2',
      'intent is required: one sentence saying what the change does and why',
      'layers[0] must be one of frontend, function, schema, data, config; got "backend"',
      'targets must be a list, got "web": what the change deploys, such as web or fn:notes-sync; use [] when nothing deployed changes',
      'markers[0].kind must be one of bundle, version, db_object, none; got "bundel"',
    ]);
  });

  it('enforces the marker rules', () => {
    const base = 'card: 1\nintent: x\nlayers: []\ntargets: []\nmarkers:\n';
    assert.match(problemsOf(`${base}  - kind: none\n    reason: tests only\n  - kind: version`).join('\n'), /a none marker must be the only marker/);
    assert.match(problemsOf(`${base}  - kind: bundle\n    text: 2024`).join('\n'), /markers\[0\]\.text must be a string; quote it, for example text: "2024"/);
    assert.match(problemsOf(`${base}  - kind: bundle\n    text: abc`).join('\n'), /at least 4 characters/);
    assert.match(problemsOf(`${base}  - kind: version\n    url: ftp://x.example/v`).join('\n'), /absolute http or https URL/);
    assert.match(problemsOf(`${base}  - kind: version\n    url: //x.example/v`).join('\n'), /must be a path such as \/version\.json/);
    const path = parseCard(`${base}  - kind: version\n    url: /api/notes-sync/version.json`);
    assert.ok(path.ok && path.card.markers[0]?.kind === 'version' && path.card.markers[0].url === '/api/notes-sync/version.json');
    assert.match(problemsOf(`${base}  - kind: version\n    text: oops`).join('\n'), /unknown field\(s\) for kind version: text/);
    assert.match(problemsOf('card: 1\nintent: x\nlayers: []\ntargets: []\nmarkers: []').join('\n'), /at least one marker/);
    const none = parseCard(`${base}  - kind: none\n    reason: tests only`);
    assert.ok(none.ok && none.card.markers[0]?.kind === 'none');
  });

  it('refuses YAML tricks: duplicate keys, aliases and custom tags', () => {
    assert.match(problemsOf('card: 1\ncard: 1').join('\n'), /not valid YAML/);
    const aliased = 'card: 1\nintent: &a x\nlayers: []\ntargets: []\nmarkers:\n  - kind: none\n    reason: *a';
    assert.match(problemsOf(aliased).join('\n'), /not valid YAML/);
    assert.match(problemsOf('card: !!js/function "x"').join('\n'), /not valid YAML/);
  });

  it('reads YAML 1.2, so yes and no stay strings', () => {
    const r = parseCard('card: 1\nintent: no\nlayers: []\ntargets: []\nmarkers:\n  - kind: none\n    reason: yes');
    assert.ok(r.ok);
    assert.equal(r.card.intent, 'no');
  });

  it('removes the fence indentation from content lines', () => {
    assert.deepEqual(extractCardBlocks('  ```seamkit-card\n  card: 1\n    x: y\n  ```').blocks, ['card: 1\n  x: y']);
  });
});

describe('commit messages', () => {
  it('reads a merge commit in each of the three forms GitHub writes', () => {
    // Default message: the number and branch first, the title on the third line.
    assert.deepEqual(parseChangeMessage('Merge pull request #12 from agent/sync-badge\n\nShow sync state', 2), {
      kind: 'pull_request',
      pr: 12,
      title: 'Show sync state',
    });
    // Pull request title, and pull request title and description, which carries the card.
    assert.deepEqual(parseChangeMessage('Show sync state (#12)', 2), { kind: 'pull_request', pr: 12, title: 'Show sync state' });
    assert.deepEqual(parseChangeMessage('Show sync state (#12)\n\nAdds a badge.\n\n```seamkit-card\ncard: 1\n```', 2), {
      kind: 'pull_request',
      pr: 12,
      title: 'Show sync state',
    });
    assert.deepEqual(parseChangeMessage('Merge pull request #12 from agent/sync-badge', 2), { kind: 'pull_request', pr: 12, title: 'agent/sync-badge' });
  });

  it('reads a squash merge, a plain merge and a direct commit', () => {
    assert.deepEqual(parseChangeMessage('Show sync state (#14)\r\n\r\n* fix', 1), { kind: 'pull_request', pr: 14, title: 'Show sync state' });
    assert.deepEqual(parseChangeMessage("Merge branch 'x' into main", 2), { kind: 'merge', title: "Merge branch 'x' into main" });
    assert.deepEqual(parseChangeMessage('site: fix the header (#a)', 1), { kind: 'commit', title: 'site: fix the header (#a)' });
    assert.deepEqual(parseChangeMessage('', 1), { kind: 'commit', title: '(no message)' });
  });
});
