# File Repair & Salvage — Plan 2: ZIP/OOXML family pillar

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The first repair pillar — salvage damaged ZIP archives (missing/corrupt central directory, truncation) by re-reading entries from local file headers and re-emitting a fresh valid archive, plus OOXML OPC reconstruction so a recovered `.docx` reopens — registered into the `recovery-core` diagnose/repair framework from Plan 1.

**Architecture:** Pure-Rust on the `zip` 8.6 crate (`read_zipfile_from_stream` reads entries from local headers with no central directory; `ZipWriter` re-emits). Per-entry recovery is all-or-nothing (an entry whose body is truncated is marked lost in the loss manifest — partial-final-entry recovery via `inflate_salvage` is a later seam). I/O-free; consumes the Plan-1 model/error/diagnose.

**Tech Stack:** Rust, `zip` 8.6 (`deflate-flate2`, pure-Rust), `flate2` (rust_backend), Plan-1 `recovery-core` types.

## Global Constraints

- I/O-free engine (bytes in, result out); pure-Rust features only (`zip` with `deflate-flate2`, `flate2` with `rust_backend` — never a C backend).
- Consumes Plan-1 types: `crate::model::{DiagnosisReport, CorruptionKind, Recoverability, RepairResult, LossManifest, RecoveredItem}`, `crate::error::RepairError`, `engine_host::format::{detect, Format}`.
- **Never overclaim:** every repaired entry is recorded in the loss manifest as recovered or lost; a truncated entry body is lost, not silently dropped.
- **Log-safety:** `RecoveredItem.name`/`detail` carry entry names — these are returned to the file's owner, never routed to the redacted error-log pipeline (only `RepairError::code()` is log-safe).
- No process-doc citations in source (no "golden rule N"/ADR/spec § in comments). Full names.
- Verify crate pins against docs.rs before use (golden rule 11). This plan's API facts are verified against `zip` 8.6.0.

---

### Task 1: Add the `zip` dependency + the ZIP module skeleton

**Files:**

- Modify: `crates/recovery-core/Cargo.toml` (add `zip`, promote `flate2` to a real dep)
- Create: `crates/recovery-core/src/zip_repair.rs`
- Create: `crates/recovery-core/src/ooxml.rs`
- Modify: `crates/recovery-core/src/lib.rs` (declare the two modules)

**Interfaces:**

- Produces: empty `zip_repair` and `ooxml` modules; the `zip` crate available.

- [ ] **Step 1: Update `crates/recovery-core/Cargo.toml`** — change the `[dependencies]`/`[dev-dependencies]` so `zip` and `flate2` are real deps:

```toml
[dependencies]
# The engine-host harness, RENAMED to `engine_host`.
engine_host = { path = "../engine-host", package = "magna-carta-engine-host" }
# Compression-stream salvage primitive (partial DEFLATE decode).
zune-inflate = "0.2"
# Read damaged archives from local file headers (no central directory) and re-emit a fresh archive.
# Lean pure-Rust features only — deflate via flate2/miniz_oxide, no bzip2/zstd/lzma C deps.
zip = { version = "8.6", default-features = false, features = ["deflate-flate2"] }
# The DEFLATE backend zip's `deflate-flate2` selects — declared directly to pin the pure-Rust
# miniz_oxide backend (never a C zlib backend).
flate2 = { version = "1", default-features = false, features = ["rust_backend"] }
```

(Delete the `[dev-dependencies]` `flate2` line — it is now a real dependency, still usable in tests.)

- [ ] **Step 2: Create the module stubs**

`crates/recovery-core/src/zip_repair.rs`:

```rust
//! The ZIP archetype-family repair pillar: salvage entries from local file
//! headers, re-emit a fresh archive, diagnose ZIP corruption.
```

`crates/recovery-core/src/ooxml.rs`:

```rust
//! Open Packaging Conventions reconstruction so a recovered OOXML package
//! (docx/xlsx/pptx) reopens: regenerate [Content_Types].xml and the root _rels.
```

- [ ] **Step 3: Declare the modules** — add to `crates/recovery-core/src/lib.rs` after the existing `pub mod` lines:

```rust
pub mod ooxml;
pub mod zip_repair;
```

- [ ] **Step 4: Verify it builds** — Run: `cargo build --manifest-path crates/Cargo.toml -p recovery-core`. Expected: compiles (the first build pulls `zip`).

- [ ] **Step 5: Commit**

