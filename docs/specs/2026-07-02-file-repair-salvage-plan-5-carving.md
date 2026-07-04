# File Repair & Salvage — Plan 5: Carving fallback pillar

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The universal fallback — a format-agnostic `carve(bytes)` that extracts recognizable embedded files (JPEG/PNG/GIF/PDF/ZIP) from any blob by scanning a header/footer signature table, validating each candidate, and returning them as multiple output files with an honest, never-complete loss manifest.

**Architecture:** Pure-Rust module `recovery-core/src/carve.rs` (algorithm) + `recovery-core/src/carve/signatures.rs` (a standalone signature-table data module, structured for later extraction into a shared `engine_host::signatures`). An `aho-corasick` automaton finds candidate headers in one pass; per candidate the extent is bounded by the type's footer (or a size cap); images are validated by a `zune-jpeg`/`zune-png` header decode, others structurally. Carving is a SEPARATE entry point, not in the `detect()`-keyed repair/diagnose dispatch. This plan first refactors `RepairResult` to carry multiple output files (every pillar returns one-or-more `SalvagedFile`), which carving needs and Plan 6's attach-to-matter consumes.

**Tech Stack:** Rust, `aho-corasick` 1, `zune-jpeg` 0.5, `zune-png` (pure-Rust), Plan-1 `recovery-core` types, the shared `crate::limits` caps.

## Global Constraints

- I/O-free engine (bytes in as `&[u8]`, result out); pure-Rust features only. `aho-corasick`, `zune-jpeg`, `zune-png` are all pure Rust — the pillar rides the WASM default lane and the container lane alike.
- Consumes Plan-1 types: `crate::model::{RepairResult, LossManifest, RecoveredItem, DiagnosisReport, CorruptionKind, Recoverability}`, `crate::error::RepairError`. Carving is format-agnostic — it does NOT use `engine_host::format::detect`.
- **Never overclaim:** `fully_recovered` is ALWAYS `false` for a carve (carving cannot certify it found every embedded file). `synthesized` is ALWAYS empty (every output is a verbatim byte range — nothing fabricated). Each fragment's `RecoveredItem.recovered` reflects its validation level; `detail` is a FIXED literal stating that level / any truncation, never file content.
- **Decompression/size discipline:** reuse `crate::limits` — `MAX_ENTRY_COUNT` bounds the number of carved fragments; per-fragment and total byte caps bound extraction. Image validation uses header-only decode (`decode_headers`), never a full pixel decode, so a giant carved image cannot become a decode bomb.
- **Log-safety:** `SalvagedFile.name` (e.g. `"0001.jpg"`) and every `RecoveredItem.detail` are structural/fixed, never file content; only `RepairError::code()` is log-safe.
- No process-doc citations in source (no "golden rule N"/ADR/spec § / "Plan N"). Full names, no shorthand.
- Verify crate APIs against the vendored source before use (golden rule 11). Facts below verified against `aho-corasick` 1.1.4 and `zune-jpeg` 0.5.15; confirm `zune-png`'s parallel API when adding it.

## Reusability (decided in the design)

Build carving self-contained in `recovery-core`; do NOT share into `engine-host` yet (single consumer today; the program promotes on a second consumer). The signature table is the deliberate reuse seam — keep it a clean, dependency-free data module (`carve/signatures.rs`) that lifts verbatim into a future `engine_host::signatures`. Design home: `docs/specs/2026-07-02-file-repair-salvage-plan-5-carving-design.md`.

---

### Task 1: Refactor `RepairResult` to carry multiple output files

**Files:**
- Modify: `crates/recovery-core/src/model.rs` (add `SalvagedFile`; change `RepairResult`)
- Modify: `crates/recovery-core/src/zip_repair.rs` (wrap output; fix test reads)
- Modify: `crates/recovery-core/src/cfb_repair.rs` (wrap output; fix test reads)
- Modify: `crates/recovery-core/src/pdf_repair.rs` (wrap output; fix test reads)

**Interfaces:**
- Produces:
  - `pub struct SalvagedFile { pub name: String, pub bytes: Vec<u8>, pub media_type: Option<String> }` (derives `Debug, Clone`)
  - `pub struct RepairResult { pub files: Vec<SalvagedFile>, pub loss: LossManifest }` (replaces the `salvaged: Vec<u8>` field; still no `PartialEq`)
- The three format pillars each return exactly one `SalvagedFile`; carving (later tasks) returns N.

- [ ] **Step 1: Change the model** — in `crates/recovery-core/src/model.rs`, replace the `RepairResult` struct and add `SalvagedFile` above it:

