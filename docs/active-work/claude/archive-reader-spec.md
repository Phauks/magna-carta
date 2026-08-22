---
worktree: C:/dev/magna-carta-worktrees/claude/archive-reader-spec
area: File Manager — design only for entering a zip from the file manager and extracting entries into a matter
status: designing
touches: docs/specs/2026-08-22-archive-reader-design.md, changelog.d, docs/active-work
---

Design only, no implementation. Writes one spec covering both halves — browsing a container's entries from a ranged central-directory read, and extracting selected entries into a matter through the existing ingest chokepoint — plus the attack table, the extraction-rubric placement, and nine numbered `AR` owner flags that gate the build.

Nothing under `packages/`, `apps/`, `crates/` or `containers/` is touched. The design names three things a future build stream would touch and this one does not: extracting `crates/archive-core` out of `crates/discovery-core/src/archive.rs`, a fourth WASM bootstrap target, and the first reader of the `fileManager.archiveCaps` setting. It also records two pieces of drift for whoever next owns those files — the `documents.upload.archive-opacity` evidence line in `roadmap.d/documents.md` is stale, and `fileManager.archiveCaps` is declared but unread — and edits neither.
