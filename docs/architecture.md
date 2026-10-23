# Architecture

Status: M1 and M2 are accepted: they are built, tested and released in 0.1.0, and the sections they cover describe the
code. M3 to M8 are proposed: each is confirmed, or changed with the change recorded under "Changes made while building",
when its milestone ships. The product is called seamkit and its command is `seamkit`. This document also calls it "the
harness", the generic term for what it is.

## 1. Purpose and design spine

The harness is a set of deterministic checks that sit between "a change merged" and "the change is proven live in
production". It is built for small teams whose code is mostly written by AI agents, where the change volume is that of
a much larger organisation while the number of people who can read changes stays small. Agents, models and humans use
it through the same four surfaces: a command line tool, an MCP server, a GitHub Action and copy-in harness hooks.

Three properties form the spine of the design, and no feature may trade them away.

1. Every check returns one of three primary outcomes, which are pass, fail and examined nothing, and every result
   lists what it did not examine. A check that looked at zero rows never passes.
2. Production is the source of truth for "done". A merged change counts as shipped only after production has been read
   back and shows it.
3. The judge is deterministic. No model runs inside the harness. Agents call it, it never calls an agent, and human
   decisions reach it only through channels it opens itself, never through an agent's tool arguments.

## 2. Threat model and non-goals

The harness defends against the failures that agent volume produces in an honest team. These are an agent that
believes a change is shipped because it merged, a deploy that carries changes nobody chose to ship, a check that
passes because it inspected nothing, an approval that one agent relays to another, and a staging copy that silently
stopped being a copy. Every module in section 6 answers one of these.

It does not claim to stop a hostile agent that runs as the same operating system user as the human and holds the same
credentials. Such an agent can edit any file, call any API the human can call and drive any terminal the human can
drive. The harness states this boundary in its documentation and offers one mechanism that does hold against it: an
approval proved with a WebAuthn assertion from an authenticator that needs a physical touch, over a challenge bound to the
exact action and commit (section 7.4). Everything else in the ledger is tamper-evident through content hashes, not
tamper-proof.

The harness also does not deploy anything, does not write to production, does not review code with a model and does not
manage agent sessions or messaging. Deploy tools deploy, session managers run agents, and receipt tools attest
agent runs (section 10).

## 3. System overview

```
        agents · models · humans  (Claude Code, Cursor, Codex, any MCP client, a shell, CI)
                 │              │                │                  │
             CLI `seamkit`      MCP server       GitHub Action      harness hooks
                 └──────────────┴───────┬────────┴──────────────────┘
                                   shell (I/O)
            reads policy and events · calls adapters · asks humans · writes events
                                        │
                                 core (pure, no I/O)
      verdict · card · gate · carry · readback · parity · radius · rulings · approvals
                                        │
                         adapters (read-only views of the world)
        git · GitHub · /version endpoint · served bundle · Vercel · Supabase · Postgres · fake
```

The core follows the functional-core, imperative-shell pattern. Every core function takes plain data (the policy, the
active rulings, a set of observations and the current time) and returns verdicts. It performs no network, file or
clock access of its own. The shell gathers observations through adapters, passes them to the core and records both the
observations and the verdicts as events.

This split is what makes the judge auditable. Because a verdict is a pure function of recorded inputs, `seamkit replay
<event>` can recompute any past verdict from the ledger and confirm that it comes out the same. A verdict that cannot be
replayed is a defect.

## 4. Packages and dependencies

The implementation is TypeScript on Node 20 or later, published as ES modules, in one repository with npm workspaces.

| Package | Contents | Runtime dependencies |
|---|---|---|
| `core` | types, verdict algebra, every check as a pure function | none |
| `formats` | scope card and commit message parsing, and later policy | `yaml` 2.9.1, pinned |
| `state` | the event store on the `seamkit/state` branch, written with git plumbing | none (it runs the `git` binary) |
| `adapters` | git history, version documents, served bundles and a local fake production (M2); GitHub (REST over `fetch`), Vercel, Supabase and Postgres later | none; `pg` will be an optional peer dependency only |
| `cli` | the `seamkit` binary, TTY prompts, the init interview | none beyond the packages above |
| `mcp` | the MCP server, elicitation, the loopback approval page | `@modelcontextprotocol/server` (the v2 SDK, which supports the 2026-07-28 revision and serves older clients through a shim) |
| `action` | the GitHub Action, bundled into one committed file | bundled at build time |
| `console` | the static HTML generator | none |
| `demo` | the seeded demo history, its builds and `npm run demo`; private, never published | none |

The core stays dependency-free so that it can be audited in one sitting and vendored if needed. It also holds the
event format and canonical JSON, which follows RFC 8785 and is used only for seamkit's own events and input digests.
It never canonicalises or verifies a receipt, which is left to receipt tools. Argument parsing uses
`node:util` `parseArgs`, prompts use `node:readline`, and HTTP uses the global `fetch`, which keeps the command line tool
close to dependency-free as well. The adapters reuse the state package's git runner, so one module in the repository
starts `git`, with one set of rules for its environment and errors.

