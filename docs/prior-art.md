# Prior art (M0 research pass, 2026-10-14)

This document records where existing tools stop relative to the harness, so that the README can be honest about what is
new. It was written from one research pass over public documentation on 2026-10-14. Every claim below carries a source,
and claims that could not be confirmed from a source are marked unverified. The expected finding, stated in the handoff
before the research began, was that each piece exists somewhere while the combination does not. The research supports
that expectation, with the qualifications set out in section 7.

## 1. Deploy and verify

Progressive-delivery controllers evaluate metrics during a rollout. All of them except Datadog's gates need Kubernetes,
and none of them treats "examined nothing" as a result in its own right.

**Argo Rollouts** has an `Inconclusive` phase, which its documentation describes as a run that was "neither successful,
nor failed", and which pauses the rollout until someone intervenes.[^ar-analysis] Empty data is not mapped to it
automatically. The documentation's own examples show that the template author decides: an expression such as
`len(result) == 0 || result[0] >= 0.95` turns an empty result into a success. Errors in taking a measurement follow a
separate path bounded by error limits.[^ar-faq] It has no notion of a commit and does not compute what a deploy carries.
It is Apache-2.0 and active, with v1.10.0 released on 2026-08-05.[^ar-rel]

**Flagger** halts advancement when no metric values are found and counts it as a failed check, rolling back at the
threshold.[^flagger-issue] That fails closed, which is safe, but missing data becomes indistinguishable from a bad metric.
It needs Kubernetes, a mesh or ingress, and a metrics backend.

**Kargo** verifies freight after promotion and emits separate events for succeeded, failed, errored, aborted,
inconclusive and unknown verification.[^kargo-events] When no verification is configured, success is "implicitly
contingent on the Applications reaching a Healthy state", so a health signal stands in for verification, and a manual
approval bypasses verification entirely.[^kargo-verify] It records the freight it promoted, which is the desired state,
rather than reading back the running service (unverified beyond the documentation).

**Spinnaker's Kayenta** has the richest missing-data rules in the set and still scores examined-nothing as a pass. Its
canary judge excludes `Nodata` metrics from group scores, fails a metric marked `mustHaveData` that has no data, and fails
the canary when at least half the metrics have no data. Yet "if all metrics in a group are `Nodata`, the group gets an
effective score of 100".[^kayenta] A group that examined nothing is scored as perfect, which is the failure this project
exists to prevent, written into a mature tool's documentation.

**Keptn** scored quality gates with pass, warning and fail, and an objective with no value scored as a failure.[^keptn-slo]
The CNCF archived the project on 2025-09-03 after its main maintaining company stepped back.[^keptn-archive]

## 2. Deploy tracking and delivery metrics

**Sleuth** registers deploys by commit from CI and checks their health from error and incident sources.[^sleuth-reg] Its
work-in-progress view lists pull requests not yet deployed to their target environment, which is the closest any SaaS
tool comes to carry, and it once offered a lock on merges while unreleased changes existed.[^sleuth-wip] It trusts the
commit CI registers rather than reading production, and an approximate mode treats every merged pull request as a
deploy, which is the opposite of read-back.[^sleuth-faq] The company has since repositioned its homepage around agent
skills.[^sleuth-home]

**LinearB** uses the correct matching rule, git ancestry rather than timestamps, but applies it to a deployment reference
that CI pushes rather than one read from production.[^linearb-api] It computes metrics and does not gate. It has an
official MCP server.[^linearb-mcp]

**Datadog** offers the most complete assembly. Deployment gates are evaluated through a CLI or GitHub Action with
`in_progress`, `pass` and `fail` states, and a monitor rule fails when a matching monitor is in `NO_DATA`, so missing data
fails closed.[^dd-gates] [^dd-api] Its APM shows which versions were "active during the selected time interval", which is
a genuine read-back of production, but only through traffic and tags and with no ancestry check.[^dd-tracking] Its Code
Changes Detection lists the git log between consecutive deployment commits, which is carry computed after the deploy
rather than before it, and it is in preview.[^dd-changes] All of this requires paid APM.

