# Document-engine Validation Harness — Implementation Plan (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable, engine-agnostic validation harness in `crates/pdf-eval` and prove it end to end on the **forms** operation over a small set of **pdf.js** AcroForm test files.

**Architecture:** A `ValidationOperation` trait abstracts "run an engine capability on document bytes and classify the result." A runner executes each (operation × document) under `catch_unwind` + a timeout so panics/hangs become per-file records, never fatal. A reporter aggregates per-document records into a summary and diffs it against a committed baseline to catch regressions. Phase 1 wires one operation (forms) and one source (pdf.js form URLs); every later operation (render, redact, scrub, detect, generate, secure, OCR) plugs into the same trait.

**Tech Stack:** Rust (native binary `pdf-eval`), `pdf-core` engine API, `serde`/`serde_json` for records + baseline, `reqwest` (blocking, rustls) behind an optional `corpus-fetch` feature, `std::thread` + `mpsc::recv_timeout` for the timeout, `std::panic::catch_unwind` for panic isolation.

## Global Constraints

- **Design spec:** `docs/specs/2026-07-03-document-engine-validation-harness-design.md`. Phase 1 = forms operation + pdf.js form corpus + harness frame only.
- **Memory-safe deps only** (golden rule 14): `reqwest` MUST use `default-features = false, features = ["rustls-tls", "blocking"]` — never native-tls (OpenSSL is a C dependency). No new C/C++ dependency.
- **Fetch is opt-in:** network code compiles only under the `corpus-fetch` cargo feature, mirroring the existing optional `pdfium` feature. The always-on `validate` path reads local files and pulls no HTTP dependency.
- **No shell for file operations** (golden rule 7): use `std::fs`, not shelling to `curl`/`cp`.
- **Fully-spelled names** (golden rule 12): `document`, not `doc`; `operation`, not `op`, in public identifiers and report fields.
- **No process-doc references in source** (golden rule 13): no ADR/spec/phase citations in `.rs` files or committed report/manifest text. Explain reasoning inline.
- **Build memory:** native builds on the dev machine can OOM. Build/test with `CARGO_BUILD_JOBS=1 CARGO_PROFILE_TEST_DEBUG=0 RUSTFLAGS="-C debuginfo=0"`.
- **Corpus storage:** the large fetched corpus lives at `crates/pdf-eval/corpus-forms/` and is **gitignored**. Only the manifest (`corpus-forms.lock`) and the baseline (`validation-baseline.json`) are committed.
- **Commits:** the repository owner performs all git commits. Each task below ends by _staging and describing_ the commit; do not run `git commit` unless the owner directs it. Where a step shows a commit command, treat it as the message/scope to hand to the owner.

---

## File Structure

- `crates/pdf-eval/src/validate/mod.rs` — the `validate` entry point; wires corpus → runner → report; owns the CLI sub-mode.
- `crates/pdf-eval/src/validate/operation.rs` — `ValidationOperation` trait, `Outcome`, `Safety`, `OperationVerdict`.
- `crates/pdf-eval/src/validate/operations/mod.rs` — re-exports operation plug-ins.
- `crates/pdf-eval/src/validate/operations/forms.rs` — the forms plug-in.
- `crates/pdf-eval/src/validate/runner.rs` — `catch_unwind` + timeout; produces `DocumentReport`.
- `crates/pdf-eval/src/validate/report.rs` — `DocumentReport`, `Summary`, JSONL writer, baseline diff.
- `crates/pdf-eval/src/validate/corpus.rs` — manifest parse; `missing_documents`; fetch (feature-gated).
- `crates/pdf-eval/corpus-forms.lock` — committed manifest (filename, URL, license per line).
- `crates/pdf-eval/validation-baseline.json` — committed regression baseline.
- `crates/pdf-eval/src/main.rs` — add `mod validate;` and a `validate` / `corpus-fetch` dispatch arm.
- `crates/pdf-eval/Cargo.toml` — add `serde`, `serde_json`; add optional `reqwest` + `corpus-fetch` feature.
- `crates/pdf-eval/.gitignore` (or repo root ignore) — ignore `corpus-forms/`.

---

### Task 1: Operation interface and outcome types

**Files:**

- Create: `crates/pdf-eval/src/validate/operation.rs`
- Create: `crates/pdf-eval/src/validate/mod.rs`
- Modify: `crates/pdf-eval/src/main.rs` (add `mod validate;` near the other module/use lines, top of file)
- Modify: `crates/pdf-eval/Cargo.toml` (add serde/serde_json)

**Interfaces:**

- Produces:
  - `enum Outcome { Success{variant:String}, Fallback{reason:String}, Skipped{reason:String}, Error{detail:String}, Panicked{detail:String}, TimedOut }` (derives `Debug, Clone, PartialEq, serde::Serialize`)
  - `enum Safety { Upheld, Violated{detail:String}, NotApplicable }` (same derives)
  - `struct OperationVerdict { outcome: Outcome, safety: Safety }`
  - `trait ValidationOperation: Send + Sync { fn name(&self)->&str; fn run(&self, bytes:&[u8]) -> OperationVerdict; }`

- [ ] **Step 1: Add serde to Cargo.toml**

In `crates/pdf-eval/Cargo.toml` under `[dependencies]` add:

```toml
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

- [ ] **Step 2: Write the failing test**

Create `crates/pdf-eval/src/validate/operation.rs`:

```rust
//! The engine-agnostic validation-operation interface: run one engine capability
//! on document bytes and classify how it fared. The runner isolates `run` from
//! panics and hangs, so implementations may fail loudly without taking the harness
//! down.

use serde::Serialize;

/// How a document fared under one operation.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Outcome {
    /// Completed on the good path; `variant` names the success mode.
    Success { variant: String },
    /// Intentionally took a safe fallback (e.g. rasterized redaction).
    Fallback { reason: String },
    /// Nothing to do (e.g. the document has no form).
    Skipped { reason: String },
    /// Returned an error.
    Error { detail: String },
    /// Panicked — a robustness defect.
    Panicked { detail: String },
    /// Exceeded the timeout — a robustness defect.
    TimedOut,
}

