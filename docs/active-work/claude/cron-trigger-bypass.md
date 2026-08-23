---
worktree: C:/dev/magna-carta-worktrees/claude/cron-trigger-bypass
area: Correct the Cron Trigger failure record and the out-of-range weekly expression
status: review
touches: apps/api-worker/wrangler.jsonc, apps/api-worker/src/index.ts, docs/conventions/operations.md, changelog.d
---

Two corrections and no behaviour change to the three live triggers. `NATURAL_LANGUAGE_KEEP_ALIVE_CRON`
moves from `0 4 * * 0` to `0 4 * * 1` because Cloudflare numbers days of the week from 1 = Sunday, and
the comments that blamed a count ceiling are replaced with the atomic-PUT explanation. No cron is
added or removed.