**DORA Four Keys** computes retrospective metrics from deployment events matched to commits, counts only successful
deployments, and was archived on 2024-01-23.[^fourkeys] [^fourkeys-metrics]

## 3. Mutation testing and the negative control

**StrykerJS** is the general, automated form of the negative-control idea: change the code and expect the tests to fail.
Its mutant states separate killed, survived, no coverage, timeout and errors, errors are excluded from the score, and a
covered-code score with nothing covered prints "n/a".[^stryker-states] A run that finds no tests stops with "No tests
found" unless the user allows it.[^stryker-config] Its build-breaking threshold is off by default, however, and a test
runner incompatibility in October 2026 produced runs of zero tests per mutant in which every mutant was reported as
survived.[^stryker-zero] The harness does not replace Stryker. It records the evidence shape of a targeted negative
control (flip a feature default, expect red) and lets a gate require it.

## 4. Merge flow, pull request policy and release notes

**GitHub rulesets** require checks to pass on the latest commit, and checks from earlier commits do not satisfy the
requirement.[^gh-required] They can also require named environments to have deployed before a merge.[^gh-rules] No
documented rule reads the pull request body. The handling of a check that did not run is inconsistent, and this is the
clearest evidence in the whole survey for a third outcome. A required workflow skipped by a path or branch filter leaves
its check pending forever, which blocks the merge, while a required job skipped by an `if:` condition reports success
and does not block.[^gh-required] [^gh-if] The same absence of evidence is therefore a permanent block in one
configuration and a silent pass in another. In the **merge queue**, a required check that is never reported fails the
merge after a timeout.[^gh-mq] Custom deployment protection rules let a GitHub App approve or reject a deployment, and
are in public preview.[^gh-dpr]

**Mergify** can match the pull request body with a regular expression, along with files, labels, authors and schedules,
and supports scheduled freezes with exceptions.[^mergify-cond] [^mergify-freeze] It reads checks from the head commit,
lets the newest run of each check win, and does not count skipped or neutral as success.[^mergify-cond] **Graphite**
provides a stack-aware merge queue and a model-based reviewer, and agreed in December 2025 to be acquired by
Cursor.[^graphite-mq] [^graphite-cursor] **Aviator** combines a merge queue, a releases view that shows the version and
commit in each environment and whether a change is "already deployed or still pending", and a newer Verify product that
captures intent through agent hooks and checks acceptance criteria deterministically with a model fallback labelled by
confidence.[^aviator-rel] [^aviator-verify] Aviator is the closest existing combination. It is paid software as a
service, and its verifier includes a model.

**Danger** runs rules in CI that can read a pull request's title, body and files and fail the build.[^danger] **OPA and
Conftest** evaluate Rego policies over structured files and know nothing of pull requests unless fed them.[^conftest]
Either could implement a card check by hand. **Changesets** is the closest prior art to the scope card: every pull request
commits a small YAML and Markdown file stating the packages it bumps and a summary, and a bot comments when one is
missing.[^changesets-bot] **release-please** derives releases from conventional commits and states that it does not handle
publication.[^release-please] Neither knows what is deployed.

## 5. Agent-era tools and direct competitors

The search for 2025 and 2026 tools aimed at release safety for agent-written code found many single-module projects and
no complete one. They fall into two groups.

