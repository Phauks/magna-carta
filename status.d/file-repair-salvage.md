---
slice: File Repair & Salvage
group: cross-cutting
order: 21
research: done by="Opus 4.8"
spec: done by="Opus 4.8"
plan: done by="Opus 4.8"
built: done by="Opus 4.8"
ui: todo
load-profile: n/a
tested: done by="Opus 4.8" awaiting
branch: main
active-work:
next: attach-to-matter UI (post-0·7a); connect the magna-carta-file-repair Worker to Workers Builds + run the deploy smoke test
link-spec: docs/specs/2026-06-28-file-repair-salvage-design.md
link-plan: docs/specs/2026-07-03-file-repair-salvage-plan-6b-attach-to-matter.md
adrs: file-repair-single-container-lane, engine-host-r2-optional
blocked-by:
---

SP2 of the engine-host program. `crates/recovery-core` (pure Rust, native-only) — ZIP/OOXML + CFB/OLE2 + PDF xref-rebuild + carving pillars, each returning an honest loss manifest — hosted in `containers/file-repair` on the engine-host harness (the first container-on-harness engine), reached via `apps/file-repair-worker` + `FILE_REPAIR_SERVICE`. Stateless `/api/v1/file-repair/{diagnose,repair,carve}` re-scan reconstructed output and withhold anything flagged; attach-to-matter `/{repair,carve}/attach` save output as a server-side upload riding the existing ingest gate (repair→new version or new file, carve→N files; flagged→quarantine; the honest loss manifest is persisted per version in `file_repair_provenance` for chain of custody). `documents`→`files` tool group; `tools:fileRepair`. UI + deploy smoke test deferred.