```rust
/// One output file a repair/carve produced. `media_type` is the detected MIME
/// where known (None when unknown). `name` is a sensible default the worker may
/// override from the original upload (a carve names fragments by index).
#[derive(Debug, Clone)]
pub struct SalvagedFile {
    pub name: String,
    pub bytes: Vec<u8>,
    pub media_type: Option<String>,
}

/// The product of a repair or carve: one-or-more recovered files plus the honest
/// loss manifest. Format pillars return exactly one file; carving returns many.
#[derive(Debug, Clone)]
pub struct RepairResult {
    pub files: Vec<SalvagedFile>,
    pub loss: LossManifest,
}
```

- [ ] **Step 2: Update `zip_repair.rs`** — find where `repair_zip` constructs its `RepairResult` (a struct literal with a `salvaged:` field and a `loss:` field). Move the value currently assigned to `salvaged` into a `SalvagedFile`, replacing the `salvaged:` field with a `files:` field:

```rust
    // was: RepairResult { salvaged: <VALUE>, loss: <LOSS> }
    Ok(RepairResult {
        files: vec![crate::model::SalvagedFile {
            name: "repaired.zip".to_string(),
            bytes: <VALUE>,                       // the exact expression previously assigned to `salvaged`
            media_type: Some("application/zip".to_string()),
        }],
        loss: <LOSS>,                             // unchanged
    })
```

Then in `zip_repair.rs` tests, change the read at the round-trip assertion from `Cursor::new(result.salvaged...)` to `Cursor::new(result.files[0].bytes.clone())` (there is one such site).

- [ ] **Step 3: Update `cfb_repair.rs`** — in `build_result`, replace `RepairResult { salvaged: bytes_out, loss: ... }` with:

```rust
    Ok(RepairResult {
        files: vec![crate::model::SalvagedFile {
            name: "repaired".to_string(),
            bytes: bytes_out,
            media_type: Some("application/x-ole-storage".to_string()),
        }],
        loss: LossManifest { items, fully_recovered, synthesized: Vec::new() },
    })
```

Then in `cfb_repair.rs` tests, change the three `Cursor::new(result.salvaged...)` reads to `Cursor::new(result.files[0].bytes.clone())`.

- [ ] **Step 4: Update `pdf_repair.rs`** — in `repair_pdf`, replace `RepairResult { salvaged, loss: ... }` with:

```rust
    Ok(RepairResult {
        files: vec![crate::model::SalvagedFile {
            name: "repaired.pdf".to_string(),
            bytes: salvaged,
            media_type: Some("application/pdf".to_string()),
        }],
        loss: LossManifest { items, fully_recovered, synthesized },
    })
```

Then in `pdf_repair.rs` tests, change the `Document::load_mem(&result.salvaged)` read to `Document::load_mem(&result.files[0].bytes)`.

- [ ] **Step 5: Run the crate gate** — Run:
  - `cargo test --manifest-path crates/Cargo.toml -p recovery-core` — ALL pass (61, unchanged count; the refactor preserves behavior).
  - `cargo fmt --manifest-path crates/Cargo.toml -p recovery-core` then `-- --check` (stage what it touches).
  - `cargo clippy --manifest-path crates/Cargo.toml -p recovery-core --all-targets -- -D warnings`.
  Expected: all pass. If a `result.salvaged` reference remains, the compiler names it — fix each to `result.files[0].bytes`.

- [ ] **Step 6: Commit**

```bash
git add crates/recovery-core/src/model.rs crates/recovery-core/src/zip_repair.rs crates/recovery-core/src/cfb_repair.rs crates/recovery-core/src/pdf_repair.rs
git commit -m "refactor(recovery-core): RepairResult carries multiple SalvagedFiles"
```

---

### Task 2: Add carving dependencies + the signature-table data module

**Files:**
- Modify: `crates/recovery-core/Cargo.toml` (add `aho-corasick`, `zune-jpeg`, `zune-png`)
- Create: `crates/recovery-core/src/carve.rs` (module root; declares `mod signatures;`)
- Create: `crates/recovery-core/src/carve/signatures.rs` (the standalone data table)
- Modify: `crates/recovery-core/src/lib.rs` (declare `pub mod carve;`)

**Interfaces:**
- Produces:
  - `pub struct Signature { pub media_type: &'static str, pub extension: &'static str, pub header: &'static [u8], pub footer: Option<&'static [u8]>, pub max_len: usize, pub image: bool }`
  - `pub const SIGNATURES: &[Signature]` (JPEG, PNG, GIF, PDF, ZIP)

- [ ] **Step 1: Add dependencies** to `crates/recovery-core/Cargo.toml` under `[dependencies]` (after `lopdf`):

