---
worktree: C:/dev/magna-carta-worktrees/claude/discovery-tab-design-mmxyul
area: The discovery surface — the matter's Discovery section, the firm-wide register, and the review workspace over the built 5·1 corpus
status: review
touches: apps/web/src/lib/discovery, apps/web/src/routes/(app)/discovery, apps/web/src/routes/(app)/matters/[id]/discovery, apps/web/src/lib/matters/sections.ts, apps/web/src/lib/navigation/destinations.ts, apps/api-worker/src/routes/discovery.ts, apps/api-worker/openapi/openapi.json, packages/discovery/src/review-reads.ts, docs/specs/, docs/user/features/, roadmap.d/discovery.md, ROADMAP.md, status.d/, STATUS.md, changelog.d/
---

The design and its build. Everything new lives under `apps/web/src/lib/discovery/` and the two new route trees; the shared files it edits are narrow and named above. `sections.ts` gains a fifteenth section (Discovery, in the Record group beside Custodian) and `destinations.ts` flips the announced Discovery row to shipped — a concurrent stream touching either should coordinate, and nothing else in `apps/web` is claimed. On the server it adds one firm-wide read to `packages/discovery/src/review-reads.ts` (registered in the visibility fitness registry in the same commit) and one artifact-download route to `apps/api-worker/src/routes/discovery.ts`, so the regenerated `openapi.json` is a touch-overlap with several streams.