/// Whether the operation's safety invariant held.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Safety {
    Upheld,
    Violated { detail: String },
    NotApplicable,
}

/// One operation's verdict on one document.
#[derive(Debug, Clone)]
pub struct OperationVerdict {
    pub outcome: Outcome,
    pub safety: Safety,
}

/// A validation operation. `run` may panic or hang; the runner isolates it.
pub trait ValidationOperation: Send + Sync {
    /// Stable identifier used in reports (e.g. "forms").
    fn name(&self) -> &str;
    /// Execute on `bytes` and classify. May panic.
    fn run(&self, bytes: &[u8]) -> OperationVerdict;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn outcome_serializes_with_kind_tag() {
        let json = serde_json::to_string(&Outcome::Success {
            variant: "filled".into(),
        })
        .unwrap();
        assert_eq!(json, r#"{"kind":"success","variant":"filled"}"#);
    }

    #[test]
    fn timed_out_serializes_as_bare_kind() {
        let json = serde_json::to_string(&Outcome::TimedOut).unwrap();
        assert_eq!(json, r#"{"kind":"timed_out"}"#);
    }
}
```

Create `crates/pdf-eval/src/validate/mod.rs`:

```rust
//! Reusable document-engine validation harness: run engine operations over a
//! corpus, classifying robustness (no panic/hang), safety (invariants hold), and
//! coverage (good path vs. fallback), and diff the summary against a baseline.

pub mod operation;
```

- [ ] **Step 3: Wire the module into the binary**

In `crates/pdf-eval/src/main.rs`, add near the top (after the existing `use` lines, before `fn main`):

```rust
mod validate;
```

- [ ] **Step 4: Run the test**

Run: `cd crates && CARGO_BUILD_JOBS=1 RUSTFLAGS="-C debuginfo=0" cargo test -p pdf-eval --lib validate::operation`
Expected: PASS (2 tests). If `cargo test -p pdf-eval --lib` reports "no library targets", the binary's unit tests still run via `cargo test -p pdf-eval` — use that and filter: `cargo test -p pdf-eval validate::operation`.

- [ ] **Step 5: Stage for commit**

```bash
git add crates/pdf-eval/src/validate/ crates/pdf-eval/src/main.rs crates/pdf-eval/Cargo.toml
# message: feat(pdf-eval): validation-operation interface + outcome types
```

---

### Task 2: Corpus manifest parser

**Files:**

- Create: `crates/pdf-eval/src/validate/corpus.rs`
- Create: `crates/pdf-eval/corpus-forms.lock`
- Modify: `crates/pdf-eval/src/validate/mod.rs` (add `pub mod corpus;`)

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `struct ManifestEntry { filename: String, url: String, license: String }`
  - `fn parse_manifest(text: &str) -> Vec<ManifestEntry>` — ignores blank lines and `#` comments; each data line is `filename<whitespace>url<whitespace>license` (license may contain spaces; it is the remainder).
  - `fn missing_documents(entries: &[ManifestEntry], dir: &std::path::Path) -> Vec<ManifestEntry>` — entries whose file is absent from `dir`.

- [ ] **Step 1: Write the committed manifest**

Create `crates/pdf-eval/corpus-forms.lock`. These are direct-committed pdf.js AcroForm/widget files; pin the branch `master` (the owner accepts that these stable files may occasionally change or be added to). Format: `filename  url  license`.

```
# pdf-eval forms corpus manifest.
# One line per document: <filename> <url> <license/source>.
# Fetched (gitignored) into corpus-forms/ via: cargo run -p pdf-eval --features corpus-fetch corpus-fetch
#
acroform_calculation_order.pdf  https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs/acroform_calculation_order.pdf  Apache-2.0 (mozilla/pdf.js)
annotation-text-widget.pdf      https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs/annotation-text-widget.pdf      Apache-2.0 (mozilla/pdf.js)
annotation-button-widget.pdf    https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs/annotation-button-widget.pdf    Apache-2.0 (mozilla/pdf.js)
annotation-choice-widget.pdf    https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs/annotation-choice-widget.pdf    Apache-2.0 (mozilla/pdf.js)
annotation-tx.pdf               https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs/annotation-tx.pdf               Apache-2.0 (mozilla/pdf.js)
annotation-tx2.pdf              https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs/annotation-tx2.pdf              Apache-2.0 (mozilla/pdf.js)
annotation-tx3.pdf              https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs/annotation-tx3.pdf              Apache-2.0 (mozilla/pdf.js)
```

- [ ] **Step 2: Write the failing test**

Create `crates/pdf-eval/src/validate/corpus.rs`:

```rust
//! Forms corpus manifest: parse `corpus-forms.lock` and determine which files are
//! not yet present locally. Fetching (feature `corpus-fetch`) lives at the bottom.

use std::path::Path;

/// One manifest line: a document to fetch and test.
#[derive(Debug, Clone, PartialEq)]
pub struct ManifestEntry {
    pub filename: String,
    pub url: String,
    pub license: String,
}

/// Parse a manifest. Blank lines and `#` comments are ignored. Each data line is
/// `filename  url  license`: the first two whitespace-delimited tokens are the
/// filename and URL; the license is the remainder of the line (it may contain
/// spaces).
pub fn parse_manifest(text: &str) -> Vec<ManifestEntry> {
    let mut entries = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut tokens = line.split_whitespace();
        let (Some(filename), Some(url)) = (tokens.next(), tokens.next()) else {
            continue;
        };
        entries.push(ManifestEntry {
            filename: filename.to_string(),
            url: url.to_string(),
            license: tokens.collect::<Vec<_>>().join(" "),
        });
    }
    entries
}

/// Manifest entries whose file is not present in `dir`.
pub fn missing_documents(entries: &[ManifestEntry], dir: &Path) -> Vec<ManifestEntry> {
    entries
        .iter()
        .filter(|e| !dir.join(&e.filename).exists())
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_data_lines_ignoring_comments() {
        let text = "# header\n\nfoo.pdf  https://x/foo.pdf  Apache-2.0 (a b)\n";
        let entries = parse_manifest(text);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].filename, "foo.pdf");
        assert_eq!(entries[0].url, "https://x/foo.pdf");
        assert_eq!(entries[0].license, "Apache-2.0 (a b)");
    }

    #[test]
    fn committed_manifest_parses() {
        let text = include_str!("../../corpus-forms.lock");
        let entries = parse_manifest(text);
        assert_eq!(entries.len(), 7);
        assert!(entries.iter().all(|e| e.url.starts_with("https://")));
    }
}
```

- [ ] **Step 3: Register the module**

In `crates/pdf-eval/src/validate/mod.rs` add:

```rust
pub mod corpus;
```

- [ ] **Step 4: Run the test**

Run: `cd crates && CARGO_BUILD_JOBS=1 RUSTFLAGS="-C debuginfo=0" cargo test -p pdf-eval validate::corpus`
Expected: PASS (2 tests).

- [ ] **Step 5: Stage for commit**

```bash
git add crates/pdf-eval/src/validate/corpus.rs crates/pdf-eval/src/validate/mod.rs crates/pdf-eval/corpus-forms.lock
# message: feat(pdf-eval): forms corpus manifest + parser
```

---

### Task 3: Corpus fetch (feature-gated) + gitignore

**Files:**

- Modify: `crates/pdf-eval/src/validate/corpus.rs` (append feature-gated fetch)
- Modify: `crates/pdf-eval/Cargo.toml` (optional reqwest + `corpus-fetch` feature)
- Modify: `crates/pdf-eval/src/main.rs` (add `corpus-fetch` dispatch arm)
- Modify: repo `.gitignore` (ignore `crates/pdf-eval/corpus-forms/`)

**Interfaces:**

- Consumes: `ManifestEntry`, `missing_documents` (Task 2).
- Produces: `#[cfg(feature = "corpus-fetch")] fn fetch_missing(entries: &[ManifestEntry], dir: &Path) -> std::io::Result<usize>` — downloads absent files into `dir`, returns count fetched.

