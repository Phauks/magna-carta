# File Repair & Salvage — Plan 1: recovery-core foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the foundation of the `crates/recovery-core` engine — the crate on the engine-host harness, the diagnose/repair data model, the `RepairError` edge contract, the diagnose dispatch framework, and the compression-stream salvage primitive — so the format pillars (Plans 2–5) plug in.

**Architecture:** A new pure-Rust crate on the `magna-carta-engine-host` harness. I/O-free (bytes in, result out), pure-Rust features only, compiles to WASM (Worker) + native (Container). This plan delivers the engine's shared base and one real primitive (DEFLATE partial-decode salvage); the per-format diagnosers and repairers register on top in later plans.

**Tech Stack:** Rust (edition 2021), `magna-carta-engine-host` (the harness — `format::detect`, `wasm_edge::EdgeError`), `zune-inflate` (partial DEFLATE decode), `flate2` (test fixtures only).

## Global Constraints

- **Crate:** `recovery-core` at `crates/recovery-core`; `edition.workspace = true`, `version = "0.0.0"`, `publish = false`; workspace member.
- **Depends on the harness:** `magna-carta-engine-host` (path `../engine-host`). Use `engine_host::format::detect` for format identification and `engine_host::wasm_edge::EdgeError` for the error contract. Do NOT re-implement magic-byte detection.
- **I/O-free:** no D1, no R2, no network, no `std::fs`, no threads, no `mmap`. Bytes in, result out (the harness convention `docs/conventions/engine-host-seam.md`).
- **Pure-Rust features only:** `zune-inflate` is pure Rust; never pull a C-backed codec. (Verify crate pins against docs.rs before use — golden rule 11.)
- **No file content in errors:** `RepairError` codes are fixed `&'static str` via `EdgeError` (golden rule 4). Never overclaim — repair results carry an explicit loss manifest.
- **Full names, no shorthand.**
- This plan builds NO worker route, NO container, NO UI, NO wasm bindings — only the pure engine foundation (those land in Plan 6).

---

### Task 1: Crate scaffold + workspace wiring

**Files:**
- Create: `crates/recovery-core/Cargo.toml`
- Create: `crates/recovery-core/src/lib.rs`
- Modify: `crates/Cargo.toml` (add `"recovery-core"` to `members`)

**Interfaces:**
- Produces: the `recovery-core` crate exposing modules `model`, `error`, `salvage`, `diagnose` (filled by later tasks).

- [ ] **Step 1: Add to the workspace** — in `crates/Cargo.toml` change `members = ["engine-host", "pdf-core", "pdf-eval"]` to `members = ["engine-host", "pdf-core", "pdf-eval", "recovery-core"]`.

- [ ] **Step 2: Write `crates/recovery-core/Cargo.toml`**

```toml
[package]
name = "recovery-core"
version = "0.0.0"
edition.workspace = true
publish = false

[lib]
name = "recovery_core"

[dependencies]
# The engine-host harness, RENAMED to `engine_host` so source reads `engine_host::format::detect` etc.
# (the package's lib name is `magna_carta_engine_host`; the rename keeps call sites short and consistent).
engine_host = { path = "../engine-host", package = "magna-carta-engine-host" }
# Pure-Rust DEFLATE/zlib/gzip decoder that returns the decoded prefix together with the error on a
# truncated/corrupt stream — the compression-stream salvage primitive.
zune-inflate = "0.2"

[dev-dependencies]
# Build deterministic DEFLATE/zlib fixtures (compress, then truncate) for the salvage tests. Pure-Rust
# miniz_oxide backend (no C dep) — matches the engine-host feature discipline.
flate2 = "1"
```

- [ ] **Step 3: Write `crates/recovery-core/src/lib.rs`**

```rust
//! recovery-core: the file-corruption recovery engine. Pure compute on the
//! magna-carta-engine-host harness — bytes in, a diagnosis or a salvaged result
//! out. NO I/O lives here; the worker/container host it. Diagnose broadly,
//! repair narrowly: per-format diagnosers and repairers register in later plans.

pub mod model;
pub mod error;
pub mod salvage;
pub mod diagnose;
```

- [ ] **Step 4: Create empty module files so it compiles**

