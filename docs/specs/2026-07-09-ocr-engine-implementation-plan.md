# OCR Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an OCR engine that turns an image or a PDF into per-page raw facts — recognized text, word boxes in PDF user space, confidence, orientation, and provenance — reachable through one route on the main worker.

**Architecture:** Three units following the `containers/file-repair` reference shape. `crates/ocr-core` is the pure engine (pixels in, facts out, no I/O). `containers/ocr` is an axum service on `engine_host::host` that links `ocr-core` and `pdf-core`, walks PDF pages, skips pages that already have a text layer, and rasterizes the rest. `apps/ocr-worker` is the container Durable Object wrapper, reached from the main worker over a service binding.

**Tech Stack:** Rust (`oar-ocr` 0.8 over `ort` / ONNX Runtime 1.24), axum 0.8, hayro via `pdf-core`, the `image` crate 0.25, TypeScript Workers (Hono, zod, `@cloudflare/containers`), Drizzle per-firm migrations.

**Design:** [`docs/specs/2026-07-09-ocr-engine-design.md`](2026-07-09-ocr-engine-design.md). **Decision:** [`do../decisions/0179-ocr-engine-model-and-determinism.md`](../decisions/0179-ocr-engine-model-and-determinism.md).

**Execute tasks in numeric order.** Task 9 (the Dockerfile) appears in this file before Tasks 5 through 8, because it was written before the tier benchmark was moved ahead of it. It runs last, so the image bakes the tier the benchmark chose.

**Amendment, after Tasks 1 and 2 shipped.** Review found that `recognize` silently discarded detected regions whose text failed to decode, which would make a page of unreadable text indistinguishable from a blank page. `Recognizer::recognize` therefore returns `Result<RecognizedPage, OcrError>`, not `Result<Vec<TextLine>, OcrError>`, where `RecognizedPage { lines: Vec<TextLine>, undecoded_regions: usize }`. `PageFacts` carries `undecoded_regions` through to the wire. The trait signatures shown inside Tasks 1 and 2 below are the originals as written; the shipped code has the amended signature. Tasks 4, 6, and 7 are written against the amended one.

## Global Constraints

These bind every task. Do not restate them; do not violate them.

- **Work in the worktree `C:/dev/magna-carta-worktrees/ocr-engine` on branch `ocr-engine`.** The main worktree is checked out to another stream's branch and has foreign uncommitted files. Never `git switch` there.
- **Cargo builds on this machine OOM under parallelism.** Always build in the **foreground**, one cargo at a time, with `CARGO_BUILD_JOBS=1 RUSTFLAGS="-C debuginfo=0"`. Never background a cargo command.
- **No emojis** anywhere — code, docs, commits, strings.
- **No process references in source, tests, config, or consumer-facing strings.** No `ADR-NNNN`, no "spec", no "slice N", no "Task N", no "Phase N". State reasoning inline, or cite a concrete file path. Enforced by `pnpm run lint:process-refs`. The one exception is a forward-looking schedule ("the searchable-PDF writer lands in a later slice").
- **Spell names out in full.** `identifiers` not `ids`; `newIdentifier()` not `newId()`; "the data-access layer", never "the DAL".
- **Verify every library API against its current docs before using it** (golden rule 11). Versions named here were checked on 2026-07-09; re-check on docs.rs / npm if a build fails.
- **The container never learns which firm it serves.** It receives bytes and returns facts. The worker owns firm scoping.
- **A fault is a retryable 503, never a fabricated empty result.** An empty text layer and a failed inference must never be indistinguishable.
- **No privileged content in any log, error label, `Problem` response, or panic message.** Error codes are stable `&'static str`.
- **Determinism:** every ONNX session is built with `intra_threads = 1`, `inter_threads = 1`, `parallel_execution = false`, and a fixed optimization level.
- **The container base image is trixie.** `rust:1-trixie` build, `debian:trixie-slim` runtime. ONNX Runtime's prebuilt binaries need glibc 2.38; bookworm's 2.36 fails to link and only the cloud build catches it.
- **Pinned model artifacts** (revision + SHA-256 of `inference.onnx`):
  - `PaddlePaddle/PP-OCRv6_medium_det_onnx` rev `61323801669c338b7891481ec7bac61ce31b576a`, sha256 `eb13b44b25bb36f89528b68720af8a61d9cf381176107f465db1757b65d086e1`
  - `PaddlePaddle/PP-OCRv6_medium_rec_onnx` rev `50c7eacafc52fa7bcf4194e8cd08e46f8558504b`, sha256 `9c09abf0957f7968c7586464b7397b84ad2387a0497a351af40e9acc71b673ba`
  - Each repo also ships `inference.yml`, which carries the pre/post-processing config and, for recognition, the character dictionary. Both files are baked in.
- **Docs are part of done** (golden rule 5): the changelog fragment and status fragment ship in the same commit as the code they describe. Never hand-edit `CHANGELOG.md`, `STATUS.md`, or the Decision-Log register on a branch.

---

## File Structure

**New Rust engine — `crates/ocr-core/`**

| File                | Responsibility                                                                    |
| ------------------- | --------------------------------------------------------------------------------- |
| `Cargo.toml`        | Crate manifest; `oar-ocr` with default features off.                              |
| `src/lib.rs`        | Public surface: `Recognizer` trait, `OcrError`, re-exports.                       |
| `src/facts.rs`      | The fact types: `TextLine`, `Quad`, `PageFacts`, `Provenance`. No engine, no I/O. |
| `src/dictionary.rs` | Parse `PostProcess.character_dict` out of a PaddleOCR `inference.yml`. Pure.      |
| `src/engine.rs`     | `PaddleRecognizer` — the `oar-ocr` pipeline, deterministic session config.        |

**New container — `containers/ocr/`**

| File                       | Responsibility                                                                 |
| -------------------------- | ------------------------------------------------------------------------------ |
| `Cargo.toml`, `Cargo.lock` | Binary crate; links `ocr-core`, `pdf-core`, `engine_host`.                     |
| `src/main.rs`              | Thin entrypoint: `serve(with_panic_net(ready_app(router(state))))`.            |
| `src/lib.rs`               | `router()`, the `POST /ocr` handler, image-vs-PDF dispatch.                    |
| `src/dto.rs`               | Wire types. Serde only. Byte-matches the TypeScript type.                      |
| `src/pages.rs`             | PDF page walk: skip-if-text-layer, rasterize, pixel-to-user-space transform.   |
| `Dockerfile`               | trixie build + runtime; fetches and SHA-256-verifies the models.               |
| `CLAUDE.md`                | Local rules: the C++ consent, the trixie constraint, the never-fabricate rule. |

**New worker — `apps/ocr-worker/`** — `wrangler.jsonc`, `src/index.ts`, `src/forward.ts`, `src/ocr-engine-container.ts`, `package.json`, `tsconfig.json`, `vitest.config.ts`, `worker-env.d.ts`, `test/forward.test.ts`.

**Modified**

| File                                             | Change                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------- |
| `crates/Cargo.toml`                              | Add `ocr-core` to `members`.                                        |
| `crates/pdf-core/src/lib.rs`                     | `RenderedPage::to_rgb_image` — composite straight alpha over white. |
| `crates/pdf-core/src/redact.rs`                  | Call it instead of keeping an inline copy of the same rule.         |
| `apps/worker/wrangler.jsonc`                     | Add `OCR_SERVICE` to the single `services` array.                   |
| `apps/worker/src/app.ts`                         | `OCR_SERVICE?` binding; call `registerOcrRoutes`.                   |
| `apps/worker/src/routes/files/ocr.ts`            | New route `POST /api/v1/ocr`.                                       |
| `apps/worker/src/per-firm-migrations.ts`         | Register the seed migration.                                        |
| `packages/access-control/src/registry.ts`        | Add `tools:ocr`.                                                    |
| `packages/tools/src/catalog.ts`                  | Add the catalog entry.                                              |
| `packages/database/drizzle/per-firm/`            | Seed migration + journal entry.                                     |
| `crates/pdf-eval/src/validate/operations/ocr.rs` | New validation operation.                                           |
| `crates/pdf-eval/src/bench/`                     | Model-tier benchmark.                                               |

---

### Task 1: Fact types and the character-dictionary parser

The pure, dependency-light core. No models, no ONNX, so it compiles and tests in seconds — everything later builds on these types.

**Files:**

- Create: `crates/ocr-core/Cargo.toml`
- Create: `crates/ocr-core/src/lib.rs`
- Create: `crates/ocr-core/src/facts.rs`
- Create: `crates/ocr-core/src/dictionary.rs`
- Modify: `crates/Cargo.toml`

**Interfaces:**

- Consumes: nothing.
- Produces: `ocr_core::facts::{Quad, TextLine, PageFacts, Provenance, SkipReason}`; `ocr_core::dictionary::character_dictionary_from_inference_yaml(&str) -> Result<String, OcrError>`; `ocr_core::OcrError` with `fn code(&self) -> &'static str`.

- [ ] **Step 1: Add the crate to the workspace**

In `crates/Cargo.toml`, change the `members` line to:

```toml
members = ["engine-host", "ocr-core", "pdf-core", "pdf-eval", "recovery-core", "decryption-core"]
```

- [ ] **Step 2: Write `crates/ocr-core/Cargo.toml`**

`oar-ocr` is not added yet — this task must compile without ONNX Runtime. `serde_yaml_ng` is the maintained fork of the deprecated `serde_yaml`; confirm its current version on docs.rs before pinning.

```toml
[package]
name = "ocr-core"
version = "0.1.0"
edition.workspace = true
publish.workspace = true

[dependencies]
# Pure-Rust YAML. The recognition model's character dictionary ships inside PaddleOCR's
# inference.yml, so the engine parses that file rather than carrying a second copy of the
# dictionary that could drift from the model it belongs to.
serde_yaml_ng = "0.10"
serde = { version = "1", features = ["derive"] }
```

- [ ] **Step 3: Write the failing tests for the dictionary parser**

Create `crates/ocr-core/src/dictionary.rs`:

```rust
//! The recognition model's character dictionary lives inside PaddleOCR's
//! `inference.yml`, under `PostProcess.character_dict`. The engine reads it from
//! there rather than from a separate dictionary file: a dictionary that can drift
//! from the model it decodes produces silent, plausible mis-recognition rather
//! than a loud failure.

use crate::OcrError;

/// Extract `PostProcess.character_dict` as newline-delimited text, in file order.
/// Order is load-bearing: the model emits class indices into this list.
pub fn character_dictionary_from_inference_yaml(yaml: &str) -> Result<String, OcrError> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_entries_in_file_order() {
        let yaml = "PostProcess:\n  name: CTCLabelDecode\n  character_dict:\n  - a\n  - b\n  - c\n";
        assert_eq!(character_dictionary_from_inference_yaml(yaml).unwrap(), "a\nb\nc");
    }

    #[test]
    fn preserves_quoted_entries_including_a_bare_space() {
        // PaddleOCR quotes entries that YAML would otherwise mangle. A space is a real
        // dictionary entry; dropping it shifts every subsequent class index by one.
        let yaml = "PostProcess:\n  character_dict:\n  - 'a'\n  - ' '\n  - '#'\n";
        assert_eq!(character_dictionary_from_inference_yaml(yaml).unwrap(), "a\n \n#");
    }

    #[test]
    fn preserves_non_latin_entries() {
        let yaml = "PostProcess:\n  character_dict:\n  - 中\n  - あ\n  - Ω\n";
        assert_eq!(character_dictionary_from_inference_yaml(yaml).unwrap(), "中\nあ\nΩ");
    }

    #[test]
    fn a_missing_dictionary_is_an_error_not_an_empty_string() {
        let yaml = "PostProcess:\n  name: CTCLabelDecode\n";
        let error = character_dictionary_from_inference_yaml(yaml).unwrap_err();
        assert_eq!(error.code(), "model-dictionary-missing");
    }

    #[test]
    fn malformed_yaml_is_an_error() {
        let error = character_dictionary_from_inference_yaml("\t: : :").unwrap_err();
        assert_eq!(error.code(), "model-dictionary-unreadable");
    }
}
```

- [ ] **Step 4: Write the fact types**

Create `crates/ocr-core/src/facts.rs`:

