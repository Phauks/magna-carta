---
worktree: C:/dev/magna-carta-worktrees/claude/upbeat-clarke-6znudl
area: Platform reset tooling, and the stack line's two stale claims
status: review
touches: CLAUDE.md, apps/api-worker/scripts, docs/conventions/operations.md
---

The pre-launch clean-slate script (`apps/api-worker/scripts/reset-platform.mts`), plus the correction
to the stack line: the per-firm store has been a SQLite Durable Object since ADR-0140, not D1, and
Vectorize is bound in none of the fourteen workers. Still to come on this branch: the per-firm
export/erase tooling, and narrowing the R2 credential from account-wide to bucket-scoped temporary
credentials.