Create `crates/recovery-core/src/model.rs`, `crates/recovery-core/src/error.rs`, `crates/recovery-core/src/salvage.rs`, `crates/recovery-core/src/diagnose.rs`, each with a one-line doc comment:

`model.rs`: `//! The diagnose/repair data model shared across the format pillars.`
`error.rs`: `//! The recovery error type and its stable edge error codes.`
`salvage.rs`: `//! Format-agnostic salvage primitives (compression-stream partial decode).`
`diagnose.rs`: `//! The diagnose dispatch framework (format -> diagnosis).`

- [ ] **Step 5: Verify it builds** — Run: `cargo build -p recovery-core` (use the manifest path if your CWD is not the workspace: `cargo build --manifest-path crates/Cargo.toml -p recovery-core`). Expected: compiles (unused-module warnings OK).

- [ ] **Step 6: Commit**

```bash
git add crates/Cargo.toml crates/recovery-core/Cargo.toml crates/recovery-core/src/
git commit -m "feat(recovery-core): crate scaffold on the engine-host harness"
```

---

### Task 2: The diagnose data model

**Files:**
- Modify: `crates/recovery-core/src/model.rs`

**Interfaces:**
- Produces:
  - `pub enum Recoverability { Intact, Repairable, Partial, Unrecoverable, Unknown }`
  - `pub enum CorruptionKind { Truncated, BrokenCentralDirectory, MissingEndOfCentralDirectory, BadLocalHeaders, MissingRequiredParts, BrokenCrossReference, Other }`
  - `pub struct DiagnosisReport { pub detected_format: Option<engine_host::format::Format>, pub corruption: Vec<CorruptionKind>, pub recoverability: Recoverability, pub repair_supported: bool, pub detail: String }`

- [ ] **Step 1: Write the failing test** — append to `crates/recovery-core/src/model.rs`:

```rust
use engine_host::format::Format;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Recoverability {
    Intact,
    Repairable,
    Partial,
    Unrecoverable,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CorruptionKind {
    Truncated,
    BrokenCentralDirectory,
    MissingEndOfCentralDirectory,
    BadLocalHeaders,
    MissingRequiredParts,
    BrokenCrossReference,
    Other,
}

#[derive(Debug, Clone)]
pub struct DiagnosisReport {
    pub detected_format: Option<Format>,
    pub corruption: Vec<CorruptionKind>,
    pub recoverability: Recoverability,
    pub repair_supported: bool,
    pub detail: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_report_carries_format_and_recoverability() {
        let report = DiagnosisReport {
            detected_format: Some(Format::Zip),
            corruption: vec![CorruptionKind::MissingEndOfCentralDirectory],
            recoverability: Recoverability::Repairable,
            repair_supported: true,
            detail: "central directory missing".into(),
        };
        assert_eq!(report.detected_format, Some(Format::Zip));
        assert_eq!(report.recoverability, Recoverability::Repairable);
        assert!(report.corruption.contains(&CorruptionKind::MissingEndOfCentralDirectory));
    }
}
```

- [ ] **Step 2: Run to verify it fails** — Run: `cargo test -p recovery-core model::`. Expected: FAIL — until the types compile (this task introduces them, so the first compile IS the red→green; if it compiles and passes, proceed).

- [ ] **Step 3: (Types are written in Step 1.)** Confirm there is no separate implementation needed.

- [ ] **Step 4: Run to verify it passes** — Run: `cargo test -p recovery-core model::`. Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add crates/recovery-core/src/model.rs
git commit -m "feat(recovery-core): the diagnose data model"
```

---

### Task 3: The repair result model + `RepairError` edge contract

**Files:**
- Modify: `crates/recovery-core/src/model.rs` (add the repair-result types)
- Modify: `crates/recovery-core/src/error.rs`

**Interfaces:**
- Produces (in `model`):
  - `pub struct RecoveredItem { pub name: String, pub recovered: bool, pub detail: String }`
  - `pub struct LossManifest { pub items: Vec<RecoveredItem>, pub fully_recovered: bool }`
  - `pub struct RepairResult { pub salvaged: Vec<u8>, pub loss: LossManifest }`
- Produces (in `error`):
  - `pub enum RepairError { NotRecognized, Unsupported, Unrepairable, Malformed }` implementing `engine_host::wasm_edge::EdgeError` with codes `"notRecognized"|"unsupported"|"unrepairable"|"malformed"`.
  - `pub const REPAIR_ERROR_CODES: &[&str]`.

- [ ] **Step 1: Write the failing tests**

Append to `crates/recovery-core/src/model.rs`:

```rust
#[derive(Debug, Clone)]
pub struct RecoveredItem {
    pub name: String,
    pub recovered: bool,
    pub detail: String,
}

