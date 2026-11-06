# Hall of fame

Three ways in, each open to anyone, and each table is waiting for its first entry. The first entry in a table also
unlocks the matching trophy in the README's trophy case. Runs on the maintainer's own sites are not listed here.

Entries are added by the maintainer when an issue is confirmed.

## Field reports

Run seamkit on a production you own and file a field report with
[`.github/ISSUE_TEMPLATE/field-report.yml`](.github/ISSUE_TEMPLATE/field-report.yml)
([open the form](https://github.com/azank1/seamkit/issues/new?template=field-report.yml)). Any outcome counts, an exit 3
(examined nothing) included, because it shows where seamkit cannot see yet. The outcome line is quoted here only when
you tick the consent box in the form.

| Who | Host | Outcome | Issue |
|---|---|---|---|
| *open* | the first outside field report goes here | | |

## Surviving mutants

seamkit's review breaks each fix on purpose and expects a test to turn red. Find a change to the source that makes a
verdict wrong while `npm test` stays green, and file it with
[`.github/ISSUE_TEMPLATE/surviving-mutant.yml`](.github/ISSUE_TEMPLATE/surviving-mutant.yml)
([open the form](https://github.com/azank1/seamkit/issues/new?template=surviving-mutant.yml)).

| Who | File and line | What the tests missed | Issue |
|---|---|---|---|
| *open* | the first surviving mutant goes here | | |

## Contributors

Open a pull request that keeps the rules in [CONTRIBUTING.md](CONTRIBUTING.md). The
[pull request template](.github/pull_request_template.md) asks what you examined, what you did not, and which mutation
you tried. Issues labelled
[good first issue](https://github.com/azank1/seamkit/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) are
a good place to start.

| Who | Pull request | What it changed |
|---|---|---|
| *open* | the first outside contributor goes here | |
