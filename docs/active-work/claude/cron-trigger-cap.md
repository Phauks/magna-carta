---
worktree: /home/user/magna-carta
area: the app Worker's Cron Trigger set — deploy-blocking
status: building
touches: apps/worker/wrangler.jsonc, changelog.d
---

The first `main:release` deploy since 2026-07-04 failed at the trigger step on every attempt. The
Worker uploaded each time; only `POST .../schedules` failed, with no error body from Cloudflare.

What identified it was history rather than the error: the two extra triggers were added 2026-08-16,
after the last successful deploy, so today was the first time the account had ever been asked for
five. Three deploy; five do not.

Trimmed to the three that are provably live. The branch left open is whether the ceiling is the plan's
or something else — the owner reports Workers Paid, whose documented limit is far above five, so the
refusal and the plan disagree and only the account can settle it.
