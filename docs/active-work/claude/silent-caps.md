---
worktree: claude/silent-caps
area: API contract — three reads that cut their answer without saying so
status: building
touches:
  - packages/custodian/src/stocktake-statements.ts
  - packages/custodian/src/stocktake-reconciliation.ts
  - packages/custodian/src/reminders.ts
  - packages/notifications/src/sweep.ts
  - apps/api-worker/src/routes/custody.ts
  - apps/api-worker/src/routes/auto-file-rules.ts
  - apps/api-worker/openapi/openapi.json
  - packages/api-client/src
  - tooling/lint-list-pagination/unpaged-baseline.mjs
---

# Three reads that cut their answer without saying so

Found while emptying the pagination baseline. `capped()` in the pagination contract already exists
and says what it is for; three reads had a real ceiling and no flag, and two described themselves as
complete while stopping short.

Each ceiling is unchanged. What changes is that the response now distinguishes "there are no more"
from "we stopped counting".

The custody reminders flag is PER REASON, not per list, and that is deliberate: a firm with sixty
overdue check-outs and no reviews has a truncated answer even though the combined list is under the
combined ceiling. The notifications sweep's own clamp answers a different question and is unchanged.