- [ ] **Step 1: Add the optional dependency and feature**

In `crates/pdf-eval/Cargo.toml`:

```toml
[features]
pdfium = ["dep:pdfium-render", "dep:image-compare"]
corpus-fetch = ["dep:reqwest"]

[dependencies]
# ... existing ...
reqwest = { version = "0.12", default-features = false, features = [
  "rustls-tls",
  "blocking",
], optional = true }
```

- [ ] **Step 2: Append the fetch function**

At the end of `crates/pdf-eval/src/validate/corpus.rs` (outside the `tests` module), add:

```rust
/// Download every manifest entry missing from `dir` into `dir`, creating it if
/// needed. Returns how many files were fetched. Network code is compiled only
/// under the `corpus-fetch` feature so the default build pulls no HTTP stack.
#[cfg(feature = "corpus-fetch")]
pub fn fetch_missing(entries: &[ManifestEntry], dir: &Path) -> std::io::Result<usize> {
    std::fs::create_dir_all(dir)?;
    let client = reqwest::blocking::Client::builder()
        .user_agent("magna-carta-pdf-eval/validation")
        .build()
        .map_err(|e| std::io::Error::other(e.to_string()))?;
    let mut fetched = 0usize;
    for entry in missing_documents(entries, dir) {
        let body = client
            .get(&entry.url)
            .send()
            .and_then(|r| r.error_for_status())
            .and_then(|r| r.bytes())
            .map_err(|e| std::io::Error::other(format!("{}: {e}", entry.url)))?;
        std::fs::write(dir.join(&entry.filename), &body)?;
        fetched += 1;
    }
    Ok(fetched)
}
```

- [ ] **Step 3: Add the CLI arm**

In `crates/pdf-eval/src/main.rs`, in the `match args.next().as_deref()` block, add an arm alongside the existing modes:

```rust
        Some("corpus-fetch") => validate::corpus_fetch_mode(),
```

And in `crates/pdf-eval/src/validate/mod.rs` add:

```rust
/// Fetch any missing forms-corpus files into `corpus-forms/`. Requires the
/// `corpus-fetch` feature; without it, prints how to enable it.
pub fn corpus_fetch_mode() {
    let dir = std::path::Path::new("pdf-eval/corpus-forms");
    let manifest = include_str!("../../corpus-forms.lock");
    let entries = corpus::parse_manifest(manifest);
    #[cfg(feature = "corpus-fetch")]
    {
        match corpus::fetch_missing(&entries, dir) {
            Ok(n) => println!("fetched {n} file(s) into {}", dir.display()),
            Err(e) => {
                eprintln!("fetch failed: {e}");
                std::process::exit(1);
            }
        }
    }
    #[cfg(not(feature = "corpus-fetch"))]
    {
        let missing = corpus::missing_documents(&entries, dir);
        eprintln!(
            "corpus-fetch feature not enabled; {} file(s) missing. Re-run with:\n  cargo run -p pdf-eval --features corpus-fetch corpus-fetch",
            missing.len()
        );
        std::process::exit(2);
    }
}
```

- [ ] **Step 4: Gitignore the fetched corpus**

Append to the repo root `.gitignore` (or `crates/.gitignore`, matching where `corpus/` is already ignored — check with `git check-ignore crates/pdf-eval/corpus/`):

```
crates/pdf-eval/corpus-forms/
```

- [ ] **Step 5: Verify it compiles both ways, then fetch for real**

Run (default build, no HTTP stack):
`cd crates && CARGO_BUILD_JOBS=1 RUSTFLAGS="-C debuginfo=0" cargo build -p pdf-eval`
Expected: builds; `corpus-fetch` without the feature exits 2 with the hint.

