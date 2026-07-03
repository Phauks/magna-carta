---
number: 161
slug: engine-host-harness
status: Accepted
date: 2026-06-28
area: Architecture / Rust document engines
summary: Extract the shared runtime seam (wasm32 JS edge, axum container skeleton, magic-byte Format detection, pure-Rust feature discipline) from the pure-Rust document engines into a magna-carta-engine-host crate; the hosting pattern is shared, the deep format logic stays per-engine; detection/ML containers may adopt the container half but are not dual-target; engines are retrofitted incrementally behind green tests after the harness is proven on the File Repair & Salvage tool.
---

**Engine-host harness — a shared runtime seam for the pure-Rust document engines.**

**Context:** the PDF engine (`crates/pdf-core`), the decryption core (`crates/decryption-core`), and the bundling/conversion cores each re-implement the same hosting seam — a wasm32 JS-marshalling edge (`wasm.rs`), an axum container skeleton (`main.rs` + `router`/`AppState`), a magic-byte format check, and pure-Rust crate-feature discipline. A read of the code confirms the duplication is in the seam, not the format logic (the two files literally named `detect.rs` are even different concerns). A new engine — File Repair & Salvage — is about to repeat the seam again.

**Decision:** extract the hosting seam (only) into `magna-carta-engine-host` (`crates/engine-host`), with `cfg`-gated modules `format` (magic-byte `Format` + `detect`), `wasm_edge` (the JS-marshalling toolkit + stable-error-code rule), and `host` (the axum `/ready`+`serve` skeleton, body cap, panic-net, R2 client helper). The hosting pattern is shared; the deep format logic stays per-engine. Detection/ML containers (scan, the Magika type-verifier) may adopt the container half but are not dual-target and are not forced into the wasm half. Engines are retrofitted onto the harness incrementally, behind green tests, after it is proven on the new File Repair & Salvage consumer.

**Considered and rejected:** a large shared "format core" library that absorbs the parsers (rejected — the deep parsing does not repeat and merging it would couple unrelated engines); a big-bang migration of the merged PDF engine before the harness is proven (rejected — retrofit is sequenced last, after validation on new code).

**Consequences:** a new engine writes its format logic and inherits its hosting. A fitness test keeps `engine-host` from importing any engine-logic crate (it sits beside the engines, never below). Concretizes the white paper's _Delivery model_ shared-core line and the "Container subsystems extract to dedicated workers" rule (ADR-0138); builds on ADR-0024/ADR-0039 and ADR-0088.