```toml
# Single-pass multi-pattern search for embedded-file header signatures (carving scan). Pure Rust.
aho-corasick = "1"
# Best-effort image header validation for carved candidates (confirm a signature match is a real
# image without a full pixel decode). Pure Rust; zune-jpeg is already in the tree transitively.
zune-jpeg = "0.5"
zune-png = "0.4"
```

- [ ] **Step 2: Create the signature table** `crates/recovery-core/src/carve/signatures.rs`:

```rust
//! The carving signature table: header/footer magic + extraction bounds per file
//! type. A standalone, dependency-free data module — kept separable so it can be
//! lifted into a shared home once a second consumer (e.g. discovery extraction)
//! needs it. `header` anchors a candidate; `footer` (when present) delimits its
//! end; `max_len` bounds a candidate whose footer is missing or far away.

/// One carvable file type: how to recognize its start and end, and its bounds.
pub struct Signature {
    pub media_type: &'static str,
    pub extension: &'static str,
    /// The leading magic bytes that anchor a candidate.
    pub header: &'static [u8],
    /// The trailing bytes that delimit the end (inclusive), if the type has a
    /// reliable terminator. `None` means bound by `max_len` / the next candidate.
    pub footer: Option<&'static [u8]>,
    /// Maximum bytes to extract for one candidate (bounds a missing footer).
    pub max_len: usize,
    /// Whether a decode-based validation applies (images).
    pub image: bool,
}

/// The v1 carvable types. Each has a recognizable header; JPEG/PNG/GIF/PDF/ZIP
/// also have a terminator so the extent is well-defined.
pub const SIGNATURES: &[Signature] = &[
    Signature {
        media_type: "image/jpeg",
        extension: "jpg",
        header: &[0xFF, 0xD8, 0xFF],
        footer: Some(&[0xFF, 0xD9]),
        max_len: 64 * 1024 * 1024,
        image: true,
    },
    Signature {
        media_type: "image/png",
        extension: "png",
        header: &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A],
        // PNG ends with the IEND chunk: length(0) + "IEND" + CRC.
        footer: Some(&[0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82]),
        max_len: 64 * 1024 * 1024,
        image: true,
    },
    Signature {
        media_type: "image/gif",
        extension: "gif",
        header: b"GIF8",
        footer: Some(&[0x3B]),
        max_len: 32 * 1024 * 1024,
        image: false,
    },
    Signature {
        media_type: "application/pdf",
        extension: "pdf",
        header: b"%PDF-",
        footer: Some(b"%%EOF"),
        max_len: 256 * 1024 * 1024,
        image: false,
    },
    Signature {
        media_type: "application/zip",
        extension: "zip",
        header: &[b'P', b'K', 0x03, 0x04],
        // ZIP's end-of-central-directory record signature.
        footer: Some(&[b'P', b'K', 0x05, 0x06]),
        max_len: 256 * 1024 * 1024,
        image: false,
    },
];
```

- [ ] **Step 3: Create the module root** `crates/recovery-core/src/carve.rs`:

```rust
//! The carving fallback pillar: format-agnostic extraction of embedded known-type
//! files from any blob. Scans a header/footer signature table, bounds each
//! candidate, validates it, and returns the found files with an honest,
//! never-complete loss manifest. A separate entry point — NOT part of the
//! detect()-keyed repair/diagnose dispatch.

mod signatures;

pub use signatures::{Signature, SIGNATURES};
```

- [ ] **Step 4: Declare the module** in `crates/recovery-core/src/lib.rs` (alphabetical — after `cfb_repair`, before `diagnose`):

```rust
pub mod carve;
```

- [ ] **Step 5: Verify it builds on both targets** — Run:
  - `cargo build --manifest-path crates/Cargo.toml -p recovery-core`
  - `cargo build --manifest-path crates/Cargo.toml -p recovery-core --target wasm32-unknown-unknown`
  Expected: both compile (pulling `aho-corasick`, `zune-jpeg`, `zune-png`). If `zune-png = "0.4"` does not resolve, check the latest 0.x on the registry and pin it; its decode API is confirmed in Task 4.

- [ ] **Step 6: Commit**

```bash
git add crates/recovery-core/Cargo.toml crates/recovery-core/src/carve.rs crates/recovery-core/src/carve/signatures.rs crates/recovery-core/src/lib.rs crates/Cargo.lock
git commit -m "feat(recovery-core): carving deps + signature-table data module"
```

---

### Task 3: Scan for candidates and bound their extent

**Files:**
- Modify: `crates/recovery-core/src/carve.rs`

