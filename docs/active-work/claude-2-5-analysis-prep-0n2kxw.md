---
branch: claude/2-5-analysis-prep-0n2kxw
worktree: (web session)
area: Slice 2·5 (PDF services + e-signature core) — pre-design analysis only
status: designing
touches: docs/specs/2026-07-17-slice-2-5-pdf-services-esignature-analysis.md
---

Analysis / development-prep for slice 2·5's open half — the **e-signature core** (PAdES seal +
ESIGN/UETA workflow + audit trail + Certificate of Completion + verification). The PDF-services
half is already built as the cross-cutting `pdf-core` engine; the e-sign layer is unstarted.

This stream **only adds an analysis doc** under `docs/specs/` and this note — no code, no shared-file
edits (STATUS/ROADMAP/white paper untouched here; their corrections are called out in the analysis
for the design cycle to make). Nothing to collide on. Seeds the sub-slice-1 (seal primitive) design
cycle; does not itself change any slice stage.
