---
worktree: /home/user/magna-carta (remote session)
area: matter file manager screen in apps/web-worker
status: designing
touches: apps/web-worker/src/lib/documents, apps/web-worker/src/routes/(app)/matters/[id]/files, packages/design-system, roadmap.d/documents.md, docs/user
---

Building out the matter Files section into the full file manager: folder navigation, scan-verdict
states, version history, bulk download (including the async bundle build), rename/move/soft-delete.
Currently in the design phase: interaction inventory + owner mockup selection, no screen code yet.
Stays out of apps/api-worker/src (two concurrent streams own parts of it); an API gap found here is
reported, not filled.