Run (with feature) to materialize the corpus:
`cd crates && CARGO_BUILD_JOBS=1 RUSTFLAGS="-C debuginfo=0" cargo run -p pdf-eval --features corpus-fetch corpus-fetch`
Expected: `fetched 7 file(s) into pdf-eval/corpus-forms`. Verify `ls pdf-eval/corpus-forms` shows 7 PDFs and `git check-ignore crates/pdf-eval/corpus-forms/annotation-tx.pdf` prints the path (ignored).

- [ ] **Step 6: Stage for commit**

```bash
git add crates/pdf-eval/Cargo.toml crates/pdf-eval/src/validate/corpus.rs crates/pdf-eval/src/validate/mod.rs crates/pdf-eval/src/main.rs .gitignore
# message: feat(pdf-eval): feature-gated forms-corpus fetch (reqwest/rustls)
```

---

### Task 4: Forms operation plug-in

**Files:**

- Create: `crates/pdf-eval/src/validate/operations/mod.rs`
- Create: `crates/pdf-eval/src/validate/operations/forms.rs`
- Modify: `crates/pdf-eval/src/validate/mod.rs` (add `pub mod operations;`)

**Interfaces:**

- Consumes: `Outcome`, `Safety`, `OperationVerdict`, `ValidationOperation` (Task 1); `pdf_core::{read_form, fill_form, flatten_form, FieldKind, FieldValue, FormFillOptions, FormError, Document}`.
- Produces: `struct FormsOperation;` implementing `ValidationOperation` with `name() == "forms"`.

Behavior of `run`:

1. `read_form(bytes)` → `Err` ⇒ `Outcome::Error`. `Ok(fields)` with no text fields ⇒ `Outcome::Skipped{reason:"no fillable text field"}`.
2. Build `values: BTreeMap<String, FieldValue>` mapping each non-read-only `FieldKind::Text` field name → `FieldValue::Text("VALIDATION_PROBE".into())`.
3. `fill_form(bytes, &values, &FormFillOptions{flatten:false})` → `Err(NoAcroForm)` ⇒ `Skipped`; other `Err` ⇒ `Error`; `Ok(filled)` ⇒ continue.
4. Safety: `read_form(&filled)` and confirm every probed field now reads back `FieldValue::Text("VALIDATION_PROBE")`. Mismatch ⇒ `Safety::Violated`.
5. `flatten_form(bytes)` → `Err` ⇒ `Outcome::Error{detail:"flatten"}`; `Ok(flat)` must re-parse: `pdf_core::Document::load(flat)` `Err` ⇒ `Outcome::Error`.
6. All good ⇒ `Outcome::Success{variant:"filled+flattened"}`.

- [ ] **Step 1: Write the failing test**

Create `crates/pdf-eval/src/validate/operations/mod.rs`:

```rust
//! Validation-operation plug-ins. Phase 1 ships `forms`; render/redact/scrub/
//! detect/generate/secure/OCR land here on the same `ValidationOperation` trait.

pub mod forms;
```

Create `crates/pdf-eval/src/validate/operations/forms.rs`:

```rust
//! Forms validation: read the AcroForm, fill every text field with a probe value,
//! confirm the probe reads back from the output (the safety invariant), and flatten
//! to a document that re-parses. Documents without a fillable form are skipped.

use crate::validate::operation::{Outcome, OperationVerdict, Safety, ValidationOperation};
use pdf_core::{
    fill_form, flatten_form, read_form, Document, FieldKind, FieldValue, FormError,
    FormFillOptions,
};
use std::collections::BTreeMap;

const PROBE: &str = "VALIDATION_PROBE";

pub struct FormsOperation;

impl ValidationOperation for FormsOperation {
    fn name(&self) -> &str {
        "forms"
    }

    fn run(&self, bytes: &[u8]) -> OperationVerdict {
        let fields = match read_form(bytes) {
            Ok(f) => f,
            Err(e) => return err(format!("read_form: {e:?}")),
        };

        let probes: BTreeMap<String, FieldValue> = fields
            .iter()
            .filter(|f| f.kind == FieldKind::Text && !f.read_only)
            .map(|f| (f.name.clone(), FieldValue::Text(PROBE.to_string())))
            .collect();

        if probes.is_empty() {
            return OperationVerdict {
                outcome: Outcome::Skipped {
                    reason: "no fillable text field".into(),
                },
                safety: Safety::NotApplicable,
            };
        }

        let filled = match fill_form(bytes, &probes, &FormFillOptions { flatten: false }) {
            Ok(b) => b,
            Err(FormError::NoAcroForm) => {
                return OperationVerdict {
                    outcome: Outcome::Skipped {
                        reason: "no AcroForm".into(),
                    },
                    safety: Safety::NotApplicable,
                }
            }
            Err(e) => return err(format!("fill_form: {e:?}")),
        };

        // Safety: the probe must read back from the produced document.
        let safety = match read_form(&filled) {
            Ok(after) => {
                let ok = probes.keys().all(|name| {
                    after
                        .iter()
                        .find(|f| &f.name == name)
                        .map(|f| f.value == Some(FieldValue::Text(PROBE.to_string())))
                        .unwrap_or(false)
                });
                if ok {
                    Safety::Upheld
                } else {
                    Safety::Violated {
                        detail: "probe value did not read back after fill".into(),
                    }
                }
            }
            Err(e) => Safety::Violated {
                detail: format!("output unreadable: {e:?}"),
            },
        };

        // Flatten must produce a re-parseable document.
        match flatten_form(bytes) {
            Ok(flat) => {
                if Document::load(flat).is_err() {
                    return OperationVerdict {
                        outcome: Outcome::Error {
                            detail: "flattened output failed to re-parse".into(),
                        },
                        safety,
                    };
                }
            }
            Err(e) => {
                return OperationVerdict {
                    outcome: Outcome::Error {
                        detail: format!("flatten_form: {e:?}"),
                    },
                    safety,
                }
            }
        }

        OperationVerdict {
            outcome: Outcome::Success {
                variant: "filled+flattened".into(),
            },
            safety,
        }
    }
}

fn err(detail: String) -> OperationVerdict {
    OperationVerdict {
        outcome: Outcome::Error { detail },
        safety: Safety::NotApplicable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn acroform_document_fills_flattens_and_upholds_safety() {
        // gov_irs_w9 is a real AcroForm committed for CI.
        let bytes = include_bytes!("../../../corpus-ci/gov_irs_w9_acroform.pdf").to_vec();
        let verdict = FormsOperation.run(&bytes);
        assert!(
            matches!(verdict.outcome, Outcome::Success { .. }),
            "expected Success, got {:?}",
            verdict.outcome
        );
        assert_eq!(verdict.safety, Safety::Upheld);
    }

    #[test]
    fn non_form_document_is_skipped() {
        // basicapi has no AcroForm.
        let bytes = include_bytes!("../../../corpus-ci/basicapi.pdf").to_vec();
        let verdict = FormsOperation.run(&bytes);
        assert!(
            matches!(verdict.outcome, Outcome::Skipped { .. }),
            "expected Skipped, got {:?}",
            verdict.outcome
        );
    }
}
```

