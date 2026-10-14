/**
 * The demo's history: an invented notes service (a web app and two server functions) built by
 * agents through twenty pull requests. Each pull request appends to or creates files, and most
 * carry the scope card an agent would write. The history is seeded with fixed identities and
 * dates, so every commit id is the same on every machine.
 */
export interface Edit {
  path: string;
  /** Text appended to the file, which is created when missing. */
  add: string;
}

export interface PullRequest {
  n: number;
  branch: string;
  title: string;
  summary: string;
  edits: Edit[];
  /** The YAML inside the card's fenced block, or undefined for a pull request without a card. */
  card?: string;
}

export const INITIAL_FILES: Readonly<Record<string, string>> = {
  'README.md': '# notes\n\nA notes service: a web app and two server functions.\n',
  '.gitignore': 'node_modules/\ndist/\n',
};

const card = (intent: string, layers: string, targets: string, markers: string, releaseNote?: string): string =>
  [
    'card: 1',
    `intent: ${intent}`,
    `layers: [${layers}]`,
    `targets: [${targets}]`,
    'markers:',
    markers,
    ...(releaseNote ? [`releaseNote: ${releaseNote}`] : []),
  ].join('\n');

const bundle = (text: string): string => `  - kind: bundle\n    text: "${text}"`;
const version = (path: string): string => `  - kind: version\n    url: ${path}`;
const none = (reason: string): string => `  - kind: none\n    reason: ${reason}`;