## 5. The verdict contract

### 5.1 Types

```ts
type Outcome = 'pass' | 'fail' | 'examined_nothing' | 'unclassified';

interface Verdict {
  check: string;              // e.g. 'readback'; events record it with its version, as readback@1
  subject: string;            // 'pr#42', 'commit:1a2b3c4d5e6f', 'main', 'fn:notes-sync'
  outcome: Outcome;
  state?: string;             // module-specific detail, e.g. readback 'not_proven'
  examined: Item[];           // what was looked at, each with a count where counting applies
  notExamined: Gap[];         // what was not, each with a reason; [] only when truly complete
  evidence: EvidenceRef[];    // URLs, hashes, counts with denominators, event ids
  reasons: string[];          // why this outcome, in order, phrased so an agent can act on them
  inputs: string;             // digest of policy, rulings and observations used (enables replay)
  at: string;                 // ISO time supplied by the shell, never read inside the core
}
interface Gap { item: string; reason: 'not_required' | 'unreadable' | 'no_adapter' | 'out_of_scope' | 'timeout' | string }
```

`unclassified` belongs to the radius module and to any composite that contains a radius result. It means that neither
policy nor a ruling covers the case, and it stops for a human in the same way a failure does.

### 5.2 Aggregation

Composite checks, such as the gate verdict for one pull request, combine their parts by severity. Any `fail` makes the
composite `fail`. Otherwise any `unclassified` makes it `unclassified`. Otherwise any `examined_nothing` makes it
`examined_nothing`. Only when every part passes does the composite pass. The composite carries the union of its parts'
`notExamined` lists, so a gap is never hidden by aggregation.

A check that policy does not require is not run, and it appears in `notExamined` with the reason `not_required`. A check
that policy requires but that finds nothing to inspect returns `examined_nothing`. The two cases are kept apart because
the first is a decision someone made and the second is an absence of evidence.

### 5.3 Exit codes

| Code | Meaning |
|---|---|
| 0 | pass |
| 1 | fail |
| 2 | usage or configuration error; no verdict was produced |
| 3 | examined nothing |
| 4 | unclassified, which stops for a human |

Every non-zero code means "not a pass", so a shell agent that chains commands with `&&` can never proceed on a result it
misread. `--json` prints one JSON object per invocation, holding the outcome, the exit code and the verdicts, so an agent
parses a single document rather than a stream.

### 5.4 Rendering rules

Every surface follows the same rules. A pass is the only outcome that may be shown in green. Examined nothing and not
proven are never green and never hidden behind a pass count. Every summary that reports a count also reports its
denominator, for example "proven live 10 of 21 merged changes".

Readback's text output groups changes by state with the problems first: not live, then not proven, then nothing to
prove, then live. Each group's header gives its share of the total and its outcomes, as in "NOT PROVEN  5 of 20  (1
examined nothing, 4 fail)". When three or more changes in a group share an outcome and an explanation, the explanation
is printed once above them, so a site that serves no version document produces one explanation rather than twenty. The
run's summary verdict comes last.

## 6. Modules

### 6.1 Card

A scope card is a fenced block in the pull request body, so that any agent able to write a pull request description can
write one.

````markdown
```seamkit-card
card: 1
intent: Show a saved indicator after a note is synced.
layers: [frontend, function]
targets: [web, fn:notes-sync]
markers:
  - kind: bundle
    text: "data-sync-state"
  - kind: version
    url: /api/notes-sync/version.json
releaseNote: Notes now show when they were last saved.
risk: ship_alone
```
````

The parser is strict. It reads YAML 1.2 with the core schema, refuses aliases and custom tags, and rejects unknown
fields. It reports every problem in one pass, each naming the field and the fix, so that an agent can repair the card
with one edit. A description holds at most one card, a card larger than 16 KiB is refused, and a card lists at most 20
markers, as many as readback judges for one change.

Readback finds cards in the history rather than through GitHub's API, so a card counts once its merge commit carries it.
GitHub's first line for a merged pull request is either "Merge pull request #N from branch", with the title on the third
line, or "Title (#N)", depending on the repository's default commit message. Only the setting "Pull request title and
description" also writes the description, for merge commits and squash merges alike, so it is the setting that cards
need. Under any other setting the card is lost, and the change is proven by version alone. The M6 GitHub adapter can
read a card from the pull request itself, which removes this dependency for repositories that grant it a token.

A marker has one of four kinds. A `bundle` marker names a `text` of 4 to 200 characters that the built output must
contain. A `version` marker names a version document, such as a server function's. A `db_object` marker names a database
object. A `none` marker gives a reason why nothing deployed changes, and it must be the only marker. A marker's `url` is
optional: a bundle marker defaults to the production page, and a version marker to production's own version document.
A path is resolved against the production URL that readback is given, so one card serves staging and production alike.

The card's `risk` is a claim, and the radius module re-derives the class from the diff, with the stricter of the two
winning. The documentation carries the bundle-marker lesson: a marker must be text that the built output contains, and
text that exists only in source files, such as a component name or a comment, will never be found in a production
bundle.

