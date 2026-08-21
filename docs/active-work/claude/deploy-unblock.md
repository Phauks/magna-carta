---
worktree: /home/user/magna-carta
area: the first production deploy since 2026-07-04 — Cron Triggers and the sign Worker's build
status: building
touches: apps/worker/wrangler.jsonc, docs/conventions/operations.md, changelog.d
---

Two deploy-step failures from the same cause: 627 commits landed between deploys, and neither the
account nor the runbook had caught up with what they added.

**Cron Triggers.** The app Worker's script uploaded on every attempt and only `POST .../schedules`
failed, with an empty error body from Cloudflare — which reads as transient and is not. History
identified it where the error could not: the fourth and fifth triggers were added 2026-08-16, after
the last successful deploy, so this was the first time the account had ever been asked for five.
Trimmed to the three that are provably live. The ceiling is unexplained — the owner reports Workers
Paid, whose documented limit is far above five.

**The sign Worker.** `ENOENT … pdf_core_bg.wasm`: it imports a git-ignored WASM artefact and its
build never ran the task that makes one. No code change — its build command becomes the app worker's,
which already depends on that task. The runbook entry is the deliverable.
