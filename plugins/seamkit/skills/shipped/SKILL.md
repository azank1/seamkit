---
name: shipped
description: Check whether merged changes are actually live in production before calling work shipped or done. Use after a merge or a deploy, when asked "is it live?", "did it deploy?", or before reporting a change as shipped.
allowed-tools: mcp__plugin_seamkit_seamkit__audit mcp__plugin_seamkit_seamkit__readback mcp__plugin_seamkit_seamkit__replay mcp__plugin_seamkit_seamkit__ledger_verify
---

Advisory: this skill tells you how to ask. The verdict comes from seamkit, and the check run in CI is the
control; nothing here can turn a non-pass into a pass.

1. For one pull request, call `readback` with `pr`; after a deploy, also pass `deployed` with the commit it
   shipped. For the latest changes, call `audit`.
2. A change is shipped only when the result's `exitCode` is 0.
3. `exitCode` 1: the change is not live or not proven. 3: nothing could be examined, which is never a pass.
   4: stop and ask a human. Report the result's `reasons` and the audit's `advice` as they are.
4. Never call again in a loop hoping for a pass. If a deploy is still rolling out, say so and stop.