### 6.2 Gate

The gate evaluates every open pull request exactly as the deploy step will. Its parts are a valid card, CI green on the
exact head commit across every run recorded for that commit, sandbox evidence recorded against that head, the approval
or acknowledgement that policy requires for the pull request's radius class, a release note when policy requires one,
and the deploy window. CI with zero recorded runs on the head returns `examined_nothing`, never a pass. The deploy window
depends on the time, which the shell passes in, so the verdict stays replayable.

`seamkit gate` with no arguments lists every open pull request with its composite verdict and the exact missing items. That
listing is the board the console renders.

### 6.3 Carry

Before a deploy of a target, carry compares the version production is running with the commit about to be deployed. It
lists, by title, every merged pull request between the two that touches the target's paths, which are mapped in policy.
A running version that is unknown, or that the adapter reports as deployed by hand, blocks the deploy with `fail`. An
unreadable target returns `examined_nothing`. Riding pull requests that need a human under the radius rules, and lack an
approval for this commit, also fail the carry.

The split rule is part of carry. It warns when one pull request is really several ships: schema and code together,
six or more functions, or a merge into a branch other than the default branch. The warning is a verdict reason, not a
separate outcome, unless policy promotes it to a failure.

Some platforms do not report a commit for a deployed artifact. For those, an adapter may report a content digest
instead, and the shell resolves the digest to a commit by building candidate commits on request. Until that capability
exists for a platform, its carry verdict is `examined_nothing` with the reason stated.

### 6.4 Readback

After a merge, readback proves whether production holds each change. It walks the first-parent history of the default
branch, one change per merged pull request or direct commit, and asks production two questions about each.

The first is which commit production runs, which a version document answers (section 6.4.1). A change whose commit is
an ancestor of the running commit, by `git merge-base --is-ancestor`, is contained in the build, and a later change is
not. A build stamped from a working tree with uncommitted changes says nothing reliable about what it contains, so its
version is reported as unreadable rather than trusted, and so is a running commit that the repository does not have.

The second is whether production serves what the change added. Readback reads the page, the scripts and styles it loads
from its own origin, and the chunks those scripts name, and searches all of them for each bundle marker's text. A marker
counts as absent only when that search was complete. When a file could not be read, or the search reached its limits,
an unfound marker is unreadable instead. Files that the page loads from other origins are listed as not examined rather
than read. A marker found in a build whose version does not contain the change is contradicted: the text is not unique
to the change, so it proves nothing. A marker absent from a build whose version does contain the change gets a hint
that the text is probably not in the built output, which is the commonest card mistake.

| State | Condition | Outcome |
|---|---|---|
| `live` | every marker is present | pass |
| `not_live` | a marker that an earlier recorded run saw is absent now | fail |
| `not_proven` | a marker is absent and was never seen, or production's version contradicts it | fail |
| `not_proven` | nothing is absent, but some marker could not be read | `examined_nothing` |
| `nothing_to_prove` | the card declares `kind: none` with a reason | `examined_nothing` |

A change without a usable card is checked against production's version document alone, through an implicit version
marker, and a card that does not parse stays listed among the change's gaps. Database markers are not examined until an
adapter for them exists. A readback over no changes is `examined_nothing`, never a pass. The run's summary verdict
counts every state against the total, names the commit that each version document reports, and lists the run's own
gaps, such as changes outside `--last` or a shallow clone.

`not_live` requires history. The M0 draft proposed a `marker_seen` event for every successful marker check. The
implementation derives sightings instead from the readback runs already recorded on the state branch: a marker that a
recorded run found present, and that its version did not contradict, counts as seen at that run's time. The ledger
then holds one kind of event for readback, and replay recomputes the history along with the verdicts. Without a ledger,
readback says that it cannot tell a change that left production from one that never arrived. A change with nothing to
prove is never reported as live. Its card's reason is shown instead, and a human may record it as accepted.

#### 6.4.1 Version documents, stamp and audit

A version document is a small JSON file that production serves:

```json
{ "schema": "seamkit.version/1", "commit": "<full commit id>", "dirty": false, "source": "git", "ref": "main", "builtAt": "<time>" }
```

When it is given no URL, readback looks for one at `/version.json`, `/api/version` and `/version`, in that order. It
also reads the documents that other tools serve, from fields such as `commit`, `sha` or `git.commit.id`, accepts an
abbreviated commit id that the repository can resolve, and refuses a document whose fields name two different commits.
A web page served in place of a document is refused, because sites often answer unknown paths with their index page.
Problems are described without quoting the response.

`seamkit stamp` writes the document at build time. It prefers git, which alone can tell a clean working tree from a
dirty one, and leaves its own output file out of that check. Where the build has no history, it falls back to the
commit that the CI system provides, such as `VERCEL_GIT_COMMIT_SHA` or `GITHUB_SHA`, records which variable it used,
and leaves `dirty` out because it cannot know. `--require-clean` refuses to stamp a dirty tree.

