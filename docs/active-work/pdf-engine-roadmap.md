# pdf-engine-roadmap

**Scope:** Whole-engine roadmap (decomposition spec) for a pure-Rust, permissively-licensed PDF engine to succeed the forked-PDFium stack — compose `hayro`/`krilla`/`lopdf`/`pdf-rs`, build only the Acrobat-layer gaps (redaction, forms, sign). Design/docs only; no code.

**Files expected to touch:**

- `docs/specs/2026-06-21-rust-pdf-engine-roadmap-design.md` (the roadmap)
- `docs/active-work/pdf-engine-roadmap.md` (this note)
- Later, if the feasibility spike is greenlit: a spike note under `docs/specs/`, then a slice-1 spec + two ADR fragments under `docs/decisions/pending/`.

**Status:** roadmap drafted + committed; next action is a pre-slice-1 feasibility spike (hayro vs PDFium fidelity/speed/WASM-size). Not started.

**Overlap note:** revisits ADR-0088 (EmbedPDF/PDFium fork) and relates to the in-flight EmbedPDF sanitize/OCG/signing work and slice 2·3 preview — but retires nothing; the PDFium fork stays the transitional incumbent. No source files touched, so no code overlap with other streams.
