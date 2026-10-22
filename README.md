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

The seamkit Action reads production back once a deploy succeeds and posts the verdict as a check run on the deployed
commit. Hosts that report deployments to GitHub fire `deployment_status`; Vercel does, and names the production
environment `Production`:

```yaml
# .github/workflows/readback.yml
name: readback
on: deployment_status
permissions:
  contents: write   # to record verdicts on the seamkit/state branch
  checks: write     # to post the check run
jobs:
  readback:
    if: github.event.deployment_status.state == 'success' && github.event.deployment.environment == 'Production'
    concurrency:
      group: seamkit-readback-${{ github.event.deployment.environment }}   # one readback at a time per address
      cancel-in-progress: false
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0   # readback decides by commit ancestry, so it needs the history
      - uses: azank1/seamkit@v0.2.0
        id: readback
        with:
          url: https://your.app
          ledger: 'true'   # start the ledger on the first run, so a rollback shows as not live
```

The concurrency group sits on the job, so a deploy to another environment, which the `if` skips, never takes a place
in it. GitHub runs one job of a group at a time and keeps at most one more waiting; when another arrives it cancels
the one waiting, and for jobs queued within minutes of each other it does not promise which it keeps. A deploy whose
readback was cancelled is covered by the next deploy's readback and by the scheduled watch below, which is why the
watch is part of the setup. When one repository feeds several Vercel projects, each production environment is named
`Production – <project>`; give each project its own job, with that exact name in its `if` and its own `url`. The
group is keyed by the environment, so the projects do not cancel each other's readbacks.

The check covers the last 20 changes on the default branch. The Action keeps reading production for up to `wait`
seconds until production's version document reports the deployed commit, fetching the branch again if production
reports a commit the checkout does not have yet, then records the run that counts and pushes the ledger. When production still runs another commit at the end of the wait, the summary says which. If that commit
does not contain the deployed one, the deploy is not live at this address, and a pass is reported as a fail.

Once the ledger holds a run that read this address, a change merged after the deployed commit is listed as not
examined and left to the next deploy when it was never seen live there and was in no build production was seen running
there, so a merge landing while this deploy builds does not fail it. Every other change is judged, so a deploy that
drops one, as a rollback does, fails. Without a ledger, on the first run at an address, and once production there has
been seen running a commit this repository does not have, seamkit cannot tell a change still on its way from one a
rollback removed, so it judges every change: a merge landing during the build fails the deploy as not proven until the
next deploy carries it. A rollback fails too, as not live when the ledger saw the dropped change live, and as not
proven without a ledger or on the first run. After a deploy, `last` counts the changes judged, not the ones left to the next deploy.

Only a pass posts a success. A change that is not live or not proven fails the check, and an unclassified result is
marked action required. Examined nothing fails it too, whether production could not be read, a marker could not be
read, or a change's card says it has nothing to prove (`kind: none`), a claim a human has to accept. Every change in
the window counts, so such a change fails each deploy until it leaves the window: a merged card cannot be changed, and
accepting a nothing-to-prove claim is not built yet. Meanwhile, lower `last` or read back one pull request with `pr`,
and keep `kind: none` for changes you are willing to see fail deploys for a while. The step exits with seamkit's own
code, so a later step that reads `steps.readback.outputs.outcome` needs `if: always()`.

When you deploy from a workflow of your own, trigger on it finishing, from the default branch:

```yaml
on:
  workflow_run:
    workflows: [deploy]   # your deploy workflow's name; this file must be on the default branch
    types: [completed]
    branches: [main]
```

Drop the job's `if` there, which only a `deployment_status` event can satisfy: the Action itself skips a run that
failed or ran for a pull request, as it skips any `deployment_status` other than success. The check run goes on the
commit that workflow ran on.

To catch a rollback or a hand deploy that no workflow saw, add a watch: a workflow of its own with the same
permissions and steps, triggered on a `schedule` such as hourly with `cron: '17 * * * *'`, with no `if` and no
concurrency group. The watch reads the default branch with nothing counted as deployed, so it also fails while a merged
change waits for its deploy. It needs no group, because a ledger push that meets another run's is merged and tried
again.

| Input | Default | |
|---|---|---|
| `url` | required | the production address |
| `last` | `20` | how many of the latest changes to examine |
| `pr` | | read back one merged pull request instead |
| `wait` | `60` | after a deploy, seconds (up to 1800) to keep reading until production reports the deployed commit; nothing is recorded meanwhile |
| `ledger` | `auto` | `auto` records when a `seamkit/state` branch exists, `true` starts one, `false` never records |
| `check-name` | `seamkit readback (<host>)` | one check per production address |
| `sha` | the deployed commit | where the check goes, and what counts as deployed |
| `branch`, `version-url`, `token` | | for unusual layouts; `branch` names the remote's branch, and one that is not a branch gives no verdict |