The deterministic group is small and young. **shipproof**, the near-namesake on npm, is a static repository hygiene linter
that scores manifests, the presence of test and build commands, lockfiles, licence files and workflows from 0 to 100. It
never runs a command, reads a pull request or looks at production.[^shipproof] **shipledger** reconciles a release
manifest that an agent writes against git ranges with deterministic rules, which overlaps carry, but it does not read
production's running version.[^shipledger] **agent-guardrails** checks a diff against a task contract of intended files,
allowed paths and required commands, flags risky paths and over-wide tasks, and ships an MCP server, which overlaps card,
radius and the split rule but not CI or production.[^agent-guardrails] **Permission Protocol's deploy-gate** has a named
human sign an approval bound to one action and redeems it once at deploy time, failing closed, which is the same idea as
the harness's approvals, delivered through a hosted service.[^permission-protocol] **Agents Shipgate** returns
deterministic verdicts including `insufficient_evidence`, the nearest vocabulary to examined-nothing, in the narrower
domain of agent tool-surface changes.[^shipgate] **blastproof** classifies blast radius but fails on unmapped files only
when a flag asks it to, which is the opposite default to the harness, where unclassified stops.[^blastproof] Several
small tools check production claims or deployed commits, but each needs a hosted API or is not public.[^didwork]
[^agent-ops] Hook packs for Claude Code block commands by pattern and know nothing of pull requests, CI or
production.[^hookpacks]

The model-based and platform group is larger and better funded. CodeRabbit's pre-merge checks judge the description and
custom rules with a model and can block merges.[^coderabbit] Greptile, Graphite's agent and Vercel's agent all review with
a model. **Vercel Deployment Checks** hold a production deployment back from its domain until required GitHub checks
pass, which is a platform-specific promotion gate.[^vercel-checks] **Kosli** records snapshots of which artifacts run in
each environment and can assert that an artifact is allowed there, which makes it the strongest prior art for knowing
what is live. It is commercial software, with no pull request card and no MCP server found.[^kosli]

The most telling result is indirect. Many repositories in 2026 write their own version-endpoint drift check by hand,[^handrolled]
which suggests that the read-back is a recognised need without a packaged tool.

## 6. MCP elicitation as a channel to a human

The harness's design depends on whether MCP elicitation reaches a human, so this question was researched separately.
The short answer is that elicitation reaches the client's interface, and nothing guarantees that a human answers it.

Elicitation appears in the 2025-06-18 revision of the specification, gained URL mode in 2025-11-25, and was restructured in
2026-07-28, the current revision, into multi round-trip requests in which the server returns an `input_required` result
and the client retries with the answers.[^mcp-versioning] [^mcp-mrtr] Form mode is limited to flat objects of primitive
fields, and its data is visible to the client. URL mode sends the user to a page that talks to the server directly, and
"data (other than the URL itself) is not exposed to the client"; clients must not open the URL without consent and must
show it in full.[^mcp-elicit-2511] [^mcp-elicit-2607] From 2025-11-25 a client that shows a request must show it clearly,
with decline and cancel options, but every revision states that "the protocol itself does not mandate any specific user
interaction model", and the 2026 revision says input may come "from the user or other sources".[^mcp-mrtr]

Client support is uneven. Claude Code supports form mode from version 2.1.76 and URL mode later, and documents that an
`Elicitation` hook can accept a request with content so that "no dialog appears", including for URL mode, where the URL
then never opens.[^cc-hooks] [^cc-mcp] VS Code supports form mode from 1.102 and URL mode from 1.107.[^vscode-102]
[^vscode-107] Cursor lists elicitation as supported.[^cursor-mcp] Codex declares both modes, auto-declines under `codex
exec`, and has open issues in which approval forms with an empty schema are auto-accepted.[^codex-45776] [^codex-23383]
Gemini CLI, Windsurf, Zed and Cline do not support it, and Goose cancels every elicitation in headless runs.[^gemini-22249]
[^goose-11194]

Two results follow for the design. Elicitation is a good way to ask, because it reaches the person at the session in the
client they already use, but it is not proof that a person answered. And the only channel the research found that an agent
running as the same user cannot complete is a WebAuthn assertion with user presence, on a page the server itself serves,
because the agent cannot produce the authenticator's signature. WebAuthn works on `localhost`, which browsers treat as a
secure context.[^mdn-secure] The architecture's approval levels (section 7.4 of `architecture.md`) are built on these two
results.

