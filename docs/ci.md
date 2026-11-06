# Use seamkit in CI

The GitHub Action, the scheduled watch that catches rollbacks and hand deploys, every input, and the recipe for any other CI.

## The GitHub Action

The seamkit Action reads production back once a deploy succeeds and posts the verdict as a check run on the deployed
commit. Hosts that report deployments to GitHub fire `deployment_status`. Vercel does while the project's
`deployment_status` Events setting (Settings, Git) is on, and names the production environment `Production`. A new
Vercel project can start with that setting off, and then no readback runs:

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
again. On a schedule the check goes on the job's commit, the default branch's tip, so a watch that reads another branch
with `branch` should have its own `check-name`.

On Vercel, a rollback also keeps later deploys away from the address. Instant Rollback turns off the project's
assignment of its production domains, so each later push still builds, and GitHub records it as a successful
`Production` deployment, while the address goes on serving the rolled-back build. The readback after each of those
deploys fails, saying that production runs the rolled-back commit, until a deployment is promoted, for example with
`vercel promote <deployment URL>`. A promote sends no deployment event, so the watch is what reads it back.

| Input | Default | |
|---|---|---|
| `url` | required | the production address |
| `last` | `20` | how many of the latest changes to examine |
| `pr` | | read back one merged pull request instead |
| `wait` | `60` | after a deploy, seconds (up to 1800) to keep reading until production reports the deployed commit; nothing is recorded meanwhile |
| `ledger` | `auto` | `auto` records when a `seamkit/state` branch exists, `true` starts one, `false` neither reads nor records it, so a rollback reads not proven and changes merged during the build are judged |
| `check-name` | `seamkit readback (<host><path>)` | one check per production address, shared by the deploy readback and its watch, so the later verdict on a commit replaces the earlier one; a job that reads the same `url` for another `branch`, a `pr` or another `version-url` needs a name of its own |
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
    deployed=(--deployed "$DEPLOYED_COMMIT")
    npx --yes seamkit@0.2 state sync --no-push || deployed=()   # without the ledger as it is now, judge every change
    status=0
    npx --yes seamkit@0.2 readback --url https://your.app --last 20 --branch "$BRANCH" "${deployed[@]}" || status=$?
    npx --yes seamkit@0.2 state sync || echo '::warning::seamkit: the ledger was not pushed'
    exit $status
  env:
    BRANCH: ${{ github.event.repository.default_branch || github.ref_name }}   # a schedule's event names no repository
    DEPLOYED_COMMIT: ${{ github.sha }}   # the commit this job deployed
```

The step exits with readback's code: it fails when a change is not live or not proven, and exits 3 when nothing could
be examined, so a broken read never passes silently. The first `state sync` only fetches and merges, so a push
problem is reported once, by the last. When the first fails, the step leaves out `--deployed`: a ledger copy left on a
runner that keeps its workspace may lack runs others pushed, and scoping from it could pass a rollback. Readback records the run when the checkout has a ledger
(`seamkit state init` starts one), and pushing it needs `permissions: contents: write`. In a GitHub Actions step, the
CLI's output cannot run a workflow command: where a change's own words would read as one, a zero-width space keeps them
plain text. Problem matchers are different: they read every line of the log, so a matcher an earlier step added, such
as the ones `actions/setup-node` adds, can turn a change's title into an error annotation. The recipe removes those; do
the same for any matcher of your own, in this job and in a job that runs the Action.

Back to the [README](../README.md).
