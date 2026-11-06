# Readback states and scope cards

How readback decides each change's state, and how a `seamkit-card` in a pull request names evidence beyond the version.

## Readback states

A merged change counts as shipped only after production has been read back and shows it. Readback walks the
first-parent history of the default branch, one change per merged pull request or direct commit.

| State | Condition | Outcome |
|---|---|---|
| live | every marker is present | pass |
| not live | a marker that an earlier, recorded run saw is absent now, as after a rollback | fail |
| not proven | a marker is absent and was never seen, or production's version contradicts it | fail |
| not proven | nothing is absent, but some marker could not be read | examined nothing |
| nothing to prove | the change's card declares that nothing deployed changes | examined nothing |

A change is checked against production's version document: if the commit production runs contains the change, the
change is live by version. A change can name more evidence in a scope card, below. A change with nothing to prove is
never reported as live, because that claim is the author's, and accepting it is a human's call.

## Scope cards: prove more than the version

A card is a fenced block in a pull request description. It names markers, which are evidence production must serve:
text that the built output must contain, or a version document of its own, such as a server function's.

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

Readback reads the page, the scripts and styles it loads from its own origin, and the chunks those scripts name, and
searches all of them for each marker's text. A marker counts as absent only when every file was read; otherwise it
"could not be read". A marker found in a build whose version does not contain the change is contradicted, because the
text is not unique to the change. A marker must be text that the built output contains: a component name or a comment
exists only in source and will never be found, and readback says so when the version shows the change is deployed.

The parser is strict. It rejects unknown fields, YAML aliases and custom tags, and reports every problem in one pass,
each naming the field and the fix, so an agent can repair a card with one edit. A card lists at most 20 markers, and
one readback reads at most 100 version documents, 100 pages and 1000 marker texts on a page; the newest changes come
first, and an older card whose markers do not fit is proven by version alone and says so. A marker's `url` may be a path, which
readback resolves against the production URL it is given, so one card serves staging and production alike. It may
also be an absolute URL on another host, such as a separate API, which readback reads as given. A marker of
kind `none` with a reason declares that nothing deployed changes.

Readback finds cards in the history, so a card counts once its merge commit carries it. GitHub writes the pull request
description into the merge commit only when the repository's default commit message is "Pull request title and
description" (Settings, General, Pull Requests), for merge commits and squash merges alike. Without that setting,
changes are proven by version alone, and `seamkit audit` says so.

Back to the [README](../README.md).