```bash
git add crates/recovery-core/Cargo.toml crates/recovery-core/src/zip_repair.rs crates/recovery-core/src/ooxml.rs crates/recovery-core/src/lib.rs crates/Cargo.lock
git commit -m "feat(recovery-core): add zip dep + ZIP/OOXML module skeleton"
```

---

### Task 2: Salvage entries from local file headers

**Files:**

- Modify: `crates/recovery-core/src/zip_repair.rs`

**Interfaces:**

- Produces:
  - `pub struct SalvagedEntry { pub name: String, pub data: Option<Vec<u8>>, pub recovered: bool, pub detail: String }`
  - `pub fn salvage_entries(bytes: &[u8]) -> Vec<SalvagedEntry>` — read each entry sequentially from its local header via `zip::read::read_zipfile_from_stream`; a fully-read entry is `recovered: true` with its decompressed `data`; an entry whose body errors (truncated/corrupt) is `recovered: false`, `data: None`. Stops at the central-directory signature or end of stream.

- [ ] **Step 1: Write the failing tests** — append to `crates/recovery-core/src/zip_repair.rs`:

```rust
use std::io::{Cursor, Read};
use zip::read::read_zipfile_from_stream;

#[derive(Debug, Clone)]
pub struct SalvagedEntry {
    pub name: String,
    pub data: Option<Vec<u8>>,
    pub recovered: bool,
    pub detail: String,
}

#[cfg(test)]
mod salvage_tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;
    use zip::{CompressionMethod, ZipWriter};

    /// Build a valid zip with the given (name, content) entries, Deflated.
    fn build_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        for (name, content) in entries {
            writer.start_file(*name, options).unwrap();
            writer.write_all(content).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    /// Offset of the End Of Central Directory record (PK\x05\x06).
    fn eocd_offset(zip: &[u8]) -> usize {
        zip.windows(4)
            .rposition(|w| w == [0x50, 0x4B, 0x05, 0x06])
            .expect("a valid zip has an EOCD")
    }

    /// Offset of the first central directory header (PK\x01\x02).
    fn central_dir_offset(zip: &[u8]) -> usize {
        zip.windows(4)
            .position(|w| w == [0x50, 0x4B, 0x01, 0x02])
            .expect("a valid zip has a central directory")
    }

    #[test]
    fn salvages_all_entries_from_a_central_directory_stripped_zip() {
        let zip = build_zip(&[("a.txt", b"alpha"), ("b.txt", b"bravo"), ("c.txt", b"charlie")]);
        // Remove everything from the central directory onward — local headers survive.
        let truncated = &zip[..central_dir_offset(&zip)];
        let entries = salvage_entries(truncated);
        assert_eq!(entries.len(), 3);
        assert!(entries.iter().all(|e| e.recovered));
        assert_eq!(entries[0].name, "a.txt");
        assert_eq!(entries[0].data.as_deref(), Some(&b"alpha"[..]));
        assert_eq!(entries[2].data.as_deref(), Some(&b"charlie"[..]));
    }

    #[test]
    fn salvages_intact_entries_and_marks_a_truncated_tail_entry_lost() {
        let zip = build_zip(&[("keep.txt", b"this entry is intact"), ("lost.txt", &[7u8; 4096])]);
        // Cut inside the second entry's compressed body: between the start of the
        // central directory (everything before it is local data) minus a chunk.
        let cut = central_dir_offset(&zip) - 64;
        let truncated = &zip[..cut];
        let entries = salvage_entries(truncated);
        // The first entry is fully present and recovered.
        let keep = entries.iter().find(|e| e.name == "keep.txt").expect("keep.txt present");
        assert!(keep.recovered);
        assert_eq!(keep.data.as_deref(), Some(&b"this entry is intact"[..]));
        // The second entry is present in the local-header scan but its body is truncated → lost.
        let lost = entries.iter().find(|e| e.name == "lost.txt");
        if let Some(lost) = lost {
            assert!(!lost.recovered, "a truncated entry body must be marked lost");
            assert!(lost.data.is_none());
        }
        // (If the truncation removed the second local header entirely, only keep.txt appears —
        // still correct: nothing is falsely reported recovered.)
    }
}
```

- [ ] **Step 2: Run to verify they fail** — Run: `cargo test --manifest-path crates/Cargo.toml -p recovery-core zip_repair::salvage`. Expected: FAIL — `salvage_entries` not defined.

