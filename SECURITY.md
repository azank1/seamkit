# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately, through GitHub: open the repository's **Security** tab and choose **Report a
vulnerability**. Do not open a public issue for a vulnerability. You can expect an acknowledgement within a few days and
a fix or a plan within two weeks for anything confirmed.

## Supported versions

Only the latest published 0.x release receives fixes while seamkit is below 1.0.

## What seamkit touches

Knowing its reach helps judge a report. The CLI:

- reads production with HTTP `GET` requests only, with limits on time and size, and never sends credentials;
- refuses production URLs that carry credentials or a query string, and drops their fragment, because URLs are
  recorded, and refuses card URLs that carry credentials, a query string or a fragment;
- reads your git repository, and writes only to its own `seamkit/state` branch, with git plumbing that never touches
  your working tree, index or HEAD, to `refs/remotes/<remote>/seamkit/state` when `seamkit state sync` fetches it,
  and, for `seamkit stamp --out`, to the version document at the path you give;
- records URLs, commit ids, marker texts and digests in that branch, never the content production served;
- runs no model, and makes no network calls other than GET requests to the production URLs you give it, to the
  absolute URLs the cards of merged changes name (a card's path is resolved against the production URL), and to
  wherever those redirect, and, when you run `seamkit state sync`, to your git remote.

The GitHub Action runs the same readback, and also:

- posts one check run per run to the GitHub API that `GITHUB_API_URL` names, with its `token` input;
- fetches the branch it reads from the checkout's origin before reading, and again while and after it waits, moving
  `refs/remotes/origin/<branch>` to what it fetched, and points `refs/remotes/origin/HEAD` at the default branch;
- when the checkout is shallow (actions/checkout's default `fetch-depth: 1`), first fetches the full history of every
  branch on origin, as `fetch-depth: 0` would, which creates or moves `refs/remotes/origin/<name>` for each of them,
  `seamkit/state` included even with `ledger: false`;
- with a ledger, fetches and pushes `seamkit/state` with the checkout's credentials, merging and never forcing;
- writes its step outputs and job summary;
- takes the user name and password of any URL out of git's errors before it reports them, since a check run on a
  public repository is public: the credentials git can see, in the URLs its config holds, its http extra headers, the
  credential helpers it runs and the proxy variables, are hidden wherever they appear, a line git quotes from a
  credential helper's output is not shown, and what is left is scrubbed of anything shaped like one.

Reports about any way to make seamkit report a pass it did not earn, to write outside its branch or the refs named
above, to record content or secrets, or to put a credential into a report are especially welcome.
