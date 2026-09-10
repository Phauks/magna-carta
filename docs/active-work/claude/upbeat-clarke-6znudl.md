---
worktree: C:/dev/magna-carta-worktrees/claude/upbeat-clarke-6znudl
area: Upload readiness and deployment modes — design under owner review; reset tooling and the runbook's key-scope correction landed
status: review
touches: docs/specs, docs/decisions/pending, apps/api-worker/src/files, apps/api-worker/src/deployment-mode.ts, apps/api-worker/wrangler.jsonc, apps/web/src/routes/(app)/matters/[id]/files
---

The pre-launch clean-slate script (`apps/api-worker/scripts/reset-platform.mts`), plus the correction
to the stack line: the per-firm store has been a SQLite Durable Object since ADR-0140, not D1, and
Vectorize is bound in none of the fourteen workers. Still to come on this branch: the per-firm
export/erase tooling, and narrowing the R2 credential from account-wide to bucket-scoped temporary
credentials.
