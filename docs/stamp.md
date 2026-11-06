# Make production say what it runs

Readback can prove a change only when production names the commit it was built from. This page covers the version document, `seamkit stamp`, and what it does on Vercel.

## The version document

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
`RENDER_GIT_COMMIT`, `CI_COMMIT_SHA`, `BITBUCKET_COMMIT` or `SOURCE_VERSION`) and records which one it used. In a
checkout it needs git: a checkout that git is missing or refuses to read gets no stamp, rather than one that cannot say
whether its tree was clean. A change counts even where `git status` would not show it: inside a submodule, whatever
its `ignore` setting, in the directory of a submodule that is not checked out, or in a file marked skip-worktree or assume-unchanged, which counts as it would unmarked (in a
sparse checkout, a skip-worktree file left out of the checkout is not a change). Stamp asks git not to refresh its index, so it writes
nothing to the repository. `--require-clean` refuses a dirty tree, and also refuses any stamp that cannot say whether
the tree is clean: outside a repository, or with `--commit` naming anything but the commit checked out.

Vercel's build keeps the history and then writes `vercel.json` into the checkout: the committed settings on one line,
or `{}` when none is committed. On Vercel's build of the commit, stamp does not count a `vercel.json` that holds exactly
the committed settings, and it records the branch Vercel built from `VERCEL_GIT_COMMIT_REF`. A stamp before 0.2.0
counts that file, so every Vercel build reads as having uncommitted changes and readback cannot prove it.

Back to the [README](../README.md).