```rust
//! What the engine reports. Raw facts only: no judgment about whether a page is
//! "good", no derived text layer, no document-level conclusion.

use serde::Serialize;

/// A detected quadrilateral. Detection returns a four-point polygon, not an
/// axis-aligned box: text on a page fed crooked through a scanner is a rotated
/// quad, and squaring it off before the caller sees it loses the skew.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Quad {
    pub points: [(f32, f32); 4],
}

impl Quad {
    /// The axis-aligned bounds, as `(x_min, y_min, x_max, y_max)`.
    pub fn bounds(&self) -> (f32, f32, f32, f32) {
        let xs = self.points.map(|p| p.0);
        let ys = self.points.map(|p| p.1);
        (
            xs.iter().copied().fold(f32::INFINITY, f32::min),
            ys.iter().copied().fold(f32::INFINITY, f32::min),
            xs.iter().copied().fold(f32::NEG_INFINITY, f32::max),
            ys.iter().copied().fold(f32::NEG_INFINITY, f32::max),
        )
    }
}

/// One recognized line of text.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TextLine {
    pub text: String,
    pub confidence: f32,
    pub quad: Quad,
    /// Per-line orientation in degrees, when the text-line orientation classifier ran.
    pub orientation_degrees: Option<f32>,
    /// Per-word quads, when word-box reporting is enabled.
    pub word_quads: Vec<Quad>,
}

/// Why a page was not recognized. A skipped page is never reported as an empty
/// page: the caller cannot otherwise tell "no words here" from "we gave up".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SkipReason {
    /// The page already carries a real, visible text layer.
    AlreadyHasTextLayer,
}

/// Which code, which model, and which machine produced a result. Three separable
/// fields: an engine change, a model change, and an architecture change each mean
/// something different, and collapsing them makes a stale result indistinguishable
/// from a fresh one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Provenance {
    pub engine_version: String,
    pub model_version: String,
    pub platform: String,
}

impl Provenance {
    pub fn new(model_version: impl Into<String>) -> Self {
        Self {
            engine_version: env!("CARGO_PKG_VERSION").to_string(),
            model_version: model_version.into(),
            platform: format!("{}-{}", std::env::consts::ARCH, std::env::consts::OS),
        }
    }
}

/// One page's worth of facts: either recognized lines, or a reason it was skipped.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PageFacts {
    pub page_index: usize,
    pub lines: Vec<TextLine>,
    pub skipped: Option<SkipReason>,
    /// Whole-page orientation in degrees, when the document orientation classifier ran.
    pub orientation_degrees: Option<f32>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quad_bounds_cover_a_rotated_quad() {
        let quad = Quad { points: [(10.0, 0.0), (20.0, 10.0), (10.0, 20.0), (0.0, 10.0)] };
        assert_eq!(quad.bounds(), (0.0, 0.0, 20.0, 20.0));
    }

    #[test]
    fn provenance_carries_three_independent_fields() {
        let provenance = Provenance::new("PP-OCRv6_medium@abc123");
        assert_eq!(provenance.engine_version, env!("CARGO_PKG_VERSION"));
        assert_eq!(provenance.model_version, "PP-OCRv6_medium@abc123");
        assert!(provenance.platform.contains(std::env::consts::ARCH));
        // No field may be derived from another.
        assert_ne!(provenance.engine_version, provenance.model_version);
    }
}
```

- [ ] **Step 5: Write `crates/ocr-core/src/lib.rs` with the error type**

```rust
//! The OCR engine: pixels in, facts out. No HTTP, no filesystem beyond loading its
//! own pinned models, no knowledge of PDFs or firms. The container that hosts this
//! owns every wire concern.

pub mod dictionary;
pub mod facts;

use image::RgbImage;

pub use facts::{PageFacts, Provenance, Quad, SkipReason, TextLine};

/// Engine failures. `code` is a stable, content-free label safe to log and to put
/// on the wire — it never carries a fragment of the document.
#[derive(Debug)]
pub enum OcrError {
    ModelDictionaryMissing,
    ModelDictionaryUnreadable,
    ModelLoadFailed,
    InferenceFailed,
}

impl OcrError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::ModelDictionaryMissing => "model-dictionary-missing",
            Self::ModelDictionaryUnreadable => "model-dictionary-unreadable",
            Self::ModelLoadFailed => "model-load-failed",
            Self::InferenceFailed => "inference-failed",
        }
    }
}

impl std::fmt::Display for OcrError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.code())
    }
}

impl std::error::Error for OcrError {}

/// Recognize text in one rasterized page. The container depends on this trait, not
/// on the concrete engine, so its page-walking and wire logic are testable without
/// loading a 139 MB model.
pub trait Recognizer: Send + Sync {
    fn recognize(&self, image: &RgbImage) -> Result<Vec<TextLine>, OcrError>;
    /// Whole-page orientation, when a classifier is configured.
    fn page_orientation(&self, image: &RgbImage) -> Option<f32>;
    fn provenance(&self) -> Provenance;
}
```

Add `image` to `crates/ocr-core/Cargo.toml` dependencies: `image = { workspace = true }`.

- [ ] **Step 6: Run the tests to verify they fail**

```bash
cd C:/dev/magna-carta-worktrees/ocr-engine/crates
CARGO_BUILD_JOBS=1 RUSTFLAGS="-C debuginfo=0" cargo test -p ocr-core
```

Expected: FAIL — `todo!()` panics in the five `dictionary` tests; `facts` tests pass.

- [ ] **Step 7: Implement the dictionary parser**

Replace the `todo!()` body in `crates/ocr-core/src/dictionary.rs`:

```rust
pub fn character_dictionary_from_inference_yaml(yaml: &str) -> Result<String, OcrError> {
    let document: serde_yaml_ng::Value =
        serde_yaml_ng::from_str(yaml).map_err(|_| OcrError::ModelDictionaryUnreadable)?;
    let entries = document
        .get("PostProcess")
        .and_then(|post| post.get("character_dict"))
        .and_then(|dict| dict.as_sequence())
        .ok_or(OcrError::ModelDictionaryMissing)?;

    let mut lines = Vec::with_capacity(entries.len());
    for entry in entries {
        // Every entry must be a scalar string. A non-scalar means the file is not the
        // dictionary we think it is, and guessing would shift every class index.
        let glyph = entry.as_str().ok_or(OcrError::ModelDictionaryMissing)?;
        lines.push(glyph);
    }
    if lines.is_empty() {
        return Err(OcrError::ModelDictionaryMissing);
    }
    Ok(lines.join("\n"))
}
```

- [ ] **Step 8: Run the tests to verify they pass**

```bash
cd C:/dev/magna-carta-worktrees/ocr-engine/crates
CARGO_BUILD_JOBS=1 RUSTFLAGS="-C debuginfo=0" cargo test -p ocr-core
```

Expected: PASS, 7 tests.

- [ ] **Step 9: Lint and format**

```bash
cd C:/dev/magna-carta-worktrees/ocr-engine/crates
cargo fmt -p ocr-core && CARGO_BUILD_JOBS=1 cargo clippy -p ocr-core -- -D warnings
```

Expected: no output. Note: do **not** run bare `cargo fmt` — the local rustfmt is newer than whatever formatted the committed code and will churn unrelated files.

- [ ] **Step 10: Commit**

```bash
git add crates/Cargo.toml crates/ocr-core
git commit -m "feat(ocr-core): fact types, provenance, and the character-dictionary parser"
```

---

### Task 2: The recognition engine over `oar-ocr`

Wires the real models. This is the first task that pulls in ONNX Runtime, so it is also the first that will be slow to build.

**Files:**

- Create: `crates/ocr-core/src/engine.rs`
- Modify: `crates/ocr-core/Cargo.toml`
- Modify: `crates/ocr-core/src/lib.rs`

**Interfaces:**

- Consumes: `Recognizer`, `OcrError`, `TextLine`, `Quad`, `Provenance`, `character_dictionary_from_inference_yaml` (Task 1).
- Produces: `ocr_core::engine::{PaddleRecognizer, ModelPaths}`; `PaddleRecognizer::load(ModelPaths) -> Result<Self, OcrError>`, implementing `Recognizer`.

- [ ] **Step 1: Add `oar-ocr` to `crates/ocr-core/Cargo.toml`**

Default features pull `ort/tls-native`, which links native TLS (a C dependency) purely to download runtime binaries we do not want fetched at runtime. Turn defaults off and re-enable only what is needed.

```toml
# The OCR pipeline: PaddleOCR PP-OCR models over ONNX Runtime via `ort`. Default features are
# off because they enable `ort/tls-native` (a native-TLS C dependency) for a runtime model
# download this engine never performs -- its models are baked into the image. `download-binaries`
# is still required: it statically links the ONNX Runtime the crate needs at build time.
oar-ocr = { version = "0.8", default-features = false, features = ["download-binaries"] }
```

Verify against docs.rs that `download-binaries` can be enabled without `tls-native`. If it cannot, enable defaults and record the native-TLS dependency in `containers/ocr/CLAUDE.md` as a disclosed C dependency.

- [ ] **Step 2: Write the failing tests**

Create `crates/ocr-core/src/engine.rs`:

