---
slug: the-gate-runs-hosted-again-on-a-capped-budget
status: Accepted
area: Dev tooling
date: 2026-11-09
summary: "`pnpm gate` stays the gate of record and runs hosted again as the required `gate` check, one job in `ci.yml` that runs the same command against GitHub's merge of the branch, on an Actions budget the owner funded with a spending cap. Two workflows ported from the Grim-Games repository go with it: PR upkeep, which comments on a conflicting or stuck pull request so its thread wakes and fixes it, and Preview cleanup, which deletes leftover Worker Previews so they stop holding Durable Object namespaces. The root CLAUDE.md gains the rules that make parallel pull requests land: merge `main` before every push, check with `git merge-tree`, turn on auto-merge. Amends ADR-0478 on where the gate runs; the command stays the gate of record."
---

**The gate runs hosted again, as a thin wrapper around the same command, on a budget with a cap.**

**Context:** The hosted gate was removed on 2026-09-16 (ADR-0478)
because the Actions budget ran dry twice and the required `gate` status, never reporting, wedged every
pull request until an override merged it. Work resumed on 2026-11-09 with several Claude threads
opening pull requests in parallel against a `main` that deploys on merge. A local-only gate depends on
each author remembering to run it, on a branch that may be behind `main`, so two branches that each
pass alone can deploy a broken combination. The Grim-Games repository runs the same parallel-thread
workflow with a hosted check, a PR upkeep job and a merge-before-push rule, and the owner considers
that setup to have worked.

**Decision:** The owner chose to fund GitHub Actions with a spending cap (2026-11-09). `ci.yml` runs
`pnpm gate` as one job named `gate` on every pull request into `main` or `beta` and every push to them,
measured from the first parent of GitHub's merge commit; it adds no check of its own. It keeps minutes
low by running one job rather than a fan-out, cancelling a pull request's stale run, caching every slow
input, and skipping the wasm-pack, browser and container set-up when `pnpm gate --plan` does not reach
them. `pr-upkeep.yml` and `preview-cleanup.yml` are ported from Grim-Games. The root `CLAUDE.md`
requires merging `main` before every push, checking with `git merge-tree --write-tree`, and auto-merge.

**Consequences:** `gate` goes back into the `main` ruleset's required checks (a deploy-queue step,
with the spending cap and the two settings auto-merge needs). If the cap is reached, the check stops
reporting and pull requests wait on it again; the deploy queue records the fallback, which is removing
the requirement until the budget resets. The docs-assembly pull request, opened with the workflow
token, dispatches `ci.yml` onto its branch so it can still auto-merge. Preview cleanup is dormant until
a `beta` Preview and its Cloudflare secrets exist.
