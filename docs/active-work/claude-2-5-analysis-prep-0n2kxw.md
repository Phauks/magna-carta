---
branch: claude/2-5-analysis-prep-0n2kxw
worktree: (web session)
area: Slice 2·5 (PDF services + e-signature core) — analysis + seal-primitive spike
status: building
touches: docs/specs/2026-07-17-slice-2-5-pdf-services-esignature-analysis.md, crates/pdf-core/src/sign.rs, crates/pdf-core/src/lib.rs
---

Slice 2·5's open half — the **e-signature core** (PAdES seal + ESIGN/UETA workflow + audit
trail + Certificate of Completion + verification). The PDF-services half is already built as the
cross-cutting `pdf-core` engine; the e-sign layer was unstarted.

Two things landed here:

1. `docs/specs/2026-07-17-slice-2-5-...-analysis.md` — the pre-design analysis (state, the
   EmbedPDF→pure-Rust supersession, the code-grounded gaps, sub-slice decomposition).
2. `crates/pdf-core/src/sign.rs` — **sub-slice 1, the seal primitive** (feasibility spike): a
   prefix-preserving PDF incremental-update writer that appends the PAdES signature dict +
   AcroForm + invisible widget, writes an exact `/ByteRange`, reserves a zero-filled
   `/Contents`, and splices a caller-supplied CMS in without disturbing a signed byte. Pure
   structure — **no crypto** (host-side, sub-slice 2). Classic xref only; xref-stream originals
   are refused (`SignError::XrefStream`), a documented follow-up.

Touches only `crates/pdf-core/src/{sign.rs,lib.rs}` (new module + one export) — no shared-file
edits (STATUS/ROADMAP/white paper untouched; their corrections are called out in the analysis for
the design cycle). Nothing else is in this area right now.