```rust
//! The concrete engine: PaddleOCR PP-OCR detection and recognition models, run as
//! ONNX through `oar-ocr`. Sessions are pinned single-threaded and sequential so a
//! given container reproduces its own output exactly -- which is the property that
//! matters when a production has to be re-run and must come out the same.

use std::path::PathBuf;
use std::sync::Arc;

use image::RgbImage;
use oar_ocr::core::config::{OrtGraphOptimizationLevel, OrtSessionConfig};
use oar_ocr::oarocr::{OAROCRBuilder, OAROCR};

use crate::dictionary::character_dictionary_from_inference_yaml;
use crate::facts::{Provenance, Quad, TextLine};
use crate::{OcrError, Recognizer};

/// The pinned, baked-in model artifacts. Each model is an `inference.onnx` beside the
/// `inference.yml` it was published with.
#[derive(Debug, Clone)]
pub struct ModelPaths {
    pub detection_onnx: PathBuf,
    pub recognition_onnx: PathBuf,
    pub recognition_yaml: PathBuf,
    /// Identifies the exact artifact set, e.g. `PP-OCRv6_medium@6132380`.
    pub model_version: String,
}

pub struct PaddleRecognizer {
    pipeline: Arc<OAROCR>,
    model_version: String,
}

impl PaddleRecognizer {
    pub fn load(models: ModelPaths) -> Result<Self, OcrError> {
        todo!()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The models are large and are baked into the container image, not committed. The
    /// tests that need them are `#[ignore]`d: `cargo test` reports them as ignored rather
    /// than as passed, so a green suite can never mean "the models were never present".
    /// The container CI job runs them with `--ignored` and `MAGNA_CARTA_OCR_MODELS` set.
    fn models() -> ModelPaths {
        let root = PathBuf::from(
            std::env::var("MAGNA_CARTA_OCR_MODELS")
                .expect("MAGNA_CARTA_OCR_MODELS must point at the model directory"),
        );
        ModelPaths {
            detection_onnx: root.join("detection/inference.onnx"),
            recognition_onnx: root.join("recognition/inference.onnx"),
            recognition_yaml: root.join("recognition/inference.yml"),
            model_version: "test".to_string(),
        }
    }

    #[test]
    fn a_missing_model_file_fails_loudly() {
        let models = ModelPaths {
            detection_onnx: PathBuf::from("/nonexistent/detection.onnx"),
            recognition_onnx: PathBuf::from("/nonexistent/recognition.onnx"),
            recognition_yaml: PathBuf::from("/nonexistent/inference.yml"),
            model_version: "absent".to_string(),
        };
        let error = PaddleRecognizer::load(models).unwrap_err();
        // The dictionary is read first, so an entirely absent model set reports that.
        assert_eq!(error.code(), "model-dictionary-unreadable");
    }

    #[test]
    #[ignore = "needs the baked-in models; run with --ignored and MAGNA_CARTA_OCR_MODELS set"]
    fn provenance_reports_the_configured_model_version() {
        let engine = PaddleRecognizer::load(models()).unwrap();
        assert_eq!(engine.provenance().model_version, "test");
    }

    #[test]
    #[ignore = "needs the baked-in models; run with --ignored and MAGNA_CARTA_OCR_MODELS set"]
    fn recognizes_rendered_text() {
        let engine = PaddleRecognizer::load(models()).unwrap();
        // A white page with the word INVOICE drawn in black, 300 DPI-ish scale.
        let image = crate::engine::tests::render_word("INVOICE");
        let lines = engine.recognize(&image).unwrap();
        let joined: String = lines.iter().map(|line| line.text.as_str()).collect();
        assert!(joined.to_uppercase().contains("INVOICE"), "got {joined:?}");
        assert!(lines[0].confidence > 0.5);
    }

    #[test]
    #[ignore = "needs the baked-in models; run with --ignored and MAGNA_CARTA_OCR_MODELS set"]
    fn the_same_image_recognizes_identically_twice() {
        let engine = PaddleRecognizer::load(models()).unwrap();
        let image = crate::engine::tests::render_word("INVOICE");
        assert_eq!(engine.recognize(&image).unwrap(), engine.recognize(&image).unwrap());
    }

    /// Draw `word` in black on white using a blocky 5x7 bitmap font scaled up. Keeps the
    /// test self-contained: no font file, no fixture image, no network.
    pub(super) fn render_word(word: &str) -> RgbImage {
        use image::Rgb;
        // 5x7 glyphs for the letters used by the tests, row-major, 1 = ink. Every glyph must
        // occupy the full five columns: a narrower one leaves blank columns inside its cell,
        // and the recognizer reads that gap as a word break.
        const GLYPHS: &[(char, [u8; 7])] = &[
            ('I', [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b11111]),
            ('N', [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001]),
            ('V', [0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b01010, 0b00100]),
            ('O', [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110]),
            ('C', [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110]),
            ('E', [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111]),
        ];
        let scale = 12u32;
        let advance = 6u32 * scale;
        let mut image = RgbImage::from_pixel(
            advance * word.len() as u32 + 2 * advance,
            7 * scale + 2 * advance,
            Rgb([255, 255, 255]),
        );
        for (index, character) in word.chars().enumerate() {
            let Some((_, rows)) = GLYPHS.iter().find(|(glyph, _)| *glyph == character) else {
                continue;
            };
            for (row_index, row) in rows.iter().enumerate() {
                for column in 0..5u32 {
                    if row & (1 << (4 - column)) != 0 {
                        let x0 = advance + index as u32 * advance + column * scale;
                        let y0 = advance + row_index as u32 * scale;
                        for x in x0..x0 + scale {
                            for y in y0..y0 + scale {
                                image.put_pixel(x, y, Rgb([0, 0, 0]));
                            }
                        }
                    }
                }
            }
        }
        image
    }
}
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd C:/dev/magna-carta-worktrees/ocr-engine/crates
CARGO_BUILD_JOBS=1 RUSTFLAGS="-C debuginfo=0" cargo test -p ocr-core
```

Expected: FAIL — `todo!()` panics in `a_missing_model_file_fails_loudly`. The three model-backed tests report as **ignored**, not passed. This build downloads ONNX Runtime and takes several minutes; run it in the foreground.

- [ ] **Step 4: Implement `load` and the `Recognizer` impl**

Replace the `todo!()` and append the trait implementation:

```rust
impl PaddleRecognizer {
    pub fn load(models: ModelPaths) -> Result<Self, OcrError> {
        let yaml = std::fs::read_to_string(&models.recognition_yaml)
            .map_err(|_| OcrError::ModelDictionaryUnreadable)?;
        let dictionary = character_dictionary_from_inference_yaml(&yaml)?;

        // Single-threaded and sequential: ONNX Runtime's thread count and execution mode
        // are the run-to-run sources of divergence on one machine, and a re-run of a
        // production must reproduce its own earlier output exactly.
        let session = OrtSessionConfig::default()
            .with_intra_threads(1)
            .with_inter_threads(1)
            .with_parallel_execution(false)
            .with_optimization_level(OrtGraphOptimizationLevel::Level3);

        let pipeline = OAROCRBuilder::new(
            models.detection_onnx.clone(),
            models.recognition_onnx.clone(),
            // Ignored: character_dict_content takes precedence, and the dictionary
            // travels with the model rather than as a separate file.
            models.recognition_yaml.clone(),
        )
        .character_dict_content(dictionary)
        .ort_session(session)
        .return_word_box(true)
        .build()
        .map_err(|_| OcrError::ModelLoadFailed)?;

        Ok(Self { pipeline: Arc::new(pipeline), model_version: models.model_version })
    }
}

fn to_quad(bounding_box: &oar_ocr::processors::BoundingBox) -> Quad {
    // Detection returns a four-point polygon. If a future model returns more points,
    // fall back to the axis-aligned bounds rather than silently dropping vertices.
    let points = &bounding_box.points;
    if points.len() == 4 {
        let corner = |index: usize| (points[index].x, points[index].y);
        Quad { points: [corner(0), corner(1), corner(2), corner(3)] }
    } else {
        let (x0, y0, x1, y1) = bounding_box.aabb();
        Quad { points: [(x0, y0), (x1, y0), (x1, y1), (x0, y1)] }
    }
}

impl Recognizer for PaddleRecognizer {
    fn recognize(&self, image: &RgbImage) -> Result<Vec<TextLine>, OcrError> {
        let results = self
            .pipeline
            .predict(vec![image.clone()])
            .map_err(|_| OcrError::InferenceFailed)?;
        let Some(page) = results.into_iter().next() else { return Ok(Vec::new()) };

        Ok(page
            .text_regions
            .iter()
            .filter_map(|region| {
                let (text, confidence) = region.text_with_confidence()?;
                Some(TextLine {
                    text: text.to_string(),
                    confidence,
                    quad: to_quad(&region.bounding_box),
                    orientation_degrees: region.orientation_angle,
                    word_quads: region
                        .word_boxes
                        .as_ref()
                        .map(|boxes| boxes.iter().map(to_quad).collect())
                        .unwrap_or_default(),
                })
            })
            .collect())
    }

    fn page_orientation(&self, _image: &RgbImage) -> Option<f32> {
        // The document-orientation classifier is a separate model, not yet baked in.
        // Reporting None is honest; reporting 0.0 would claim a measurement never made.
        None
    }

    fn provenance(&self) -> Provenance {
        Provenance::new(self.model_version.clone())
    }
}
```

Add `pub mod engine;` to `crates/ocr-core/src/lib.rs`.

Note: `oar_ocr::processors::BoundingBox::points` is a `Vec<Point>`; confirm on docs.rs whether `Point` exposes `.x`/`.y` fields or `.0`/`.1` tuple access, and adjust `corner` accordingly. This is the one API detail the research could not close.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd C:/dev/magna-carta-worktrees/ocr-engine/crates
CARGO_BUILD_JOBS=1 RUSTFLAGS="-C debuginfo=0" cargo test -p ocr-core
```

Expected: PASS. `a_missing_model_file_fails_loudly` runs; the three model-backed tests are reported as ignored.

- [ ] **Step 6: Run the model-backed tests for real, once**

Download the tiny tier (6 MB, fast) purely to prove the pipeline wires up. The winning tier gets baked into the image by the Dockerfile in the last task.

```bash
mkdir -p /tmp/ocr-models/detection /tmp/ocr-models/recognition
curl -sL -o /tmp/ocr-models/detection/inference.onnx "https://huggingface.co/PaddlePaddle/PP-OCRv6_tiny_det_onnx/resolve/main/inference.onnx"
curl -sL -o /tmp/ocr-models/recognition/inference.onnx "https://huggingface.co/PaddlePaddle/PP-OCRv6_tiny_rec_onnx/resolve/main/inference.onnx"
curl -sL -o /tmp/ocr-models/recognition/inference.yml "https://huggingface.co/PaddlePaddle/PP-OCRv6_tiny_rec_onnx/resolve/main/inference.yml"
cd C:/dev/magna-carta-worktrees/ocr-engine/crates
MAGNA_CARTA_OCR_MODELS=/tmp/ocr-models CARGO_BUILD_JOBS=1 cargo test -p ocr-core -- --ignored --nocapture
```

Expected: PASS, including `recognizes_rendered_text` and `the_same_image_recognizes_identically_twice`.

If `recognizes_rendered_text` fails, the likely cause is dictionary format rather than the pipeline: print the first ten dictionary entries and confirm they are single glyphs in model order. Do not "fix" it by relaxing the assertion.

- [ ] **Step 7: Lint, format, commit**

```bash
cd C:/dev/magna-carta-worktrees/ocr-engine/crates
cargo fmt -p ocr-core && CARGO_BUILD_JOBS=1 cargo clippy -p ocr-core -- -D warnings
cd .. && git add crates/ocr-core && git commit -m "feat(ocr-core): PaddleOCR recognition engine with deterministic ONNX sessions"
```

---

### Task 3: `pdf-core` — one correct composite-to-RGB

`render_page` returns **straight** RGBA8, and a page with no background content is fully transparent (alpha 0, RGB 0). Simply dropping the alpha channel therefore turns such a page **solid black** — which is what the OCR engine would then try to read. `redact.rs` already gets this right by compositing alpha over white, inline. Give that conversion one home, beside the function that produces the buffer, so the container and the harness cannot get it wrong differently.

**Files:**

- Modify: `crates/pdf-core/src/lib.rs`
- Modify: `crates/pdf-core/src/redact.rs:170-182`

**Interfaces:**

- Consumes: `pdf_core::RenderedPage` (existing, `lib.rs:116`).
- Produces: `pdf_core::RenderedPage::to_rgb_image(&self) -> Option<image::RgbImage>` — composites straight-alpha RGBA8 over white and returns RGB8. `None` when the buffer is PNG-encoded or truncated.

- [ ] **Step 1: Write the failing tests**

Add to `crates/pdf-core/src/lib.rs`'s test module:

```rust
    #[test]
    fn to_rgb_image_composites_transparent_pixels_over_white() {
        // Straight alpha: a fully transparent pixel carries RGB 0. Dropping alpha would
        // render it black; compositing over white renders it white, which is what a blank
        // region of a page actually looks like.
        let page = RenderedPage { data: vec![0, 0, 0, 0], width: 1, height: 1, png: false };
        let image = page.to_rgb_image().unwrap();
        assert_eq!(image.get_pixel(0, 0).0, [255, 255, 255]);
    }

    #[test]
    fn to_rgb_image_preserves_opaque_pixels() {
        let page = RenderedPage { data: vec![10, 20, 30, 255], width: 1, height: 1, png: false };
        assert_eq!(page.to_rgb_image().unwrap().get_pixel(0, 0).0, [10, 20, 30]);
    }

    #[test]
    fn to_rgb_image_composites_a_half_transparent_pixel() {
        // out = alpha * src + (1 - alpha) * 255, with alpha = 128/255.
        let page = RenderedPage { data: vec![0, 0, 0, 128], width: 1, height: 1, png: false };
        let value = page.to_rgb_image().unwrap().get_pixel(0, 0).0[0];
        assert!((126..=128).contains(&value), "expected mid-grey, got {value}");
    }

    #[test]
    fn to_rgb_image_rejects_a_png_buffer_rather_than_reinterpreting_it() {
        let page = RenderedPage { data: vec![0x89, b'P', b'N', b'G'], width: 1, height: 1, png: true };
        assert!(page.to_rgb_image().is_none());
    }

    #[test]
    fn to_rgb_image_rejects_a_truncated_buffer() {
        let page = RenderedPage { data: vec![10, 20, 30], width: 2, height: 1, png: false };
        assert!(page.to_rgb_image().is_none());
    }
```

- [ ] **Step 2: Run to verify failure**

```bash
cd C:/dev/magna-carta-worktrees/ocr-engine/crates
CARGO_BUILD_JOBS=1 RUSTFLAGS="-C debuginfo=0" cargo test -p pdf-core to_rgb_image
```

Expected: FAIL — no method `to_rgb_image`.

- [ ] **Step 3: Implement it**

In `crates/pdf-core/src/lib.rs`, beside `RenderedPage`:

```rust
impl RenderedPage {
    /// Composite this page's straight-alpha RGBA8 over a white background and return
    /// RGB8. The renderer leaves pages with no background content fully transparent, so
    /// discarding alpha instead of compositing would turn a blank page black. Returns
    /// `None` for a PNG-encoded buffer (which is not raw pixels) or a truncated one.
    pub fn to_rgb_image(&self) -> Option<image::RgbImage> {
        if self.png {
            return None;
        }
        let pixels = (self.width as usize).checked_mul(self.height as usize)?;
        if self.data.len() < pixels.checked_mul(4)? {
            return None;
        }
        let mut rgb = Vec::with_capacity(pixels * 3);
        for pixel in self.data.chunks_exact(4) {
            let alpha = pixel[3] as f32 / 255.0;
            // Porter-Duff over white: out = src_alpha * src + (1 - src_alpha) * 255
            let composite =
                |channel: u8| ((alpha * channel as f32) + ((1.0 - alpha) * 255.0)).round() as u8;
            rgb.push(composite(pixel[0]));
            rgb.push(composite(pixel[1]));
            rgb.push(composite(pixel[2]));
        }
        image::RgbImage::from_raw(self.width, self.height, rgb)
    }
}
```

