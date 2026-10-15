# seamkit

seamkit is a set of deterministic production checks for small teams whose code is mostly written by AI agents. It sits
between "a change merged" and "the change is proven live in production", and agents, models and humans use it through
the same command line tool, MCP server, GitHub Action and harness hooks. No model runs inside it.

This repository is pre-release. The design is in `docs/architecture.md` and the survey of existing tools is in
`docs/prior-art.md`.

## Outcomes

Every check returns one of four outcomes, and the process exit code says which one, so a shell agent cannot mistake one
for another. A check that looked at nothing never passes.

| Exit code | Outcome |
|---|---|
| 0 | pass |
| 1 | fail |
| 2 | usage or configuration error; no verdict was produced |
| 3 | examined nothing |
| 4 | unclassified, which stops for a human |

## Readback: is the merged change live?

A merged change counts as shipped only after production has been read back and shows it. `seamkit readback` walks the
first-parent history of the default branch, one change per merged pull request or direct commit, and asks production
two questions about each change.

The first question is which commit production runs. A version document answers it: a small JSON file, written at build
time by `seamkit stamp` and served by production at `/version.json`, `/api/version` or `/version`. Every change whose
commit is an ancestor of the running commit is live by version, and every later change is not. A build stamped from a
working tree with uncommitted changes proves nothing, and readback says so rather than trusting it.

The second question is whether production serves what the change added. A change's scope card, a fenced block in its
pull request description that reaches the history with its merge (see Scope cards), can name markers: text that the
built output must contain, or a version document of its own for a server function. Readback reads the page, the scripts
and styles it loads from its own origin, and the chunks those scripts name, and searches all of them for each marker's
text.

| State | Condition | Outcome |
|---|---|---|
| live | every marker is present | pass |
| not live | a marker that an earlier, recorded run saw is absent now, as after a rollback | fail |
| not proven | a marker is absent and was never seen, or production's version contradicts it | fail |
| not proven | nothing is absent, but some marker could not be read | examined nothing |
| nothing to prove | the card declares that nothing deployed changes | examined nothing |

A marker counts as absent only when every file the page references was read. When a file could not be read, or the
search reached its limits, an unfound marker is "could not be read" instead. A change with nothing to prove is never
reported as live, because the card's claim is an agent's, and accepting it is a human's call.

`seamkit audit --url https://your.app` is readback over the last 20 changes with no configuration at all. After the
verdicts it lists, for every gap it found, the change that would close it, so that "examined nothing" becomes a to-do
list. Its first run against one of the author's own deployed sites examined 0 of 20 changes, because the site serves no
version document, which is exactly the finding it exists to surface. The site then added a route that returns the
commit its host reports for the deployment, merged with a card naming that route, and the same audit proved 20 of 20
changes live.

## The demo

`npm run demo` seeds an invented notes service with twenty pull requests written as if by agents, serves the build of
pull request 17 from a local fake production and records a readback, then rolls production back to the build of pull
request 14 and reads back again. The second run sorts the twenty changes as follows (abridged where a line reads
`...`):

```
NOT LIVE  3 of 20  (3 fail)
  pr#17  Export notes as CSV
         marker "Export as CSV" not found in 3 files served from http://127.0.0.1:33413/; production runs e48d7758f6ec, which does not contain this change; it was seen live at 2026-10-14T19:02:20.551Z (event 5fe217c110c7)
         production at http://127.0.0.1:33413/api/notes-export/version.json runs e48d7758f6ec, which does not contain this change; it was seen live at 2026-10-14T19:02:20.523Z (event 5fe217c110c7)
  pr#16  Pin notes to the top of the list
         production runs e48d7758f6ec, which does not contain this change; it was seen live at 2026-10-14T19:02:20.366Z (event 5fe217c110c7)
  ...

NOT PROVEN  5 of 20  (1 examined nothing, 4 fail)
  ...
  pr#18  Queue edits while offline
         marker "offline-queue" not found in 3 files served from http://127.0.0.1:33413/; production runs e48d7758f6ec, which does not contain this change
  pr#12  Store sync state per note
         1 of 1 marker could not be read
         database object notes.sync_state: this version of seamkit has no adapter for database markers
  pr#11  Show a sync badge on each note
         marker "SyncBadge" not found in 3 files served from http://127.0.0.1:33413/, although production's version e48d7758f6ec contains this change; the text is probably not in the built output (text that exists only in source, such as a comment or a component name, never reaches a bundle)

NOTHING TO PROVE  3 of 20  (3 examined nothing)
  pr#13  Cache dependencies in CI
         nothing to prove, as its card declares: CI configuration only
  ...

LIVE  9 of 20  (9 pass)
  pr#14  Add keyboard shortcuts for new note and search
         marker "shortcut-help" found in 3 files served from http://127.0.0.1:33413/
  ...
  pr#6   Retry notes-sync on transient errors
         production at http://127.0.0.1:33413/api/notes-sync/version.json runs e48d7758f6ec, which contains this change
  ...

FAIL  readback  main
  proven live 9 of 20 changes
  not live 3: seen live earlier, absent now
  not proven 5: 4 absent or contradicted, 1 could not be read
  nothing to prove 3, by their cards' claims, which a human has to accept
  production at http://127.0.0.1:33413/version.json runs e48d7758f6ec (pr#14)
  production at http://127.0.0.1:33413/api/notes-export/version.json runs e48d7758f6ec (pr#14)
  production at http://127.0.0.1:33413/api/notes-sync/version.json runs e48d7758f6ec (pr#14)
  not examined: changes before the last 20 on main (outside --last)
  not examined: 1 item listed with the changes above
```

