# File Repair & Salvage — Plan 4: PDF cross-reference rebuild pillar

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The third repair pillar — salvage a PDF whose cross-reference table (xref) is broken or truncated by scanning the raw bytes for the indirect objects that are still physically present, synthesizing a fresh classic xref + trailer, re-emitting a clean PDF, and reporting every object that could not be recovered — registered into the `recovery-core` diagnose/repair framework, following the ZIP and CFB pillars' shape.

**Architecture:** Pure-Rust on the `lopdf` 0.41 crate. `lopdf` will not brute-force a broken xref (its reader errors on an unfindable/unparseable xref) and its object parser is private, so recovery cannot parse objects one-by-one. Instead the pillar reconstructs the *index*: a raw-byte scan finds every `N G obj` header and its offset; a fresh classic xref table + trailer (with a located `/Root`) is appended to a copy of the original bytes (whose object offsets are unchanged); `lopdf::Document::load_mem` then loads via that synthesized xref and `save_to` re-emits a clean file. The honest-loss layer is the crux: `lopdf` silently drops any object it cannot re-parse (`Err(_e) => {}` in its reader), so the pillar DIFFS the raw-scanned object set against what actually loaded and records every dropped object — never letting a silent drop become a silent overclaim. Objects packed inside compressed object streams (ObjStm) are invisible to the `N G obj` scan; when the original xref is unusable they cannot be recovered by this pass — a documented seam and a disclosed loss, exactly as the ZIP pillar seamed partial-final-entry recovery and the CFB pillar seamed manual sector-scan reconstruction.

**Tech Stack:** Rust, `lopdf` 0.41 (`default-features = false`), Plan-1 `recovery-core` types, the shared `crate::limits` caps.

## Global Constraints

- I/O-free engine (bytes in as `&[u8]`, result out as `Vec<u8>`); pure-Rust features only. `lopdf` pulls `nom`/`flate2`/`weezl`/RustCrypto — all pure Rust. Pin with `default-features = false` (drops `chrono`/`jiff`/`rayon`/`time`); on `wasm32` add `getrandom`'s `wasm_js` backend so it compiles for the Worker lane.
- Consumes Plan-1 types: `crate::model::{DiagnosisReport, CorruptionKind, Recoverability, RepairResult, LossManifest, RecoveredItem}`, `crate::error::RepairError`, `engine_host::format::{detect, Format}` (the PDF magic is `Format::Pdf`, already detected by `%PDF`).
- **Never overclaim:** every object physically present in the input is recorded recovered or lost. `LossManifest.synthesized` stays empty for PDF (nothing is fabricated — the xref is rebuilt from real offsets, not invented content). A file using compressed object streams whose xref is unusable gets an explicit disclosure loss item.
- **Decompression/size discipline:** apply the shared caps against pathological inputs — the object-count cap (`MAX_ENTRY_COUNT`) bounds the scan; `lopdf` bounds its own stream inflation. Reuse the shared `crate::limits` constants; do not redefine them.
- **Log-safety:** `RecoveredItem.name`/`detail` are owner-facing receipt fields (an object number is structural, not privileged content); they must NEVER flow to the redacted error-log pipeline. Every `detail` is a FIXED literal — never PDF content bytes. Only `RepairError::code()` is log-safe.
- No process-doc citations in source (no "golden rule N"/ADR/spec § / "Plan N" in comments). Full names, no shorthand.
- Verify the `lopdf` 0.41 API against the vendored crate source before use (golden rule 11). API facts below were verified against `lopdf` 0.41.0 at `~/.cargo/registry/src/*/lopdf-0.41.0/`.

## Pillar shape (established by Plans 2–3, follow it here)

`diagnose_pdf(bytes) -> (Vec<CorruptionKind>, Recoverability)` and `repair_pdf(bytes) -> Result<RepairResult, RepairError>`, each registered into the `detect()`-keyed dispatch in BOTH `diagnose.rs` and `repair.rs`. Reconciliation uses **set membership**, never first-match. Caps are injectable so the honesty paths are testable without huge inputs. Any dropped object is folded into the `LossManifest` so `fully_recovered` cannot overclaim.

---

### Task 1: Add the `lopdf` dependency + the PDF module skeleton

**Files:**
- Modify: `crates/recovery-core/Cargo.toml` (add `lopdf`; add the wasm `getrandom` backend)
- Create: `crates/recovery-core/src/pdf_repair.rs`
- Modify: `crates/recovery-core/src/lib.rs` (declare `pdf_repair`)

**Interfaces:**
- Produces: an empty `pdf_repair` module; the `lopdf` crate available on both native and wasm targets.

- [ ] **Step 1: Add `lopdf` to `crates/recovery-core/Cargo.toml`** under `[dependencies]` (after `cfb`/`uuid`):