- [ ] **Step 4: Replace the inline copy in `redact.rs`**

`redact.rs` currently builds the same RGB buffer by hand at lines 170-182. Rewrite that block to call `to_rgb_image()` on the rendered page and take `.into_raw()`, so there is exactly one implementation of the compositing rule. Keep the surrounding image-XObject construction unchanged.

Run the full `pdf-core` suite afterwards — redaction has the strictest safety tests in the repo, and they are the check that this refactor changed nothing:

```bash
cd C:/dev/magna-carta-worktrees/ocr-engine/crates
CARGO_BUILD_JOBS=1 RUSTFLAGS="-C debuginfo=0" cargo test -p pdf-core
```

Expected: PASS, all 207+ tests, including every redaction test. If any redaction test fails, the refactor is wrong — revert it and leave `redact.rs` alone rather than adjusting the test.

- [ ] **Step 5: Lint, format, commit**

```bash
cd C:/dev/magna-carta-worktrees/ocr-engine/crates
cargo fmt -p pdf-core && CARGO_BUILD_JOBS=1 cargo clippy -p pdf-core -- -D warnings
cd .. && git add crates/pdf-core
git commit -m "feat(pdf-core): RenderedPage::to_rgb_image composites straight alpha over white"
```

---

### Task 4: The container — page walk, wire types, routes

**Files:**

- Create: `containers/ocr/Cargo.toml`, `containers/ocr/src/main.rs`, `containers/ocr/src/lib.rs`, `containers/ocr/src/dto.rs`, `containers/ocr/src/pages.rs`, `containers/ocr/CLAUDE.md`, `containers/ocr/.dockerignore`

**Interfaces:**

- Consumes: `ocr_core::{Recognizer, RecognizedPage, PageFacts, TextLine, Quad, SkipReason, Provenance, OcrError}` (Tasks 1-2). Note `Recognizer::recognize` returns `Result<RecognizedPage, OcrError>`, where `RecognizedPage { lines: Vec<TextLine>, undecoded_regions: usize }` — the count of regions detection found but recognition could not read. Also `pdf_core::Document::{render_page, page_text_rects, page_size}` and `pdf_core::RenderedPage::to_rgb_image` (Task 3); `engine_host::host::{ready_app, with_panic_net, serve}`.
- Produces: `magna_carta_ocr::router(state: AppState) -> Router`; `magna_carta_ocr::pages::{to_user_space, RENDER_DPI}`.

- [ ] **Step 1: Write `containers/ocr/Cargo.toml`**

```toml
[package]
name = "magna-carta-ocr"
version = "0.0.0"
edition = "2021"
publish = false

[lib]
name = "magna_carta_ocr"
path = "src/lib.rs"

[[bin]]
name = "magna-carta-ocr"
path = "src/main.rs"

[dependencies]
# The shared container host skeleton (/ready, body cap, panic net, :8080 serve).
engine_host = { path = "../../crates/engine-host", package = "magna-carta-engine-host" }
# The OCR engine -- pure, I/O-free; this host owns all HTTP/JSON.
ocr-core = { path = "../../crates/ocr-core" }
# Page rasterization and the existing-text-layer check. Pure Rust parses the untrusted
# document; only decoded pixels reach the ONNX Runtime.
pdf-core = { path = "../../crates/pdf-core" }
image = "0.25"
tokio = { version = "1", features = ["full"] }
axum = "0.8"
serde = { version = "1", features = ["derive"] }
serde_json = "1"

[dev-dependencies]
reqwest = { version = "0.12", default-features = false, features = ["json", "rustls-tls"] }
```

- [ ] **Step 2: Write the failing tests for the coordinate transform**

Create `containers/ocr/src/pages.rs`:

```rust
//! Turning a PDF page into pixels and the engine's pixel coordinates back into PDF
//! user space. The two coordinate systems disagree about where the origin is and
//! which way y grows, and getting that wrong puts every word box on the wrong half
//! of the page.

use ocr_core::Quad;

/// Rasterization density. 300 DPI is the floor at which small print in a scanned
/// exhibit stays legible to the recognizer.
pub const RENDER_DPI: f32 = 300.0;

/// Convert a quad in render-pixel coordinates (origin top-left, y grows downward) to
/// PDF user space (origin bottom-left, y grows upward, 72 units per inch).
pub fn to_user_space(quad: Quad, page_height_points: f32) -> Quad {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_origin_flips_from_top_left_to_bottom_left() {
        // A 792-point-tall page rendered at 300 DPI is 3300 pixels tall. A quad hugging
        // the top of the raster must land at the top of user space, i.e. y near 792.
        let quad = Quad { points: [(0.0, 0.0), (100.0, 0.0), (100.0, 50.0), (0.0, 50.0)] };
        let converted = to_user_space(quad, 792.0);
        let (_, y_min, _, y_max) = converted.bounds();
        assert!((y_max - 792.0).abs() < 0.01, "top of raster must be top of page: {y_max}");
        assert!((y_min - 780.0).abs() < 0.01, "50px = 12pt below the top: {y_min}");
    }

    #[test]
    fn pixels_scale_down_by_seventy_two_over_the_render_dpi() {
        // 300 px at 300 DPI is one inch, which is 72 points.
        let quad = Quad { points: [(0.0, 0.0), (300.0, 0.0), (300.0, 0.0), (0.0, 0.0)] };
        let (x_min, _, x_max, _) = to_user_space(quad, 792.0).bounds();
        assert!((x_min - 0.0).abs() < 0.01);
        assert!((x_max - 72.0).abs() < 0.01, "300px at 300dpi is 72pt, got {x_max}");
    }
}
```

- [ ] **Step 3: Run to verify failure**

```bash
cd C:/dev/magna-carta-worktrees/ocr-engine/containers/ocr
CARGO_BUILD_JOBS=1 RUSTFLAGS="-C debuginfo=0" cargo test
```

Expected: FAIL, `todo!()` panics in two tests.

- [ ] **Step 4: Implement the transform**

```rust
pub fn to_user_space(quad: Quad, page_height_points: f32) -> Quad {
    let scale = 72.0 / RENDER_DPI;
    Quad {
        points: quad.points.map(|(x, y)| (x * scale, page_height_points - y * scale)),
    }
}
```

The RGBA-to-RGB conversion lives on `pdf_core::RenderedPage::to_rgb_image` (Task 3), which composites straight alpha over white. Do not reimplement it here: dropping the alpha channel instead of compositing turns a transparent (blank-background) page solid black.

- [ ] **Step 5: Run to verify pass**

```bash
cd C:/dev/magna-carta-worktrees/ocr-engine/containers/ocr
CARGO_BUILD_JOBS=1 RUSTFLAGS="-C debuginfo=0" cargo test
```

Expected: PASS, 2 tests.

- [ ] **Step 6: Write the wire types**

Create `containers/ocr/src/dto.rs`:

```rust
//! The container's wire shape. Serde only -- these types byte-match the TypeScript
//! type the worker validates. Every string label is a `&'static str` literal: no
//! document content ever reaches the wire except the recognized text itself.

use ocr_core::{PageFacts, Provenance, Quad, TextLine};
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuadDto {
    pub points: [[f32; 2]; 4],
}

