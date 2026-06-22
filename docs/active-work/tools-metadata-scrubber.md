---
branch: tools-metadata-scrubber
worktree: C:/dev/magna-carta
area: Tools — Metadata Inspector & Scrubber (+ first Rust→WASM image core)
status: designing
touches: docs/specs/2026-06-22-metadata-tool-design.md, packages/metadata/** (new), crates/image-metadata/** (new, Rust→WASM), packages/tools/src/catalog.ts (one row), packages/access-control/src/registry.ts (one permission), apps/worker/src/routes/metadata.ts (new) + app.ts registration, apps/worker migrations (role seed), STATUS.md, ROADMAP.md
---

A new ethereal Tools-area tool in the `documents` subject group: inspect a file's metadata + content-bearing
artifacts (author, tracked changes, comments, hidden text, EXIF/GPS, …) and download a cleaned copy. Built
core-first so a matter-action ("scrub in place", "auto-scrub before producing") can consume the same core later.

Scope of THIS stream: the scrubber + a shared **Rust→WASM image-metadata core** (first WASM module in the repo,
reused later by a separate `forensics` tool — NOT built here). OOXML engine in TypeScript; image engine in
Rust→WASM. Approach C (port seam + size cap; container engine deferred until measured).

Forensics (image tamper-localization + AI-image detection) is a SEPARATE future tool (group `forensics`,
probabilistic) that will reuse the shared image core. Out of scope here.

Design: `docs/specs/2026-06-22-metadata-tool-design.md`.
Principle: memory `tools-area-ethereal-principle.md` (Tools = matter-grade work without committing to a matter).