- [ ] **Step 3: Implement `salvage_entries`** — add above the `#[cfg(test)]` block. VERIFY the `read_zipfile_from_stream` signature against docs.rs for the resolved `zip` version (it is `fn read_zipfile_from_stream<R: Read>(reader: &mut R) -> ZipResult<Option<ZipFile<'_, R>>>`; `ZipFile` implements `Read` for decompressed bytes and has `.name()`):

```rust
/// Read each entry sequentially from its local file header, ignoring the
/// (missing/corrupt) central directory. A fully-decoded entry is recovered with
/// its bytes; an entry whose body cannot be fully read (truncated/corrupt) is
/// recorded lost, never silently dropped. Stops at the central-directory
/// signature or end of stream.
pub fn salvage_entries(bytes: &[u8]) -> Vec<SalvagedEntry> {
    let mut reader = Cursor::new(bytes);
    let mut out = Vec::new();
    loop {
        // A read error at the header boundary (e.g. truncated header) ends the scan.
        let next = match read_zipfile_from_stream(&mut reader) {
            Ok(Some(file)) => file,
            Ok(None) => break,  // hit the central-directory signature: no more local entries
            Err(_) => break,    // a malformed/truncated local header: stop scanning
        };
        let name = next.name().to_owned();
        // Directory entries carry no data; skip them (they are recreated on re-emit).
        if name.ends_with('/') {
            continue;
        }
        let mut file = next;
        let mut data = Vec::new();
        match file.read_to_end(&mut data) {
            Ok(_) => out.push(SalvagedEntry {
                name,
                data: Some(data),
                recovered: true,
                detail: String::new(),
            }),
            Err(_) => out.push(SalvagedEntry {
                name,
                data: None,
                recovered: false,
                detail: "entry body truncated or corrupt".into(),
            }),
        }
    }
    out
}
```

NOTE on the `Err` mid-body case: a `read_to_end` error may leave the `Cursor` mid-stream, so subsequent entries after a corrupt one are not reliably recoverable — that is acceptable (we recover the intact prefix of the archive). Do not attempt to resync after a body error in this version.

- [ ] **Step 4: Run to verify they pass** — Run: `cargo test --manifest-path crates/Cargo.toml -p recovery-core zip_repair::salvage`. Expected: PASS (2 tests). If `read_to_end` on a truncated final entry does not error (some encoders pad), adjust the truncation offset in the test so the body is genuinely cut; the production code is correct regardless.

- [ ] **Step 5: Commit**

```bash
git add crates/recovery-core/src/zip_repair.rs
git commit -m "feat(recovery-core): salvage zip entries from local file headers"
```

---

### Task 3: Re-emit a fresh archive

**Files:**

- Modify: `crates/recovery-core/src/zip_repair.rs`

**Interfaces:**

- Produces: `pub fn rebuild_archive(entries: &[(String, Vec<u8>)]) -> Result<Vec<u8>, crate::error::RepairError>` — write a fresh valid zip (Deflated) from recovered (name, bytes) pairs via `zip::ZipWriter`. Returns `RepairError::Unrepairable` if the writer fails.

- [ ] **Step 1: Write the failing test** — add to the test module in `zip_repair.rs`:

```rust
#[cfg(test)]
mod rebuild_tests {
    use super::*;
    use zip::read::ZipArchive;

    #[test]
    fn rebuilt_archive_is_a_valid_zip_with_the_same_entries() {
        let entries = vec![
            ("a.txt".to_string(), b"alpha".to_vec()),
            ("dir/b.txt".to_string(), b"bravo".to_vec()),
        ];
        let zip = rebuild_archive(&entries).expect("rebuild");
        // The result must be a valid, central-directory-bearing zip.
        let mut archive = ZipArchive::new(Cursor::new(zip)).expect("valid zip");
        assert_eq!(archive.len(), 2);
        let mut a = archive.by_name("a.txt").expect("a.txt present");
        let mut content = String::new();
        std::io::Read::read_to_string(&mut a, &mut content).unwrap();
        assert_eq!(content, "alpha");
    }
}
```

- [ ] **Step 2: Run to verify it fails** — Run: `cargo test --manifest-path crates/Cargo.toml -p recovery-core zip_repair::rebuild`. Expected: FAIL — `rebuild_archive` not defined.

- [ ] **Step 3: Implement `rebuild_archive`** — add to `zip_repair.rs` (add the needed `use` for the writer types at the top of the file, beside the existing imports):