impl From<Quad> for QuadDto {
    fn from(quad: Quad) -> Self {
        Self { points: quad.points.map(|(x, y)| [x, y]) }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextLineDto {
    pub text: String,
    pub confidence: f32,
    pub quad: QuadDto,
    pub orientation_degrees: Option<f32>,
    pub word_quads: Vec<QuadDto>,
}

impl From<TextLine> for TextLineDto {
    fn from(line: TextLine) -> Self {
        Self {
            text: line.text,
            confidence: line.confidence,
            quad: line.quad.into(),
            orientation_degrees: line.orientation_degrees,
            word_quads: line.word_quads.into_iter().map(QuadDto::from).collect(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageDto {
    pub page_index: usize,
    pub lines: Vec<TextLineDto>,
    /// Regions detection found but recognition could not read. A page of unreadable
    /// text must not reach a caller looking like a page that had no text on it.
    pub undecoded_regions: usize,
    /// Present only when the page was not recognized, naming why.
    pub skipped: Option<&'static str>,
    pub orientation_degrees: Option<f32>,
}

impl From<PageFacts> for PageDto {
    fn from(facts: PageFacts) -> Self {
        Self {
            page_index: facts.page_index,
            lines: facts.lines.into_iter().map(TextLineDto::from).collect(),
            undecoded_regions: facts.undecoded_regions,
            skipped: facts.skipped.map(|_| "already-has-text-layer"),
            orientation_degrees: facts.orientation_degrees,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvenanceDto {
    pub engine_version: String,
    pub model_version: String,
    pub platform: String,
}

impl From<Provenance> for ProvenanceDto {
    fn from(provenance: Provenance) -> Self {
        Self {
            engine_version: provenance.engine_version,
            model_version: provenance.model_version,
            platform: provenance.platform,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrResultDto {
    pub pages: Vec<PageDto>,
    pub provenance: ProvenanceDto,
}
```

- [ ] **Step 7: Write the failing route tests**

Create `containers/ocr/src/lib.rs`:

```rust
//! The OCR container's HTTP surface: one POST route that takes an image or a PDF and
//! returns per-page raw facts. The engine stays pure; every wire concern lives here.
//! The standard `/ready` probe and body cap come from `engine_host::host::ready_app`.

pub mod dto;
pub mod pages;

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};

use ocr_core::{OcrError, PageFacts, Recognizer, SkipReason};

use dto::{OcrResultDto, PageDto};

#[derive(Clone)]
pub struct AppState {
    pub recognizer: Arc<dyn Recognizer>,
}

/// Recognize an image or every scanned page of a PDF.
async fn ocr(State(state): State<AppState>, body: Bytes) -> Response {
    if body.is_empty() {
        return error(StatusCode::UNPROCESSABLE_ENTITY, "empty-body");
    }
    let result = if body.starts_with(b"%PDF") {
        recognize_pdf(&state, &body)
    } else {
        recognize_image(&state, &body)
    };
    match result {
        Ok(pages) => (
            StatusCode::OK,
            Json(OcrResultDto {
                pages: pages.into_iter().map(PageDto::from).collect(),
                provenance: state.recognizer.provenance().into(),
            }),
        )
            .into_response(),
        // An inference fault is retryable and must never look like a page with no words.
        Err(OcrError::InferenceFailed) => error(StatusCode::SERVICE_UNAVAILABLE, "inference-failed"),
        Err(other) => error(StatusCode::UNPROCESSABLE_ENTITY, other.code()),
    }
}

fn error(status: StatusCode, code: &'static str) -> Response {
    (status, Json(serde_json::json!({ "code": code }))).into_response()
}

fn recognize_image(state: &AppState, bytes: &[u8]) -> Result<Vec<PageFacts>, OcrError> {
    // Decode under explicit limits: an image is untrusted input, and a decompression
    // bomb must be refused rather than allocated.
    let mut reader = image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| OcrError::InferenceFailed)?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(20_000);
    limits.max_image_height = Some(20_000);
    limits.max_alloc = Some(512 * 1024 * 1024);
    reader.limits(limits);
    let image = reader.decode().map_err(|_| OcrError::InferenceFailed)?.to_rgb8();

    let page = state.recognizer.recognize(&image)?;
    Ok(vec![PageFacts {
        page_index: 0,
        lines: page.lines,
        undecoded_regions: page.undecoded_regions,
        skipped: None,
        orientation_degrees: state.recognizer.page_orientation(&image),
    }])
}

fn recognize_pdf(state: &AppState, bytes: &[u8]) -> Result<Vec<PageFacts>, OcrError> {
    let document = pdf_core::Document::load(bytes).map_err(|_| OcrError::InferenceFailed)?;
    let mut pages = Vec::new();
    for page_index in 0..document.page_count() {
        // A page that already carries visible glyphs already has a text layer. Skipping
        // it is the difference between recognizing a whole production and recognizing
        // the handful of scanned pages inside it.
        let existing = document.page_text_rects(page_index).unwrap_or_default();
        if !existing.is_empty() {
            pages.push(PageFacts {
                page_index,
                lines: Vec::new(),
                undecoded_regions: 0,
                skipped: Some(SkipReason::AlreadyHasTextLayer),
                orientation_degrees: None,
            });
            continue;
        }
        let rendered = document
            .render_page(page_index, pages::RENDER_DPI, false)
            .map_err(|_| OcrError::InferenceFailed)?;
        // Composite over white rather than discarding alpha: a page with no background
        // content is fully transparent, and dropping alpha would hand the engine a black page.
        let image = rendered.to_rgb_image().ok_or(OcrError::InferenceFailed)?;
        let (_, page_height_points) =
            document.page_size(page_index).map_err(|_| OcrError::InferenceFailed)?;

        let recognized = state.recognizer.recognize(&image)?;
        let lines = recognized
            .lines
            .into_iter()
            .map(|mut line| {
                line.quad = pages::to_user_space(line.quad, page_height_points);
                line.word_quads = line
                    .word_quads
                    .into_iter()
                    .map(|quad| pages::to_user_space(quad, page_height_points))
                    .collect();
                line
            })
            .collect();
        pages.push(PageFacts {
            page_index,
            lines,
            // Detection found these regions; recognition could not read them. Carrying the
            // count is what stops a page of unreadable text looking like a blank page.
            undecoded_regions: recognized.undecoded_regions,
            skipped: None,
            orientation_degrees: state.recognizer.page_orientation(&image),
        });
    }
    Ok(pages)
}

/// The engine's work routes. Compose with `engine_host::host::ready_app` and
/// `with_panic_net` for the full container service.
pub fn router(state: AppState) -> Router {
    Router::new().route("/ocr", post(ocr)).with_state(state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::RgbImage;
    use ocr_core::{Provenance, Quad, TextLine};

    /// A recognizer that returns one fixed line, or fails, without loading a model.
    /// The container's page walking and wire mapping are testable in milliseconds.
    struct StubRecognizer {
        fail: bool,
    }

    impl Recognizer for StubRecognizer {
        fn recognize(&self, _image: &RgbImage) -> Result<RecognizedPage, OcrError> {
            if self.fail {
                return Err(OcrError::InferenceFailed);
            }
            Ok(RecognizedPage {
                lines: vec![TextLine {
                    text: "INVOICE".to_string(),
                    confidence: 0.99,
                    quad: Quad { points: [(0.0, 0.0), (300.0, 0.0), (300.0, 60.0), (0.0, 60.0)] },
                    orientation_degrees: None,
                    word_quads: Vec::new(),
                }],
                undecoded_regions: 0,
            })
        }
        fn page_orientation(&self, _image: &RgbImage) -> Option<f32> {
            None
        }
        fn provenance(&self) -> Provenance {
            Provenance::new("stub@0")
        }
    }

    async fn spawn(fail: bool) -> String {
        let state = AppState { recognizer: Arc::new(StubRecognizer { fail }) };
        let app = engine_host::host::ready_app(router(state));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            engine_host::host::serve_on(listener, app).await.unwrap();
        });
        format!("http://{addr}")
    }

    fn png_bytes() -> Vec<u8> {
        let image = RgbImage::from_pixel(64, 32, image::Rgb([255, 255, 255]));
        let mut out = std::io::Cursor::new(Vec::new());
        image.write_to(&mut out, image::ImageFormat::Png).unwrap();
        out.into_inner()
    }

    async fn post(base: &str, body: Vec<u8>) -> (reqwest::StatusCode, serde_json::Value) {
        let response =
            reqwest::Client::new().post(format!("{base}/ocr")).body(body).send().await.unwrap();
        let status = response.status();
        (status, response.json().await.unwrap())
    }

    #[tokio::test]
    async fn ready_probe_returns_ok() {
        let base = spawn(false).await;
        let body = reqwest::get(format!("{base}/ready")).await.unwrap().text().await.unwrap();
        assert_eq!(body, "ok");
    }

    #[tokio::test]
    async fn an_image_returns_one_page_of_lines_with_provenance() {
        let base = spawn(false).await;
        let (status, json) = post(&base, png_bytes()).await;
        assert_eq!(status, reqwest::StatusCode::OK);
        assert_eq!(json["pages"][0]["lines"][0]["text"], "INVOICE");
        assert_eq!(json["pages"][0]["pageIndex"], 0);
        assert_eq!(json["provenance"]["modelVersion"], "stub@0");
        // Three separable provenance fields, always present.
        assert!(json["provenance"]["engineVersion"].is_string());
        assert!(json["provenance"]["platform"].is_string());
    }

    #[tokio::test]
    async fn a_page_reports_its_undecoded_region_count_on_the_wire() {
        let base = spawn(false).await;
        let (_, json) = post(&base, png_bytes()).await;
        // A caller must be able to tell a page with no text from a page whose text could
        // not be read. The count travels; it is not an internal detail.
        assert_eq!(json["pages"][0]["undecodedRegions"], 0);
    }

    #[tokio::test]
    async fn an_inference_fault_is_a_retryable_503_not_an_empty_page() {
        let base = spawn(true).await;
        let (status, json) = post(&base, png_bytes()).await;
        assert_eq!(status, reqwest::StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(json["code"], "inference-failed");
        assert!(json.get("pages").is_none(), "a fault must not present as pages: {json}");
    }

    #[tokio::test]
    async fn an_empty_body_is_rejected() {
        let base = spawn(false).await;
        let (status, json) = post(&base, Vec::new()).await;
        assert_eq!(status, reqwest::StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(json["code"], "empty-body");
    }

    #[tokio::test]
    async fn a_pdf_page_that_already_has_text_is_skipped_with_a_reason() {
        let base = spawn(false).await;
        // A minimal one-page PDF carrying a real text layer.
        let pdf = std::fs::read("../../crates/pdf-core/tests/fixtures/hello.pdf")
            .expect("hello.pdf fixture");
        let (status, json) = post(&base, pdf).await;
        assert_eq!(status, reqwest::StatusCode::OK);
        assert_eq!(json["pages"][0]["skipped"], "already-has-text-layer");
        assert_eq!(json["pages"][0]["lines"].as_array().unwrap().len(), 0);
    }
}
```

- [ ] **Step 8: Write the entrypoint**

Create `containers/ocr/src/main.rs`:

```rust
//! Thin container entrypoint: load the baked-in models, wrap the work routes in the
//! standard `/ready` probe, body cap, and panic net, then serve on the container's
//! :8080 contract. All logic lives in the library.

use std::path::PathBuf;
use std::sync::Arc;

use ocr_core::engine::{ModelPaths, PaddleRecognizer};

#[tokio::main]
async fn main() -> std::io::Result<()> {
    // Baked into the image by the Dockerfile. Absent models are a deployment fault, not
    // a request fault: fail at boot rather than serve requests that can never succeed.
    let root = PathBuf::from(
        std::env::var("MAGNA_CARTA_OCR_MODELS").unwrap_or_else(|_| "/models".to_string()),
    );
    let model_version = std::env::var("MAGNA_CARTA_OCR_MODEL_VERSION")
        .expect("MAGNA_CARTA_OCR_MODEL_VERSION must name the baked model artifact");
    let recognizer = PaddleRecognizer::load(ModelPaths {
        detection_onnx: root.join("detection/inference.onnx"),
        recognition_onnx: root.join("recognition/inference.onnx"),
        recognition_yaml: root.join("recognition/inference.yml"),
        model_version,
    })
    .expect("the baked-in OCR models must load at boot");

    let state = magna_carta_ocr::AppState { recognizer: Arc::new(recognizer) };
    let app = engine_host::host::with_panic_net(engine_host::host::ready_app(
        magna_carta_ocr::router(state),
    ));
    engine_host::host::serve(app).await
}
```

- [ ] **Step 9: Run the tests**

```bash
cd C:/dev/magna-carta-worktrees/ocr-engine/containers/ocr
CARGO_BUILD_JOBS=1 RUSTFLAGS="-C debuginfo=0" cargo test
```

Expected: PASS, 9 tests. If `pdf-core` does not expose `Document::load`, `page_count`, or `page_size` with these exact signatures, read `crates/pdf-core/src/lib.rs` and adjust the call sites — the fixture path in the last test may also differ; locate a one-page text-bearing fixture under `crates/pdf-core/tests/`.

- [ ] **Step 10: Write `containers/ocr/CLAUDE.md`**

```markdown
# containers/ocr — local rules

The OCR engine container. Bytes in, per-page raw facts out. It never learns which firm it serves.

- **Never fabricate a result.** An inference fault is a 503 with a stable code. An empty text layer
  and a failed recognition must never be indistinguishable to a caller who is about to file something.
- **A skipped page is reported as skipped**, with a reason — never as a page with no words.
- **Memory-safety posture.** ONNX Runtime (C++) reaches this container through the Rust `ort` crate.
  It parses exactly two things: our own pinned model files, and a decoded pixel buffer. The untrusted
  document is parsed by pure Rust — `hayro` inside `pdf-core`, or the `image` crate — so what crosses
  into C++ is a flat array of pixels with no structure left to exploit. Keep it that way: never hand
  raw document bytes to the engine.
- **The base image must be trixie.** ONNX Runtime's prebuilt binaries need glibc 2.38; bookworm's
  2.36 fails to link, and only the cloud build catches it. The runtime stage needs `libstdc++6`
  and `libgomp1`.
- **Sessions are single-threaded and sequential.** ONNX Runtime's thread count and execution mode are
  the run-to-run sources of divergence, and a re-run of a production must reproduce its own output.
- **Models are baked at build time and verified by SHA-256.** Nothing is fetched at request time; the
  container runs with outbound networking disabled.
- The engine cannot run under the local worker test pool, so the proxy is exercised against a fake
  container and the real image is built and booted in a container CI job.
```

Also create `containers/ocr/.dockerignore` containing `target/`.

- [ ] **Step 11: Lint, format, commit**

```bash
cd C:/dev/magna-carta-worktrees/ocr-engine/containers/ocr
cargo fmt && CARGO_BUILD_JOBS=1 cargo clippy -- -D warnings
cd ../.. && git add containers/ocr && git commit -m "feat(ocr): container routes, page walk, and PDF user-space transform"
```

---

### Task 9: The Dockerfile — trixie, hash-verified models

Executed **last**, after the benchmark, so the image bakes the tier the measurement chose rather than a tier we guessed and then rewrote.

**Files:**

- Create: `containers/ocr/Dockerfile`

**Interfaces:**

- Consumes: the binary `magna-carta-ocr` (Task 4); the winning tier's revisions and hashes (Task 8).
- Produces: an image serving `:8080` with models at `/models` and `MAGNA_CARTA_OCR_MODEL_VERSION` set.

- [ ] **Step 1: Write the Dockerfile**

```dockerfile
# ONNX Runtime's prebuilt binaries (pulled in by the `ort` crate, via oar-ocr) reference glibc 2.38
# symbols. bookworm ships glibc 2.36 and fails to link -- a failure that only appears in the cloud
# build, never locally. Both stages must be trixie, and they must match.
FROM rust:1-trixie AS build
WORKDIR /src
# Build context is the repo root (image_build_context in apps/ocr-worker/wrangler.jsonc). Copy the
# whole crates/ workspace: ocr-core and pdf-core inherit `edition` from crates/Cargo.toml, so cargo
# must see that root to resolve the inheritance.
COPY crates crates
COPY containers/ocr containers/ocr
WORKDIR /src/containers/ocr
RUN cargo build --release --bin magna-carta-ocr

# The pinned model artifacts. Fetched in the build stage, which has network; the runtime stage has
# none. Each file is verified by content hash: a silently changed model would silently change every
# result, and the model version stamped onto results would then be a lie.
FROM debian:trixie-slim AS models
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /models
ARG DET_REVISION=61323801669c338b7891481ec7bac61ce31b576a
ARG REC_REVISION=50c7eacafc52fa7bcf4194e8cd08e46f8558504b
ARG DET_SHA256=eb13b44b25bb36f89528b68720af8a61d9cf381176107f465db1757b65d086e1
ARG REC_SHA256=9c09abf0957f7968c7586464b7397b84ad2387a0497a351af40e9acc71b673ba
RUN set -eux; \
    mkdir -p detection recognition; \
    base="https://huggingface.co/PaddlePaddle"; \
    curl -fsSL -o detection/inference.onnx "$base/PP-OCRv6_medium_det_onnx/resolve/$DET_REVISION/inference.onnx"; \
    curl -fsSL -o detection/inference.yml  "$base/PP-OCRv6_medium_det_onnx/resolve/$DET_REVISION/inference.yml"; \
    curl -fsSL -o recognition/inference.onnx "$base/PP-OCRv6_medium_rec_onnx/resolve/$REC_REVISION/inference.onnx"; \
    curl -fsSL -o recognition/inference.yml  "$base/PP-OCRv6_medium_rec_onnx/resolve/$REC_REVISION/inference.yml"; \
    echo "$DET_SHA256  detection/inference.onnx" | sha256sum -c -; \
    echo "$REC_SHA256  recognition/inference.onnx" | sha256sum -c -

FROM debian:trixie-slim
# onnxruntime is statically linked into the binary, but its C++ still calls into the shared C++ and
# OpenMP runtimes at load time.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libstdc++6 libgomp1 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/containers/ocr/target/release/magna-carta-ocr /usr/local/bin/ocr
COPY --from=models /models /models
# The model version travels with the results. It names the exact artifact pair, so a result produced
# before a model upgrade is never mistaken for one produced after.
ENV MAGNA_CARTA_OCR_MODELS=/models \
    MAGNA_CARTA_OCR_MODEL_VERSION=PP-OCRv6_medium@6132380-50c7eac
EXPOSE 8080
CMD ["/usr/local/bin/ocr"]
```

- [ ] **Step 2: Verify the hash guard actually fails on a wrong hash**

The point of the check is that it stops the build. Prove it does before trusting it.

```bash
cd C:/dev/magna-carta-worktrees/ocr-engine
docker build -f containers/ocr/Dockerfile --target models \
  --build-arg DET_SHA256=0000000000000000000000000000000000000000000000000000000000000000 . 2>&1 | tail -5
```

Expected: the build FAILS at `sha256sum -c -` with `detection/inference.onnx: FAILED`.

If Docker is unavailable locally (it is on this machine per the build-performance notes), skip to Step 3 and record that the hash guard is verified by the container CI job instead. Do **not** mark it verified without evidence.

- [ ] **Step 3: Build the real image and boot it**

```bash
cd C:/dev/magna-carta-worktrees/ocr-engine
docker build -f containers/ocr/Dockerfile -t magna-carta-ocr:local .
docker run --rm -d -p 8080:8080 --name ocr-smoke magna-carta-ocr:local
curl -sf http://localhost:8080/ready
docker rm -f ocr-smoke
```

Expected: `ok`. A boot failure here means the models did not load — read the container logs; do not paper over it by making `PaddleRecognizer::load` lenient.

- [ ] **Step 4: Write the documentation fragments**

No feature is done until its docs ship in the same commit. Never hand-edit the rendered `CHANGELOG.md`, `STATUS.md`, or the Decision-Log register on a branch — write fragments:

- `changelog.d/ocr-engine.md`
- `status.d/<slice>.md` — mirror the shape of an existing fragment in that directory.
- `docs/operating-costs.md` — add the OCR container's cost line beside the other engine containers. It scales to zero, with a slower cold start than the others because the models load at boot.

- [ ] **Step 5: Final gate and commit**

```bash
cd C:/dev/magna-carta-worktrees/ocr-engine
pnpm run lint:process-refs && pnpm check
cd crates && CARGO_BUILD_JOBS=1 cargo test && CARGO_BUILD_JOBS=1 cargo clippy -- -D warnings
cd .. && git add -A
git commit -m "build(ocr): trixie image with hash-verified PP-OCRv6 models baked in"
```

`pnpm check` is a long, memory-heavy build; run it in the foreground and let it finish.

---

### Task 5: The engine worker

**Files:**

- Create: `apps/ocr-worker/wrangler.jsonc`, `apps/ocr-worker/src/index.ts`, `apps/ocr-worker/src/forward.ts`, `apps/ocr-worker/src/ocr-engine-container.ts`, `apps/ocr-worker/package.json`, `apps/ocr-worker/tsconfig.json`, `apps/ocr-worker/vitest.config.ts`, `apps/ocr-worker/worker-env.d.ts`, `apps/ocr-worker/test/forward.test.ts`

**Interfaces:**

- Consumes: the container's `POST /ocr` (Task 4).
- Produces: a deployed worker named `magna-carta-ocr`, bound from the app worker as `OCR_SERVICE`.

- [ ] **Step 1: Copy the scaffold from file-repair-worker**

Copy `package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, and `worker-env.d.ts` from `apps/file-repair-worker/`, replacing `file-repair` with `ocr` and `@magna-carta/file-repair-worker` with `@magna-carta/ocr-worker` throughout.

- [ ] **Step 2: Write `apps/ocr-worker/src/ocr-engine-container.ts`**

```ts
import { Container } from "@cloudflare/containers";

// The OCR engine Container — the HTTP service built from containers/ocr/. Its default fetch()
// proxies to the service; `pingEndpoint` is the boot-readiness probe Cloudflare uses to know the
// freshly-started container is ready (NOT a keep-warm). There is no warm cron: the container scales
// to zero after sleepAfter, so it bills only while a recognition runs. Untrusted, privileged
// document bytes never reach the network: outbound networking is disabled.
//
// Model load at boot is slower than the other engine containers (the ONNX models are ~139 MB), so a
// cold start costs more here. That is still the right trade against paying for an always-on instance,
// and a warm-poke cron is a later tuning decision, off by default.
export class OcrEngineContainer extends Container {
  override defaultPort = 8080;
  override requiredPorts = [8080];
  override sleepAfter = "5m";
  override enableInternet = false; // untrusted bytes, and the models are baked in — no egress
  override pingEndpoint = "ready";
}
```

- [ ] **Step 3: Write `apps/ocr-worker/src/forward.ts`**

```ts
// The OCR Container's HTTP surface, narrowed to the one call the proxy makes. The container from
// getContainer(env.OCR_ENGINE, ...) satisfies it; tests pass a fake so the proxy is exercised without
// a real container (or Docker).
export interface OcrContainerFetcher {
  fetch(request: Request): Promise<Response>;
}

// Forward an incoming OCR request to the engine Container and return its response verbatim. The app
// worker calls POST /ocr with the document bytes as the body; this proxy re-targets the same path at
// the container and streams the body through. The service binding from the app worker is the trust
// boundary — this worker has no public routes. A network failure throws (surfaced via telemetry),
// never a silent empty result.
export async function forwardOcr(
  request: Request,
  container: OcrContainerFetcher,
): Promise<Response> {
  const containerResponse = await container.fetch(
    new Request("http://ocr/ocr", {
      method: "POST",
      body: request.body,
      headers: request.headers,
      duplex: "half",
      signal: request.signal,
    } as RequestInit & { duplex: "half" }),
  );
  return new Response(containerResponse.body, {
    status: containerResponse.status,
    statusText: containerResponse.statusText,
    headers: containerResponse.headers,
  });
}
```

- [ ] **Step 4: Write `apps/ocr-worker/src/index.ts`**

```ts
import { getContainer } from "@cloudflare/containers";
import { forwardOcr } from "./forward.ts";

// The OCR worker's runtime bindings. Stateless: no D1, R2, or Queues. The only binding is the engine
// Container Durable Object. Reached only via a service binding from the app worker — no public routes,
// so the service binding is the trust boundary.
export type Bindings = {
  OCR_ENGINE: DurableObjectNamespace<import("./ocr-engine-container.ts").OcrEngineContainer>;
};

export { OcrEngineContainer } from "./ocr-engine-container.ts";

export default {
  // POST /ocr — receives the streamed document body from the app worker (via service binding) and
  // forwards it to the engine Container, returning its JSON response verbatim. No auth: the service
  // binding is the trust boundary (not reachable from the public internet).
  async fetch(request: Request, env: Bindings): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/ocr") {
      return forwardOcr(request, getContainer(env.OCR_ENGINE, "ocr"));
    }
    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Bindings>;
```

- [ ] **Step 5: Write `apps/ocr-worker/wrangler.jsonc`**

```jsonc
{
  // The standalone OCR worker. It owns the OcrEngineContainer Durable Object (a Container-backed DO
  // that runs the OCR engine on port 8080) and is reached only via a service binding from the main
  // app worker — it has no public routes.
  "name": "magna-carta-ocr",
  "main": "./src/index.ts",
  "compatibility_date": "2026-06-05",
  "compatibility_flags": ["nodejs_compat"],
  "workers_dev": false,
  "preview_urls": false,
  "containers": [
    {
      "class_name": "OcrEngineContainer",
      "image": "../../containers/ocr/Dockerfile",
      "image_build_context": "../../",
      "max_instances": 5,
      "instance_type": "standard-1",
    },
  ],
  "durable_objects": {
    "bindings": [{ "name": "OCR_ENGINE", "class_name": "OcrEngineContainer" }],
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["OcrEngineContainer"] }],
  // No cron triggers: the Container scales to zero after its sleepAfter, billing only while a
  // recognition runs. A warm-poke cron would pay for an always-on instance to save a cold start.
  "observability": { "enabled": true, "head_sampling_rate": 1 },
}
```

- [ ] **Step 6: Write the failing proxy test**

Create `apps/ocr-worker/test/forward.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { forwardOcr } from "../src/forward.ts";

describe("forwardOcr", () => {
  it("re-targets the request at the container and returns its response verbatim", async () => {
    let seen: Request | undefined;
    const container = {
      async fetch(request: Request) {
        seen = request;
        return new Response(JSON.stringify({ pages: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    };
    const response = await forwardOcr(
      new Request("https://worker.example/ocr", {
        method: "POST",
        body: "bytes",
      }),
      container,
    );
    expect(seen?.url).toBe("http://ocr/ocr");
    expect(seen?.method).toBe("POST");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ pages: [] });
  });

  it("passes a container fault through rather than masking it as success", async () => {
    const container = {
      async fetch() {
        return new Response(JSON.stringify({ code: "inference-failed" }), {
          status: 503,
        });
      },
    };
    const response = await forwardOcr(
      new Request("https://worker.example/ocr", {
        method: "POST",
        body: "bytes",
      }),
      container,
    );
    expect(response.status).toBe(503);
  });
});
```

- [ ] **Step 7: Run the tests**

```bash
cd C:/dev/magna-carta-worktrees/ocr-engine
pnpm install
pnpm --filter @magna-carta/ocr-worker test
```

Expected: PASS, 2 tests.

- [ ] **Step 8: Regenerate the typecheck project references and check**

```bash
node tooling/tsconfig-refs/index.mjs
pnpm --filter @magna-carta/ocr-worker exec wrangler deploy --dry-run
```

Expected: the dry-run validates the config. Do not hand-edit `tsconfig.build.json` — it is generated.

- [ ] **Step 9: Commit**

```bash
git add apps/ocr-worker tsconfig.build.json && git commit -m "feat(ocr-worker): container Durable Object and verbatim forwarding proxy"
```

---

### Task 6: Reachability — permission, catalog, migration, route

This is the registration surface. Every item below must land together: a permission with no catalog entry, or a catalog entry with no role grant, is a tool nobody can use.

**Files:**

- Modify: `packages/access-control/src/registry.ts`
- Modify: `packages/tools/src/catalog.ts`
- Create: `packages/database/drizzle/per-firm/20260908T000000_baseline.sql`
- Modify: `packages/database/drizzle/per-firm/meta/_journal.json`
- Modify: `apps/worker/src/per-firm-migrations.ts`
- Create: `apps/worker/src/routes/files/ocr.ts`
- Modify: `apps/worker/src/app.ts`
- Modify: `apps/worker/wrangler.jsonc`
- Create: `apps/worker/test/seed-tools-ocr.test.ts`

**Interfaces:**

- Consumes: `apps/ocr-worker`'s `POST /ocr` over the `OCR_SERVICE` service binding (Task 5).
- Produces: `registerOcrRoutes(app, chokepoint)`; the `tools:ocr` permission; `POST /api/v1/ocr`.

- [ ] **Step 1: Add the permission**

In `packages/access-control/src/registry.ts`, beside the other `tools:` entries:

```ts
  "tools:ocr", // recognize text in a scanned image or PDF — returns text, word boxes, and confidence
```

- [ ] **Step 2: Add the catalog entry**

In `packages/tools/src/catalog.ts`, after the `file-repair` entry:

```ts
  {
    id: "ocr",
    name: "Text Recognition",
    icon: "scan-text",
    subjectGroup: "files",
    permission: assertPermission("tools:ocr"),
    contextTags: ["file", "none"],
    // The recognition engine runs in an internal Container, not a connected third-party integration,
    // so this is `library` — the same backing the other in-house file utilities use. Stateless: the
    // engine writes nothing. Turning the recognized text into a searchable PDF lands in a later slice.
    backing: { kind: "library" },
    matterContext: "optional",
  },
```

Confirm `scan-text` exists in the Lucide icon set the design system exposes; if not, pick another Lucide name and use it consistently.

- [ ] **Step 3: Mint the role-permission identifiers**

The seed migration commits identifiers as literals. Mint five:

```bash
cd C:/dev/magna-carta-worktrees/ocr-engine
node -e "const{newIdentifier}=require('./packages/identifiers/dist/index.cjs');for(let i=0;i<5;i++)console.log(newIdentifier('rolePermission'))"
```

If that import path does not resolve, run `pnpm --filter @magna-carta/identifiers build` first, or use the package's documented entry point. Record the five values; they go into the SQL verbatim.

- [ ] **Step 4: Write the seed migration**

Create `packages/database/drizzle/per-firm/20260908T000000_baseline.sql`, substituting the five minted identifiers:

```sql
-- Seed tools:ocr onto every default role. Reading the text out of a scanned document is an everyday
-- utility any firm member may need without a separate grant -- the same broad reach as the other
-- tools:* utilities. The rolePermission_ handles are minted once and committed as literals; the
-- role_id values are the default roles from the member-rbac seed.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('<MINTED_1>', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tools:ocr');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('<MINTED_2>', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'tools:ocr');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('<MINTED_3>', 'role_917LCQyRKP50Z9bW89vXl', 'tools:ocr');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('<MINTED_4>', 'role_hwwC1D98d8Lazc_asL6vO', 'tools:ocr');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('<MINTED_5>', 'role_WojF9F7kksBEftsmZGNhb', 'tools:ocr');
```

- [ ] **Step 5: Register it in the journal and the migration map**

Append to the `entries` array in `packages/database/drizzle/per-firm/meta/_journal.json` (bump `idx` past the last entry, currently `2`):

```json
{
  "idx": 3,
  "version": "6",
  "when": 1783200000000,
  "tag": "20260709T000001_seed-tools-ocr",
  "breakpoints": true
}
```

In `apps/worker/src/per-firm-migrations.ts`, add the import and the map entry:

```ts
import seedToolsOcrSql from "@magna-carta/database/drizzle/per-firm/20260709T000001_seed-tools-ocr.sql";
```

```ts
    "20260709T000001_seed-tools-ocr": seedToolsOcrSql,
```

`migrationsFromJournal` fails loud when the journal gains a migration the map does not carry — that failure is the guard, so run the suite and see it pass rather than assuming.

- [ ] **Step 6: Write the failing seed test**

Create `apps/worker/test/seed-tools-ocr.test.ts`, modelled on `apps/worker/test/seed-tools-file-repair.test.ts`. Read that file and mirror it exactly, substituting `tools:ocr`. It must assert the permission is granted to all five default roles after the lineage runs.

- [ ] **Step 7: Run it to verify it fails, then passes**

```bash
cd C:/dev/magna-carta-worktrees/ocr-engine
pnpm --filter @magna-carta/worker test -- seed-tools-ocr
```

Expected: FAIL before Steps 4-5 land, PASS after.

- [ ] **Step 8: Add the service binding**

In `apps/worker/wrangler.jsonc`, add to the **existing** `services` array — never a second `services` key, because JSONC keeps only the last duplicate top-level key and everything above it is silently dropped:

```jsonc
    { "binding": "OCR_SERVICE", "service": "magna-carta-ocr" },
```

- [ ] **Step 9: Write the route**

Create `apps/worker/src/routes/files/ocr.ts`:

```ts
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { readInspectableSizeCap } from "@magna-carta/file-manager/upload-policy";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import { requireChokepointFirmContext } from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { Problem, problemJson } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";

export const ocrRecognizeMeta: RouteMeta = {
  operationId: "ocr.recognize",
  surface: "app",
  authenticated: true,
  permission: "tools:ocr",
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "expensive",
};

const QuadSchema = z.object({
  points: z.array(z.array(z.number()).length(2)).length(4),
});

const TextLineSchema = z.object({
  text: z.string(),
  confidence: z.number(),
  quad: QuadSchema,
  orientationDegrees: z.number().nullable().optional(),
  wordQuads: z.array(QuadSchema),
});

const PageSchema = z.object({
  pageIndex: z.number().int(),
  lines: z.array(TextLineSchema),
  // Regions detection found but recognition could not read. Surfaced so a caller can tell a
  // page with no text from a page whose text was unreadable.
  undecodedRegions: z.number().int(),
  skipped: z.string().nullable().optional(),
  orientationDegrees: z.number().nullable().optional(),
});

const ResultSchema = z.object({
  pages: z.array(PageSchema),
  provenance: z.object({
    engineVersion: z.string(),
    modelVersion: z.string(),
    platform: z.string(),
  }),
});

const recognizeRoute = defineOpenAPIRoute(ocrRecognizeMeta, {
  method: "post",
  path: "/api/v1/ocr",
  description:
    "Recognize text in a scanned image or PDF. Returns per-page lines with word boxes, confidence, " +
    "and the engine and model that produced them. Pages that already carry a text layer are " +
    "reported as skipped rather than re-recognized. Nothing is stored.",
  request: {
    body: {
      content: { "application/octet-stream": { schema: z.any() } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Per-page recognition facts",
      content: { "application/json": { schema: ResultSchema } },
    },
    400: {
      description: "Empty request body",
      content: { "application/problem+json": { schema: Problem } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "Missing tools:ocr",
      content: { "application/problem+json": { schema: Problem } },
    },
    413: {
      description: "File exceeds the inspectable-size cap",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
    503: {
      description: "Recognition engine unavailable",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export function registerOcrRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    {
      ...recognizeRoute,
      middleware: chokepointMiddleware(chokepoint, recognizeRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const body = c.req.raw.body;
      if (body === null) {
        return problemJson(c, {
          type: "validation",
          title: "Empty body",
          status: 400,
          detail: "Provide the document bytes as the request body.",
        });
      }
      const sizeBytes = Number(c.req.header("content-length") ?? "0");
      const cap = await readInspectableSizeCap(firm.firmDatabase);
      if (sizeBytes > cap) {
        await body.cancel();
        return problemJson(c, {
          type: "upload-not-allowed",
          title: "File too large to recognize inline",
          status: 413,
          detail: `The file exceeds this firm's inspectable-size cap (${cap} bytes).`,
        });
      }
      const ocr = c.env.OCR_SERVICE;
      if (ocr === undefined) {
        return problemJson(c, {
          type: "service-unavailable",
          title: "Recognition engine unavailable",
          status: 503,
          detail: "The recognition engine is not currently reachable. Try again shortly.",
        });
      }
      const response = await ocr.fetch(
        new Request("http://ocr/ocr", {
          method: "POST",
          body,
          duplex: "half",
        } as RequestInit & { duplex: "half" }),
      );
      if (response.status !== 200) {
        // A fault is never dressed up as a page with no words.
        return problemJson(c, {
          type: "service-unavailable",
          title: "Recognition failed",
          status: 503,
          detail: "The recognition engine returned an error. Try again shortly.",
        });
      }
      return c.json(ResultSchema.parse(await response.json()), 200);
    },
  );
}
```

- [ ] **Step 10: Wire it into the app**

In `apps/worker/src/app.ts`, add `OCR_SERVICE?: Fetcher;` to the `Bindings` type beside `SCAN_SERVICE`, import `registerOcrRoutes`, and call it beside `registerFileTypeRoutes(app, chokepoint)`.

- [ ] **Step 11: Regenerate the contract**

```bash
cd C:/dev/magna-carta-worktrees/ocr-engine
pnpm --filter @magna-carta/worker run emit-openapi
pnpm --filter @magna-carta/api-client run generate
```

A byte-exact test gates contract drift, and the conformance operation list must include `ocr.recognize`. Both regenerated files are committed in this task.

- [ ] **Step 12: Full quality gate**

```bash
cd C:/dev/magna-carta-worktrees/ocr-engine
pnpm run lint:process-refs
pnpm check
```

Expected: clean. `pnpm check` is a long, memory-heavy build; run it in the foreground and let it finish.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "feat(ocr): tools:ocr permission, catalog entry, role seed, and the recognize route"
```

---

### Task 7: The validation operation

**Files:**

- Create: `crates/pdf-eval/src/validate/operations/ocr.rs`
- Modify: `crates/pdf-eval/src/validate/operations/mod.rs`

**Interfaces:**

- Consumes: `pdf_eval::validate::operation::{ValidationOperation, OperationVerdict, Outcome, Safety}`; `ocr_core::Recognizer` (Task 1).
- Produces: `OcrOperation`, implementing `ValidationOperation`.

- [ ] **Step 1: Write the failing test**

Create `crates/pdf-eval/src/validate/operations/ocr.rs`. Read `operations/forms.rs` first and mirror its structure.

The safety invariant: recognition is strictly additive and non-destructive. A page that already carried real text still carries it afterward, and a page we declined is reported as skipped rather than as empty.

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_page_with_a_text_layer_is_skipped_not_recognized() {
        let bytes = std::fs::read("tests/fixtures/hello.pdf").unwrap();
        let verdict = OcrOperation::new(stub_recognizer()).run(&bytes);
        assert!(matches!(verdict.outcome, Outcome::Skipped { .. }));
        assert_eq!(verdict.safety, Safety::NotApplicable);
    }

    #[test]
    fn a_scanned_page_is_recognized_and_the_existing_text_is_untouched() {
        let bytes = std::fs::read("tests/fixtures/scanned.pdf").unwrap();
        let before = pdf_core::Document::load(&bytes).unwrap().page_text_rects(0).unwrap();
        let verdict = OcrOperation::new(stub_recognizer()).run(&bytes);
        assert!(matches!(verdict.outcome, Outcome::Success { .. }));
        assert_eq!(verdict.safety, Safety::Upheld);
        // Recognition reads; it never rewrites the document.
        let after = pdf_core::Document::load(&bytes).unwrap().page_text_rects(0).unwrap();
        assert_eq!(before.len(), after.len());
    }

    #[test]
    fn an_engine_error_is_reported_as_an_error_not_as_an_empty_success() {
        let bytes = std::fs::read("tests/fixtures/scanned.pdf").unwrap();
        let verdict = OcrOperation::new(failing_recognizer()).run(&bytes);
        assert!(matches!(verdict.outcome, Outcome::Error { .. }));
    }
}
```

Write `stub_recognizer()` and `failing_recognizer()` returning `Box<dyn Recognizer>`, mirroring `StubRecognizer` from `containers/ocr/src/lib.rs`. If no `scanned.pdf` fixture exists, create one by rendering `hello.pdf` to a raster and wrapping it in a single-page image-only PDF; commit it under `crates/pdf-eval/tests/fixtures/`.

- [ ] **Step 2: Run to verify failure**

```bash
cd C:/dev/magna-carta-worktrees/ocr-engine/crates
CARGO_BUILD_JOBS=1 RUSTFLAGS="-C debuginfo=0" cargo test -p pdf-eval ocr
```

Expected: FAIL — `OcrOperation` does not exist.

- [ ] **Step 3: Implement `OcrOperation`**

```rust
//! Recognition as a validation operation. Robustness comes from the runner, which
//! isolates `run` under catch_unwind and a timeout. The invariant this operation
//! checks is that recognition is strictly additive: it reads a page, it never
//! rewrites one, and a page it declines is reported as declined rather than as a
//! page that happened to contain no words.

use ocr_core::Recognizer;

use crate::validate::operation::{OperationVerdict, Outcome, Safety, ValidationOperation};

pub struct OcrOperation {
    recognizer: Box<dyn Recognizer>,
}

impl OcrOperation {
    pub fn new(recognizer: Box<dyn Recognizer>) -> Self {
        Self { recognizer }
    }
}

impl ValidationOperation for OcrOperation {
    fn name(&self) -> &str {
        "ocr"
    }

    fn run(&self, bytes: &[u8]) -> OperationVerdict {
        let Ok(document) = pdf_core::Document::load(bytes) else {
            return OperationVerdict {
                outcome: Outcome::Error { detail: "load failed".to_string() },
                safety: Safety::NotApplicable,
            };
        };
        let Ok(existing) = document.page_text_rects(0) else {
            return OperationVerdict {
                outcome: Outcome::Error { detail: "text observation failed".to_string() },
                safety: Safety::NotApplicable,
            };
        };
        if !existing.is_empty() {
            return OperationVerdict {
                outcome: Outcome::Skipped { reason: "page already has a text layer".to_string() },
                safety: Safety::NotApplicable,
            };
        }
        let Ok(rendered) = document.render_page(0, 300.0, false) else {
            return OperationVerdict {
                outcome: Outcome::Error { detail: "render failed".to_string() },
                safety: Safety::NotApplicable,
            };
        };
        let Some(image) = rendered.to_rgb_image() else {
            return OperationVerdict {
                outcome: Outcome::Error { detail: "raster conversion failed".to_string() },
                safety: Safety::NotApplicable,
            };
        };
        match self.recognizer.recognize(&image) {
            Ok(recognized) => {
                // Additive-only: reload and confirm the source document is unchanged.
                let unchanged = pdf_core::Document::load(bytes)
                    .and_then(|reloaded| reloaded.page_text_rects(0))
                    .map(|after| after.is_empty())
                    .unwrap_or(false);
                OperationVerdict {
                    outcome: Outcome::Success {
                        variant: format!(
                            "{} lines, {} undecoded",
                            recognized.lines.len(),
                            recognized.undecoded_regions
                        ),
                    },
                    safety: if unchanged {
                        Safety::Upheld
                    } else {
                        Safety::Violated { detail: "recognition mutated the document".to_string() }
                    },
                }
            }
            Err(error) => OperationVerdict {
                outcome: Outcome::Error { detail: error.code().to_string() },
                safety: Safety::NotApplicable,
            },
        }
    }
}

```

Add `pub mod ocr;` to `crates/pdf-eval/src/validate/operations/mod.rs` and add `ocr-core` plus `image` to `crates/pdf-eval/Cargo.toml`. The RGBA-to-RGB conversion comes from `pdf_core::RenderedPage::to_rgb_image` (Task 3) — do not write a second one.

- [ ] **Step 4: Run to verify pass, lint, commit**

```bash
cd C:/dev/magna-carta-worktrees/ocr-engine/crates
CARGO_BUILD_JOBS=1 RUSTFLAGS="-C debuginfo=0" cargo test -p pdf-eval
cargo fmt -p pdf-eval && CARGO_BUILD_JOBS=1 cargo clippy -p pdf-eval -- -D warnings
cd .. && git add crates/pdf-eval && git commit -m "test(pdf-eval): OCR validation operation with an additive-only safety invariant"
```

---

### Task 8: The model-tier benchmark

Pins the tier on measurement. Until this runs, no tier is written into `modelVersion`.

**Files:**

- Create: `crates/pdf-eval/src/bench/mod.rs`, `crates/pdf-eval/src/bench/degrade.rs`, `crates/pdf-eval/src/bench/score.rs`
- Create: `crates/pdf-eval/ocr-benchmark-baseline.json`

**Interfaces:**

- Consumes: `ocr_core::{Recognizer, TextLine}`; `pdf_core::Document::{render_page, page_text_rects}`; the crate-private glyph observer.
- Produces: `bench::{degrade, character_error_rate, run_tier}`.

- [ ] **Step 1: Write the failing tests for the scorer**

Create `crates/pdf-eval/src/bench/score.rs`:

```rust
//! Scoring recognition against ground truth. Character error rate is the Levenshtein
//! distance between the recognized text and the truth, normalized by the truth's
//! length -- the standard OCR measure, and the one a model upgrade must not regress.

/// Levenshtein edit distance between two character sequences.
pub fn edit_distance(left: &str, right: &str) -> usize {
    todo!()
}

/// Character error rate: edits per character of ground truth. 0.0 is perfect. A rate
/// above 1.0 is possible when recognition invents more text than exists.
pub fn character_error_rate(truth: &str, recognized: &str) -> f64 {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identical_text_has_no_error() {
        assert_eq!(character_error_rate("INVOICE", "INVOICE"), 0.0);
    }

    #[test]
    fn one_wrong_character_in_seven_is_one_seventh() {
        let rate = character_error_rate("INVOICE", "1NVOICE");
        assert!((rate - 1.0 / 7.0).abs() < 1e-9, "got {rate}");
    }

    #[test]
    fn edit_distance_counts_insertions_deletions_and_substitutions() {
        assert_eq!(edit_distance("kitten", "sitting"), 3);
        assert_eq!(edit_distance("", "abc"), 3);
        assert_eq!(edit_distance("abc", ""), 3);
    }

    #[test]
    fn empty_truth_with_invented_text_is_a_total_error_not_a_divide_by_zero() {
        assert!(character_error_rate("", "spurious").is_finite());
        assert!(character_error_rate("", "spurious") > 0.0);
    }

    #[test]
    fn multibyte_characters_count_as_one_each() {
        // Byte-length would call this three errors; it is one.
        assert!((character_error_rate("中文", "中x") - 0.5).abs() < 1e-9);
    }
}
```

- [ ] **Step 2: Run to verify failure**

```bash
cd C:/dev/magna-carta-worktrees/ocr-engine/crates
CARGO_BUILD_JOBS=1 RUSTFLAGS="-C debuginfo=0" cargo test -p pdf-eval bench
```

Expected: FAIL, `todo!()` panics in five tests.

- [ ] **Step 3: Implement the scorer**

```rust
pub fn edit_distance(left: &str, right: &str) -> usize {
    let left: Vec<char> = left.chars().collect();
    let right: Vec<char> = right.chars().collect();
    let mut previous: Vec<usize> = (0..=right.len()).collect();
    let mut current = vec![0usize; right.len() + 1];
    for (i, left_char) in left.iter().enumerate() {
        current[0] = i + 1;
        for (j, right_char) in right.iter().enumerate() {
            let substitution = previous[j] + usize::from(left_char != right_char);
            current[j + 1] = substitution.min(previous[j + 1] + 1).min(current[j] + 1);
        }
        std::mem::swap(&mut previous, &mut current);
    }
    previous[right.len()]
}

pub fn character_error_rate(truth: &str, recognized: &str) -> f64 {
    let truth_length = truth.chars().count();
    let distance = edit_distance(truth, recognized) as f64;
    if truth_length == 0 {
        // No truth to divide by: every recognized character is spurious.
        return if recognized.is_empty() { 0.0 } else { distance };
    }
    distance / truth_length as f64
}
```

- [ ] **Step 4: Write the degradation pass with tests**

Create `crates/pdf-eval/src/bench/degrade.rs`. It turns a clean render into something scanner-shaped, deterministically — a seeded generator, never `rand::thread_rng`, because a benchmark that varies run to run cannot serve as a regression baseline.

```rust
//! Making a clean render look scanned. Deterministic by construction: the same page and
//! the same seed always degrade identically, so a benchmark result is comparable across
//! runs and a regression is a real regression rather than a different roll of the dice.

use image::RgbImage;

/// Rotate by `skew_degrees`, add Gaussian-ish noise, and re-encode through JPEG at
/// `quality`, in that order -- the order a real scanner degrades a page.
pub fn degrade(image: &RgbImage, skew_degrees: f32, noise: u8, quality: u8, seed: u64) -> RgbImage {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn white(width: u32, height: u32) -> RgbImage {
        RgbImage::from_pixel(width, height, image::Rgb([255, 255, 255]))
    }

    #[test]
    fn degradation_is_deterministic_for_a_given_seed() {
        let source = white(64, 64);
        let first = degrade(&source, 1.5, 12, 80, 42);
        let second = degrade(&source, 1.5, 12, 80, 42);
        assert_eq!(first.as_raw(), second.as_raw());
    }

    #[test]
    fn a_different_seed_produces_different_noise() {
        let source = white(64, 64);
        assert_ne!(degrade(&source, 0.0, 12, 80, 1).as_raw(), degrade(&source, 0.0, 12, 80, 2).as_raw());
    }

    #[test]
    fn zero_noise_and_zero_skew_at_full_quality_is_close_to_the_original() {
        let source = white(64, 64);
        let output = degrade(&source, 0.0, 0, 100, 7);
        assert_eq!(output.dimensions(), source.dimensions());
    }
}
```

Implement `degrade` with `image::imageops::rotate_about_center` (or an affine helper), a small xorshift seeded by `seed` for the noise, and a JPEG round-trip through `image::codecs::jpeg::JpegEncoder`. Verify each API against docs.rs for `image` 0.25.

- [ ] **Step 5: Write the tier runner**

Create `crates/pdf-eval/src/bench/mod.rs` exposing `run_tier`, which for each corpus document:

1. loads it and takes ground truth from the observer path (the recognized text of every visible glyph, in reading order),
2. renders page 0 at 300 DPI,
3. degrades it with a fixed seed,
4. recognizes the degraded raster with the tier's `Recognizer`,
5. records character error rate, word-box overlap against the true glyph boxes, wall-clock recognition time, and model-load time.

Emit one JSON line per document plus a summary, reusing `validate::report`'s writer. Skip documents whose ground-truth text is empty — an image-only page has nothing to score against, and counting it as a perfect zero would flatter every tier equally.

- [ ] **Step 6: Run the three tiers and commit the baseline**

```bash
# Fetch all three tiers into /tmp/ocr-tiers/{tiny,small,medium}/{detection,recognition}/
# (see the Dockerfile for the canonical URLs and revisions), then:
cd C:/dev/magna-carta-worktrees/ocr-engine/crates
MAGNA_CARTA_OCR_TIERS=/tmp/ocr-tiers CARGO_BUILD_JOBS=1 cargo run -p pdf-eval --release -- ocr-benchmark
```

Expected: a table of three rows. Record the winner in `crates/pdf-eval/ocr-benchmark-baseline.json`. Task 9 then bakes that tier's revisions and hashes into the Dockerfile; the constants in Global Constraints are the medium tier's, and must be replaced if the measurement picks another.

If medium does not beat small by a margin that justifies 4.5x the image size and its cold-start cost, say so plainly and take small. The measurement decides; report what it says, including if it says something inconvenient.

- [ ] **Step 7: Update the design and decision documents with the measured result**

Both currently say the tier is pinned by measurement. Replace that with the number.

- [ ] **Step 8: Commit**

```bash
cd C:/dev/magna-carta-worktrees/ocr-engine/crates
CARGO_BUILD_JOBS=1 cargo test -p pdf-eval && CARGO_BUILD_JOBS=1 cargo clippy -p pdf-eval -- -D warnings
cd .. && git add -A
git commit -m "feat(ocr): model-tier benchmark, baseline, and the measured tier pin"
```

---

## Self-Review

**Spec coverage.** Every section of the design maps to a task: architecture and the three units (Tasks 1-5); the engine contract, image-and-PDF input, skip-if-text-layer, user-space boxes, never-fabricate (Task 4); provenance and determinism (Tasks 1-2, asserted in tests); the two-file model artifact, hash verification, trixie (Task 9); reachability and the registration surface (Task 6); validation (Task 7); the tier benchmark, manufactured ground truth, and the regression baseline (Task 8). The recognizer-swappability seam is carried by the `Recognizer` trait from Task 1, which is what a per-script v5 model registers behind later.

**One correctness fix found while reviewing this plan against the codebase.** An earlier draft had the container and the harness each drop the alpha channel from `render_page`'s output. That output is _straight_ alpha, and a page with no background content is fully transparent with RGB 0 — so dropping alpha would have handed the engine a solid black page for exactly those documents. `pdf-core/src/redact.rs` already composited over white, inline. Task 3 gives that rule one home and both consumers call it.

**Known gaps, stated rather than hidden.** Three API details could not be closed from documentation and must be verified against docs.rs at implementation time, each flagged inline at its use site: whether `oar_ocr`'s `Point` exposes `.x`/`.y` or tuple fields (Task 2, Step 4); whether `download-binaries` can be enabled without `tls-native` (Task 2, Step 1); and the exact `pdf-core` signatures for `Document::load`, `page_count`, and `page_size`, which the container calls (Task 3, Step 9). None of these change the design; each changes a line of code.

**Deferred by design, not by omission.** No document-orientation or rectification models are baked in, so `page_orientation` honestly returns `None` rather than claiming a measurement never taken; `oar-ocr` supports both classifiers behind `with_document_image_orientation_classification` and `with_document_image_rectification`, each needing its own extra model, and adding them is additive. The invisible text-layer writer, ingest wiring, queues, the desktop path, and the user interface are all out of scope per the design.