`seamkit audit --url <production>` is readback over the last 20 changes with no configuration. After the verdicts it
gives advice for each gap it found, such as serving a version document, fetching an unknown commit, deepening a shallow
clone, starting a ledger, or the merge setting that cards need, so that examined nothing becomes a list of next steps.
Its first run against the dogfood site examined nothing for all 20 changes, because that site serves no version
document. After the site added `/api/version`, which returns the commit its host reports for the deployment, and
switched its merge setting so cards reach the history, the same audit proved 20 of 20 changes live (2026-10-15).

### 6.5 Parity

Parity asks whether the sandbox is still a copy of production. The sandbox is described in policy by a recorded base
and a recorded list of applied changes. The check compares running versions per target and the presence of named
database objects between the two environments, and returns `pass` for parity, `fail` for drift, or `examined_nothing`.
The policy also records that the sandbox runs on synthetic data only. The harness cannot verify that statement, and it
says so in `notExamined` on every parity verdict rather than implying it was checked.

### 6.6 Radius

Radius classifies a diff into `ship_alone`, `stop_for_human` or `unclassified`. It reuses the scope-class vocabulary
common to agent permission systems (`read`, `write`, `destructive`), together with that vocabulary's rule that an unknown case is treated as
the most dangerous one. Here the vocabulary describes the effect of a diff on production, not an agent's tool call. Policy
maps path globs to an effect class and to optional sensitive areas, such as authentication, payments, data export or
shared state. A path that no glob covers is `unclassified`, and so is the whole diff that contains it.

Four rails apply whatever the class. A production write needs a snapshot and a written revert beside it. Destructive
operations, such as `DROP`, `TRUNCATE` or a `DELETE` without `WHERE`, always stop for a human. Done requires a readback.
And schema changes never reach production through a command-line shortcut that bypasses the migration record. The rails
are implemented as named checks, so each one appears in a verdict and can be seen to have run.

### 6.7 Review evidence

The independent re-run of a builder's tests by a second agent is the agent's job, not the harness's. The harness defines
the evidence shape that such a review records (the head commit, the command run, the counts with denominators, and the
negative controls with their expected and observed results), and the gate can require one. A negative control that did
not go red invalidates the review.

## 7. Human input: policy, rulings and approvals

### 7.1 Three kinds of input

| Kind | Asked | Stored | Binds |
|---|---|---|---|
| Policy | once at `seamkit init`, revised rarely | `.seamkit/policy.yaml` on the default branch, changed by pull request | every session and agent, until changed |
| Ruling | when a check returns `unclassified` | an event, append-only | every later session, prospectively, within its scope |
| Approval | at the moment of a gated action | an event, append-only | one human, one action, one commit, one performer, used once |

A ruling records the question, the answer, the human's handle, the time, a scope (a path glob or a class) and an optional
expiry. Rulings are never edited, only superseded, and a ruling can be promoted into policy by pull request. An approval
records the action (for example `deploy fn:notes-sync`), the exact commit, the performer it authorises, the channel it
came through and its assurance level. An approval expires with its commit, because a new head needs a new approval, and
it is marked used by the event of the action that consumed it.

### 7.2 Structural rules

No MCP tool and no command-line flag accepts an approval or a ruling as an argument. The harness asks the human itself
through a channel it opens, and records the answer. An agent that reports "the engineer approved" changes nothing,
because no event exists. A case that neither policy nor a ruling covers is `unclassified`, which stops.

### 7.3 Where state lives

Policy lives on the default branch because it changes rarely and deserves review. Rulings, approvals, observations and
verdicts cannot live there. They are written continuously, by many sessions on many branches, and a ruling must bind
other sessions the moment it is made rather than when some branch merges. Writing them into `.seamkit/` on feature branches
would also produce merge conflicts on every append.

The proposal is a dedicated state branch, `seamkit/state`, holding one file per event under `events/YYYY/MM/DD/`, named by
a sortable unique id and the hash of the event's canonical JSON. One file per event means concurrent writers never
conflict, so a write is a commit and a push that retries on a non-fast-forward. Every session reads the shared truth
with a fetch of that branch. A session that cannot reach the remote still works, but every verdict it produces lists
"state not synchronised since <time>" in `notExamined`. The state is still files in the repository, readable with plain
git, and no service or database is involved. This refines the first sketch, in which everything lived under `.seamkit/`
on the working branch, and it is listed as a decision in section 12.

Three details of the implementation follow from this. The branch is written with git plumbing (a private index file,
`commit-tree` and a compare-and-swap update of the ref), so recording an event never touches the working tree, the
index or HEAD of the session that records it. State commits carry a fixed tool identity rather than the human's, which
says plainly who wrote them and keeps them out of contribution histories and commit budgets; who caused an event is
recorded inside the event, as provenance. And a verdict is recorded only when the branch already exists or the caller
asks for it, so a first run of the tool creates no branch by surprise.

### 7.4 Channels and assurance levels