The Action runs on GitHub-hosted runners, and on self-hosted runners that support the `node24` runtime. Recording
pushes with the checkout's credentials, so keep `actions/checkout`'s default `persist-credentials`. Before reading, the
Action fetches the branch it reads from origin: when the branch has moved past the job's commit, `actions/checkout`
leaves `origin/<branch>` at that commit, which would hide every change merged since. So when the `branch` input is not
a branch name, or the branch cannot be fetched, the Action gives no verdict (exit 2) and says why.

Anywhere else, run readback as a step of the job that deploys, once the deploy is live, naming the commit it shipped:

```yaml
- uses: actions/checkout@v7
  with:
    fetch-depth: 0
- uses: actions/setup-node@v7
  with:
    node-version: 22
# … your deploy steps …
- run: |
    : "${BRANCH:?set BRANCH to the default branch}"
    echo "::remove-matcher owner=tsc::"   # setup-node's problem matchers would read a change's title as an error
    echo "::remove-matcher owner=eslint-stylish::"
    echo "::remove-matcher owner=eslint-compact::"
    git fetch --quiet --no-tags origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"   # the branch as it is now
    npx --yes seamkit@0.2 state sync || true   # fetch the ledger, when there is one
    status=0
    npx --yes seamkit@0.2 readback --url https://your.app --last 20 --branch "$BRANCH" --deployed "$DEPLOYED_COMMIT" || status=$?
    npx --yes seamkit@0.2 state sync || echo '::warning::seamkit: the ledger was not pushed'
    exit $status
  env:
    BRANCH: ${{ github.event.repository.default_branch || github.ref_name }}   # a schedule's event names no repository
    DEPLOYED_COMMIT: ${{ github.sha }}   # the commit this job deployed
```

The step exits with readback's code: it fails when a change is not live or not proven, and exits 3 when nothing could
be examined, so a broken read never passes silently. Readback records the run when the checkout has a ledger
(`seamkit state init` starts one), and pushing it needs `permissions: contents: write`. In a GitHub Actions step, the
CLI's output cannot run a workflow command: where a change's own words would read as one, a zero-width space keeps them
plain text. Problem matchers are different: they read every line of the log, so a matcher an earlier step added, such
as the ones `actions/setup-node` adds, can turn a change's title into an error annotation. The recipe removes those; do
the same for any matcher of your own, in this job and in a job that runs the Action.

## Use it from an agent

The exit code is the contract, so an agent needs one instruction, for example in `AGENTS.md` or `CLAUDE.md`:

```markdown
After a deploy, run `npx seamkit readback --url https://your.app --pr <number> --json`.
The change is shipped only when it exits 0. Exit 1 means it is not live or not proven. Exit 3 means nothing
was proven: production or a marker could not be read, the card says there is nothing to prove, or the pull
request was not found. Report the reasons; never call a change done on any other exit code.
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

seamkit 0.1 is the command line tool: `audit`, `readback`, `stamp`, `replay` and `state`. 0.2 adds the GitHub Action,
which reads back after every deploy and reports a check run, and `readback --deployed`, which judges a deploy by the
commit it shipped. Both are tested on Node 20, 22 and 24 on Linux.

Next, in order:

1. An MCP server with the same checks as tools, and a Claude Code plugin.
2. Carry: before a deploy, the merged pull requests it will also ship, and a block on hand deploys.
3. Cards and a gate that evaluates every open pull request the way the deploy step will.
4. Approvals that an agent cannot forge, policy and rulings elicited from a human, and a static console.
5. Blast-radius classification, sandbox parity, and hook packs for coding agents.

The setup guide, with diagrams, copy-in recipes for agents and CI, and the build tracker, is at
[azank1.github.io/seamkit](https://azank1.github.io/seamkit/). The design is in
[`docs/architecture.md`](docs/architecture.md), and the survey of existing tools, with what each one does and does not
cover, is in [`docs/prior-art.md`](docs/prior-art.md).

## Development

```sh
npm ci
npm test             # 192 tests, using temporary repositories and a local fake production
npm run demo         # add -- --keep to keep the demo repository
npm run pack:cli     # builds the npm package into release/seamkit
npm run smoke:pack   # installs that package into an empty project and runs it
npm run pack:action  # rebuilds the Action's committed bundle; commit it with the source that changed it
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) to contribute and [`SECURITY.md`](SECURITY.md) to report a vulnerability.

Licensed under the Apache License, Version 2.0. See [`LICENSE`](LICENSE).
