---
branch: slice-2-2-editing
worktree: C:/dev/magna-carta-worktrees/slice-2-2-editing
area: Slice 2·2 — in-app .docx editing (Collabora on Containers), versioning, Standard→IA tiering, optimistic concurrency + reconciliation
status: building
touches: apps/worker/src/editing, apps/worker/wrangler.jsonc, packages/database, packages/access-control, packages/file-manager, packages/fixtures, containers/collabora, STATUS.md, ROADMAP.md, docs/specs/2026-06-18-slice-2-2-*, docs/decisions/pending/collabora-editing-host-topology.md, docs/decisions/pending/document-editing-concurrency-reconciliation.md
---

Design + 25-task plan landed for slice 2·2; beginning the Phase 0 measurement spike (coolwsd RSS / cold-start / keep-alive on a real Cloudflare container). The main build is gated on slice 2·1 (`slice-2-1-design-and-plans`) landing first — it supplies the shared Container + Durable Object substrate this slice extends; 2·2 rebases onto `main`+2·1 before the build proper. New worker code lands under `apps/worker/src/editing/` and new bindings (the `DocumentSession` DO + the Collabora Container) in `wrangler.jsonc` — concurrent streams touching those bindings or `packages/file-manager` version code should coordinate here.