export const PULL_REQUESTS: readonly PullRequest[] = [
  {
    n: 1,
    branch: 'scaffold-notes',
    title: 'Scaffold the notes web app',
    summary: 'Adds the page, the note list and the base styles.',
    edits: [
      {
        path: 'web/index.html',
        add: '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>notes</title>\n<link rel="stylesheet" href="style.css">\n</head>\n<body>\n<ul id="notes-root"></ul>\n<script type="module" src="app.js"></script>\n</body>\n</html>\n',
      },
      {
        path: 'web/app.js',
        add: "// Renders the note list into the page.\nconst root = document.getElementById('notes-root');\nconst state = { notes: [] };\nfunction render() {\n  root.innerHTML = state.notes.map((n) => `<li class=\"note\">${n.title}</li>`).join('');\n}\nrender();\n",
      },
      { path: 'web/style.css', add: '/* Base styles. */\nbody { font-family: system-ui, sans-serif; margin: 2rem; }\n.note { padding: 0.5rem 0; }\n' },
    ],
    card: card('Render the note list on a page.', 'frontend', 'web', bundle('notes-root'), 'Notes are listed on the home page.'),
  },
  {
    n: 2,
    branch: 'sync-function',
    title: 'Add the notes-sync function',
    summary: 'Saves edited notes to the store.',
    edits: [{ path: 'functions/notes-sync.js', add: '// Saves edited notes.\nexport async function sync(notes, store) {\n  return store.put(notes);\n}\n' }],
  },
  {
    n: 3,
    branch: 'note-editor',
    title: 'Add a note editor with autosave',
    summary: 'Edits save a draft every second.',
    edits: [{ path: 'web/app.js', add: "// Editor: autosaves a draft.\nconst status = document.createElement('p');\nfunction autosave() {\n  status.textContent = 'Saving draft';\n}\nsetInterval(autosave, 1000);\n" }],
    card: card('Let people edit a note, saving a draft as they type.', 'frontend', 'web', bundle('Saving draft'), 'Notes save a draft while you type.'),
  },
  {
    n: 4,
    branch: 'sync-tests',
    title: 'Add tests for sync conflict detection',
    summary: 'Covers two edits of one note from two devices.',
    edits: [{ path: 'tests/sync.test.js', add: "// Two devices edit one note; the later edit must not be lost.\ntest('conflicting edits are both kept', () => {});\n" }],
    card: card('Test conflict detection in sync.', '', '', none('tests only; nothing deployed changes')),
  },
  {
    n: 5,
    branch: 'empty-state',
    title: 'Show an empty state when there are no notes',
    summary: 'A first visit shows a hint instead of a blank page.',
    edits: [{ path: 'web/app.js', add: "if (state.notes.length === 0) root.dataset.empty = 'No notes yet';\n" }],
    card: card('Show a hint when the list is empty.', 'frontend', 'web', bundle('No notes yet'), 'An empty list now says so.'),
  },
  {
    n: 6,
    branch: 'sync-retry',
    title: 'Retry notes-sync on transient errors',
    summary: 'Retries three times with backoff before giving up.',
    edits: [{ path: 'functions/notes-sync.js', add: '// Retry transient store errors with backoff.\nexport const RETRIES = 3;\n' }],
    card: card('Retry sync when the store answers with a transient error.', 'function', 'fn:notes-sync', version('/api/notes-sync/version.json'), 'Syncing recovers from brief outages.'),
  },
  {
    n: 7,
    branch: 'search',
    title: 'Add search across note titles',
    summary: 'Filters the list as you type.',
    edits: [{ path: 'web/app.js', add: "const search = document.createElement('input');\nsearch.placeholder = 'Search notes';\n" }],
    card: card('Filter notes by title.', 'frontend', 'web', bundle('Search notes'), 'You can search your notes.'),
  },
  {
    n: 8,
    branch: 'export-function',
    title: 'Add the notes-export function',
    summary: 'Exports every note as JSON.',
    edits: [{ path: 'functions/notes-export.js', add: '// Exports notes.\nexport function exportNotes(notes) {\n  return JSON.stringify(notes);\n}\n' }],
  },
  {
    n: 9,
    branch: 'docs-sync',
    title: 'Document the sync protocol',
    summary: 'Explains how conflicts are detected and kept.',
    edits: [{ path: 'docs/sync.md', add: '# Sync\n\nEach edit carries the version it was based on. A conflict keeps both edits.\n' }],
    card: card('Document how sync handles conflicts.', '', '', none('documentation only')),
  },
  {
    n: 10,
    branch: 'dark-mode',
    title: 'Add a dark theme',
    summary: 'Follows the system setting.',
    edits: [
      { path: 'web/style.css', add: '.theme-dark { background: #111; color: #eee; }\n' },
      { path: 'web/app.js', add: "document.body.classList.toggle('theme-dark', matchMedia('(prefers-color-scheme: dark)').matches);\n" },
    ],
    card: card('Offer a dark theme that follows the system setting.', 'frontend', 'web', bundle('theme-dark'), 'Notes has a dark theme.'),
  },
  {
    n: 11,
    branch: 'sync-badge',
    title: 'Show a sync badge on each note',
    summary: 'Each note shows whether its last edit is saved.',
    edits: [{ path: 'web/app.js', add: "// SyncBadge: shows saved or pending on each note.\nconst badge = document.createElement('span');\nbadge.className = 'sync-pill';\n" }],
    // The marker is the component's name, which appears only in a source comment: the build drops
    // it, so production can never show it. This is the bundle-marker lesson.
    card: card('Show on each note whether its last edit is saved.', 'frontend', 'web', bundle('SyncBadge'), 'Each note shows whether it is saved.'),
  },
  {
    n: 12,
    branch: 'sync-state-column',
    title: 'Store sync state per note',
    summary: 'Adds a sync_state column and writes it from notes-sync.',
    edits: [
      { path: 'migrations/003_sync_state.sql', add: 'ALTER TABLE notes ADD COLUMN sync_state text;\n' },
      { path: 'functions/notes-sync.js', add: "export const SYNC_STATE_COLUMN = 'sync_state';\n" },
    ],
    card: card('Record each note\'s sync state in the database.', 'function, schema', 'fn:notes-sync, notes', `  - kind: db_object\n    object: notes.sync_state`),
  },
  {
    n: 13,
    branch: 'ci-cache',
    title: 'Cache dependencies in CI',
    summary: 'Cuts CI time by reusing the dependency cache.',
    edits: [{ path: '.github/workflows/ci.yml', add: 'name: ci\non: [pull_request]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n' }],
    card: card('Make CI faster.', '', '', none('CI configuration only')),
  },
  {
    n: 14,
    branch: 'keyboard-shortcuts',
    title: 'Add keyboard shortcuts for new note and search',
    summary: 'N starts a note and / focuses search.',
    edits: [{ path: 'web/app.js', add: "const help = document.createElement('aside');\nhelp.id = 'shortcut-help';\n" }],
    card: card('Add keyboard shortcuts.', 'frontend', 'web', bundle('shortcut-help'), 'Press N for a new note and / to search.'),
  },
  {
    n: 15,
    branch: 'conflict-banner',
    title: 'Show a banner when a sync conflicts',
    summary: 'Tells the person both edits were kept.',
    edits: [{ path: 'web/app.js', add: "const banner = document.createElement('div');\nbanner.id = 'sync-conflict-banner';\n" }],
    card: card('Tell people when a sync conflict kept both edits.', 'frontend', 'web', bundle('sync-conflict-banner'), 'A banner explains sync conflicts.'),
  },
  {
    n: 16,
    branch: 'pinned-notes',
    title: 'Pin notes to the top of the list',
    summary: 'Pinned notes sort first.',
    edits: [{ path: 'web/app.js', add: 'state.notes.sort((a, b) => Number(b.pinned) - Number(a.pinned));\n' }],
  },
  {
    n: 17,
    branch: 'export-csv',
    title: 'Export notes as CSV',
    summary: 'Adds a CSV format to notes-export and a button for it.',
    edits: [
      { path: 'functions/notes-export.js', add: "export function exportCsv(notes) {\n  return notes.map((n) => n.title).join('\\n');\n}\n" },
      { path: 'web/app.js', add: "const exportButton = document.createElement('button');\nexportButton.textContent = 'Export as CSV';\n" },
    ],
    card: card('Export notes as CSV.', 'frontend, function', 'web, fn:notes-export', `${bundle('Export as CSV')}\n${version('/api/notes-export/version.json')}`, 'Notes can be exported as CSV.'),
  },
  {
    n: 18,
    branch: 'offline-queue',
    title: 'Queue edits while offline',
    summary: 'Edits made offline sync when the connection returns.',
    edits: [{ path: 'web/app.js', add: "const queue = { name: 'offline-queue', items: [] };\n" }],
    card: card('Keep edits made offline and sync them later.', 'frontend', 'web', bundle('offline-queue'), 'Edits made offline are kept.'),
  },
  {
    n: 19,
    branch: 'sync-metrics',
    title: 'Count sync retries',
    summary: 'Adds a retry counter for the dashboard.',
    edits: [{ path: 'functions/notes-sync.js', add: 'export const metrics = { retries: 0 };\n' }],
  },
  {
    n: 20,
    branch: 'note-colors',
    title: 'Let notes have a color',
    summary: 'Adds a color picker to each note.',
    edits: [{ path: 'web/app.js', add: "const picker = document.createElement('input');\npicker.className = 'note-color-picker';\n" }],
    card: card('Let people color their notes.', 'frontend', 'web', bundle('note-color-picker'), 'Notes can have a color.'),
  },
];

/** The demo's script: production first runs this build, then is rolled back to the second. */
export const FIRST_DEPLOY = 17;
export const ROLLBACK_TO = 14;
