# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately, through GitHub: open the repository's **Security** tab and choose **Report a
vulnerability**. Do not open a public issue for a vulnerability. You can expect an acknowledgement within a few days and
a fix or a plan within two weeks for anything confirmed.

## Supported versions

Only the latest published 0.x release receives fixes while seamkit is below 1.0.

## What seamkit touches

Knowing its reach helps judge a report. seamkit:

- reads production with HTTP `GET` requests only, with limits on time and size, and never sends credentials;
- refuses production URLs that carry credentials or a query string, because URLs are recorded;
- reads your git repository, and writes only to its own `seamkit/state` branch, with git plumbing that never touches
  your working tree, index or HEAD;
- records URLs, commit ids, marker texts and digests in that branch, never the content production served;
- runs no model, and makes no network calls other than to the production URLs you give it and, when you run
  `seamkit state sync`, to your git remote.

Reports about any way to make seamkit report a pass it did not earn, to write outside its branch, or to record content
or secrets are especially welcome.