```rust
use std::io::Write;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use crate::error::RepairError;

/// Write a fresh, valid zip (with a correct central directory) from recovered
/// (name, bytes) pairs. Entries are Deflated. A writer failure → Unrepairable.
pub fn rebuild_archive(entries: &[(String, Vec<u8>)]) -> Result<Vec<u8>, RepairError> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    for (name, bytes) in entries {
        writer
            .start_file(name, options)
            .map_err(|_| RepairError::Unrepairable)?;
        writer
            .write_all(bytes)
            .map_err(|_| RepairError::Unrepairable)?;
    }
    let cursor = writer.finish().map_err(|_| RepairError::Unrepairable)?;
    Ok(cursor.into_inner())
}
```

- [ ] **Step 4: Run to verify it passes** — Run: `cargo test --manifest-path crates/Cargo.toml -p recovery-core zip_repair::rebuild`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/recovery-core/src/zip_repair.rs
git commit -m "feat(recovery-core): re-emit a fresh zip from recovered entries"
```

---

### Task 4: Diagnose ZIP corruption + register the diagnoser

**Files:**

- Modify: `crates/recovery-core/src/zip_repair.rs`
- Modify: `crates/recovery-core/src/diagnose.rs`

**Interfaces:**

- Produces (in `zip_repair`): `pub fn diagnose_zip(bytes: &[u8]) -> (Vec<crate::model::CorruptionKind>, crate::model::Recoverability)` — `ZipArchive::new` succeeds → (`[]`, `Intact`); fails but `salvage_entries` recovers ≥1 entry → (`[MissingEndOfCentralDirectory]`, `Repairable`); fails and recovers nothing → (`[Truncated]`, `Unrecoverable`).
- Consumes (in `diagnose`): the `Zip` arm calls `diagnose_zip` and sets `repair_supported = true`.

- [ ] **Step 1: Write the failing tests** — add to `zip_repair.rs` test section:

```rust
#[cfg(test)]
mod diagnose_tests {
    use super::*;
    use crate::model::{CorruptionKind, Recoverability};

    #[test]
    fn an_intact_zip_is_intact() {
        let zip = salvage_tests::build_zip(&[("a.txt", b"alpha")]);
        let (corruption, recoverability) = diagnose_zip(&zip);
        assert_eq!(recoverability, Recoverability::Intact);
        assert!(corruption.is_empty());
    }

    #[test]
    fn a_central_directory_stripped_zip_is_repairable() {
        let zip = salvage_tests::build_zip(&[("a.txt", b"alpha"), ("b.txt", b"bravo")]);
        let truncated = &zip[..salvage_tests::central_dir_offset(&zip)];
        let (corruption, recoverability) = diagnose_zip(truncated);
        assert_eq!(recoverability, Recoverability::Repairable);
        assert!(corruption.contains(&CorruptionKind::MissingEndOfCentralDirectory));
    }
}
```

To let `diagnose_tests` and `rebuild_tests` reuse the `build_zip`/`central_dir_offset` helpers in `salvage_tests`, change those two helper fns in `salvage_tests` from private to `pub(super)` (and `eocd_offset` too if used). Update the call sites accordingly (`salvage_tests::build_zip`).

- [ ] **Step 2: Run to verify they fail** — Run: `cargo test --manifest-path crates/Cargo.toml -p recovery-core zip_repair::diagnose`. Expected: FAIL — `diagnose_zip` not defined.

- [ ] **Step 3: Implement `diagnose_zip`** — add to `zip_repair.rs` (add `use zip::read::ZipArchive;` at the top):

```rust
use crate::model::{CorruptionKind, Recoverability};