The research for this section, summarised in `prior-art.md` section 6, settled the central question against the project's
first sketch. No revision of the MCP specification requires that a human answer an elicitation. The 2025-11-25 revision
obliges a client that shows a form to show it clearly, but the protocol "does not mandate any specific user interaction
model", and the 2026-07-28 revision says the client gathers input "from the user or other sources". In practice the
answer can be automated in the clients that matter most. In Claude Code an `Elicitation` hook can accept a form or a URL
request with content, and when it does "no dialog appears"; a hook source can be a project's own settings file, which an
agent in a permissive mode can edit. Codex auto-accepts approval forms with an empty schema under one approval policy and
auto-declines under `codex exec`. A terminal prompt is no stronger, because an agent can type into it through
`tmux send-keys`, and a pull request review is spoofable when the reviewer's token is on the same machine. An automated
decline is also byte-for-byte identical to a human one.

The harness therefore separates asking from proving, and ranks each answer by what it proves.

| Level | Channel | What the record can honestly claim | Used for |
|---|---|---|---|
| 0, asserted | a tool argument, a peer's message, an agent's report | nothing; never accepted | nothing |
| 1, interactive | form elicitation with a required, non-empty typed field, or a terminal prompt | "an answer arrived through the session's interface" | policy at init, rulings |
| 2, account | an approving review on the exact head commit by a named account whose token policy says is not held on the machine | "account X approved commit S" | approvals where policy allows it, typically CI deploys |
| 3, presence | a WebAuthn assertion with user presence and verification, on a page the harness serves on `127.0.0.1`, reached through URL-mode elicitation or a printed link | "the holder of credential K, enrolled by handle N at time T, proved presence over a challenge that binds action A, commit S and this server process" | approvals for `stop_for_human` changes |

The level 3 challenge is a hash of the action, the commit, the policy digest and a nonce held only in the server's
memory, so an assertion cannot be replayed for another action, commit or process. The credential is enrolled by the
human at `seamkit init`, and its public key lives in policy on the default branch, which changes only by a reviewed merge, so
the trust root is the same as for every other rule. When a client does not support URL-mode elicitation, the harness
prints the approval link in the tool result. The agent can relay that link to the human but cannot complete it, which
turns the relayed-approval failure into a harmless one. An OpenSSH `ed25519-sk` signature is an alternative level 3
channel for terminal use, with one caveat: `ssh-keygen -Y verify` is not documented to check the user-presence flag, so
the harness would have to check it itself, and the M7 spike has to confirm that it can.

Policy sets the minimum level for each radius class. Every approval event records the level it achieved and keeps the raw
assertion, so CI can verify it again later. No record claims more than its level allows, and in particular no record
claims that a person read and understood the change.

The fallback order is level 3 through URL-mode elicitation, then level 3 through a printed link, then level 2 where policy
allows it, and then refusal. Decline and cancel both mean not approved. Form elicitation is used only for policy and
rulings, never for approvals, and every form carries a required non-empty field because empty-schema forms are the ones
that clients auto-accept.

### 7.5 Identity and sessions

The human is identified by a handle configured in policy, never by an email address or a name. A performer is
identified by its kind (human, agent or CI), a handle and, where the client provides one, a session identifier.

Claude Code sets `CLAUDE_CODE_SESSION_ID` in the environment of the processes it starts, including Bash subprocesses
(confirmed on version 2.1.299) and, according to its documentation, standard-input MCP servers. Claude
Code and Codex also pass `session_id` to hooks. These identifiers correlate events with a session, but they do not
authenticate anything, because the agent can read them. The MCP 2026-07-28 revision removes protocol-level sessions
altogether and asks servers to mint their own handles and protect them with a keyed hash.

The harness binds an approval to the session in the way that revision recommends. The server process keeps a key in
memory only, computes a keyed hash over the action, the argument digest, the commit, the policy digest, the client's
session identifier and an expiry, and consumes the approval once, server-side, on the call whose digest matches. That
binds the approval to one server process and one client connection, which is the most MCP can offer. Commit binding and
single use are the guarantees the harness enforces. The session identifier is recorded as provenance, not claimed as a
control.

## 8. Adapters

Adapters observe and the core judges. An adapter reports what it read, never a verdict such as present or absent:

```ts
interface VersionObservation {
  url: string; at: string; status: 'ok' | 'unreadable';
  reported?: string;          // the commit as the document gave it, possibly abbreviated
  commit?: string;            // the full id, when the repository has it
  dirty?: boolean; digest?: string; reason?: string;
}
interface BundleObservation {
  url: string; at: string; status: 'ok' | 'unreadable';
  complete: boolean;          // every same-origin file the page references was read, within the limits
  files: number; bytes: number;
  digest?: string;            // over the sorted [url, sha256] pairs of the files read
  searched: string[];         // the marker texts looked for
  found: string[];            // the subset that was found
  versionUrl?: string;        // the same-origin version document, for contradictions and hints
  otherOrigins?: string[];    // origins the page references that were not read
  reason?: string;
}
```

The core decides from these whether a marker is present, absent, contradicted or unreadable. The decision is therefore
replayable from the recorded observation, and an adapter cannot pass a change by reporting that it did. Observations
hold URLs, commit ids, counts and digests, never content. HTTP reads are bounded: 10 seconds and 5 MiB per response by
default, 64 KiB for a version document, 10 MiB for each script or style, and 100 files and 25 MiB for a whole crawl,
fetched six at a time.

