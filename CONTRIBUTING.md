# Contributing to seamkit

Thank you for helping. seamkit is small on purpose, and the rules below are what keep its verdicts trustworthy.

## Setup

You need Node 20 or later and git.

```sh
npm ci
npm test         # builds, then runs every test; it fails if no tests ran
npm run demo     # the end-to-end demo against a local fake production
```

## The rules a change has to keep

- **A check that examined nothing never passes.** A pass rests on at least one examined item, and every other outcome
  gives a reason. A run over zero items is `examined_nothing`.
- **Checks are pure.** A check is a function of its recorded input and the time the shell passes in. All I/O lives in
  the adapters and the CLI, so every verdict can be replayed byte for byte.
- **Changing a check's output is a new check version.** Recorded verdicts are replayed and compared exactly, so a check
  whose output changes for the same input gets a new version, and the old version stays registered.
- **No model runs inside seamkit**, and nothing a server returns is echoed into a verdict. Adapters record URLs, commit
  ids, counts and digests, never content or credentials.
- **Dependencies are few and pinned exactly.** The command line tool has one third-party runtime dependency, `yaml`.
  Please open an issue before adding another.
- **Tests use fakes**, such as the local fake production in `packages/adapters`, and never real credentials.

## Tests

Every behaviour change comes with a test that fails without the change. For a change to a check, also try the
mutation by hand: put the defect back, confirm that the suite turns red, and restore the file. Pull requests that say
which mutation they tried are easier to review.

## Pull requests

Describe what you examined and what you did not, in the same spirit as a verdict. Commit messages follow
`type(scope): summary`, for example `fix(adapters): read a version document served as text/plain`.

By contributing, you agree that your contribution is licensed under the Apache License, Version 2.0, the licence of
this repository.