#[derive(Debug, Clone)]
pub struct LossManifest {
    pub items: Vec<RecoveredItem>,
    pub fully_recovered: bool,
}

#[derive(Debug, Clone)]
pub struct RepairResult {
    pub salvaged: Vec<u8>,
    pub loss: LossManifest,
}

#[cfg(test)]
mod repair_model_tests {
    use super::*;

    #[test]
    fn a_partial_recovery_is_not_marked_fully_recovered() {
        let loss = LossManifest {
            items: vec![
                RecoveredItem { name: "word/document.xml".into(), recovered: true, detail: String::new() },
                RecoveredItem { name: "word/media/image1.png".into(), recovered: false, detail: "stream truncated".into() },
            ],
            fully_recovered: false,
        };
        let result = RepairResult { salvaged: vec![1, 2, 3], loss };
        assert!(!result.loss.fully_recovered);
        assert_eq!(result.loss.items.iter().filter(|i| !i.recovered).count(), 1);
    }
}
```

Write `crates/recovery-core/src/error.rs`:

```rust
use engine_host::wasm_edge::EdgeError;

/// Recovery failures, mapped to fixed edge codes. A `&'static str` code cannot
/// carry file content (golden rule 4).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RepairError {
    /// No known format magic — nothing to attempt.
    NotRecognized,
    /// Format recognized but no repair pillar supports it yet.
    Unsupported,
    /// Recognized and supported, but the damage is unrecoverable.
    Unrepairable,
    /// The input is malformed beyond the point a diagnoser can read it.
    Malformed,
}

pub const REPAIR_ERROR_CODES: &[&str] =
    &["notRecognized", "unsupported", "unrepairable", "malformed"];

impl EdgeError for RepairError {
    fn code(&self) -> &'static str {
        match self {
            RepairError::NotRecognized => "notRecognized",
            RepairError::Unsupported => "unsupported",
            RepairError::Unrepairable => "unrepairable",
            RepairError::Malformed => "malformed",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use engine_host::wasm_edge::allowed_code;

    #[test]
    fn every_error_code_is_in_the_declared_set() {
        for error in [
            RepairError::NotRecognized,
            RepairError::Unsupported,
            RepairError::Unrepairable,
            RepairError::Malformed,
        ] {
            assert!(allowed_code(error.code(), REPAIR_ERROR_CODES));
        }
    }

    #[test]
    fn a_content_like_string_is_not_a_valid_code() {
        assert!(!allowed_code("client-secret.docx", REPAIR_ERROR_CODES));
    }
}
```

- [ ] **Step 2: Run to verify they fail/compile** — Run: `cargo test -p recovery-core`. Expected: the new `error::` and `repair_model_tests` compile and PASS (types + impl are written above). If a compile error appears (e.g. an `EdgeError`/`allowed_code` path mismatch), fix the `use` path against the engine-host crate and re-run.

- [ ] **Step 3: Run to verify they pass** — Run: `cargo test -p recovery-core`. Expected: PASS (model + error tests).

- [ ] **Step 4: Commit**

```bash
git add crates/recovery-core/src/model.rs crates/recovery-core/src/error.rs
git commit -m "feat(recovery-core): repair-result model + RepairError edge codes"
```

---

### Task 4: Compression-stream salvage primitive

**Files:**
- Modify: `crates/recovery-core/src/salvage.rs`

**Interfaces:**
- Produces:
  - `pub enum DeflateWrapper { Raw, Zlib, Gzip }`
  - `pub struct SalvageOutput { pub bytes: Vec<u8>, pub complete: bool }`
  - `pub fn inflate_salvage(data: &[u8], wrapper: DeflateWrapper) -> SalvageOutput` — decode as far as possible; on a truncated/corrupt stream, return the decoded prefix with `complete = false`; on a clean stream, the full bytes with `complete = true`.

- [ ] **Step 1: Write the failing tests** — write `crates/recovery-core/src/salvage.rs`:

```rust
//! Format-agnostic salvage primitives (compression-stream partial decode).

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeflateWrapper {
    Raw,
    Zlib,
    Gzip,
}

#[derive(Debug, Clone)]
pub struct SalvageOutput {
    pub bytes: Vec<u8>,
    pub complete: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::write::ZlibEncoder;
    use flate2::Compression;
    use std::io::Write;