- [ ] **Step 2: Register the module**

In `crates/pdf-eval/src/validate/mod.rs` add:

```rust
pub mod operations;
```

- [ ] **Step 3: Confirm the include paths and pdf-core exports**

Verify the fixture paths resolve from `operations/forms.rs`: `../../../corpus-ci/` points at `crates/pdf-eval/corpus-ci/`. Confirm `pdf_core` re-exports `read_form, fill_form, flatten_form, FieldKind, FieldValue, FormFillOptions, FormError` (they are `pub use forms::*` targets) and `Document` (crate root). If `Document::load` is not the correct constructor name, use the one shown in `crates/pdf-core/src/lib.rs` (`Document::load(bytes: Vec<u8>) -> Result<Self, PdfError>`).

- [ ] **Step 4: Run the tests**

Run: `cd crates && CARGO_BUILD_JOBS=1 CARGO_PROFILE_TEST_DEBUG=0 RUSTFLAGS="-C debuginfo=0" cargo test -p pdf-eval validate::operations::forms`
Expected: PASS (2 tests). First run compiles hayro/vello via pdf-core — allow several minutes.

- [ ] **Step 5: Stage for commit**

```bash
git add crates/pdf-eval/src/validate/operations/ crates/pdf-eval/src/validate/mod.rs
# message: feat(pdf-eval): forms validation operation (fill round-trip + flatten)
```

---

### Task 5: Runner — panic and timeout isolation

**Files:**

- Create: `crates/pdf-eval/src/validate/runner.rs`
- Create: `crates/pdf-eval/src/validate/report.rs` (only the `DocumentReport` struct in this task; the summary/diff come in Tasks 6–7)
- Modify: `crates/pdf-eval/src/validate/mod.rs` (add `pub mod runner;`, `pub mod report;`)

**Interfaces:**

- Consumes: `ValidationOperation`, `Outcome`, `Safety` (Task 1).
- Produces:
  - `struct DocumentReport { document: String, operation: String, outcome: Outcome, safety: Safety }` (derives `Debug, Clone, serde::Serialize`) in `report.rs`.
  - `fn run_document(operation: Arc<dyn ValidationOperation>, document: String, bytes: Vec<u8>, timeout: Duration) -> DocumentReport` in `runner.rs`.

- [ ] **Step 1: Add the DocumentReport type**

Create `crates/pdf-eval/src/validate/report.rs`:

```rust
//! Per-document records and (Tasks 6–7) their aggregation into a summary plus a
//! regression diff against a committed baseline.

use crate::validate::operation::{Outcome, Safety};
use serde::Serialize;

/// One operation's verdict on one document, as written to the JSONL report.
#[derive(Debug, Clone, Serialize)]
pub struct DocumentReport {
    pub document: String,
    pub operation: String,
    pub outcome: Outcome,
    pub safety: Safety,
}
```

- [ ] **Step 2: Write the failing test**

Create `crates/pdf-eval/src/validate/runner.rs`:

```rust
//! Executes one operation on one document under panic-catching and a wall-clock
//! timeout, so a bad document yields a `Panicked`/`TimedOut` record instead of
//! taking the harness down. A timed-out worker thread is abandoned (Rust threads
//! are not killable); acceptable for a batch tool. Process isolation is a future
//! hardening if hostile hangs become common.

use crate::validate::operation::{Outcome, Safety, ValidationOperation};
use crate::validate::report::DocumentReport;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::Duration;

pub fn run_document(
    operation: Arc<dyn ValidationOperation>,
    document: String,
    bytes: Vec<u8>,
    timeout: Duration,
) -> DocumentReport {
    let name = operation.name().to_string();
    let (sender, receiver) = mpsc::channel();
    let worker = operation.clone();
    std::thread::spawn(move || {
        let verdict = catch_unwind(AssertUnwindSafe(|| worker.run(&bytes)));
        let _ = sender.send(verdict);
    });

    let (outcome, safety) = match receiver.recv_timeout(timeout) {
        Ok(Ok(verdict)) => (verdict.outcome, verdict.safety),
        Ok(Err(payload)) => (
            Outcome::Panicked {
                detail: panic_detail(payload.as_ref()),
            },
            Safety::NotApplicable,
        ),
        Err(_) => (Outcome::TimedOut, Safety::NotApplicable),
    };

    DocumentReport {
        document,
        operation: name,
        outcome,
        safety,
    }
}

fn panic_detail(payload: &(dyn std::any::Any + Send)) -> String {
    if let Some(s) = payload.downcast_ref::<&str>() {
        (*s).to_string()
    } else if let Some(s) = payload.downcast_ref::<String>() {
        s.clone()
    } else {
        "non-string panic payload".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::validate::operation::OperationVerdict;

    struct Panicker;
    impl ValidationOperation for Panicker {
        fn name(&self) -> &str {
            "panicker"
        }
        fn run(&self, _bytes: &[u8]) -> OperationVerdict {
            panic!("boom");
        }
    }

    struct Sleeper;
    impl ValidationOperation for Sleeper {
        fn name(&self) -> &str {
            "sleeper"
        }
        fn run(&self, _bytes: &[u8]) -> OperationVerdict {
            std::thread::sleep(Duration::from_secs(10));
            unreachable!()
        }
    }

    struct Ok;
    impl ValidationOperation for Ok {
        fn name(&self) -> &str {
            "ok"
        }
        fn run(&self, _bytes: &[u8]) -> OperationVerdict {
            OperationVerdict {
                outcome: Outcome::Success {
                    variant: "x".into(),
                },
                safety: Safety::Upheld,
            }
        }
    }

    #[test]
    fn captures_panic_as_panicked() {
        let r = run_document(Arc::new(Panicker), "d".into(), vec![], Duration::from_secs(5));
        assert!(matches!(r.outcome, Outcome::Panicked { .. }));
    }

    #[test]
    fn captures_timeout() {
        let r = run_document(Arc::new(Sleeper), "d".into(), vec![], Duration::from_millis(100));
        assert_eq!(r.outcome, Outcome::TimedOut);
    }

    #[test]
    fn passes_through_success() {
        let r = run_document(Arc::new(Ok), "d".into(), vec![], Duration::from_secs(5));
        assert!(matches!(r.outcome, Outcome::Success { .. }));
        assert_eq!(r.safety, Safety::Upheld);
    }
}
```

