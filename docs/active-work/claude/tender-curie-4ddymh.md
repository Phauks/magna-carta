---
worktree: C:/dev/magna-carta-worktrees/claude/tender-curie-4ddymh
area: Shipping & postage completion — the plan for the credential seam that makes the built backend reachable, then the four surfaces over it
status: designing
touches: docs/specs/, apps/api-worker/src/plugins/secret-store.ts, apps/api-worker/src/plugins/registry.ts, apps/api-worker/src/routes/shipping.ts, apps/web/src/routes/(app)/shipping/, apps/web/src/routes/(app)/settings/shipping/, apps/web/src/lib/settings/settings-sections.ts, apps/web/src/lib/tools/tool-presentation.ts, packages/access-control/src/registry.ts, roadmap.d/integrations.md, status.d/
---

Plans the remaining shipping and postage work: the per-firm credential read that currently answers 501 on every carrier operation, the permission collision behind it, and the four surfaces the June design predates (register, shipment window, buy wizard, a dedicated settings page). Planning only in this stream — nothing under `apps/web/src/routes/(app)/shipping/` or the shipping worker routes is built here yet. Anything touching `apps/api-worker/src/plugins/secret-store.ts` or the shipping routes collides with this stream.