M2 ships the git history, version document, served bundle and fake production adapters. The platform interface below
is the plan for M5, where carry needs the running version of a target and how it was deployed:

```ts
interface ProductionAdapter {
  name: string;
  capabilities: ('running_version' | 'content_digest' | 'marker:bundle' | 'marker:version' | 'marker:db_object')[];
  runningVersion(target: string): Promise<Observed<{ sha?: string; digest?: string; deployedBy: 'pipeline' | 'hand' | 'unknown' }>>;
  hasMarker(m: Marker): Promise<Observed<'present' | 'absent' | 'unreadable'>>;
}
interface Observed<T> { value: T; at: string; source: string; raw?: string }  // raw is a digest, never a payload
```

Adapters are read-only by construction. They take credentials from the environment, document the narrowest token scope
that suffices, and never write the credential or a response payload into an event. A production URL that carries
credentials or a query string is refused, because URLs are recorded. Each observation is recorded with its source and
time so that the verdict built on it can be replayed. GitHub follows in M6, and Vercel, Supabase and Postgres in the
milestones that need them.

## 9. Surfaces

| Surface | Commands or tools | Notes |
|---|---|---|
| CLI | built: `seamkit readback [--pr N \| --commit C] [--last N] [--deployed C]`, `seamkit audit`, `seamkit stamp [--out F] [--require-clean]`, `seamkit check`, `seamkit checks`, `seamkit replay [<event>]`, `seamkit state init\|list\|verify\|sync`; planned: `seamkit init`, `seamkit gate [--pr N]`, `seamkit carry <target>`, `seamkit parity`, `seamkit radius [<range>]`, `seamkit rule`, `seamkit approve <action>`, `seamkit console` | exit codes per 5.3; `seamkit approve` opens the channel itself and never reads the answer from its arguments |
| MCP server | tools mirroring the read-only commands, plus `request_ruling` and `request_approval`, which take the question and the action but never the answer | human answers arrive only through the channel the server opens; the result of `request_approval` is a link or a level, never a yes the agent supplied |
| GitHub Action | built: `readback` after a deploy (`deployment_status`, or `workflow_run` of a deploy workflow) and on a schedule; planned: `gate` on pull requests (M6) | one check run per production address on the deployed commit; `checks: write` to post it, `contents: write` only when a ledger is kept |
| Hooks | copy-in examples for Claude Code and Cursor that refuse a deploy command unless `gate` and `carry` pass for the exact head | shipped as examples, not installed silently |
| Console | a static HTML page generated from the policy and the events | no server, no model, no network at view time |

## 10. Boundaries with other tools

| Kind of tool | Boundary |
|---|---|
| Agent-run receipts (signed records of what an agent did) | seamkit keeps a deploy evidence ledger, not agent-run receipts, and never verifies a receipt. Where agent work is attested, an event stores the receipt's reference, and verification is left to the receipt tool's own command |
| Scope classes for agent tool calls | Radius uses the common `read`, `write`, `destructive` vocabulary and the rule that an unknown case is the most dangerous one, applied to diffs and deploys rather than tool calls |
| Agent session managers and their gates | seamkit is a check provider. A gate can run `seamkit readback --pr N` as its check command and read the exit code. Sessions, seats and messaging stay with the session manager |
| Model-backed command checks | A fast model-backed check on an agent's command and seamkit's deterministic check that a deploy is allowed for an exact commit can sit in the same pre-tool hook, the model check first. seamkit never calls a model |
| Dashboards and rule lenses | seamkit's outcomes map one to one onto any scheme of measured, examined with no answer, and not examined, so verdicts can be exported as they are |

## 11. Testing strategy

Every core function is tested against fixed observations, including the empty cases, so that zero rows is shown to give
`examined_nothing` for every check. The demo history is imported with `git fast-import` under fixed identities and
dates, so its commit ids are identical on every machine, and the demo's test pins those ids and the state of every
change in both of its runs. A replay test recomputes every verdict in the demo ledger and requires identical results.
The harness's own tests include negative controls, in which a fixture is changed so that a check must fail, and the
suite asserts that it does; the demo's control drops the first recorded run, and its three not-live changes fall back
to not proven. Each milestone also runs mutations by hand: a deliberate defect goes into a check, the suite must turn
red, and the file is restored and compared byte for byte. Adapters are tested against the local fake production, and
network adapters have contract tests that run only when credentials are present, which the test report states as not
examined when they are absent.

## 12. Decisions

The maintainer decided the following on 2026-10-14, after the M0 research.