- [ ] **Step 3: Register the modules**

In `crates/pdf-eval/src/validate/mod.rs` add:

```rust
pub mod report;
pub mod runner;
```

- [ ] **Step 4: Run the tests**

Run: `cd crates && CARGO_BUILD_JOBS=1 RUSTFLAGS="-C debuginfo=0" cargo test -p pdf-eval validate::runner`
Expected: PASS (3 tests).

- [ ] **Step 5: Stage for commit**

```bash
git add crates/pdf-eval/src/validate/runner.rs crates/pdf-eval/src/validate/report.rs crates/pdf-eval/src/validate/mod.rs
# message: feat(pdf-eval): runner with panic + timeout isolation
```

---

### Task 6: Summary aggregation + JSONL

**Files:**

- Modify: `crates/pdf-eval/src/validate/report.rs`

**Interfaces:**

- Consumes: `DocumentReport` (Task 5), `Outcome`, `Safety`.
- Produces:
  - `struct Summary { total: usize, outcomes: BTreeMap<String,usize>, fallback_reasons: BTreeMap<String,usize>, panicked: Vec<String>, timed_out: Vec<String>, safety_violations: Vec<String> }` (derives `Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize`).
  - `fn summarize(reports: &[DocumentReport]) -> Summary`.
  - `fn write_jsonl(reports: &[DocumentReport], path: &std::path::Path) -> std::io::Result<()>`.

- [ ] **Step 1: Write the failing test (append to report.rs)**

Add to `crates/pdf-eval/src/validate/report.rs`:

```rust
use serde::Deserialize;
use std::collections::BTreeMap;
use std::io::Write;
use std::path::Path;

/// Aggregate view of a run. `outcomes` counts each outcome kind; `fallback_reasons`
/// histograms the reasons; the three lists name the documents that hit a robustness
/// or safety defect (each must stay empty).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Summary {
    pub total: usize,
    pub outcomes: BTreeMap<String, usize>,
    pub fallback_reasons: BTreeMap<String, usize>,
    pub panicked: Vec<String>,
    pub timed_out: Vec<String>,
    pub safety_violations: Vec<String>,
}

pub fn summarize(reports: &[DocumentReport]) -> Summary {
    let mut outcomes: BTreeMap<String, usize> = BTreeMap::new();
    let mut fallback_reasons: BTreeMap<String, usize> = BTreeMap::new();
    let mut panicked = Vec::new();
    let mut timed_out = Vec::new();
    let mut safety_violations = Vec::new();

    for r in reports {
        let kind = match &r.outcome {
            Outcome::Success { .. } => "success",
            Outcome::Fallback { reason } => {
                *fallback_reasons.entry(reason.clone()).or_default() += 1;
                "fallback"
            }
            Outcome::Skipped { .. } => "skipped",
            Outcome::Error { .. } => "error",
            Outcome::Panicked { .. } => {
                panicked.push(r.document.clone());
                "panicked"
            }
            Outcome::TimedOut => {
                timed_out.push(r.document.clone());
                "timed_out"
            }
        };
        *outcomes.entry(kind.to_string()).or_default() += 1;
        if let Safety::Violated { .. } = r.safety {
            safety_violations.push(r.document.clone());
        }
    }

    Summary {
        total: reports.len(),
        outcomes,
        fallback_reasons,
        panicked,
        timed_out,
        safety_violations,
    }
}

/// Write one JSON object per report, one per line.
pub fn write_jsonl(reports: &[DocumentReport], path: &Path) -> std::io::Result<()> {
    let mut file = std::fs::File::create(path)?;
    for r in reports {
        let line = serde_json::to_string(r).map_err(|e| std::io::Error::other(e.to_string()))?;
        writeln!(file, "{line}")?;
    }
    Ok(())
}

#[cfg(test)]
mod summary_tests {
    use super::*;

    fn report(document: &str, outcome: Outcome, safety: Safety) -> DocumentReport {
        DocumentReport {
            document: document.into(),
            operation: "forms".into(),
            outcome,
            safety,
        }
    }

    #[test]
    fn counts_outcomes_and_collects_defects() {
        let reports = vec![
            report("a", Outcome::Success { variant: "x".into() }, Safety::Upheld),
            report("b", Outcome::Skipped { reason: "no form".into() }, Safety::NotApplicable),
            report("c", Outcome::Panicked { detail: "boom".into() }, Safety::NotApplicable),
            report("d", Outcome::Success { variant: "x".into() }, Safety::Violated { detail: "leak".into() }),
        ];
        let s = summarize(&reports);
        assert_eq!(s.total, 4);
        assert_eq!(s.outcomes.get("success"), Some(&2));
        assert_eq!(s.outcomes.get("skipped"), Some(&1));
        assert_eq!(s.panicked, vec!["c".to_string()]);
        assert_eq!(s.safety_violations, vec!["d".to_string()]);
    }
}
```

