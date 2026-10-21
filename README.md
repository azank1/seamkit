# seamkit

**Is your merged change actually live in production? seamkit checks, and answers with an exit code.**

When AI agents write most of the code, changes merge faster than anyone can watch them ship. A green merge is not a
deploy, a deploy is not always the build you think it is, and a check that looked at nothing should never come back as a
pass. seamkit is a set of deterministic production checks for small teams in that position. It reads production
read-only, compares what it serves with your git history, and records the evidence in your own repository. No model runs
inside it, and agents, CI and humans all get the same verdicts.

```sh
cd your-repo
npx seamkit audit --url https://your.app
```

The audit takes the last 20 changes merged into your default branch and asks production which commit it runs. Every
change is then reported as **live**, **not live**, **not proven** or **nothing to prove**, followed by what to fix
for each change it could not prove. This is a real run against a site that serves its commit at `/api/version`
(abridged where a line reads `...`):

```
LIVE  20 of 20  (20 pass)
  pr#16                api: /api/version names the deployed commit
                       production at https://commit.city/api/version runs 492378ccca80, which contains this change
  19 changes, each for the same reason:
      production's version 492378ccca80 contains this change
    commit:5d37aae6a218  home: show "Made to be shown off" before "Real history, drawn to scale"
    commit:1f5a66920a97  builder: copy pack bytes into blocks as they arrive, not keep the network chunks
    ...

PASS  readback  origin/main
  proven live 20 of 20 changes
  production at https://commit.city/api/version runs 492378ccca80 (pr#16)
  not examined: changes before the last 20 on origin/main (outside --last)
```

Before that site served its commit, the same audit proved 0 of 20 changes and exited 3, "examined nothing", with
advice on how to fix that. Not knowing is never reported as a pass.

## Outcomes and exit codes

Every check returns one of four outcomes, and the exit code says which, so a script or an agent cannot mistake one for
another.

| Exit code | Outcome |
|---|---|
| 0 | pass |
| 1 | fail |
| 2 | usage or configuration error; no verdict was produced |
| 3 | examined nothing: seamkit could not look, so it does not claim anything |
| 4 | unclassified, which stops for a human |

`--json` prints one JSON document per run, holding the outcome, the exit code and every verdict with its reasons,
what was examined and what was not.

## Make production say what it runs

Readback needs production to name the commit it was built from. Either write a version document at build time:

```sh
npx seamkit stamp --out public/version.json   # before the build; most bundlers copy public/ into the output
```

```json
{ "schema": "seamkit.version/1", "commit": "<full commit id>", "dirty": false, "source": "git", "ref": "main" }
```

or answer `/api/version` with `{"commit": "<full commit id>"}` from a server function, for example from
`VERCEL_GIT_COMMIT_SHA` on Vercel. seamkit looks at `/version.json`, `/api/version` and `/version`, in that order, and
also reads the shapes other tools serve, from fields such as `commit`, `sha` or `git.commit.id`. It refuses a document
whose fields name two different commits, and a web page served in place of a document.

Stamp prefers git, because only git can tell a clean working tree from one with uncommitted changes, and a build made
from uncommitted changes proves nothing about what it contains. Where the build has no history, stamp falls back to the
commit the CI system provides (`VERCEL_GIT_COMMIT_SHA`, `GITHUB_SHA`, `CF_PAGES_COMMIT_SHA`, `COMMIT_REF`,
`RENDER_GIT_COMMIT`, `CI_COMMIT_SHA`, `BITBUCKET_COMMIT` or `SOURCE_VERSION`) and records which one it used.

## Use it in CI

A GitHub Action is next on the roadmap. Until it ships, run readback as a step once your deploy is live. It needs the
full history, because it decides whether production contains a change by commit ancestry:

```yaml
- uses: actions/checkout@v7
  with:
    fetch-depth: 0
- uses: actions/setup-node@v7
  with:
    node-version: 22
- run: npx --yes seamkit@0.1 readback --url https://your.app --last 20
```

