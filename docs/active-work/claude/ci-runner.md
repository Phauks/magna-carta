---
branch: claude/ci-runner
worktree: /home/user/magna-carta/.claude/worktrees/ci-runner
area: the dead gate of record — why no runner attaches, and what it is not
status: review
touches: docs/deploy-queue.md, docs/conventions/operations.md, docs/conventions/build-performance.md, ROADMAP.md, docs/active-work/claude, changelog.d/, docs/decisions/pending/
---

The gate of record has concluded `failure` on every run since 2026-08-05 without executing a single
step. The working hypothesis on the way in was that `ubuntu-slim` — added by the CI cost-reduction
work — is not a real runner label, and that correcting or reverting it would restore the gate.

That hypothesis is wrong, and this stream is mostly the disproof. `ubuntu-slim` is a generally
available GitHub-hosted label; the outage predates its introduction by three hours and reproduces
identically on `ubuntu-latest` in a second workflow that has no `ubuntu-slim` in it at all. No runner
attaches for **any** label because the account cannot start billable jobs, which is exactly what the
austerity note already said on the day it was written.

No workflow change: reverting the label would spend three times the rate to fix nothing. What lands
here is the evidence, the owner action on the deploy queue, and a recognition rule so that a job that
never ran stops looking like a job that failed.