| Decision | Outcome |
|---|---|
| Name | seamkit (package, repository and command `seamkit`) |
| Licence | Apache-2.0 |
| Home | `azank1/seamkit`, private at first and public from 2026-10-15 |
| Cross-session approvals | an approval binds one action and one commit, is used once, expires after a policy-set time, and names its performer, which the human chooses at the moment of approval: the session that asked, or a CI identity listed in policy |
| First dogfood target | commit.city, through a version route added to its existing API router |
| State | the `seamkit/state` branch, one file per event, with an option to keep state in a separate private repository |
| Milestone order | reshuffled: a zero-configuration audit and version stamping join M2, carry moves to M3 ahead of card and gate, and the Claude Code plugin packaging ships with the MCP server in M5 |

Level 3 approvals (section 7.4) are built in M7 but stay optional. Until an authenticator is enrolled, which can be a
phone passkey or a hardware key, policy runs approvals at level 1 and every approval event records that level.

### Revised milestones

On 2026-10-15, with M1 and M2 done and the repository going public, the maintainer moved the work that makes seamkit
usable by strangers ahead of the remaining checks: the npm package and the GitHub Action first, then the MCP server. On
2026-10-21 the maintainer accepted M1 and M2 as built and kept M3 to M8 as proposals.

| M | Scope | Done when | State |
|---|---|---|---|
| M1 | repository scaffold, `core` verdict algebra, event writer for the state branch, CLI skeleton with exit codes, replay | unit tests cover every outcome, including zero rows as `examined_nothing`, and a replay test reproduces every verdict | done, accepted |
| M2 | `readback` with the version-endpoint and bundle-marker adapters, version ancestry, the fake production, `seamkit audit` with zero configuration, `seamkit stamp` | the demo history sorts into live, not proven, not live and nothing to prove, and the audit runs against commit.city | done, accepted |
| M3 | the `seamkit` npm package; a GitHub Action that reads back after deploys and reports a check run | `npx seamkit audit` works on a clean machine, and the Action posts a check run on a sample repository | in progress, proposed |
| M4 | MCP server with read-only tools mirroring the CLI, Claude Code plugin packaging | an MCP client runs an audit and receives the verdicts and the outcome | proposed |
| M5 | `carry` and the split rule | given a production version behind main, carry lists the riding pull requests by title, and a hand deploy blocks | proposed |
| M6 | `card` and `gate` with the GitHub adapter | `seamkit gate` lists each open pull request with its verdict and the exact missing items | proposed |
| M7 | elicitation for policy and rulings, approvals at levels 1 and 3, the init interview, the static console | an MCP client completes init and a ruling round trip, an approval passed as an argument is refused, and the console renders from policy and state alone | proposed |
| M8 | `radius`, `parity`, hook packs for Cursor and Codex | unclassified stops, and the three parity outcomes are tested | proposed |

### Changes made while building

