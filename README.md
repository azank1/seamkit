# seamkit

seamkit is a set of deterministic production checks for small teams whose code is mostly written by AI agents. It sits
between "a change merged" and "the change is proven live in production", and agents, models and humans use it through
the same command line tool, MCP server, GitHub Action and harness hooks. No model runs inside it.

This repository is pre-release. The design is in `docs/architecture.md` and the survey of existing tools is in
`docs/prior-art.md`.

## What works today

Milestone 1 provides the verdict core, the ledger and the command line skeleton. Every check returns one of four
outcomes, and the process exit code says which one, so a shell agent cannot mistake one for another.

| Exit code | Outcome |
|---|---|
| 0 | pass |
| 1 | fail |
| 2 | usage or configuration error; no verdict was produced |
| 3 | examined nothing |
| 4 | unclassified, which stops for a human |

The first check is `invariant`, which answers the failure that started this project: an invariant suite that printed
PASS on an empty table. It needs two numbers from your own query, the rows in scope and the rows that violate the
invariant, and it refuses to pass when the first number is zero. Up to twenty sample ids can be attached as evidence.
They are recorded in the ledger, so use opaque internal ids and never personal data.

```sh
echo '{"subject":"notes.owner_set","scope":"rows in notes","examined":0,"violations":0}' \
  | npx seamkit check invariant
# EXAMINED NOTHING  invariant  notes.owner_set  (no_rows)
#   why: no rows were in scope (rows in notes), and a check over zero rows is not a pass
# exit code 3
```

Verdicts are recorded on a separate `seamkit/state` branch, one file per event, named by the SHA-256 of its content.
The branch is written with git plumbing, so it never touches your working tree, index or HEAD. `seamkit state init`
creates it, `seamkit state verify` checks every file against its name, `seamkit replay` recomputes every recorded
verdict and fails if any comes out differently, and `seamkit state sync` merges and pushes it without forcing.

## Development

```sh
npm ci
npm test
```

The tests run on Node 20 and 22. They use temporary git repositories and never touch the developer's own.

Licensed under the Apache License, Version 2.0. See `LICENSE`.