## 7. Synthesis

No tool or combination delivers three-valued results, a read-back of production, carry computed before a deploy, and an
agent-facing surface for a small team without Kubernetes or a hosted service.

The pieces exist separately. Gate mechanics are well covered: required checks on the head commit, the newest run
winning, merge queues and freezes are standard in GitHub and Mergify. Changesets proves that teams accept a committed
statement of intent per change. shipledger and agent-guardrails cover parts of carry and of card-plus-radius for agents.
Permission Protocol binds approvals to one action. Kosli and Aviator know what runs in each environment, as paid
services.

What remains uncovered, for a small team that wants a deterministic tool it hosts itself, is the following list.

1. A schema-validated card in the pull request body that the pull request gate and the deploy step evaluate identically.
2. One explicit rule for a check that did not run, where GitHub alone gives three different answers depending on how it
   was skipped.
3. Carry anchored to the version production is actually running, blocking when that version was deployed by hand or
   cannot be determined.
4. Marker-based read-back, which teams currently write by hand.
5. An examined-nothing outcome with an explicit list of what was not examined, which no deploy tool has. Argo Rollouts
   and Kargo leave empty data to the user's expression, Kayenta scores an all-empty group as perfect, and Flagger,
   Datadog and Keptn fold it into failure.
6. Radius classification in which an unclassified path stops by default.
7. Approvals that cannot arrive as a tool argument and record what their channel can prove.

The combination is therefore new, while each element has precedent, which is what the handoff expected. The README
should say so plainly and credit the precedents. The competitive risk is Aviator adding read-back and an MCP-first
surface, and the defence is the deterministic, self-hosted and three-valued design that a paid service with a model
fallback is unlikely to adopt.

### Ideas borrowed

Kayenta's `mustHaveData` flag and its rule that a majority of empty metrics fails the run become policy options.
Stryker's default refusal to run with no tests is the default for every harness check. LinearB's ancestry test is the
matching rule, applied to a version read from production rather than one pushed by CI. Kargo's separation of
inconclusive from errored is the distinction between `examined_nothing` and a configuration error with exit code 2.
Mergify's rule that skipped and neutral checks are not success is adopted, and a skipped required job is reported as
examined nothing rather than as a pass.

## Sources