/// Classify a zip's health: a readable central directory means intact; an
/// unreadable one with recoverable local-header entries is repairable; nothing
/// recoverable is unrecoverable.
pub fn diagnose_zip(bytes: &[u8]) -> (Vec<CorruptionKind>, Recoverability) {
    if ZipArchive::new(Cursor::new(bytes)).is_ok() {
        return (Vec::new(), Recoverability::Intact);
    }
    let recovered = salvage_entries(bytes).into_iter().filter(|e| e.recovered).count();
    if recovered > 0 {
        (vec![CorruptionKind::MissingEndOfCentralDirectory], Recoverability::Repairable)
    } else {
        (vec![CorruptionKind::Truncated], Recoverability::Unrecoverable)
    }
}
```

- [ ] **Step 4: Wire into the diagnose framework** — in `crates/recovery-core/src/diagnose.rs`, replace the recognized-format `Some(format) => …` arm so the `Zip` format dispatches to `diagnose_zip`:

```rust
    match detect(bytes) {
        Some(Format::Zip) => {
            let (corruption, recoverability) = crate::zip_repair::diagnose_zip(bytes);
            DiagnosisReport {
                detected_format: Some(Format::Zip),
                corruption,
                recoverability,
                repair_supported: true,
                detail: "zip family".into(),
            }
        }
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
```

Add `use engine_host::format::Format;` to `diagnose.rs` if not already imported, and keep the existing `< 8 bytes` guard above the match.

- [ ] **Step 5: Update the diagnose test** — the Plan-1 test `identifies_a_known_format_but_reports_no_pillar_yet` used PDF (still `Unknown`, unchanged). Add a ZIP diagnose test in `diagnose.rs`:

```rust
    #[test]
    fn a_recognized_zip_reports_repair_supported() {
        // A minimal stored zip: local header for an empty file then EOCD is complex to
        // hand-build, so reuse the zip_repair helper indirectly via a real archive.
        let zip = crate::zip_repair::tests_build_minimal_zip();
        let report = diagnose(&zip);
        assert_eq!(report.detected_format, Some(Format::Zip));
        assert!(report.repair_supported);
    }
```

And expose a tiny non-test builder for the fixture in `zip_repair.rs` (so `diagnose.rs`'s test can build a real zip without duplicating writer code):

```rust
/// Test-support: build a minimal valid zip (one stored entry). Public for the
/// diagnose-framework test; not part of the repair API.
#[doc(hidden)]
pub fn tests_build_minimal_zip() -> Vec<u8> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    writer.start_file("a.txt", options).unwrap();
    writer.write_all(b"alpha").unwrap();
    writer.finish().unwrap().into_inner()
}
```

- [ ] **Step 6: Run the tests** — Run: `cargo test --manifest-path crates/Cargo.toml -p recovery-core` (zip_repair + diagnose). Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add crates/recovery-core/src/zip_repair.rs crates/recovery-core/src/diagnose.rs
git commit -m "feat(recovery-core): diagnose zip corruption + register the diagnoser"
```

---

### Task 5: OOXML OPC reconstruction

**Files:**

- Modify: `crates/recovery-core/src/ooxml.rs`

**Interfaces:**

- Produces:
  - `pub fn is_ooxml(entries: &[(String, Vec<u8>)]) -> bool` — true if the entry set looks like an OOXML package (has a `word/`, `xl/`, or `ppt/` part, or a `[Content_Types].xml`).
  - `pub fn reconstruct_opc(entries: Vec<(String, Vec<u8>)>) -> Vec<(String, Vec<u8>)>` — ensure the OPC skeleton exists: if `[Content_Types].xml` is missing, synthesize a minimal one covering the present parts; if `_rels/.rels` is missing, synthesize the package relationship to the main document part. Existing valid parts are left untouched. v1 targets WordprocessingML (`word/document.xml`); xl/ppt get a best-effort content-type default.

- [ ] **Step 1: Write the failing tests** — write `crates/recovery-core/src/ooxml.rs` body + tests:

