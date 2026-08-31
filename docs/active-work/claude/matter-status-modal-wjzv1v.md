---
worktree: C:/dev/magna-carta-worktrees/claude/matter-status-modal-wjzv1v
area: The matter masthead — the status seal as the lifecycle control, and the way back to the docket
status: review
touches: apps/web/src/lib/matters, apps/web/src/lib/api/request.ts, apps/web/test/matter-lifecycle.test.ts, roadmap.d/core-domain.md, docs/now.md, docs/user/features/opening-and-finding-matters.md
---

Changing a matter's status moved from the masthead's overflow menu onto the status seal itself: pressing the seal opens a window that states what the step does to the record and, for a close, what the firm's money rules check first, then runs the real open/close/reopen operation. The overflow menu held nothing else and is gone. The seal also gained a back link to the docket at the head of the ledger line.

Confined to `apps/web/src/lib/matters/` plus one additive field on the shared problem envelope in `apps/web/src/lib/api/request.ts` (a refusal's `errors` array, previously dropped) — a concurrent stream reading that module is unaffected, nothing existing changed shape. The cross-cutting files are `roadmap.d/core-domain.md` (the `matters.lifecycle` node flipped to shipped) and its rendered register.
