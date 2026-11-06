# The ledger

The `seamkit/state` branch: what it records, why it can tell not live from not proven, and how replay checks it.

## Not live versus not proven

`seamkit state init` creates a `seamkit/state` branch, and from then on every readback is recorded there, one file per
event named by the SHA-256 of its content. That history is what lets a later run say a change was live and has left
production, as after a rollback, rather than merely that it is not proven. The branch is written with git plumbing, so
it never touches your working tree, index or HEAD. `seamkit state verify` checks every file against its name,
`seamkit replay` recomputes every recorded verdict from its recorded observations and fails if any comes out
differently, and `seamkit state sync` merges and pushes the branch without forcing (`--no-push` merges here only).

The ledger is a branch, so whatever builds every branch sees each push to it. The Action pushes with the job's token,
which starts no workflows, but a push from your own machine starts every `on: push` workflow that does not leave the
branch out with `branches-ignore: [seamkit/state]`. A host that builds every branch also sees each push: on Vercel,
whose git integration does not build commits by an author outside the team, every ledger commit, written by `seamkit`,
is blocked and shows on GitHub as a failed `Preview` deployment, with nothing built or served.

seamkit records URLs, commit ids, marker texts and digests of what production served, never the content itself. A
production URL with credentials or a query string is refused for that reason, and its fragment is dropped before
anything reads or records it; a card's URL with credentials, a query string or a fragment is refused.

Back to the [README](../README.md).
