---
branch: tools-metadata-scrubber
worktree: C:/dev/magna-carta
area: Tools — Metadata Inspector & Scrubber (all-TypeScript)
status: designing
touches: docs/specs/2026-06-22-metadata-tool-design.md, packages/metadata/** (new), packages/tools/src/catalog.ts (one row), packages/access-control/src/registry.ts (one permission), apps/worker/src/routes/metadata.ts (new) + app.ts registration, apps/worker migrations (role seed), STATUS.md, ROADMAP.md
---

A new ethereal Tools-area tool in the `documents` subject group: inspect a file's metadata + content-bearing
artifacts (author, tracked changes, comments, hidden text, EXIF/GPS, …) and download a cleaned copy. Built
core-first so a matter-action ("scrub in place", "auto-scrub before producing") can consume the same core later.

Scope of THIS stream: the scrubber, **all-TypeScript**. OOXML engine (fflate + XML surgery) and image engine
(JPEG/PNG/TIFF segment/chunk surgery) behind small swappable engine interfaces (`DocumentMetadataEngine`,
`ImageMetadataEngine`). Approach C: a `MetadataPort` seam + size cap; a Container engine deferred until measured.

Rust → WASM was considered for the image engine and **rejected for v1** (did not pay for itself; see the spec's
language-decision note) — it is a measured-trigger swap behind `ImageMetadataEngine` only if forensics is
greenlit or JS HEIC proves too fragile. HEIC, PDF, legacy .doc/.xls, and the forensics tool are out of scope.

Design: `docs/specs/2026-06-22-metadata-tool-design.md`.
Principle: memory `tools-area-ethereal-principle.md` (Tools = matter-grade work without committing to a matter).
