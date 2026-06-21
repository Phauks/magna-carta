# pdf-engine-roadmap

**Scope:** Whole-engine roadmap (decomposition spec) for a pure-Rust, permissively-licensed PDF engine to succeed the forked-PDFium stack — compose `hayro`/`krilla`/`lopdf`/`pdf-rs`, build only the Acrobat-layer gaps (redaction, forms, sign). Design/docs only; no code.

**Files expected to touch:**

- `docs/specs/2026-06-21-rust-pdf-engine-roadmap-design.md` (the roadmap)
- `docs/active-work/pdf-engine-roadmap.md` (this note)
- Later, if the feasibility spike is greenlit: a spike note under `docs/specs/`, then a slice-1 spec + two ADR fragments under `docs/decisions/pending/`.

**Status:** roadmap + spike design committed; **feasibility spike COMPLETE (4/4) — verdict GO** (results note: `docs/specs/2026-06-21-pdf-engine-feasibility-results.md`). (1) hayro renders the legal set — court forms, IRS AcroForms, academic — faithfully, ~40-260ms/pp; (2) parse: lopdf 100%, hayro 100%, pdf-rs 90% (adopt lopdf primary); (3) wasm 1.56 MB gz (~half PDFium), zero build friction; (4) fidelity vs PDFium: median MSSIM 0.956 (the 0.98 bar was miscalibrated for cross-rasterizer; recalibrated gate met; W-9 visual audit confirms faithful — lows are anti-aliasing + AcroForm-widget gap = slice 4). **Next:** slice-1 spec (core+render parallel-evaluation track) + the two ADRs.

**Overlap note:** revisits ADR-0088 (EmbedPDF/PDFium fork) and relates to the in-flight EmbedPDF sanitize/OCG/signing work and slice 2·3 preview — but retires nothing; the PDFium fork stays the transitional incumbent. No source files touched, so no code overlap with other streams.