```toml
# Read/write PDF object model. The recovery pillar cannot brute-force a broken
# xref through lopdf (its reader errors on an unparseable xref and its object
# parser is private), so it synthesizes a fresh xref and reloads; lopdf then
# parses the objects and re-emits a clean file. default-features=false drops the
# date/parallelism features (chrono/jiff/rayon/time) the load/save path never needs.
lopdf = { version = "0.41", default-features = false }
```

- [ ] **Step 2: Add the wasm `getrandom` backend** at the END of `crates/recovery-core/Cargo.toml` (lopdf pulls `getrandom`, which needs the `wasm_js` backend to compile for `wasm32-unknown-unknown`):

```toml
# lopdf pulls getrandom; the Worker (wasm32-unknown-unknown) lane requires the
# wasm_js backend to compile.
[target.'cfg(target_arch = "wasm32")'.dependencies]
getrandom = { version = "0.4", features = ["wasm_js"] }
```

- [ ] **Step 3: Create `crates/recovery-core/src/pdf_repair.rs`** stub:

```rust
//! The PDF cross-reference rebuild pillar: scan the raw bytes for the indirect
//! objects still physically present, synthesize a fresh classic xref + trailer,
//! reload through lopdf, and re-emit a clean PDF — recording every object that
//! could not be re-parsed as lost. Diagnose PDF xref corruption.
```

- [ ] **Step 4: Declare the module** in `crates/recovery-core/src/lib.rs` (keep alphabetical with the rest, i.e. after `limits` / before `repair`):

```rust
pub mod pdf_repair;
```