```rust
const CONTENT_TYPES_PATH: &str = "[Content_Types].xml";
const ROOT_RELS_PATH: &str = "_rels/.rels";

#[cfg(test)]
mod tests {
    use super::*;

    fn names(entries: &[(String, Vec<u8>)]) -> Vec<&str> {
        entries.iter().map(|(n, _)| n.as_str()).collect()
    }

    #[test]
    fn detects_a_word_package() {
        let entries = vec![("word/document.xml".to_string(), b"<w:document/>".to_vec())];
        assert!(is_ooxml(&entries));
    }

    #[test]
    fn a_non_ooxml_zip_is_not_ooxml() {
        let entries = vec![("photos/cat.jpg".to_string(), vec![0xFF, 0xD8])];
        assert!(!is_ooxml(&entries));
    }

    #[test]
    fn reconstructs_a_missing_content_types_and_root_rels() {
        // A docx whose OPC skeleton was lost in salvage: only the main part remains.
        let entries = vec![("word/document.xml".to_string(), minimal_document_xml())];
        let rebuilt = reconstruct_opc(entries);
        let n = names(&rebuilt);
        assert!(n.contains(&CONTENT_TYPES_PATH), "must synthesize [Content_Types].xml");
        assert!(n.contains(&ROOT_RELS_PATH), "must synthesize _rels/.rels");
        // The content types must declare the rels default and the document override.
        let ct = &rebuilt.iter().find(|(p, _)| p == CONTENT_TYPES_PATH).unwrap().1;
        let ct = String::from_utf8_lossy(ct);
        assert!(ct.contains("Extension=\"rels\""));
        assert!(ct.contains("/word/document.xml"));
        // The root rels must point at the main document part.
        let rels = &rebuilt.iter().find(|(p, _)| p == ROOT_RELS_PATH).unwrap().1;
        let rels = String::from_utf8_lossy(rels);
        assert!(rels.contains("word/document.xml"));
    }

    #[test]
    fn an_existing_content_types_is_left_untouched() {
        let custom = b"<Types>custom</Types>".to_vec();
        let entries = vec![
            (CONTENT_TYPES_PATH.to_string(), custom.clone()),
            ("word/document.xml".to_string(), minimal_document_xml()),
        ];
        let rebuilt = reconstruct_opc(entries);
        let ct = &rebuilt.iter().find(|(p, _)| p == CONTENT_TYPES_PATH).unwrap().1;
        assert_eq!(ct, &custom, "an existing [Content_Types].xml must not be overwritten");
    }

    fn minimal_document_xml() -> Vec<u8> {
        b"<?xml version=\"1.0\"?><w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body/></w:document>".to_vec()
    }
}
```

- [ ] **Step 2: Run to verify they fail** — Run: `cargo test --manifest-path crates/Cargo.toml -p recovery-core ooxml::`. Expected: FAIL — symbols not defined.

- [ ] **Step 3: Implement** — add above the `#[cfg(test)]` block in `ooxml.rs`. The minimal `[Content_Types].xml` and `_rels/.rels` are the OPC minimum verified for a Word package:

```rust
/// True when the entry set looks like an OOXML (Open Packaging Conventions)
/// package: it has a main-story directory or a content-types part.
pub fn is_ooxml(entries: &[(String, Vec<u8>)]) -> bool {
    entries.iter().any(|(name, _)| {
        name == CONTENT_TYPES_PATH
            || name.starts_with("word/")
            || name.starts_with("xl/")
            || name.starts_with("ppt/")
    })
}

fn has(entries: &[(String, Vec<u8>)], path: &str) -> bool {
    entries.iter().any(|(name, _)| name == path)
}

/// The main document part of the package, if present, in OPC priority order.
fn main_part(entries: &[(String, Vec<u8>)]) -> Option<&'static str> {
    if entries.iter().any(|(n, _)| n == "word/document.xml") {
        Some("word/document.xml")
    } else if entries.iter().any(|(n, _)| n == "xl/workbook.xml") {
        Some("xl/workbook.xml")
    } else if entries.iter().any(|(n, _)| n == "ppt/presentation.xml") {
        Some("ppt/presentation.xml")
    } else {
        None
    }
}

fn content_type_for(main: &str) -> &'static str {
    match main {
        "xl/workbook.xml" => {
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"
        }
        "ppt/presentation.xml" => {
            "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"
        }
        // word/document.xml and the default
        _ => "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
    }
}

fn synth_content_types(main: &str) -> Vec<u8> {
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n\
         <Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">\
         <Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>\
         <Default Extension=\"xml\" ContentType=\"application/xml\"/>\
         <Override PartName=\"/{main}\" ContentType=\"{ct}\"/></Types>",
        main = main,
        ct = content_type_for(main),
    )
    .into_bytes()
}

fn synth_root_rels(main: &str) -> Vec<u8> {
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n\
         <Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\
         <Relationship Id=\"rId1\" \
         Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" \
         Target=\"{main}\"/></Relationships>",
        main = main,
    )
    .into_bytes()
}

/// Ensure the OPC skeleton (content types + root relationships) is present so the
/// package reopens. Existing parts are never overwritten; only missing skeleton
/// parts are synthesized, and only when a main document part can be identified.
pub fn reconstruct_opc(mut entries: Vec<(String, Vec<u8>)>) -> Vec<(String, Vec<u8>)> {
    let Some(main) = main_part(&entries) else {
        return entries; // no recognizable main part — nothing safe to synthesize
    };
    if !has(&entries, CONTENT_TYPES_PATH) {
        entries.push((CONTENT_TYPES_PATH.to_string(), synth_content_types(main)));
    }
    if !has(&entries, ROOT_RELS_PATH) {
        entries.push((ROOT_RELS_PATH.to_string(), synth_root_rels(main)));
    }
    entries
}
```