Pull request 11 shows the most common marker mistake. Its card names a component, which appears in the source only in
a comment, so the build drops it and production can never serve it. Pull requests 6 and 17 each changed a server
function, and their cards point at the function's own version document, which the reasons name. The port, times and
event ids differ from run to run. The commit ids do not, because the demo's history is seeded with fixed identities and
dates, and the demo's test pins every state shown here.

## Scope cards

````markdown
```seamkit-card
card: 1
intent: Show a saved indicator after a note is synced.
layers: [frontend]
targets: [web]
markers:
  - kind: bundle
    text: "data-sync-state"
  - kind: version
    url: /api/notes-sync/version.json
releaseNote: Notes now show when they were last saved.
```
````

The parser is strict. It rejects unknown fields, YAML aliases and custom tags, and reports every problem in one pass,
each naming the field and the fix, so an agent can repair a card with one edit. A marker's `url` may be a path, which
readback resolves against the production URL it is given, so one card serves staging and production alike. A marker of
kind `none` with a reason declares that nothing deployed changes. A change without a card, or with a card that does not
parse, is proven by version alone, and a broken card stays listed among the change's gaps.

Readback finds cards in the history rather than through GitHub's API, so a card counts once its merge commit carries it.
GitHub writes the description into the merge commit only when the repository's default commit message is "Pull
request title and description" (Settings, General, Pull Requests), for merge commits and squash merges alike. With the
default message the card is lost and the change is proven by version alone, and `seamkit audit` says so when it
finds no cards.

## Version documents

```sh
npx seamkit stamp --out public/version.json   # before the build; most bundlers copy public/ into the output
```

```json
{ "schema": "seamkit.version/1", "commit": "<full commit id>", "dirty": false, "source": "git", "ref": "main" }
```

Stamp prefers git, because only git can tell a clean working tree from one with uncommitted changes. Where the build
system copies the source without its history, it falls back to the commit the CI system provides, such as
`VERCEL_GIT_COMMIT_SHA` or `GITHUB_SHA`, and records that the tree's cleanliness is unknown. Readback also reads the
version documents other tools serve, from fields such as `commit`, `sha` or `git.commit.id`, and refuses a document
whose fields name two different commits.

## The ledger

Verdicts are recorded on a separate `seamkit/state` branch, one file per event, named by the SHA-256 of its content.
The branch is written with git plumbing, so it never touches your working tree, index or HEAD. `seamkit state init`
creates it, and from then on every readback is recorded, which is what lets a later run call a change not live rather
than merely not proven. `seamkit state verify` checks every file against its name, `seamkit replay` recomputes every
recorded verdict from its recorded observations and fails if any comes out differently, and `seamkit state sync` merges
and pushes the branch without forcing.

seamkit records URLs, commit ids, marker texts and digests of what production served, never the content itself. A
production URL with credentials or a query string is refused for that reason.

## Development

```sh
npm ci
npm test       # 117 tests on Node 20 and 22, using temporary repositories and a local fake production
npm run demo   # the demo above; add -- --keep to keep the demo repository
```

Licensed under the Apache License, Version 2.0. See `LICENSE`.