- [ ] **Step 5: Verify it builds on both targets + no C dependency creeps in** — Run:
  - `cargo build --manifest-path crates/Cargo.toml -p recovery-core`
  - `cargo build --manifest-path crates/Cargo.toml -p recovery-core --target wasm32-unknown-unknown`
  - `cargo tree --manifest-path crates/Cargo.toml -p recovery-core -i flate2 -e features` — confirm the DEFLATE backend resolves to the pure-Rust `miniz_oxide`/`rust_backend`, NOT a C `zlib`/`zlib-ng` backend. (recovery-core already pins `flate2` with `default-features=false, features=["rust_backend"]`; cargo unifies lopdf's `flate2` onto it. If a C backend appears, add the matching pin.)
  Expected: both builds compile; no C zlib backend. If the wasm build fails on `getrandom`, confirm Step 2 landed.

- [ ] **Step 6: Commit**

```bash
git add crates/recovery-core/Cargo.toml crates/recovery-core/src/pdf_repair.rs crates/recovery-core/src/lib.rs crates/Cargo.lock
git commit -m "feat(recovery-core): add lopdf dep + PDF module skeleton"
```

---

### Task 2: Scan the raw bytes for indirect objects

**Files:**
- Modify: `crates/recovery-core/src/pdf_repair.rs`

**Interfaces:**
- Produces:
  - `pub struct ScannedObject { pub number: u32, pub generation: u16, pub offset: usize }`
  - `pub fn scan_objects(bytes: &[u8], max_count: usize) -> Vec<ScannedObject>` — forward-scan for every `N G obj` indirect-object header; `offset` is the byte index of the header's first digit; capped at `max_count` headers. Best-effort: a digit run that is not followed by `<uint> obj` is skipped.

- [ ] **Step 1: Write the failing tests** — append to `crates/recovery-core/src/pdf_repair.rs`:

```rust
#[cfg(test)]
mod scan_tests {
    use super::*;

    #[test]
    fn finds_each_indirect_object_header() {
        let bytes = b"%PDF-1.5\n1 0 obj\n<< /Type /Catalog >>\nendobj\n12 3 obj\n(hi)\nendobj\n";
        let found = scan_objects(bytes, 1000);
        assert_eq!(found.len(), 2);
        assert_eq!((found[0].number, found[0].generation), (1, 0));
        assert_eq!((found[1].number, found[1].generation), (12, 3));
        // The recorded offset points at the header's first digit.
        assert_eq!(&bytes[found[0].offset..found[0].offset + 5], b"1 0 o");
    }

    #[test]
    fn ignores_the_word_obj_that_is_not_a_header() {
        // "endobj" contains "obj" but is not preceded by "<uint> <uint> ".
        let bytes = b"1 0 obj\n<< >>\nendobj\n";
        let found = scan_objects(bytes, 1000);
        assert_eq!(found.len(), 1);
    }

    #[test]
    fn respects_the_count_cap() {
        let bytes = b"1 0 obj\nendobj\n2 0 obj\nendobj\n3 0 obj\nendobj\n";
        assert_eq!(scan_objects(bytes, 2).len(), 2);
    }
}
```

- [ ] **Step 2: Run to verify they fail** — Run: `cargo test --manifest-path crates/Cargo.toml -p recovery-core pdf_repair::scan`. Expected: FAIL — `scan_objects` not defined.

- [ ] **Step 3: Implement the scanner** — add above the `#[cfg(test)]` block:

```rust
/// One indirect-object header (`N G obj`) found by the raw scan, with the byte
/// offset of its first digit (the offset a cross-reference entry must point at).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScannedObject {
    pub number: u32,
    pub generation: u16,
    pub offset: usize,
}

/// Forward-scan `bytes` for every `N G obj` indirect-object header. A header is a
/// run of digits (the object number), PDF whitespace, a run of digits (the
/// generation), PDF whitespace, then the literal `obj`. Anything that does not
/// match is skipped (e.g. the `obj` inside `endobj`, or digits inside content).
/// Stops after `max_count` headers to bound work on pathological input.
pub fn scan_objects(bytes: &[u8], max_count: usize) -> Vec<ScannedObject> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        // A header only starts where a digit follows a delimiter/whitespace or the
        // file start — this avoids re-matching inside a longer digit run.
        let at_boundary = i == 0 || is_pdf_whitespace(bytes[i - 1]) || is_pdf_delimiter(bytes[i - 1]);
        if at_boundary && bytes[i].is_ascii_digit() {
            if let Some(parsed) = parse_header_at(bytes, i) {
                out.push(parsed);
                if out.len() >= max_count {
                    break;
                }
                // Continue scanning after the "obj" keyword.
                i = parsed.offset;
                // Advance past the digits we consumed; a simple +1 is enough since
                // the next boundary check re-anchors, but jump past the number to
                // avoid O(n^2) on huge digit runs.
                while i < bytes.len() && bytes[i].is_ascii_digit() {
                    i += 1;
                }
                continue;
            }
        }
        i += 1;
    }
    out
}

/// Try to parse `N G obj` starting at `start` (which must index a digit). Returns
/// the parsed header (with `offset == start`) or None if the shape does not hold.
fn parse_header_at(bytes: &[u8], start: usize) -> Option<ScannedObject> {
    let mut i = start;
    let (number, next) = parse_uint::<u32>(bytes, i)?;
    i = next;
    i = skip_whitespace(bytes, i)?;
    let (generation, next) = parse_uint::<u16>(bytes, i)?;
    i = next;
    i = skip_whitespace(bytes, i)?;
    if bytes.get(i..i + 3) != Some(b"obj") {
        return None;
    }
    // "obj" must end at a delimiter, whitespace, or EOF to be the keyword.
    match bytes.get(i + 3) {
        None => {}
        Some(&b) if is_pdf_whitespace(b) || is_pdf_delimiter(b) => {}
        Some(_) => return None,
    }
    Some(ScannedObject { number, generation, offset: start })
}

/// Parse an unsigned integer, returning (value, index-after-digits). Fails on no
/// digits or on overflow of the target type.
fn parse_uint<T: TryFrom<u64>>(bytes: &[u8], start: usize) -> Option<(T, usize)> {
    let mut i = start;
    let mut value: u64 = 0;
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        value = value.checked_mul(10)?.checked_add((bytes[i] - b'0') as u64)?;
        i += 1;
    }
    if i == start {
        return None;
    }
    T::try_from(value).ok().map(|v| (v, i))
}

/// Advance over at least one PDF whitespace byte; None if there is not one.
fn skip_whitespace(bytes: &[u8], start: usize) -> Option<usize> {
    let mut i = start;
    while i < bytes.len() && is_pdf_whitespace(bytes[i]) {
        i += 1;
    }
    if i == start {
        None
    } else {
        Some(i)
    }
}

/// PDF whitespace: null, tab, line feed, form feed, carriage return, space.
fn is_pdf_whitespace(b: u8) -> bool {
    matches!(b, 0x00 | 0x09 | 0x0A | 0x0C | 0x0D | 0x20)
}

/// PDF delimiter characters.
fn is_pdf_delimiter(b: u8) -> bool {
    matches!(b, b'(' | b')' | b'<' | b'>' | b'[' | b']' | b'{' | b'}' | b'/' | b'%')
}
```

- [ ] **Step 4: Run to verify they pass** — Run: `cargo test --manifest-path crates/Cargo.toml -p recovery-core pdf_repair::scan`. Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add crates/recovery-core/src/pdf_repair.rs
git commit -m "feat(recovery-core): raw-byte scan for pdf indirect objects"
```

---

### Task 3: Locate the document catalog (`/Root`)

**Files:**
- Modify: `crates/recovery-core/src/pdf_repair.rs`

**Interfaces:**
- Consumes: `scan_objects` / `ScannedObject` from Task 2.
- Produces: `pub fn find_root(bytes: &[u8], scanned: &[ScannedObject]) -> Option<(u32, u16)>` — the object number+generation of the first scanned object whose body declares `/Type /Catalog`, or None if none is found.

- [ ] **Step 1: Write the failing tests** — append:

```rust
#[cfg(test)]
mod root_tests {
    use super::*;

    #[test]
    fn locates_the_catalog_object() {
        let bytes = b"1 0 obj\n<< /Type /Pages /Count 0 >>\nendobj\n2 0 obj\n<< /Type /Catalog /Pages 1 0 R >>\nendobj\n";
        let scanned = scan_objects(bytes, 1000);
        assert_eq!(find_root(bytes, &scanned), Some((2, 0)));
    }

    #[test]
    fn returns_none_when_no_catalog_is_present() {
        let bytes = b"1 0 obj\n<< /Type /Pages >>\nendobj\n";
        let scanned = scan_objects(bytes, 1000);
        assert_eq!(find_root(bytes, &scanned), None);
    }
}
```

- [ ] **Step 2: Run to verify they fail** — Run: `cargo test --manifest-path crates/Cargo.toml -p recovery-core pdf_repair::root`. Expected: FAIL — `find_root` not defined.

- [ ] **Step 3: Implement** — add above the `#[cfg(test)]` block:

```rust
/// Locate the document catalog by scanning each object's body for a `/Type`
/// dictionary entry naming `/Catalog`. Best-effort — the object's byte span runs
/// from its header offset to the next object's offset (or end of file). The
/// trailer's `/Root` reference ultimately validates the choice when the file
/// reloads; a false positive simply fails that reload and is caught upstream.
pub fn find_root(bytes: &[u8], scanned: &[ScannedObject]) -> Option<(u32, u16)> {
    for (index, object) in scanned.iter().enumerate() {
        let end = scanned
            .get(index + 1)
            .map(|next| next.offset)
            .unwrap_or(bytes.len());
        let body = &bytes[object.offset..end];
        if contains(body, b"/Type") && contains(body, b"/Catalog") {
            return Some((object.number, object.generation));
        }
    }
    None
}

/// True if `haystack` contains `needle` (small, non-allocating substring search).
fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    if needle.is_empty() || haystack.len() < needle.len() {
        return needle.is_empty();
    }
    haystack.windows(needle.len()).any(|w| w == needle)
}
```

- [ ] **Step 4: Run to verify they pass** — Run: `cargo test --manifest-path crates/Cargo.toml -p recovery-core pdf_repair::root`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/recovery-core/src/pdf_repair.rs
git commit -m "feat(recovery-core): locate the pdf catalog for /Root"
```

---

### Task 4: Synthesize a fresh cross-reference table and append it

**Files:**
- Modify: `crates/recovery-core/src/pdf_repair.rs`

**Interfaces:**
- Consumes: `ScannedObject` from Task 2.
- Produces: `pub fn rebuild_with_xref(bytes: &[u8], scanned: &[ScannedObject], root: (u32, u16)) -> Vec<u8>` — return a copy of `bytes` with a fresh classic xref table, a trailer (`/Size`, `/Root`), and `startxref` appended, so `lopdf::Document::load_mem` can load it. The appended xref references each scanned object at its original offset; later duplicates of an object number win (the offset physically latest in the file is the current revision).

- [ ] **Step 1: Write the failing test** — append (this test round-trips through lopdf, proving the synthesized xref is loadable):

```rust
#[cfg(test)]
mod xref_tests {
    use super::*;
    use lopdf::Document;

    #[test]
    fn appended_xref_makes_a_headerless_body_loadable() {
        // A PDF body with objects but NO xref/trailer (as if truncated before them).
        let body = b"%PDF-1.5\n\
1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n\
2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n\
3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n";
        let scanned = scan_objects(body, 1000);
        let root = find_root(body, &scanned).expect("catalog present");
        let patched = rebuild_with_xref(body, &scanned, root);
        let doc = Document::load_mem(&patched).expect("loads via the synthesized xref");
        // All three objects are present and the catalog is the trailer Root.
        assert!(doc.objects.contains_key(&(1, 0)));
        assert!(doc.objects.contains_key(&(2, 0)));
        assert!(doc.objects.contains_key(&(3, 0)));
    }
}
```

- [ ] **Step 2: Run to verify it fails** — Run: `cargo test --manifest-path crates/Cargo.toml -p recovery-core pdf_repair::xref`. Expected: FAIL — `rebuild_with_xref` not defined.

- [ ] **Step 3: Implement** — add above the `#[cfg(test)]` block (add `use std::collections::BTreeMap;` at the module top if not present):

```rust
/// Append a fresh classic cross-reference table + trailer + `startxref` to a copy
/// of `bytes`, indexing every scanned object at its original offset. The original
/// object bytes are untouched (so their offsets stay valid); lopdf reads the last
/// `startxref` (this one) and loads through it. Object 0 is the mandatory free
/// head; object number 0 is never a real object and is ignored if scanned. When an
/// object number appears more than once, the physically-latest offset wins.
pub fn rebuild_with_xref(bytes: &[u8], scanned: &[ScannedObject], root: (u32, u16)) -> Vec<u8> {
    // number -> (generation, offset); insertion order is file order, so a later
    // duplicate overwrites an earlier one (latest revision wins).
    let mut by_number: BTreeMap<u32, (u16, usize)> = BTreeMap::new();
    for object in scanned {
        if object.number == 0 {
            continue;
        }
        by_number.insert(object.number, (object.generation, object.offset));
    }

    let size = by_number.keys().copied().max().map(|n| n + 1).unwrap_or(1);

    let mut out = bytes.to_vec();
    // The xref keyword must begin its own line.
    if !out.is_empty() && *out.last().unwrap() != b'\n' {
        out.push(b'\n');
    }
    let xref_offset = out.len();

    out.extend_from_slice(b"xref\n");
    // Free-list head: object 0.
    out.extend_from_slice(b"0 1\n");
    out.extend_from_slice(b"0000000000 65535 f \n");

    // Group present object numbers into contiguous runs (xref subsections). Each
    // in-use entry is exactly 20 bytes: 10-digit offset, gen, type, 2-byte EOL.
    let numbers: Vec<u32> = by_number.keys().copied().collect();
    let mut i = 0;
    while i < numbers.len() {
        let mut j = i;
        while j + 1 < numbers.len() && numbers[j + 1] == numbers[j] + 1 {
            j += 1;
        }
        let start = numbers[i];
        let count = (j - i + 1) as u32;
        out.extend_from_slice(format!("{start} {count}\n").as_bytes());
        for number in &numbers[i..=j] {
            let (generation, offset) = by_number[number];
            out.extend_from_slice(format!("{offset:010} {generation:05} n \n").as_bytes());
        }
        i = j + 1;
    }

    out.extend_from_slice(b"trailer\n");
    out.extend_from_slice(
        format!("<< /Size {size} /Root {} {} R >>\n", root.0, root.1).as_bytes(),
    );
    out.extend_from_slice(b"startxref\n");
    out.extend_from_slice(format!("{xref_offset}\n").as_bytes());
    out.extend_from_slice(b"%%EOF\n");
    out
}
```

- [ ] **Step 4: Run to verify it passes** — Run: `cargo test --manifest-path crates/Cargo.toml -p recovery-core pdf_repair::xref`. Expected: PASS. If lopdf rejects the xref, verify (against the vendored reader) the expected in-use entry width (20 bytes incl. a 2-byte EOL) and the subsection-header form.

- [ ] **Step 5: Commit**

```bash
git add crates/recovery-core/src/pdf_repair.rs
git commit -m "feat(recovery-core): synthesize a fresh pdf cross-reference table"
```

---

### Task 5: The PDF repairer + honest loss manifest + register into the repair dispatch

**Files:**
- Modify: `crates/recovery-core/src/pdf_repair.rs`
- Modify: `crates/recovery-core/src/repair.rs`

**Interfaces:**
- Consumes: `scan_objects`, `find_root`, `rebuild_with_xref` (Tasks 2–4); `crate::limits::MAX_ENTRY_COUNT`; `lopdf::Document`.
- Produces (in `pdf_repair`): `pub fn repair_pdf(bytes: &[u8]) -> Result<RepairResult, RepairError>` — scan objects (Err `Unrepairable` if none); locate `/Root` (Err `Unrepairable` if none); synthesize the xref; `load_mem` the patched buffer (Err `Unrepairable` if it still will not load); `save_to` a fresh buffer; build the `LossManifest` by DIFFING scanned object numbers against the numbers lopdf actually loaded (each scanned number → one `RecoveredItem`, recovered iff loaded); disclose a compressed-object-stream coverage gap as a loss item; `synthesized` empty; `fully_recovered` = all items recovered.
- Consumes (in `repair`): the `Pdf` arm dispatches to `repair_pdf`.

- [ ] **Step 1: Write the failing tests** — append to `pdf_repair.rs`:

```rust
#[cfg(test)]
mod repair_tests {
    use super::*;
    use lopdf::Document;

    /// A PDF body (objects present) with NO trailing xref/trailer.
    fn headerless_pdf() -> Vec<u8> {
        b"%PDF-1.5\n\
1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n\
2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n\
3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n"
            .to_vec()
    }

    #[test]
    fn repairs_a_broken_xref_and_reopens() {
        let result = repair_pdf(&headerless_pdf()).expect("repairable");
        // The re-emitted file is a valid PDF that lopdf reloads cleanly.
        let reopened = Document::load_mem(&result.salvaged).expect("valid pdf");
        assert!(reopened.objects.contains_key(&(1, 0)));
        assert!(result.loss.fully_recovered);
        assert!(result.loss.synthesized.is_empty());
        assert_eq!(result.loss.items.iter().filter(|i| i.recovered).count(), 3);
    }

    #[test]
    fn a_corrupt_object_is_reported_lost_not_dropped_silently() {
        // Object 4 has a malformed body lopdf cannot parse; it must be reported
        // lost, and the file must not claim full recovery.
        let mut bytes = headerless_pdf();
        bytes.extend_from_slice(b"4 0 obj\n<< /Broken << << /a >> endobj\n");
        let result = repair_pdf(&bytes).expect("repairable");
        let four = result
            .loss
            .items
            .iter()
            .find(|i| i.name.contains('4'))
            .expect("object 4 accounted for");
        assert!(!four.recovered);
        assert!(!result.loss.fully_recovered);
    }

    #[test]
    fn input_without_objects_is_unrepairable() {
        assert!(repair_pdf(b"%PDF-1.5\nno objects here\n").is_err());
    }
}
```

- [ ] **Step 2: Run to verify they fail** — Run: `cargo test --manifest-path crates/Cargo.toml -p recovery-core pdf_repair::repair`. Expected: FAIL — `repair_pdf` not defined.

- [ ] **Step 3: Implement `repair_pdf`** — add above the `#[cfg(test)]` block (add `use std::collections::BTreeSet;` and the model/limit imports at the module top):

```rust
use std::collections::BTreeSet;

use lopdf::Document;

use crate::error::RepairError;
use crate::limits::MAX_ENTRY_COUNT;
use crate::model::{LossManifest, RecoveredItem, RepairResult};

/// Repair a PDF whose cross-reference table is broken: scan the objects still in
/// the file, synthesize a fresh xref, reload through lopdf, and re-emit a clean
/// PDF — recording every object lopdf could not re-parse as lost, so a silent
/// drop never becomes a silent overclaim. Errors (rather than emitting a hollow
/// file) when no objects or no catalog can be found, or the rebuild will not load.
pub fn repair_pdf(bytes: &[u8]) -> Result<RepairResult, RepairError> {
    let scanned = scan_objects(bytes, MAX_ENTRY_COUNT);
    if scanned.is_empty() {
        return Err(RepairError::Unrepairable);
    }
    let root = find_root(bytes, &scanned).ok_or(RepairError::Unrepairable)?;
    let patched = rebuild_with_xref(bytes, &scanned, root);
    let mut document = Document::load_mem(&patched).map_err(|_| RepairError::Unrepairable)?;

    let mut salvaged = Vec::new();
    document
        .save_to(&mut salvaged)
        .map_err(|_| RepairError::Unrepairable)?;

    // Honest loss: which scanned object numbers did lopdf actually load? A number
    // the raw scan found but the loaded document lacks was silently dropped by
    // lopdf's parser and must be reported.
    let loaded: BTreeSet<u32> = document.objects.keys().map(|(number, _)| *number).collect();
    let scanned_numbers: BTreeSet<u32> =
        scanned.iter().map(|o| o.number).filter(|n| *n != 0).collect();

    let mut items: Vec<RecoveredItem> = scanned_numbers
        .iter()
        .map(|number| {
            let recovered = loaded.contains(number);
            RecoveredItem {
                name: format!("object {number}"),
                recovered,
                detail: if recovered {
                    String::new()
                } else {
                    "object could not be parsed and was dropped".to_string()
                },
            }
        })
        .collect();

    // Objects packed inside a compressed object stream are invisible to the raw
    // `N G obj` scan; when the original xref is unusable they cannot be recovered
    // by this rebuild. Disclose the possibility rather than imply a complete
    // accounting — a coverage gap, not a fabrication.
    if contains(bytes, b"/ObjStm") {
        items.push(RecoveredItem {
            name: "(compressed object streams)".to_string(),
            recovered: false,
            detail: "this file uses compressed object streams; objects packed inside them are not recovered by cross-reference rebuild".to_string(),
        });
    }

    let fully_recovered = items.iter().all(|i| i.recovered);
    Ok(RepairResult {
        salvaged,
        loss: LossManifest {
            // Nothing is fabricated — the xref is rebuilt from real offsets.
            items,
            fully_recovered,
            synthesized: Vec::new(),
        },
    })
}
```

- [ ] **Step 4: Register into the repair dispatch** — in `crates/recovery-core/src/repair.rs`, add the `Pdf` arm before the `Some(_) => Err(...Unsupported)` catch-all (match the existing `Zip`/`Ole2` arm style):

```rust
        Some(Format::Pdf) => crate::pdf_repair::repair_pdf(bytes),
```

- [ ] **Step 5: Run the tests** — Run: `cargo test --manifest-path crates/Cargo.toml -p recovery-core pdf_repair::repair` then the full crate. Expected: PASS. If `a_corrupt_object_is_reported_lost_not_dropped_silently` fails because lopdf parses (or wholly rejects) the malformed object differently than expected, adjust the fixture so object 4's body is syntactically unparseable yet still matched by the `4 0 obj` scan (the property under test is: scanned-but-not-loaded ⇒ reported lost).

- [ ] **Step 6: Commit**

```bash
git add crates/recovery-core/src/pdf_repair.rs crates/recovery-core/src/repair.rs
git commit -m "feat(recovery-core): pdf repairer with honest loss manifest + register dispatch"
```

---

### Task 6: Diagnose PDF xref corruption + register the diagnoser

**Files:**
- Modify: `crates/recovery-core/src/pdf_repair.rs`
- Modify: `crates/recovery-core/src/diagnose.rs`

**Interfaces:**
- Consumes: `scan_objects`, `find_root`, `rebuild_with_xref` (Tasks 2–4); `lopdf::Document`.
- Produces (in `pdf_repair`): `pub fn diagnose_pdf(bytes: &[u8]) -> (Vec<crate::model::CorruptionKind>, crate::model::Recoverability)` — no objects → (`[Other]`, `Unrecoverable`); loads as-is → (`[]`, `Intact`); original will not load but the rebuild loads every scanned object → (`[BrokenCrossReference]`, `Repairable`); rebuild loads but some scanned objects are missing → (`[BrokenCrossReference]`, `Partial`); no catalog → (`[MissingRequiredParts]`, `Unrecoverable`); rebuild will not load → (`[BrokenCrossReference]`, `Unrecoverable`). The Repairable-vs-Partial split uses the SAME scanned-number-set ⊆ loaded-number-set check as the repair manifest, so diagnose and repair never disagree.
- Consumes (in `diagnose`): the `Pdf` arm calls `diagnose_pdf` and sets `repair_supported = true`.

- [ ] **Step 1: Write the failing tests** — append to `pdf_repair.rs`:

```rust
#[cfg(test)]
mod diagnose_tests {
    use super::*;
    use crate::model::Recoverability;
    use lopdf::Document;

    /// A well-formed PDF (valid xref) built by lopdf.
    fn valid_pdf() -> Vec<u8> {
        // Reuse the repair-test body then repair it once to get a clean file with
        // a real xref, so "loads as-is" is exercised.
        let body = b"%PDF-1.5\n\
1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n\
2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n\
3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n";
        let scanned = scan_objects(body, 1000);
        let root = find_root(body, &scanned).unwrap();
        let patched = rebuild_with_xref(body, &scanned, root);
        let mut doc = Document::load_mem(&patched).unwrap();
        let mut clean = Vec::new();
        doc.save_to(&mut clean).unwrap();
        clean
    }

    #[test]
    fn a_valid_pdf_is_intact() {
        let (corruption, recoverability) = diagnose_pdf(&valid_pdf());
        assert_eq!(recoverability, Recoverability::Intact);
        assert!(corruption.is_empty());
    }

    #[test]
    fn a_broken_xref_with_objects_is_repairable() {
        let body = b"%PDF-1.5\n\
1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n\
2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n\
3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n";
        let (corruption, recoverability) = diagnose_pdf(body);
        assert_eq!(recoverability, Recoverability::Repairable);
        assert_eq!(corruption, vec![CorruptionKind::BrokenCrossReference]);
    }

    #[test]
    fn input_without_objects_is_unrecoverable() {
        let (_c, recoverability) = diagnose_pdf(b"%PDF-1.5\nnothing here\n");
        assert_eq!(recoverability, Recoverability::Unrecoverable);
    }
}
```

- [ ] **Step 2: Run to verify they fail** — Run: `cargo test --manifest-path crates/Cargo.toml -p recovery-core pdf_repair::diagnose`. Expected: FAIL — `diagnose_pdf` not defined.

- [ ] **Step 3: Implement `diagnose_pdf`** — add above the `#[cfg(test)]` block (add `use crate::model::{CorruptionKind, Recoverability};` at the module top):

```rust
/// Classify a PDF's cross-reference health. Loads as-is → intact; original will
/// not load but a rebuilt xref loads every scanned object → repairable; the
/// rebuild loads but is missing some scanned objects → partial; no catalog or a
/// rebuild that still will not load → unrecoverable by this pillar.
///
/// The "loads as-is → intact" fast path deliberately does not second-guess a file
/// lopdf already accepts (an xref-stream file's own xref object would otherwise
/// skew an object-count check); the repair manifest remains the authoritative
/// per-object accounting. The repairable-vs-partial split uses a scanned ⊆ loaded
/// object-number SET check (not a length compare) so it agrees with the manifest.
pub fn diagnose_pdf(bytes: &[u8]) -> (Vec<CorruptionKind>, Recoverability) {
    let scanned = scan_objects(bytes, MAX_ENTRY_COUNT);
    if scanned.is_empty() {
        return (vec![CorruptionKind::Other], Recoverability::Unrecoverable);
    }

    // Loads as-is → nothing to repair.
    if Document::load_mem(bytes).is_ok() {
        return (Vec::new(), Recoverability::Intact);
    }

    let root = match find_root(bytes, &scanned) {
        Some(root) => root,
        None => return (vec![CorruptionKind::MissingRequiredParts], Recoverability::Unrecoverable),
    };
    let patched = rebuild_with_xref(bytes, &scanned, root);
    match Document::load_mem(&patched) {
        Ok(document) => {
            let scanned_numbers: BTreeSet<u32> =
                scanned.iter().map(|o| o.number).filter(|n| *n != 0).collect();
            let loaded: BTreeSet<u32> =
                document.objects.keys().map(|(number, _)| *number).collect();
            if scanned_numbers.iter().all(|number| loaded.contains(number)) {
                (vec![CorruptionKind::BrokenCrossReference], Recoverability::Repairable)
            } else {
                (vec![CorruptionKind::BrokenCrossReference], Recoverability::Partial)
            }
        }
        Err(_) => (vec![CorruptionKind::BrokenCrossReference], Recoverability::Unrecoverable),
    }
}
```

- [ ] **Step 4: Wire into the diagnose framework** — in `crates/recovery-core/src/diagnose.rs`, add a `Pdf` arm to the `match detect(bytes)` (above the catch-all `Some(format) =>`), matching the existing `Zip`/`Ole2` arm style:

```rust
        Some(Format::Pdf) => {
            let (corruption, recoverability) = crate::pdf_repair::diagnose_pdf(bytes);
            DiagnosisReport {
                detected_format: Some(Format::Pdf),
                corruption,
                recoverability,
                repair_supported: true,
                detail: "pdf document".into(),
            }
        }
```

- [ ] **Step 5: Add a diagnose-framework test** — in `diagnose.rs` tests, mirroring the existing zip/cfb equivalents:

```rust
    #[test]
    fn a_recognized_pdf_reports_repair_supported() {
        let pdf = b"%PDF-1.5\n1 0 obj\n<< /Type /Catalog >>\nendobj\n";
        let report = diagnose(pdf);
        assert_eq!(report.detected_format, Some(Format::Pdf));
        assert!(report.repair_supported);
    }
```

- [ ] **Step 6: Run the full crate gate** — Run:
  - `cargo test --manifest-path crates/Cargo.toml -p recovery-core`
  - `cargo fmt --manifest-path crates/Cargo.toml -p recovery-core` then `cargo fmt --manifest-path crates/Cargo.toml -p recovery-core -- --check` (stage everything it touches)
  - `cargo clippy --manifest-path crates/Cargo.toml -p recovery-core --all-targets -- -D warnings`
  - `grep -rniE "golden rule|ADR-[0-9]|spec §|slice [0-9]" crates/recovery-core/src` (returns nothing)
  Expected: all pass, fmt clean, clippy clean, no citations, clean working tree after commit.

- [ ] **Step 7: Commit**

```bash
git add crates/recovery-core/src/pdf_repair.rs crates/recovery-core/src/diagnose.rs
git commit -m "feat(recovery-core): diagnose pdf xref corruption + register the diagnoser"
```

---

## Notes for the implementer

- **Verify the `lopdf` 0.41 API against the vendored source** (golden rule 11): `Document::load_mem(&[u8]) -> Result<Document>` (lenient — `LoadOptions::default()` has `strict: false`); `Document { objects: BTreeMap<ObjectId, Object>, trailer: Dictionary, version: String, max_id: u32, reference_table: Xref }`; `ObjectId = (u32, u16)`; `Document::save_to<W: Write>(&mut self, &mut W) -> Result<()>`. lopdf's reader silently skips objects it cannot parse (`Err(_e) => {}`) — that silent drop is exactly what the scanned-vs-loaded diff surfaces. lopdf's `parser` module is PRIVATE, which is why recovery synthesizes an xref and reloads rather than parsing objects individually.
- **The honest-loss diff is the point.** Never trust `Document::load_mem` to tell you what it dropped — it will not. Always diff the raw-scanned object numbers against `document.objects` and report the difference.
- **Compressed object streams (ObjStm) are the documented seam.** The `N G obj` scan cannot see objects packed inside an ObjStm, so a file whose real xref is unusable AND which packs objects in ObjStm loses those objects. Task 5 discloses this as a loss item; the deeper recovery (parsing ObjStm contents by hand) is a separate, larger effort — the same kind of deepest-case seam the ZIP and CFB pillars left.
- **Caps:** `MAX_ENTRY_COUNT` bounds the object scan; lopdf bounds its own stream inflation on load. `scan_objects` takes the cap as a parameter so the count path is testable.
- **Log-safety:** object numbers in `RecoveredItem.name` are structural, not privileged content, and are owner-facing receipt only — never the redacted log path. Only `RepairError::code()` is log-safe.
- **`fully_recovered` scope:** as with the other pillars, a repaired PDF is a freshly re-serialized file (lopdf writes its own clean xref), not a byte-identical copy. `fully_recovered` means every object physically present in the input was carried into the output — it never claims byte-identity.
- The worker route, container heavy lane, attach-to-matter, and the `files` catalog group are Plan 6 — this plan is the pure engine pillar only. An OPTIONAL Plan-6 enhancement is render-verification of the repaired PDF via the mainline `pdf-core` hayro path ("N of M pages decode") on the container lane; it must never couple into this WASM-default-lane engine.