- [ ] **Step 4: Run to verify they pass** — Run: `cargo test --manifest-path crates/Cargo.toml -p recovery-core ooxml::`. Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add crates/recovery-core/src/ooxml.rs
git commit -m "feat(recovery-core): OOXML OPC reconstruction (content-types + root rels)"
```

---

### Task 6: The ZIP repairer + top-level repair dispatch

**Files:**

- Create: `crates/recovery-core/src/repair.rs`
- Modify: `crates/recovery-core/src/lib.rs` (declare + re-export `repair`)
- Modify: `crates/recovery-core/src/zip_repair.rs` (the `repair_zip` entry point)

**Interfaces:**

- Produces (in `zip_repair`): `pub fn repair_zip(bytes: &[u8]) -> Result<RepairResult, RepairError>` — salvage entries; if none recovered → `Err(Unrepairable)`; if the recovered set is OOXML, run `reconstruct_opc`; rebuild the archive; build the `LossManifest` (one `RecoveredItem` per entry, recovered or lost).
- Produces (in `repair`): `pub fn repair(bytes: &[u8]) -> Result<RepairResult, RepairError>` — dispatch by `engine_host::format::detect`: `Zip` → `repair_zip`; recognized-but-unsupported → `Err(Unsupported)`; unrecognized → `Err(NotRecognized)`.

- [ ] **Step 1: Write the failing tests** — add to `zip_repair.rs` test section:

```rust
#[cfg(test)]
mod repair_tests {
    use super::*;
    use zip::read::ZipArchive;

    #[test]
    fn repairs_a_central_directory_stripped_zip_and_lists_recovered_entries() {
        let zip = salvage_tests::build_zip(&[("a.txt", b"alpha"), ("b.txt", b"bravo")]);
        let truncated = &zip[..salvage_tests::central_dir_offset(&zip)];
        let result = repair_zip(truncated).expect("repairable");
        // The salvaged output is a valid, reopenable zip.
        let mut archive = ZipArchive::new(Cursor::new(result.salvaged.clone())).expect("valid zip");
        assert_eq!(archive.len(), 2);
        // The loss manifest lists both as recovered, fully_recovered = true.
        assert!(result.loss.fully_recovered);
        assert_eq!(result.loss.items.iter().filter(|i| i.recovered).count(), 2);
    }

    #[test]
    fn an_unrecoverable_input_errors_rather_than_emitting_an_empty_zip() {
        // Random non-zip bytes routed here directly must not produce a "repaired" empty archive.
        let result = repair_zip(b"\x50\x4b\x03\x04 garbage that is not a real local header body");
        assert!(result.is_err());
    }
}
```

And add a `repair` dispatch test in a new `crates/recovery-core/src/repair.rs` (below).

- [ ] **Step 2: Implement `repair_zip`** — add to `zip_repair.rs`. Reuse `crate::model::{LossManifest, RecoveredItem, RepairResult}`:

```rust
use crate::model::{LossManifest, RecoveredItem, RepairResult};

/// Repair a damaged zip: salvage entries from local headers, reconstruct the OPC
/// skeleton if it is an OOXML package, re-emit a fresh archive, and record an
/// honest loss manifest. Errors (rather than emitting an empty archive) when
/// nothing is recoverable.
pub fn repair_zip(bytes: &[u8]) -> Result<RepairResult, RepairError> {
    let salvaged = salvage_entries(bytes);
    let recovered: Vec<(String, Vec<u8>)> = salvaged
        .iter()
        .filter_map(|e| e.data.clone().map(|d| (e.name.clone(), d)))
        .collect();
    if recovered.is_empty() {
        return Err(RepairError::Unrepairable);
    }
    let recovered = if crate::ooxml::is_ooxml(&recovered) {
        crate::ooxml::reconstruct_opc(recovered)
    } else {
        recovered
    };
    let bytes_out = rebuild_archive(&recovered)?;
    let items: Vec<RecoveredItem> = salvaged
        .iter()
        .map(|e| RecoveredItem {
            name: e.name.clone(),
            recovered: e.recovered,
            detail: e.detail.clone(),
        })
        .collect();
    let fully_recovered = items.iter().all(|i| i.recovered);
    Ok(RepairResult {
        salvaged: bytes_out,
        loss: LossManifest { items, fully_recovered },
    })
}
```

- [ ] **Step 3: Implement the top-level `repair` dispatch** — write `crates/recovery-core/src/repair.rs`:

```rust
//! The top-level repair dispatch: route a damaged file to its format pillar.