- [ ] **Step 2: Run the test**

Run: `cd crates && CARGO_BUILD_JOBS=1 RUSTFLAGS="-C debuginfo=0" cargo test -p pdf-eval validate::report`
Expected: PASS (all report tests).

- [ ] **Step 3: Stage for commit**

```bash
git add crates/pdf-eval/src/validate/report.rs
# message: feat(pdf-eval): run summary + JSONL report writer
```

---

### Task 7: Regression baseline + diff

**Files:**

- Modify: `crates/pdf-eval/src/validate/report.rs` (append diff)
- Create: `crates/pdf-eval/validation-baseline.json` (created from a real run in Task 8; a placeholder-free stub is committed here and refreshed)

**Interfaces:**

- Consumes: `Summary` (Task 6).
- Produces:
  - `struct Regression { kind: String, detail: String }`
  - `fn diff_baseline(current: &Summary, baseline: &Summary) -> Vec<Regression>` — reports: any name in `current.panicked`/`timed_out`/`safety_violations` not in the baseline's; and any drop in `outcomes["success"]` below baseline.

- [ ] **Step 1: Write the failing test (append to report.rs)**

Add to `crates/pdf-eval/src/validate/report.rs`:

```rust
/// A single regression versus the baseline.
#[derive(Debug, Clone, PartialEq)]
pub struct Regression {
    pub kind: String,
    pub detail: String,
}

/// Compare a run against the baseline. New panics, new timeouts, new safety
/// violations, and a drop in successes are regressions.
pub fn diff_baseline(current: &Summary, baseline: &Summary) -> Vec<Regression> {
    let mut out = Vec::new();
    let new_names = |cur: &[String], base: &[String]| -> Vec<String> {
        cur.iter().filter(|n| !base.contains(n)).cloned().collect()
    };
    for n in new_names(&current.panicked, &baseline.panicked) {
        out.push(Regression { kind: "new_panic".into(), detail: n });
    }
    for n in new_names(&current.timed_out, &baseline.timed_out) {
        out.push(Regression { kind: "new_timeout".into(), detail: n });
    }
    for n in new_names(&current.safety_violations, &baseline.safety_violations) {
        out.push(Regression { kind: "new_safety_violation".into(), detail: n });
    }
    let cur_success = current.outcomes.get("success").copied().unwrap_or(0);
    let base_success = baseline.outcomes.get("success").copied().unwrap_or(0);
    if cur_success < base_success {
        out.push(Regression {
            kind: "coverage_drop".into(),
            detail: format!("success {cur_success} < baseline {base_success}"),
        });
    }
    out
}

#[cfg(test)]
mod diff_tests {
    use super::*;

    fn base() -> Summary {
        Summary {
            total: 2,
            outcomes: BTreeMap::from([("success".to_string(), 2)]),
            fallback_reasons: BTreeMap::new(),
            panicked: vec![],
            timed_out: vec![],
            safety_violations: vec![],
        }
    }

    #[test]
    fn clean_run_matches_baseline() {
        assert!(diff_baseline(&base(), &base()).is_empty());
    }

    #[test]
    fn new_panic_and_coverage_drop_are_regressions() {
        let mut cur = base();
        cur.outcomes.insert("success".into(), 1);
        cur.panicked.push("evil.pdf".into());
        let regs = diff_baseline(&cur, &base());
        assert!(regs.iter().any(|r| r.kind == "new_panic" && r.detail == "evil.pdf"));
        assert!(regs.iter().any(|r| r.kind == "coverage_drop"));
    }
}
```

- [ ] **Step 2: Run the test**

Run: `cd crates && CARGO_BUILD_JOBS=1 RUSTFLAGS="-C debuginfo=0" cargo test -p pdf-eval validate::report`
Expected: PASS (diff tests included).

- [ ] **Step 3: Stage for commit**

```bash
git add crates/pdf-eval/src/validate/report.rs
# message: feat(pdf-eval): baseline regression diff
```

---

### Task 8: `validate` mode — wire corpus → runner → report → baseline

**Files:**

- Modify: `crates/pdf-eval/src/validate/mod.rs` (add `validate_mode`)
- Modify: `crates/pdf-eval/src/main.rs` (dispatch `validate`)
- Create: `crates/pdf-eval/validation-baseline.json` (generated, then committed)

**Interfaces:**

- Consumes: everything above.
- Produces: `pub fn validate_mode(dir: String)` and the `validate` CLI arm.

- [ ] **Step 1: Implement `validate_mode`**

In `crates/pdf-eval/src/validate/mod.rs` add:

```rust
use crate::validate::operations::forms::FormsOperation;
use crate::validate::report::{diff_baseline, summarize, write_jsonl, DocumentReport, Summary};
use crate::validate::runner::run_document;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

/// Run every phase-1 operation over each PDF in `dir`, write a JSONL report, print a
/// summary, and diff against the committed baseline. Exit code 1 on any regression.
pub fn validate_mode(dir: String) {
    let operations: Vec<Arc<dyn operation::ValidationOperation>> = vec![Arc::new(FormsOperation)];
    let timeout = Duration::from_secs(10);

    let mut reports: Vec<DocumentReport> = Vec::new();
    let mut documents: Vec<std::path::PathBuf> = std::fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("read corpus dir {dir}: {e}"))
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.extension().map(|extension| extension == "pdf").unwrap_or(false))
        .collect();
    documents.sort();

    for path in &documents {
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        let bytes = match std::fs::read(path) {
            Ok(bytes) => bytes,
            Err(e) => {
                eprintln!("skip {name}: read error {e}");
                continue;
            }
        };
        for operation in &operations {
            let report = run_document(operation.clone(), name.clone(), bytes.clone(), timeout);
            println!(
                "{:<10} {:<34} {:?}",
                report.operation, report.document, report.outcome
            );
            reports.push(report);
        }
    }

    let summary = summarize(&reports);
    let report_path = Path::new("pdf-eval/validation-report.jsonl");
    if let Err(e) = write_jsonl(&reports, report_path) {
        eprintln!("warning: could not write {}: {e}", report_path.display());
    }
    println!(
        "\nSUMMARY: {} documents; outcomes {:?}; panicked {}; timed_out {}; safety_violations {}",
        summary.total,
        summary.outcomes,
        summary.panicked.len(),
        summary.timed_out.len(),
        summary.safety_violations.len()
    );

    let baseline_text = include_str!("../../validation-baseline.json");
    let baseline: Summary =
        serde_json::from_str(baseline_text).expect("validation-baseline.json is valid");
    let regressions = diff_baseline(&summary, &baseline);
    if regressions.is_empty() {
        println!("no regressions versus baseline");
    } else {
        eprintln!("REGRESSIONS ({}):", regressions.len());
        for r in &regressions {
            eprintln!("  {} : {}", r.kind, r.detail);
        }
        std::process::exit(1);
    }
}
```