**Interfaces:**
- Consumes: `SIGNATURES` / `Signature` (Task 2); `crate::limits::MAX_ENTRY_COUNT`.
- Produces:
  - `pub struct Candidate { pub signature: usize, pub start: usize, pub end: usize, pub truncated: bool }` (index into `SIGNATURES`; byte range `start..end`; `truncated` = no footer found within the cap)
  - `pub fn scan_candidates(bytes: &[u8], max_count: usize) -> Vec<Candidate>`

- [ ] **Step 1: Write the failing tests** — append to `crates/recovery-core/src/carve.rs`:

```rust
#[cfg(test)]
mod scan_tests {
    use super::*;

    /// A blob = junk + a tiny fake JPEG (header..footer) + junk.
    fn blob_with_jpeg() -> Vec<u8> {
        let mut v = b"....junk....".to_vec();
        v.extend_from_slice(&[0xFF, 0xD8, 0xFF]); // JPEG header
        v.extend_from_slice(b"body");
        v.extend_from_slice(&[0xFF, 0xD9]); // JPEG footer
        v.extend_from_slice(b"....trailing....");
        v
    }

    #[test]
    fn finds_an_embedded_candidate_bounded_by_its_footer() {
        let blob = blob_with_jpeg();
        let found = scan_candidates(&blob, 1000);
        assert_eq!(found.len(), 1);
        let c = &found[0];
        assert_eq!(SIGNATURES[c.signature].media_type, "image/jpeg");
        assert!(!c.truncated);
        // The extracted range is exactly header..=footer.
        assert_eq!(&blob[c.start..c.end], &[0xFF, 0xD8, 0xFF, b'b', b'o', b'd', b'y', 0xFF, 0xD9]);
    }

    #[test]
    fn a_header_without_a_footer_is_truncated_and_bounded() {
        let mut blob = b"junk".to_vec();
        blob.extend_from_slice(&[0xFF, 0xD8, 0xFF]);
        blob.extend_from_slice(b"no footer here");
        let found = scan_candidates(&blob, 1000);
        assert_eq!(found.len(), 1);
        assert!(found[0].truncated);
        assert_eq!(found[0].end, blob.len()); // bounded to end of blob
    }

    #[test]
    fn junk_yields_no_candidates() {
        assert!(scan_candidates(b"nothing to see here at all", 1000).is_empty());
    }

    #[test]
    fn respects_the_count_cap() {
        let mut blob = Vec::new();
        for _ in 0..5 {
            blob.extend_from_slice(&[0xFF, 0xD8, 0xFF]);
            blob.extend_from_slice(&[0xFF, 0xD9]);
        }
        assert_eq!(scan_candidates(&blob, 2).len(), 2);
    }
}
```

- [ ] **Step 2: Run to verify they fail** — Run: `cargo test --manifest-path crates/Cargo.toml -p recovery-core carve::scan`. Expected: FAIL — `Candidate`/`scan_candidates` not defined.