use crate::error::RepairError;
use crate::model::RepairResult;
use engine_host::format::{detect, Format};

/// Repair a damaged file by detecting its format and dispatching to the matching
/// pillar. Unrecognized input → NotRecognized; a recognized format with no pillar
/// yet → Unsupported. Never emits a silently-empty result.
pub fn repair(bytes: &[u8]) -> Result<RepairResult, RepairError> {
    match detect(bytes) {
        Some(Format::Zip) => crate::zip_repair::repair_zip(bytes),
        Some(_) => Err(RepairError::Unsupported),
        None => Err(RepairError::NotRecognized),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unrecognized_input_is_not_recognized() {
        // `matches!` (not assert_eq!) because RepairResult does not derive PartialEq.
        assert!(matches!(
            repair(b"not a known file at all"),
            Err(RepairError::NotRecognized)
        ));
    }

    #[test]
    fn a_recognized_unsupported_format_is_unsupported() {
        // A PDF is recognized but its pillar is not in this plan.
        assert!(matches!(repair(b"%PDF-1.7\nstuff"), Err(RepairError::Unsupported)));
    }
}
```

- [ ] **Step 4: Declare + re-export** — add to `crates/recovery-core/src/lib.rs`:

```rust
pub mod repair;
```

and after the `pub use diagnose::diagnose;` line:

```rust
pub use repair::repair;
```

- [ ] **Step 5: Run the full crate gate** — Run:
  - `cargo test --manifest-path crates/Cargo.toml -p recovery-core`
  - `cargo fmt --manifest-path crates/Cargo.toml -p recovery-core -- --check` (run `cargo fmt` first if needed)
  - `cargo clippy --manifest-path crates/Cargo.toml -p recovery-core --all-targets -- -D warnings`
  - `grep -rniE "golden rule|ADR-[0-9]|spec §" crates/recovery-core/src` (returns nothing)
    Expected: all pass, fmt clean, clippy clean, no citations.

- [ ] **Step 6: Commit**

```bash
git add crates/recovery-core/src/zip_repair.rs crates/recovery-core/src/repair.rs crates/recovery-core/src/lib.rs
git commit -m "feat(recovery-core): zip repairer + top-level repair dispatch"
```

---

## Notes for the implementer

- **Verify the `zip` 8.6 API against docs.rs** (golden rule 11): `read_zipfile_from_stream<R: Read>(&mut R) -> ZipResult<Option<ZipFile<'_, R>>>` (loop until `Ok(None)`), `ZipFile` implements `Read` + has `.name()`/`.compression()`, `ZipWriter::new(W: Write+Seek)` + `start_file(name, SimpleFileOptions)` + `Write` + `finish() -> W`, `SimpleFileOptions::default().compression_method(CompressionMethod::Deflated)`, `ZipArchive::new(Cursor)` for the intact-read check. Adapt names if the resolved minor differs.
- **Per-entry recovery is all-or-nothing here.** `read_zipfile_from_stream` does not expose partial decompressed bytes for a truncated entry — so a cut entry body is marked lost. Recovering the partial prefix of a truncated final entry (via manual local-header parse + `inflate_salvage` from Plan 1) is a deliberate later seam, not this plan.
- **Streamed entries (general-purpose bit 3 with zeroed local-header sizes)** are not handled by `read_zipfile_from_stream` (it reads `compressed_size` from the local header). Real desktop archives almost always write real sizes; such an entry simply won't recover and is recorded lost. Do not add data-descriptor scanning in this plan.
- **OOXML reconstruction is OPC-skeleton only** — it makes the package _openable_ (content-types + root rels). Repairing a corrupt `word/document.xml`'s internal XML (well-forming) is a later enhancement; v1 reconstructs the packaging, not the body XML.
- **Log-safety:** entry names live in `RecoveredItem.name`/`detail`. These flow to the file's owner via the receipt — never into the redacted error-log pipeline. Only `RepairError::code()` is log-safe.
- The worker route, container, attach-to-matter, and the `files` catalog group are Plan 6 — this plan is the pure engine pillar only.

```

```