- [ ] **Step 2: Add the CLI arm**

In `crates/pdf-eval/src/main.rs`, add to the `match`:

```rust
        Some("validate") => validate::validate_mode(args.next().expect("usage: validate <corpus_dir>")),
```

- [ ] **Step 3: Seed a temporary baseline so it compiles**

Create `crates/pdf-eval/validation-baseline.json` with an empty-but-valid summary (refreshed in Step 5):

```json
{
  "total": 0,
  "outcomes": {},
  "fallback_reasons": {},
  "panicked": [],
  "timed_out": [],
  "safety_violations": []
}
```

- [ ] **Step 4: Build and run against the fetched corpus**

Run: `cd crates && CARGO_BUILD_JOBS=1 CARGO_PROFILE_DEV_DEBUG=0 RUSTFLAGS="-C debuginfo=0" cargo run -p pdf-eval validate pdf-eval/corpus-forms`
Expected: seven per-document lines (each `forms <file> Success{…}` or `Skipped{…}`), a SUMMARY line, and — because the seed baseline has `success: 0` — either "no regressions" (if no successes drop below 0, which cannot happen) or a report. Confirm **zero** `panicked`/`timed_out`/`safety_violations`. If any document panics or violates safety, that is a real engine bug: stop and file it, do not paper over the baseline.

- [ ] **Step 5: Freeze the real baseline**

Copy the printed summary into `crates/pdf-eval/validation-baseline.json` (the harness prints `summary.outcomes` etc.; encode the same values as the JSON `Summary` shape). Re-run Step 4; expected: `no regressions versus baseline`, exit 0.

- [ ] **Step 6: Add a smoke test over the committed CI corpus**

Append to `crates/pdf-eval/src/validate/mod.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::operations::forms::FormsOperation;
    use super::operation::{Outcome, ValidationOperation};

    #[test]
    fn forms_operation_never_panics_on_ci_corpus() {
        // The committed CI corpus must run clean through the forms operation.
        for bytes in [
            include_bytes!("../../corpus-ci/gov_irs_w9_acroform.pdf").as_slice(),
            include_bytes!("../../corpus-ci/basicapi.pdf").as_slice(),
            include_bytes!("../../corpus-ci/pdfjs_franz_image.pdf").as_slice(),
        ] {
            let verdict = FormsOperation.run(bytes);
            assert!(
                !matches!(verdict.outcome, Outcome::Panicked { .. } | Outcome::TimedOut),
                "forms operation must not panic/timeout: {:?}",
                verdict.outcome
            );
        }
    }
}
```

Run: `cd crates && CARGO_BUILD_JOBS=1 RUSTFLAGS="-C debuginfo=0" cargo test -p pdf-eval validate::tests`
Expected: PASS.

- [ ] **Step 7: Full gate**

Run: `cd crates && CARGO_BUILD_JOBS=1 CARGO_PROFILE_TEST_DEBUG=0 RUSTFLAGS="-C debuginfo=0" cargo test -p pdf-eval` then `cargo clippy -p pdf-eval`.
Expected: all tests pass; clippy clean. Confirm `cargo fmt -p pdf-eval -- --check` flags nothing in the new `validate/` files (ignore pre-existing rustfmt-version-drift diffs elsewhere).

- [ ] **Step 8: Stage for commit**

```bash
git add crates/pdf-eval/src/validate/mod.rs crates/pdf-eval/src/main.rs crates/pdf-eval/validation-baseline.json
# message: feat(pdf-eval): validate mode over forms corpus with baseline gate
```

---

## Documentation (fold into the final task's commit)

- Add a short `## Validation harness` section to `crates/pdf-eval/README.md` (create if absent): what `validate` and `corpus-fetch` do, the two commands, and that `corpus-forms/` is gitignored and regenerated from `corpus-forms.lock`.
- No user-facing (`docs/user/`) change — this is developer tooling.
- No `CHANGELOG.md`/ADR fragment is required for an internal dev harness unless the owner wants one; if so, add `changelog.d/pdf-eval-validation-harness.md` (category `Added`).

## Self-review notes (author checklist — completed)

- **Spec coverage:** corpus manifest + fetch (Tasks 2–3), `ValidationOperation` (Task 1), forms operation with self-contained safety check (Task 4), runner catch_unwind+timeout (Task 5), reporting (Task 6), regression baseline (Tasks 7–8). Fallback-reason enum, redaction/render/other operations, broader corpus, and the Worker tier are explicitly phase 2+ and out of this plan.
- **Type consistency:** `Outcome`/`Safety`/`OperationVerdict`/`ValidationOperation` defined in Task 1 are consumed unchanged in Tasks 4–8; `DocumentReport` (Task 5) feeds `summarize`/`write_jsonl` (Task 6) and `diff_baseline` (Task 7); `Summary` shape matches `validation-baseline.json`.
- **Placeholder scan:** the only intentional interim is the seed baseline in Task 8 Step 3, replaced by a real one in Step 5. The `parse_manifest` scaffolding in Task 2 Step 2 is explicitly replaced by the final function shown in the same step.