M1 moved the event writer into its own `state` package, limited RFC 8785 to seamkit's own events and input digests, gave
state commits a fixed tool identity (section 7.3), and made `--json` print one document per invocation (section 5.3). M2
made four further changes. Sightings come from recorded readback runs rather than from `marker_seen` events (section
6.4). Adapters report observations, and the core judges them (section 8). A card marker's `url` became optional and may
be a path, so a card does not name one environment (section 6.1). And cards are read from merge commit messages, which
makes the repository's merge setting part of the setup (section 6.1). M3 put the GitHub Action's metadata at the
repository root, so it is used as `azank1/seamkit@<tag>`, with its code in `packages/action` and one committed bundle
that CI rebuilds and compares. The Action posts examined nothing as a failed check, not a neutral one, because GitHub
counts a neutral check as passing for required checks, and unclassified as action required. Readback gained
`--deployed`, the commit a deploy put out. Once the ledger holds a recorded run that read this address's version
document, a change merged after it is scoped out, folded into one not-examined gap and left to the next deploy, when it
was never seen live there and is in no build production was seen running there, by any recorded run whatever it judged,
or by this one. A merge landing during a build then does not fail a healthy deploy, and a deploy that drops any other
change fails. Without such a run, whether there is no ledger, a ledger just started, or one kept for another address,
and once production there has been seen running a commit the repository does not have, nothing is scoped out, because a
change on its way cannot be told from one a rollback removed, and the gap says so. `--last` counts the changes judged. This is scoping in
the shell, like `--last`; the check and its version are unchanged, and a contradicted marker on a scoped-out change
shows on the next run that judges it, such as the scheduled watch. `readback --json` reports production's own version
document as `production`, and the Action waits on that document alone: a read is final once it reports the deployed
commit, and once a read has named a commit, a read that names none is a failed read rather than an answer. A pass while
production runs a commit that does not contain the deployed one is reported as a fail, because the deploy is not live at
that address. Before reading, the Action fetches the branch it reads, because `actions/checkout` points
`origin/<branch>` at the job's commit when the branch has moved on, and a `--branch` that git accepts as a branch name
(`git check-ref-format --branch`) now prefers `origin/<name>` over a local branch of that name, while `HEAD` and other
revisions mean what git says. The Action reads `refs/heads/<name>`, `heads/<name>`, `origin/<name>`,
`remotes/origin/<name>` and `refs/remotes/origin/<name>` as `<name>`, and `origin/HEAD` as the default branch. When its
branch is not a branch name or cannot be fetched, it gives no verdict, since the checkout's own branch could hide a
rollback. While it waits, a commit production reports that the clone lacks makes it fetch the branch once more. It points `origin/HEAD` at the event's default branch, which
`actions/checkout` leaves unset, and for a schedule, whose payload names none, at the branch the schedule runs on. When
it records, it fetches the ledger again after the wait, so the run that counts sees what other runs pushed meanwhile.
In a GitHub Actions step the CLI's output cannot run a workflow command: a zero-width space goes before a line that would
start one and inside `##[`, and JSON output writes `[` after `##` as `\u005b`. `--version-url` is checked as `--url` is,
and the Action's tables escape a change's words as Markdown and HTML, though GitHub still links a bare URL, which shows
its own address. Text output turns every control character in a change's words into a space, line breaks, terminal
escapes, backspaces and direction overrides alike, so they cannot draw or hide lines of the report. A build seen
running at any of the version document paths at an address counts, so moving the document from `/api/version` to
`/version.json` does not hide a rollback, and for a change whose version marker is production's own document, a
sighting at one of those paths counts at the others, so that rollback reads as not live. `--deployed` reads as many
commits as were merged after the deployed one before applying `--last`. Readback reads the ledger before production, so
no connection to production sits idle while a large ledger is parsed, and it sends a GET once more when a kept-alive
connection turns out closed. A card string holding half a character, which YAML's `\uD800` escape gives and no event can
record, is a card problem rather than a run with no verdict. A ledger push that loses a race is tried again for about a
minute, after a random wait that doubles each time, and one that fails while the remote stands still is given up after
three tries. While the Action waits, a read that names a commit the checkout lacks is kept before the branch is fetched
again, and at most one read follows each fetch before the next poll. A sighting at another discovery path is counted at
production's own document only for a change whose card names no such path itself, and `seamkit state list` folds
control characters in ledger file names and fields as reports do. Readback follows redirects as a browser does, so an
address that redirects to another origin, such as `http://` to `https://` or the bare domain to `www`, is judged by what
it redirects to; only production's operator can make it redirect. A `--version-url` at one of the discovery paths
counts the others as discovery does, and a run that read any of them counts as a run at this address, so moving the
document does not stop a change on its way from being left to the next deploy. A second production on the same origin
whose version document is at one of those paths shares their history: its sightings count here, and its runs count as
runs at this address. Serving its document at another path keeps the two apart. A ledger push that the remote refuses
while no other writer pushes ends with its own error, and the Action's advice names the change to make for a refusal,
a missing permission or a lost race. The Action rewrites only absolute URLs, and values that could carry a credential,
in the errors it reports, so a path such as `/version.json` in advice stays as written. Every CLI error prints on one
line, and `seamkit state list` shows a well-formed event that has no time as `(no time)`. A card that the check would
refuse is treated as a broken card, so it is proven by version alone and never leaves its window without a verdict, and
one run reads at most 100 version documents, 100 pages and 1000 marker texts on a page: the newest changes spend that
first, and an older card whose markers do not fit is proven by version alone, which its gap says. A branch whose name
starts with `refs/` is read as the remote has it, as any other branch name is, while a full ref such as
`refs/heads/<name>` that the remote has no branch for means what git says. A commit a version document names is
resolved only to a commit whose id starts with it, so a tag, which git would peel to its commit, or a ref named like the
abbreviation reads as a commit the clone does not have. The Action's job summary writes its heading as text, and a
report cut to fit is cut inside its code block, which still closes, with a run of 64 or more backticks shown as its
count so the fence stays short. For scoping only, a build seen running whose document named an annotated tag counts as
the commit the tag points at; the commit production runs now must still be named as a commit. The check is given only
the sightings it looks up, one per marker of each change judged, so a ledger kept for many addresses does not grow its
input. While the Action waits, fetching the branch for a commit the clone lacks is tried again on later polls until it
succeeds, and the note says whether it was fetched again or the fetch failed; the reading a verdict falls back to is
resolved again after the fetch that follows the wait. seamkit runs git with its tracing off and removes a URL's user
name and password from anything git writes, because git's errors can reach a check run that anyone who can read the
repository can read. Tracing is turned off by removing every `GIT_TRACE*` variable and `GIT_CURL_VERBOSE` from git's
environment, not by setting them to 0: git traces curl whenever `GIT_CURL_VERBOSE` is set, whatever its value, and
`GIT_TRACE_REDACT` is kept on. A commit abbreviation that a blob or tree also matches still resolves to the commit when
scoping, as it does everywhere else. A misconfigured step's check run goes on the full commit when the sha input is
abbreviated. Both paths expand an abbreviated deployed commit by one rule: git looks a name up as a ref first, so text
that looks like an abbreviation and gives a commit that does not start with it is a tag or branch named like it, and a
run given such a deployed commit ends with no verdict rather than judge the ref's commit; the full id always works. A change whose card the run cannot read for lack of room, or cannot check, is still kept in `--deployed`
scope by a sighting under one of its card's markers. The test runner's time limit is per test from Node 24 and per file
before it, so it is set well above the slowest file there.
