---
branch: tools-metadata-tool
worktree: C:/dev/magna-carta-worktrees/tools-metadata-tool
area: Tools — Metadata Inspector & Scrubber (all-TypeScript)
status: building
touches: docs/specs/2026-06-22-metadata-tool-design.md, docs/specs/2026-06-22-metadata-tool-implementation-plan.md, packages/metadata/** (new), packages/tools/src/catalog.ts (one row), packages/access-control/src/registry.ts (one permission), apps/worker/src/routes/metadata.ts (new) + app.ts registration, apps/worker conformance test, packages/database per-firm migration (role seed), apps/worker seed test, STATUS.md, ROADMAP.md, changelog.d/, docs/decisions/pending/, docs/user/tools/
---

A new ethereal Tools-area tool in the `documents` subject group: inspect a file's metadata + content-bearing
artifacts (author, tracked changes, comments, hidden text, EXIF/GPS, …) and download a cleaned copy. Built
core-first so a matter-action ("scrub in place", "auto-scrub before producing") can consume the same core later.

Scope of THIS stream: the scrubber, **all-TypeScript**. OOXML engine (fflate + XML surgery) and image engine
(JPEG/PNG segment/chunk surgery) behind small swappable engine interfaces. Approach C: a `MetadataPort` seam +
size cap; a Container engine deferred until measured. v1 formats: .docx/.jpg/.png (xlsx/pptx/TIFF/HEIC staged).

Rust → WASM was considered for the image engine and **rejected for v1** (measured-trigger swap only). HEIC,
PDF, legacy .doc/.xls, and the forensics tool are out of scope.

NOTE — branch split (2026-06-22): originally on `tools-metadata-scrubber` in the shared `C:/dev/magna-carta`
checkout; a parallel `apps/scan-worker` (container-service extraction) stream began committing to that same
branch/worktree concurrently. To keep the streams separate (owner's call), the metadata work moved to this
isolated worktree+branch (`tools-metadata-tool`) at the last clean metadata commit. `tools-metadata-scrubber`
is left to the scan-worker stream; the metadata scaffold commit it briefly carried is preserved at branch
`wip/scan-worker-scaffold`.

Design: `docs/specs/2026-06-22-metadata-tool-design.md`.
Plan: `docs/specs/2026-06-22-metadata-tool-implementation-plan.md`.
Principle: memory `tools-area-ethereal-principle.md` (Tools = matter-grade work without committing to a matter).