The step fails when a change is not live or not proven, and exits 3 when production could not be read, so a broken
read never passes silently.

## Use it from an agent

The exit code is the contract, so an agent needs one instruction, for example in `AGENTS.md` or `CLAUDE.md`:

```markdown
After a deploy, run `npx seamkit readback --url https://your.app --pr <number> --json`.
The change is shipped only when it exits 0. Exit 1 means it is not live or not proven, and exit 3 means
production could not be examined. Report the reasons; never call a change done on any other exit code.
```

An MCP server with the same checks as tools is on the roadmap.

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
each naming the field and the fix, so an agent can repair a card with one edit. A marker's `url` may be a path, which
readback resolves against the production URL it is given, so one card serves staging and production alike. A marker of
kind `none` with a reason declares that nothing deployed changes.

Readback finds cards in the history, so a card counts once its merge commit carries it. GitHub writes the pull request
description into the merge commit only when the repository's default commit message is "Pull request title and
description" (Settings, General, Pull Requests), for merge commits and squash merges alike. Without that setting,
changes are proven by version alone, and `seamkit audit` says so.

## The ledger: not live versus not proven

`seamkit state init` creates a `seamkit/state` branch, and from then on every readback is recorded there, one file per
event named by the SHA-256 of its content. That history is what lets a later run say a change was live and has left
production, as after a rollback, rather than merely that it is not proven. The branch is written with git plumbing, so
it never touches your working tree, index or HEAD. `seamkit state verify` checks every file against its name,
`seamkit replay` recomputes every recorded verdict from its recorded observations and fails if any comes out
differently, and `seamkit state sync` merges and pushes the branch without forcing.

seamkit records URLs, commit ids, marker texts and digests of what production served, never the content itself. A
production URL with credentials or a query string is refused for that reason.

## Try the demo

```sh
git clone https://github.com/azank1/seamkit && cd seamkit
npm ci && npm run demo
```

The demo seeds an invented notes service with twenty pull requests written as if by agents, serves the build of pull
request 17 from a local fake production and records a readback, then rolls production back to pull request 14 and
reads back again. The second run sorts the twenty changes into live 9, not live 3, not proven 5 and nothing to prove 3,
and replay recomputes both runs byte for byte. Two of its changes show the common mistakes: pull request 11's marker
names a component that exists only in a source comment, and pull request 12 names a database object, which this version
cannot read yet. The demo's history is seeded with fixed identities and dates, so its commit ids are the same on every
machine, and its test pins every state.

## What works today, and what is next

seamkit 0.1 is the command line tool: `audit`, `readback`, `stamp`, `replay` and `state`. It is tested on Node 20 and
22 on Linux.

Next, in order:

1. A GitHub Action that reads back after every deploy and reports a check run.
2. An MCP server with the same checks as tools, and a Claude Code plugin.
3. Carry: before a deploy, the merged pull requests it will also ship, and a block on hand deploys.
4. Cards and a gate that evaluates every open pull request the way the deploy step will.
5. Approvals that an agent cannot forge, policy and rulings elicited from a human, and a static console.
6. Blast-radius classification, sandbox parity, and hook packs for coding agents.

The setup guide, with diagrams, copy-in recipes for agents and CI, and the build tracker, is at
[azank1.github.io/seamkit](https://azank1.github.io/seamkit/). The design is in
[`docs/architecture.md`](docs/architecture.md), and the survey of existing tools, with what each one does and does not
cover, is in [`docs/prior-art.md`](docs/prior-art.md).

## Development

```sh
npm ci
npm test            # 117 tests, using temporary repositories and a local fake production
npm run demo        # add -- --keep to keep the demo repository
npm run pack:cli    # builds the npm package into release/seamkit
npm run smoke:pack  # installs that package into an empty project and runs it
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) to contribute and [`SECURITY.md`](SECURITY.md) to report a vulnerability.

Licensed under the Apache License, Version 2.0. See [`LICENSE`](LICENSE).
