# pdf-engine-forms

**Stream:** AcroForm support (slice 5, forms half) for the pure-Rust PDF engine — read, fill, and flatten interactive forms. Off merged main (the engine landed on local main `3ee88f5`/`bbee1f3`).

**Scope:** v1 = read fields; fill text/checkbox/radio/choice; flatten (bake appearances into page content, drop the AcroForm). Deferred: digital-signature fields, rich-text appearances, exotic `/MK` styling. The "secure" half (encryption/permissions, RustCrypto deps approved) is a separate later stream.

**Files expected to touch:** `crates/pdf-core/src/forms.rs` (new), `crates/pdf-core/src/lib.rs`, `crates/pdf-core/src/wasm.rs`, `packages/pdf/src/index.ts`, `packages/pdf/README.md`, `docs/decisions/pending/pdf-forms.md`, `changelog.d/pdf-forms.md`, `ROADMAP.md`/`STATUS.md` (own rows). Reuses `surgery.rs` resolve helpers + `standard_fonts` metrics + the `scrub.rs` AcroForm field walk.

**Spike:** GO (`fee83a5`) — fill+flatten proven on the W-9 (`spikes/forms-feasibility/`).