    fn zlib_compress(input: &[u8]) -> Vec<u8> {
        let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(input).unwrap();
        encoder.finish().unwrap()
    }

    fn long_input() -> Vec<u8> {
        // Compressible, multi-block input so truncation loses only the tail.
        "The quick brown fox jumps over the lazy dog. ".repeat(500).into_bytes()
    }

    #[test]
    fn a_clean_zlib_stream_decodes_complete() {
        let input = long_input();
        let compressed = zlib_compress(&input);
        let out = inflate_salvage(&compressed, DeflateWrapper::Zlib);
        assert!(out.complete);
        assert_eq!(out.bytes, input);
    }

    #[test]
    fn a_truncated_zlib_stream_yields_a_partial_prefix() {
        let input = long_input();
        let mut compressed = zlib_compress(&input);
        // Drop the tail to corrupt the stream.
        compressed.truncate(compressed.len() - 20);
        let out = inflate_salvage(&compressed, DeflateWrapper::Zlib);
        assert!(!out.complete, "a truncated stream must not report complete");
        assert!(!out.bytes.is_empty(), "expected a recovered prefix");
        assert!(
            input.starts_with(&out.bytes),
            "the salvaged bytes must be a genuine prefix of the original"
        );
        assert!(out.bytes.len() < input.len());
    }
}
```

- [ ] **Step 2: Run to verify they fail** — Run: `cargo test -p recovery-core salvage::`. Expected: FAIL — `inflate_salvage` not defined.

- [ ] **Step 3: Implement `inflate_salvage`** — add above the `#[cfg(test)]` block in `salvage.rs`. NOTE: verify the `zune-inflate` 0.2 API against docs.rs first — the decoder is `zune_inflate::DeflateDecoder`, its `decode_zlib()`/`decode_deflate()`/`decode_gzip()` return `Result<Vec<u8>, zune_inflate::errors::InflateDecodeErrors>`, and the error value carries the partially-decoded bytes (field/accessor named `data` in current versions). Adapt the field/accessor name to the verified API if it differs:

```rust
use zune_inflate::DeflateDecoder;

pub fn inflate_salvage(data: &[u8], wrapper: DeflateWrapper) -> SalvageOutput {
    let mut decoder = DeflateDecoder::new(data);
    let result = match wrapper {
        DeflateWrapper::Raw => decoder.decode_deflate(),
        DeflateWrapper::Zlib => decoder.decode_zlib(),
        DeflateWrapper::Gzip => decoder.decode_gzip(),
    };
    match result {
        Ok(bytes) => SalvageOutput { bytes, complete: true },
        // On a truncated/corrupt stream zune-inflate returns the prefix it managed
        // to decode alongside the error — keep it, flag incomplete.
        Err(errors) => SalvageOutput { bytes: errors.data, complete: false },
    }
}
```

- [ ] **Step 4: Run to verify they pass** — Run: `cargo test -p recovery-core salvage::`. Expected: PASS (2 tests). If the `errors.data` accessor name differs in the pinned version, correct it per docs.rs and re-run.

- [ ] **Step 5: Commit**

```bash
git add crates/recovery-core/src/salvage.rs
git commit -m "feat(recovery-core): DEFLATE partial-decode salvage primitive"
```

---

### Task 5: The diagnose dispatch framework

**Files:**
- Modify: `crates/recovery-core/src/diagnose.rs`
- Modify: `crates/recovery-core/src/lib.rs` (re-export `diagnose`)

**Interfaces:**
- Consumes: `engine_host::format::detect`, `model::{DiagnosisReport, Recoverability}`.
- Produces: `pub fn diagnose(bytes: &[u8]) -> DiagnosisReport` — identifies the format and returns a report. With no per-format diagnoser registered yet (Plans 2–5 add them), a recognized format reports `recoverability: Unknown, repair_supported: false`; unrecognized bytes report `detected_format: None, recoverability: Unrecoverable`; empty/too-short input reports `Unrecoverable` with `CorruptionKind::Truncated`.

- [ ] **Step 1: Write the failing tests** — write `crates/recovery-core/src/diagnose.rs`:

```rust
//! The diagnose dispatch framework (format -> diagnosis).

use crate::model::{CorruptionKind, DiagnosisReport, Recoverability};
use engine_host::format::detect;

pub fn diagnose(bytes: &[u8]) -> DiagnosisReport {
    if bytes.len() < 8 {
        return DiagnosisReport {
            detected_format: None,
            corruption: vec![CorruptionKind::Truncated],
            recoverability: Recoverability::Unrecoverable,
            repair_supported: false,
            detail: "input too short to identify".into(),
        };
    }
    match detect(bytes) {
        Some(format) => DiagnosisReport {
            detected_format: Some(format),
            corruption: Vec::new(),
            recoverability: Recoverability::Unknown,
            repair_supported: false,
            detail: "format identified; no repair pillar registered yet".into(),
        },
        None => DiagnosisReport {
            detected_format: None,
            corruption: vec![CorruptionKind::Other],
            recoverability: Recoverability::Unrecoverable,
            repair_supported: false,
            detail: "no known format magic".into(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use engine_host::format::Format;

    #[test]
    fn identifies_a_known_format_but_reports_no_pillar_yet() {
        let report = diagnose(b"%PDF-1.7\nmore bytes here");
        assert_eq!(report.detected_format, Some(Format::Pdf));
        assert!(!report.repair_supported);
        assert_eq!(report.recoverability, Recoverability::Unknown);
    }

    #[test]
    fn unknown_bytes_are_unrecoverable() {
        let report = diagnose(b"not a known file at all");
        assert_eq!(report.detected_format, None);
        assert_eq!(report.recoverability, Recoverability::Unrecoverable);
    }

    #[test]
    fn too_short_input_is_truncated_and_unrecoverable() {
        let report = diagnose(b"PK");
        assert_eq!(report.recoverability, Recoverability::Unrecoverable);
        assert!(report.corruption.contains(&CorruptionKind::Truncated));
    }
}
```

Add to `crates/recovery-core/src/lib.rs` after the module declarations:

```rust
pub use diagnose::diagnose;
```

- [ ] **Step 2: Run to verify they fail/compile** — Run: `cargo test -p recovery-core diagnose::`. Expected: the tests compile and PASS (the implementation is written above). If they pass on first compile, that satisfies green for this scaffolding task.

- [ ] **Step 3: Run the whole crate gate** — Run:
  - `cargo test -p recovery-core`
  - `cargo fmt --manifest-path crates/Cargo.toml -p recovery-core -- --check`
  - `cargo clippy --manifest-path crates/Cargo.toml -p recovery-core --all-targets -- -D warnings`
  Expected: all tests pass; fmt clean; no clippy warnings.

- [ ] **Step 4: Commit**

```bash
git add crates/recovery-core/src/diagnose.rs crates/recovery-core/src/lib.rs
git commit -m "feat(recovery-core): diagnose dispatch framework"
```

---

## Notes for the implementer

- **Verify crate pins against docs.rs before use** (golden rule 11): `zune-inflate` 0.2 (confirm `DeflateDecoder` and that the error type exposes the partially-decoded bytes — adapt the `errors.data` accessor if the pinned version names it differently), `flate2` 1 (dev-only, pure-Rust `miniz_oxide` backend — do not enable a `zlib`/`zlib-ng` C feature).
- **The harness is the dependency floor.** `engine_host::format::{detect, Format}` and `engine_host::wasm_edge::{EdgeError, allowed_code}` already exist and are tested — consume them, don't reimplement. The Cargo.toml dependency is renamed (`engine_host = { path = "../engine-host", package = "magna-carta-engine-host" }`), so source uses `engine_host::` directly — no `use ... as` needed.
- **No wasm bindings, no routes, no container in this plan** — those are Plan 6. Keep `recovery-core` a pure engine.
- The per-format pillars (ZIP/OOXML, CFB, PDF, carving) register their diagnosers/repairers in Plans 2–5; this plan only lays the framework and the one shared primitive.
```
