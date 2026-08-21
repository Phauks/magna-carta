---
worktree: C:/dev/magna-carta-worktrees/claude/web-worker-split
area: Split the SvelteKit SPA onto its own deployable Worker (apps/web-worker)
status: building
touches: apps/web-worker, docs/conventions/operations.md, changelog.d
---

Adds `apps/web-worker` — an assets-only Cloudflare Worker serving the `apps/web` build output, so a
UI change no longer rebuilds and redeploys the API Worker. This stage is additive: `apps/worker`
keeps its own `assets` block and production serves exactly as it does today. The cutover (route
patterns on one hostname, and removing the API Worker's `assets` block) is gated on a zone hostname
existing and is not in this stream.

Not touched here: `apps/worker/wrangler.jsonc` — `claude/worker-first-routing` owns that file while
it fixes `run_worker_first` coverage for the non-`/api` surfaces.
