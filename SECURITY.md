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
- refuses production URLs that carry credentials or a query string, because URLs are recorded;
- reads your git repository, and writes only to its own `seamkit/state` branch, with git plumbing that never touches
  your working tree, index or HEAD, and, for `seamkit stamp --out`, to the version document at the path you give;
- records URLs, commit ids, marker texts and digests in that branch, never the content production served;
- runs no model, and makes no network calls other than to the production URLs you give it and, when you run
  `seamkit state sync`, to your git remote.

The GitHub Action runs the same readback, and also:

- posts one check run per run to the GitHub API that `GITHUB_API_URL` names, with its `token` input;
- fetches the branch it reads from the checkout's origin before reading, all of its history when the checkout is
  shallow, and again while and after it waits, moving `refs/remotes/origin/<branch>` to what it fetched and pointing
  `refs/remotes/origin/HEAD` at the default branch;
- with a ledger, fetches and pushes `seamkit/state` with the checkout's credentials, merging and never forcing;
- writes its step outputs and job summary;
- takes the user name and password of any URL out of git's errors before it reports them, since a check run on a
  public repository is public.

Reports about any way to make seamkit report a pass it did not earn, to write outside its branch or the refs named
above, to record content or secrets, or to put a credential into a report are especially welcome.
