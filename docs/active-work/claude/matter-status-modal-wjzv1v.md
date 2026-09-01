---
worktree: C:/dev/magna-carta-worktrees/claude/matter-status-modal-wjzv1v
area: The matter masthead — the status seal as the lifecycle control, and the way back to the docket
status: review
touches: apps/web/src/lib/matters, apps/web/src/lib/api/request.ts, apps/api-worker/src/routes/matters.ts, apps/api-worker/openapi/openapi.json, packages/api-client/src, roadmap.d/core-domain.md, docs/now.md, docs/user/features/opening-and-finding-matters.md
---

Changing a matter's status moved from the masthead's overflow menu onto the status seal itself: pressing it opens a short window stating the status, what closing requires and whether each requirement is met, what becomes of the paper file, and the one step the status allows. The overflow menu held nothing else and is gone. The seal also gained a back arrow to the docket at the head of the ledger line.

The verdict is the program's, which needed one new route: `GET /api/v1/matters/{id}/close-readiness` runs the registered close preconditions read-only. That touches `apps/api-worker/src/routes/matters.ts` plus the regenerated OpenAPI snapshot and API client, so a concurrent stream regenerating either will collide — coordinate before touching them. The other cross-cutting files are `roadmap.d/core-domain.md` (the `matters.lifecycle` node flipped to shipped, and a new `matters.physical-file` node for the register the platform does not have) and its rendered register. The one shared-module change is additive: a refusal's `errors` array on `apps/web/src/lib/api/request.ts`, which nothing existing reads.