- [ ] **Step 3: Implement** — add above the `#[cfg(test)]` block in `carve.rs` (add `use aho_corasick::AhoCorasick;` at the top; `scan_candidates` takes `max_count` as a parameter, so it does NOT import `MAX_ENTRY_COUNT` — Task 5's `carve` adds that import when it calls this with the shared cap):

```rust
use aho_corasick::AhoCorasick;

/// One located candidate: which signature matched, the extracted byte range, and
/// whether it was cut at the size cap because no footer was found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Candidate {
    pub signature: usize,
    pub start: usize,
    pub end: usize,
    pub truncated: bool,
}

/// Scan `bytes` for every signature header, and bound each match's extent by the
/// type's footer (searched after the header, within `max_len`) or, failing that,
/// by `max_len` / the next header / end of blob (recorded `truncated`). Overlapping
/// candidates are skipped: after emitting one, scanning resumes at its end. Stops
/// after `max_count` candidates.
pub fn scan_candidates(bytes: &[u8], max_count: usize) -> Vec<Candidate> {
    // Build the automaton from the header patterns, in SIGNATURES order so a match's
    // pattern index maps straight back to the signature.
    let headers: Vec<&[u8]> = SIGNATURES.iter().map(|s| s.header).collect();
    let automaton = match AhoCorasick::new(&headers) {
        Ok(automaton) => automaton,
        Err(_) => return Vec::new(),
    };

    let mut out = Vec::new();
    let mut cursor = 0;
    while cursor < bytes.len() {
        let Some(m) = automaton.find(&bytes[cursor..]) else {
            break;
        };
        let signature = m.pattern().as_usize();
        let start = cursor + m.start();
        let sig = &SIGNATURES[signature];

        let body_start = start + sig.header.len();
        let cap_end = start.saturating_add(sig.max_len).min(bytes.len());
        let (end, truncated) = match sig.footer {
            Some(footer) => match find_from(&bytes[..cap_end], footer, body_start) {
                Some(at) => (at + footer.len(), false),
                None => (cap_end, true),
            },
            None => (cap_end, true),
        };

        out.push(Candidate { signature, start, end, truncated });
        if out.len() >= max_count {
            break;
        }
        // Resume after this candidate to avoid re-matching a header inside it.
        cursor = end.max(start + 1);
    }
    out
}

/// Index of the first occurrence of `needle` in `haystack` at or after `start`.
fn find_from(haystack: &[u8], needle: &[u8], start: usize) -> Option<usize> {
    if needle.is_empty() || start >= haystack.len() || haystack.len() - start < needle.len() {
        return None;
    }
    haystack[start..]
        .windows(needle.len())
        .position(|window| window == needle)
        .map(|position| start + position)
}
```

- [ ] **Step 4: Run to verify they pass** — Run: `cargo test --manifest-path crates/Cargo.toml -p recovery-core carve::scan`. Expected: PASS (4 tests). Confirm `aho_corasick::Match::pattern().as_usize()` and `.start()` against the vendored crate if the compiler objects.

- [ ] **Step 5: Commit**

```bash
git add crates/recovery-core/src/carve.rs
git commit -m "feat(recovery-core): scan a blob for embedded-file candidates"
```

---

### Task 4: Validate a candidate

**Files:**
- Modify: `crates/recovery-core/src/carve.rs`

**Interfaces:**
- Consumes: `Candidate`/`Signature` (Tasks 2–3).
- Produces:
  - `pub enum Confidence { Decoded, Delimited, Unconfirmed }` (`Decoded` = image header decoded; `Delimited` = non-image with header+footer found; `Unconfirmed` = truncated, or an image that would not decode)
  - `pub fn validate(run: &[u8], candidate: &Candidate) -> Confidence`

- [ ] **Step 1: Write the failing tests** — append to `carve.rs`:

```rust
#[cfg(test)]
mod validate_tests {
    use super::*;

    #[test]
    fn a_real_png_header_decodes() {
        // Minimal valid PNG (1x1) — decode_headers must accept it.
        let png: &[u8] = &[
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48,
            0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00,
            0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, 0x54, 0x78,
            0x9C, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
            0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
        ];
        let candidate = Candidate { signature: png_index(), start: 0, end: png.len(), truncated: false };
        assert_eq!(validate(png, &candidate), Confidence::Decoded);
    }

    #[test]
    fn a_fake_png_that_does_not_decode_is_unconfirmed() {
        let fake = &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0xFF, 0xFF, 0xFF, 0xFF];
        let candidate = Candidate { signature: png_index(), start: 0, end: fake.len(), truncated: false };
        assert_eq!(validate(fake, &candidate), Confidence::Unconfirmed);
    }

    #[test]
    fn a_delimited_non_image_is_delimited() {
        // A ZIP candidate with header+footer found (truncated: false) validates structurally.
        let zip_index = SIGNATURES.iter().position(|s| s.media_type == "application/zip").unwrap();
        let candidate = Candidate { signature: zip_index, start: 0, end: 8, truncated: false };
        assert_eq!(validate(b"PK\x03\x04PK\x05\x06", &candidate), Confidence::Delimited);
    }

    #[test]
    fn a_truncated_candidate_is_unconfirmed() {
        let zip_index = SIGNATURES.iter().position(|s| s.media_type == "application/zip").unwrap();
        let candidate = Candidate { signature: zip_index, start: 0, end: 4, truncated: true };
        assert_eq!(validate(b"PK\x03\x04", &candidate), Confidence::Unconfirmed);
    }

    fn png_index() -> usize {
        SIGNATURES.iter().position(|s| s.media_type == "image/png").unwrap()
    }
}
```

- [ ] **Step 2: Run to verify they fail** — Run: `cargo test --manifest-path crates/Cargo.toml -p recovery-core carve::validate`. Expected: FAIL — `Confidence`/`validate` not defined.

- [ ] **Step 3: Implement** — add above the `#[cfg(test)]` block in `carve.rs`. VERIFY the decoders' header-only APIs against the vendored crates before writing: `zune_jpeg::JpegDecoder::new(bytes).decode_headers() -> Result<_, _>` and the `zune_png::PngDecoder` equivalent (`decode_headers` or `decode`). Use header-only decode so a huge carved image is not fully decoded.

```rust
/// How well a candidate was validated. `Decoded` (image header parsed) and
/// `Delimited` (non-image, header and footer both present) are reported recovered;
/// `Unconfirmed` (truncated, or an image whose header will not parse) is reported
/// lost — a signature match is not proof of a complete file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Confidence {
    Decoded,
    Delimited,
    Unconfirmed,
}

/// Validate a carved run. A truncated candidate is always `Unconfirmed`. An image
/// is `Decoded` only if its header parses; a delimited non-image is `Delimited`.
pub fn validate(run: &[u8], candidate: &Candidate) -> Confidence {
    if candidate.truncated {
        return Confidence::Unconfirmed;
    }
    let sig = &SIGNATURES[candidate.signature];
    if sig.image {
        if image_header_ok(sig.media_type, run) {
            Confidence::Decoded
        } else {
            Confidence::Unconfirmed
        }
    } else {
        // Non-image, header+footer found (truncated == false): structurally bounded.
        Confidence::Delimited
    }
}

/// Best-effort image validation via a header-only decode (never a full pixel
/// decode — that bounds work and avoids a decode bomb on a huge carved image).
fn image_header_ok(media_type: &str, run: &[u8]) -> bool {
    match media_type {
        "image/jpeg" => zune_jpeg::JpegDecoder::new(run).decode_headers().is_ok(),
        "image/png" => zune_png::PngDecoder::new(run).decode_headers().is_ok(),
        _ => false,
    }
}
```

- [ ] **Step 4: Run to verify they pass** — Run: `cargo test --manifest-path crates/Cargo.toml -p recovery-core carve::validate`. Expected: PASS. If a decoder's constructor wants a reader wrapper (e.g. `ZCursor::new(run)`) or the method is named differently, adapt to the verified API and keep the header-only intent.

- [ ] **Step 5: Commit**

```bash
git add crates/recovery-core/src/carve.rs
git commit -m "feat(recovery-core): validate carved candidates (image decode / structural)"
```

---

### Task 5: The `carve` entry point + honest manifest

**Files:**
- Modify: `crates/recovery-core/src/carve.rs`
- Modify: `crates/recovery-core/src/lib.rs` (re-export `carve`)

**Interfaces:**
- Consumes: `scan_candidates`, `validate`, `Confidence`, `Candidate`, `SIGNATURES`, `crate::limits::MAX_ENTRY_COUNT`, `crate::model::{RepairResult, SalvagedFile, LossManifest, RecoveredItem}`, `crate::error::RepairError`.
- Produces: `pub fn carve(bytes: &[u8]) -> Result<RepairResult, RepairError>` — `Err(Unrepairable)` when nothing is carvable; otherwise a `RepairResult` whose `files` are the recovered fragments and whose `loss` lists every candidate (recovered iff `Decoded`/`Delimited`), with `fully_recovered = false` and `synthesized` empty.

- [ ] **Step 1: Write the failing tests** — append to `carve.rs`:

```rust
#[cfg(test)]
mod carve_tests {
    use super::*;

    /// A blob with a real 1x1 PNG embedded between junk.
    fn blob_with_png() -> Vec<u8> {
        let png: &[u8] = &[
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48,
            0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00,
            0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, 0x54, 0x78,
            0x9C, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
            0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
        ];
        let mut v = b"leading junk".to_vec();
        v.extend_from_slice(png);
        v.extend_from_slice(b"trailing junk");
        v
    }

    #[test]
    fn carves_an_embedded_png_and_never_claims_full_recovery() {
        let result = carve(&blob_with_png()).expect("carvable");
        assert_eq!(result.files.len(), 1);
        assert_eq!(result.files[0].media_type.as_deref(), Some("image/png"));
        assert_eq!(result.files[0].name, "0001.png");
        // Byte-exact extraction: the carved file re-decodes.
        assert!(zune_png::PngDecoder::new(&result.files[0].bytes).decode_headers().is_ok());
        // Carving never certifies completeness.
        assert!(!result.loss.fully_recovered);
        assert!(result.loss.synthesized.is_empty());
        assert_eq!(result.loss.items.iter().filter(|i| i.recovered).count(), 1);
    }

    #[test]
    fn a_blob_with_no_signatures_is_unrepairable() {
        assert!(carve(b"just some plain text, nothing embedded").is_err());
    }

    #[test]
    fn a_truncated_candidate_is_listed_lost() {
        let mut blob = b"junk".to_vec();
        blob.extend_from_slice(&[0xFF, 0xD8, 0xFF]); // JPEG header, no footer
        blob.extend_from_slice(b"incomplete");
        let result = carve(&blob).expect("something was found");
        assert!(!result.loss.fully_recovered);
        assert!(result.loss.items.iter().any(|i| !i.recovered));
    }
}
```

- [ ] **Step 2: Run to verify they fail** — Run: `cargo test --manifest-path crates/Cargo.toml -p recovery-core carve::carve_tests`. Expected: FAIL — `carve` not defined.

- [ ] **Step 3: Implement `carve`** — add above the `#[cfg(test)]` block in `carve.rs` (add `use crate::limits::MAX_ENTRY_COUNT;`, `use crate::error::RepairError;`, and `use crate::model::{LossManifest, RecoveredItem, RepairResult, SalvagedFile};` at the top):

```rust
use crate::error::RepairError;
use crate::model::{LossManifest, RecoveredItem, RepairResult, SalvagedFile};

/// Extract embedded known-type files from an arbitrary blob. Format-agnostic
/// fallback for when the format pillars cannot help. Returns each extracted
/// fragment as a `SalvagedFile`; the loss manifest lists every candidate and is
/// deliberately never "fully recovered" — carving cannot certify it found every
/// embedded file. `Err(Unrepairable)` when nothing extractable is present.
pub fn carve(bytes: &[u8]) -> Result<RepairResult, RepairError> {
    let candidates = scan_candidates(bytes, MAX_ENTRY_COUNT);
    if candidates.is_empty() {
        return Err(RepairError::Unrepairable);
    }

    let mut files = Vec::new();
    let mut items = Vec::new();
    let mut index = 0u32;
    for candidate in &candidates {
        index += 1;
        let sig = &SIGNATURES[candidate.signature];
        let run = &bytes[candidate.start..candidate.end];
        let confidence = validate(run, candidate);
        let name = format!("{index:04}.{}", sig.extension);

        // recovered = fully validated; emit = worth handing back at all. A truncated
        // fragment is emitted (the partial bytes may be salvageable) but flagged not
        // recovered; a bounded candidate that fails validation is a false-positive
        // header — listed lost and NOT emitted, so garbage is never handed back as
        // an output file.
        let (recovered, emit, detail) = match confidence {
            Confidence::Decoded => (true, true, String::new()),
            Confidence::Delimited => (
                true,
                true,
                "extracted by signature: header and terminator found".to_string(),
            ),
            Confidence::Unconfirmed if candidate.truncated => (
                false,
                true,
                "header found but no terminator within the size cap; extraction is truncated"
                    .to_string(),
            ),
            Confidence::Unconfirmed => (
                false,
                false,
                "signature matched but the content did not validate".to_string(),
            ),
        };

        if emit {
            files.push(SalvagedFile {
                name: name.clone(),
                bytes: run.to_vec(),
                media_type: Some(sig.media_type.to_string()),
            });
        }
        // Every candidate is accounted for in the manifest, emitted or not.
        items.push(RecoveredItem { name, recovered, detail });
    }

    if files.is_empty() {
        // Candidates were found but all were false-positive headers — nothing
        // trustworthy to hand back.
        return Err(RepairError::Unrepairable);
    }

    Ok(RepairResult {
        files,
        loss: LossManifest {
            items,
            // Carving can never certify it found every embedded file.
            fully_recovered: false,
            // Every output is a verbatim byte range — nothing is fabricated.
            synthesized: Vec::new(),
        },
    })
}
```

- [ ] **Step 4: Re-export `carve`** — in `crates/recovery-core/src/lib.rs`, alongside the existing `pub use` of `diagnose`/`repair`, add:

```rust
pub use carve::carve;
```

- [ ] **Step 5: Run the crate gate** — Run:
  - `cargo test --manifest-path crates/Cargo.toml -p recovery-core`
  - `cargo build --manifest-path crates/Cargo.toml -p recovery-core --target wasm32-unknown-unknown`
  - `cargo fmt --manifest-path crates/Cargo.toml -p recovery-core -- --check` (fmt first; stage)
  - `cargo clippy --manifest-path crates/Cargo.toml -p recovery-core --all-targets -- -D warnings`
  Expected: all pass, wasm compiles.

- [ ] **Step 6: Commit**

```bash
git add crates/recovery-core/src/carve.rs crates/recovery-core/src/lib.rs
git commit -m "feat(recovery-core): carve entry point with honest never-complete manifest"
```

---

### Task 6: `diagnose` suggests carving

**Files:**
- Modify: `crates/recovery-core/src/model.rs` (add `carve_suggested` to `DiagnosisReport`)
- Modify: `crates/recovery-core/src/diagnose.rs` (set it)

**Interfaces:**
- Produces: `DiagnosisReport` gains `pub carve_suggested: bool` — `true` when the format is unrecognized (`None`) or a pillar's recoverability is `Unrecoverable`/`Unknown`, signalling the caller that carving may extract embedded files.

- [ ] **Step 1: Add the field** — in `crates/recovery-core/src/model.rs`, add to the `DiagnosisReport` struct (after `repair_supported`):

```rust
    /// True when the format pillars cannot help (unrecognized, or unrecoverable):
    /// carving may still extract embedded known-type files. Set by `diagnose`.
    pub carve_suggested: bool,
```

- [ ] **Step 2: Write the failing tests** — in `crates/recovery-core/src/diagnose.rs` tests, add:

```rust
    #[test]
    fn an_unrecognized_blob_suggests_carving() {
        let report = diagnose(b"\x00\x01\x02 not a known format at all");
        assert_eq!(report.detected_format, None);
        assert!(report.carve_suggested);
    }

    #[test]
    fn a_repairable_format_does_not_suggest_carving() {
        // A clean minimal zip is intact/repairable — carving is not the path.
        let report = diagnose(&crate::zip_repair::tests_build_minimal_zip());
        assert!(!report.carve_suggested);
    }
```

- [ ] **Step 3: Run to verify they fail** — Run: `cargo test --manifest-path crates/Cargo.toml -p recovery-core diagnose::`. Expected: FAIL — struct literal missing `carve_suggested` (compile error) and/or the assertions fail.

- [ ] **Step 4: Set the field in every `diagnose` arm** — in `crates/recovery-core/src/diagnose.rs`, compute `carve_suggested` and set it on each `DiagnosisReport` constructed. For the `Some(Format::*)` arms it is `matches!(recoverability, Recoverability::Unrecoverable | Recoverability::Unknown)`; for the `None` arm it is `true`. Concretely, in each format arm add the field (using that arm's `recoverability` value):

```rust
                carve_suggested: matches!(
                    recoverability,
                    Recoverability::Unrecoverable | Recoverability::Unknown
                ),
```

and in the `None => DiagnosisReport { ... }` arm add:

```rust
            carve_suggested: true,
```

(If `recoverability` is moved into the struct before this line, read it into a local first, or set `carve_suggested` above the struct literal.)

- [ ] **Step 5: Run the crate gate** — Run:
  - `cargo test --manifest-path crates/Cargo.toml -p recovery-core`
  - `cargo fmt --manifest-path crates/Cargo.toml -p recovery-core -- --check` (fmt first; stage)
  - `cargo clippy --manifest-path crates/Cargo.toml -p recovery-core --all-targets -- -D warnings`
  - `grep -rniE "golden rule|ADR-[0-9]|spec §|slice [0-9]" crates/recovery-core/src` (returns nothing)
  Expected: all pass; clean working tree after commit.

- [ ] **Step 6: Commit**

```bash
git add crates/recovery-core/src/model.rs crates/recovery-core/src/diagnose.rs
git commit -m "feat(recovery-core): diagnose suggests carving when pillars cannot help"
```

---

## Notes for the implementer

- **Verify crate APIs against the vendored source** (golden rule 11): `aho_corasick::AhoCorasick::new(patterns) -> Result<_, BuildError>`, `.find(haystack) -> Option<Match>`, `Match::pattern() -> PatternID` (`.as_usize()`), `.start()`. `zune_jpeg::JpegDecoder::new(bytes).decode_headers()`; confirm the `zune_png::PngDecoder` header-decode method name and the exact `zune-png` version when adding it. Use header-only decode, never a full pixel decode.
- **Honesty is the crown rule.** `fully_recovered` is ALWAYS false for a carve; `synthesized` is ALWAYS empty; a truncated or non-validating candidate is `recovered: false` with a fixed-literal `detail`. A false-positive header (a coincidental magic-byte run) that does not validate is listed lost, never emitted — the same non-overclaim discipline as the other pillars.
- **The signature table is the reuse seam** — keep `carve/signatures.rs` a standalone, dependency-free data module so it lifts into a future `engine_host::signatures` verbatim when a second consumer appears. Do not couple it to `engine_host::format`.
- **Caps:** `MAX_ENTRY_COUNT` bounds candidate count; each `Signature.max_len` bounds a footerless run; header-only image decode bounds validation work.
- **Deferred (documented seams):** Magika ML validation (container-only, ort/ONNX C-dep) to classify/label carved runs beyond signature+decode; deeper per-type validation (e.g. running a carved ZIP/PDF back through its own pillar); more signatures (the table is data). Mid-stream bit-rot is unrecoverable without pre-existing redundancy (PAR2, deferred).
- The worker route, container heavy lane, and attach-to-matter (mapping N `SalvagedFile`s → N matter file-versions) are Plan 6 — this plan is the pure engine only.