[^ar-analysis]: https://argo-rollouts.readthedocs.io/en/stable/features/analysis/
[^ar-faq]: https://argo-rollouts.readthedocs.io/en/stable/FAQ/
[^ar-rel]: https://pkg.go.dev/github.com/argoproj/argo-rollouts
[^flagger-issue]: https://github.com/fluxcd/flagger/issues/1090
[^kargo-events]: https://docs.kargo.io/user-guide/reference-docs/events/event-reference
[^kargo-verify]: https://docs.kargo.io/user-guide/how-to-guides/verification
[^kayenta]: https://spinnaker.io/docs/guides/user/canary/judge/
[^keptn-slo]: https://v1.keptn.sh/docs/1.0.x/reference/files/slo/
[^keptn-archive]: https://www.cncf.io/projects/keptn/ and https://github.com/cncf/toc/issues/1584
[^sleuth-reg]: https://help.sleuth.io/sleuth-dora/sleuth-api/deploy-registration
[^sleuth-wip]: https://help.sleuth.io/work-in-progress and https://www.sleuth.io/post/deployment-locking/
[^sleuth-faq]: https://help.sleuth.io/sleuth-dora/resources/faq
[^sleuth-home]: https://www.sleuth.io/
[^linearb-api]: https://linearb.helpdocs.io/article/5h6n4re0t9-api-deployment
[^linearb-mcp]: https://linearb.helpdocs.io/article/g9dquc4vob-mcp-server
[^dd-gates]: https://docs.datadoghq.com/deployment_gates/setup/preconfigured/
[^dd-api]: https://docs.datadoghq.com/api/latest/deployment-gates/get-a-deployment-gate-evaluation-result/
[^dd-tracking]: https://docs.datadoghq.com/tracing/services/deployment_tracking/
[^dd-changes]: https://docs.datadoghq.com/continuous_delivery/features/code_changes_detection/
[^fourkeys]: https://github.com/dora-team/fourkeys
[^fourkeys-metrics]: https://github.com/dora-team/fourkeys/blob/main/METRICS.md
[^stryker-states]: https://stryker-mutator.io/docs/mutation-testing-elements/mutant-states-and-metrics/
[^stryker-config]: https://stryker-mutator.io/docs/stryker-js/configuration/
[^stryker-zero]: https://github.com/wedevelopnl/silverstripe-grid/issues/489
[^gh-required]: https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks
[^gh-rules]: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets
[^gh-if]: https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-jobs-with-conditions
[^gh-mq]: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue
[^gh-dpr]: https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/create-custom-protection-rules
[^mergify-cond]: https://docs.mergify.com/configuration/conditions/
[^mergify-freeze]: https://docs.mergify.com/merge-protections/freeze/
[^graphite-mq]: https://graphite.com/docs/merge-queue-optimizations
[^graphite-cursor]: https://graphite.com/blog/graphite-joins-cursor
[^aviator-rel]: https://changelog.aviator.co/p/aviator-releases-now-in-public-beta
[^aviator-verify]: https://www.aviator.co/verify
[^danger]: https://danger.systems/js/
[^conftest]: https://www.conftest.dev/
[^changesets-bot]: https://github.com/changesets/bot
[^release-please]: https://github.com/googleapis/release-please
[^shipproof]: https://github.com/CalvaryBloom/shipproof
[^shipledger]: https://github.com/kacxx/shipledger
[^agent-guardrails]: https://github.com/logi-cmd/agent-guardrails
[^permission-protocol]: https://github.com/permission-protocol/deploy-gate
[^shipgate]: https://threemoonslab.com/
[^blastproof]: https://github.com/hamc/blastproof
[^didwork]: https://github.com/didworksh/verify-action
[^agent-ops]: https://www.npmjs.com/package/@agent-stack2/ops
[^hookpacks]: https://github.com/karanb192/claude-code-hooks, https://github.com/0xKalel/claude-code-guard-hooks, https://github.com/dwarvesf/claude-guardrails
[^coderabbit]: https://docs.coderabbit.ai/pr-reviews/pre-merge-checks
[^vercel-checks]: https://vercel.com/docs/deployment-checks
[^kosli]: https://docs.kosli.com/understand_kosli/how_kosli_works
[^handrolled]: https://github.com/mentorix-app/backend/pull/55, https://github.com/narduk-enterprises/narduk-libs/issues/597, https://github.com/felix-run/web/pull/266
[^mcp-versioning]: https://modelcontextprotocol.io/specification/versioning
[^mcp-mrtr]: https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr
[^mcp-elicit-2511]: https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation
[^mcp-elicit-2607]: https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation
[^cc-hooks]: https://code.claude.com/docs/en/hooks#elicitation
[^cc-mcp]: https://code.claude.com/docs/en/mcp#respond-to-mcp-elicitation-requests
[^vscode-102]: https://code.visualstudio.com/updates/v1_102
[^vscode-107]: https://code.visualstudio.com/updates/v1_107
[^cursor-mcp]: https://cursor.com/docs/mcp
[^codex-45776]: https://github.com/openai/codex/issues/45776
[^codex-23383]: https://github.com/openai/codex/issues/23383
[^gemini-22249]: https://github.com/google-gemini/gemini-cli/issues/22249
[^goose-11194]: https://github.com/aaif-goose/goose/issues/11194
[^mdn-secure]: https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts
