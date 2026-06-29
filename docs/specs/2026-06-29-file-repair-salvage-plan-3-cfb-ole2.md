# File Repair & Salvage — Plan 3: CFB/OLE2 family pillar

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The second repair pillar — salvage damaged CFB/OLE2 compound files (legacy `.doc`/`.xls`/`.ppt`, Outlook `.msg`, MSI) by reading the streams the `cfb` crate can still open and re-emitting a fresh compound file — registered into the `recovery-core` diagnose/repair framework, following the ZIP pillar's shape.

**Architecture:** Pure-Rust on the `cfb` 0.14 crate. `CompoundFile::open` validates the header/FAT/directory eagerly but reads stream sectors lazily — so for the common **truncation** damage (metadata intact, trailing stream data cut) it succeeds and intact streams read while only the truncated stream errors. The pillar walks the directory, best-effort reads each stream (truncated/corrupt streams → recorded lost), and rebuilds a clean CFB. The deeper case — `open` itself failing on a damaged header/FAT/directory, requiring manual sector-scan reconstruction — is a documented seam (the MS-CFB format facts are captured in the research), not this plan, exactly as the ZIP pillar seamed partial-final-entry recovery.

**Tech Stack:** Rust, `cfb` 0.14, Plan-1 `recovery-core` types, the Plan-2 cap constants (extracted to a shared `limits` module here).

## Global Constraints

- I/O-free engine (bytes in via `std::io::Cursor`, result out); pure-Rust features only.
- Consumes Plan-1 types: `crate::model::{DiagnosisReport, CorruptionKind, Recoverability, RepairResult, LossManifest, RecoveredItem}`, `crate::error::RepairError`, `engine_host::format::{detect, Format}` (the CFB magic is `Format::Ole2`).
- **Never overclaim:** every stream is recorded recovered or lost; `LossManifest.synthesized` stays empty for CFB (nothing is fabricated — the hierarchy is preserved or noted lost).
- **Decompression/size discipline:** CFB streams are not compressed, but apply the same caps against pathological inputs — per-stream byte cap, total cap, stream-count cap — reusing the shared `limits` constants.
- **Log-safety:** `RecoveredItem.name`/`detail` carry stream paths — returned to the file's owner, never to the redacted error-log pipeline (only `RepairError::code()` is log-safe).
- No process-doc citations in source (no "golden rule N"/ADR/spec § in comments). Full names.
- Verify crate pins against docs.rs before use (golden rule 11). API facts verified against `cfb` 0.14.0.

---

### Task 1: Add the `cfb` dependency, extract shared cap limits, + the CFB module skeleton

**Files:**
- Modify: `crates/recovery-core/Cargo.toml` (add `cfb`)
- Create: `crates/recovery-core/src/limits.rs`
- Modify: `crates/recovery-core/src/zip_repair.rs` (use the shared limits)
- Create: `crates/recovery-core/src/cfb_repair.rs`
- Modify: `crates/recovery-core/src/lib.rs` (declare `limits` + `cfb_repair`)

**Interfaces:**
- Produces: `pub const MAX_ENTRY_UNCOMPRESSED_BYTES: u64`, `pub const MAX_TOTAL_UNCOMPRESSED_BYTES: u64`, `pub const MAX_ENTRY_COUNT: usize` in `crate::limits`; an empty `cfb_repair` module; the `cfb` crate available.

- [ ] **Step 1: Add `cfb` to `crates/recovery-core/Cargo.toml`** under `[dependencies]` (after `zip`):

```toml
# Read/write CFB (OLE2 compound files) — the container behind legacy .doc/.xls/.ppt, .msg, MSI.
# Pure Rust; open() reads damaged files best-effort (validates header/FAT/directory, reads stream
# sectors lazily) so a truncated file's intact streams are still recoverable.
cfb = "0.14"
```

- [ ] **Step 2: Create `crates/recovery-core/src/limits.rs`** (one home for the salvage caps, shared by every inflating/extracting pillar):

```rust
//! Shared salvage caps. Untrusted input must never exhaust container memory:
//! every pillar bounds per-item output, aggregate output, and item count.

/// Maximum decompressed/extracted bytes for a single item (entry/stream).
pub const MAX_ENTRY_UNCOMPRESSED_BYTES: u64 = 512 * 1024 * 1024;
/// Maximum decompressed/extracted bytes across all recovered items in one file.
pub const MAX_TOTAL_UNCOMPRESSED_BYTES: u64 = 2 * 1024 * 1024 * 1024;
/// Maximum number of items (entries/streams) processed from one file.
pub const MAX_ENTRY_COUNT: usize = 100_000;
```

- [ ] **Step 3: Point `zip_repair.rs` at the shared limits** — remove the three `const MAX_*` definitions currently in `zip_repair.rs` and replace their uses with `crate::limits::MAX_ENTRY_UNCOMPRESSED_BYTES` / `crate::limits::MAX_TOTAL_UNCOMPRESSED_BYTES` / `crate::limits::MAX_ENTRY_COUNT` (or add `use crate::limits::{MAX_ENTRY_UNCOMPRESSED_BYTES, MAX_TOTAL_UNCOMPRESSED_BYTES, MAX_ENTRY_COUNT};` near the top and leave the call sites unchanged). Run the zip tests to confirm no behavior change.

- [ ] **Step 4: Create `crates/recovery-core/src/cfb_repair.rs`** stub:

```rust
//! The CFB/OLE2 repair pillar: open a compound file, best-effort read each
//! stream, re-emit a fresh compound file. Diagnose CFB corruption.
```

- [ ] **Step 5: Declare the modules** in `crates/recovery-core/src/lib.rs` (keep them alphabetical with the rest):

```rust
pub mod cfb_repair;
pub mod limits;
```

- [ ] **Step 6: Verify it builds + zip tests still pass** — Run: `cargo build --manifest-path crates/Cargo.toml -p recovery-core` then `cargo test --manifest-path crates/Cargo.toml -p recovery-core zip_repair::`. Expected: compiles (pulls `cfb`); all zip tests pass unchanged.

- [ ] **Step 7: Commit**

```bash
git add crates/recovery-core/Cargo.toml crates/recovery-core/src/limits.rs crates/recovery-core/src/zip_repair.rs crates/recovery-core/src/cfb_repair.rs crates/recovery-core/src/lib.rs crates/Cargo.lock
git commit -m "feat(recovery-core): add cfb dep + shared salvage limits + CFB skeleton"
```

---

### Task 2: Salvage streams from a compound file

**Files:**
- Modify: `crates/recovery-core/src/cfb_repair.rs`

**Interfaces:**
- Produces:
  - `pub struct SalvagedStream { pub path: String, pub data: Option<Vec<u8>>, pub recovered: bool, pub detail: String }`
  - `pub fn salvage_streams(bytes: &[u8]) -> Result<Vec<SalvagedStream>, crate::error::RepairError>` — open the compound file (`Err(Unrepairable)` if the header/FAT/directory is too damaged to open); walk the directory; best-effort read every stream (a stream that errors or exceeds the per-stream cap → `recovered: false, data: None`); enforce the count and total caps.

- [ ] **Step 1: Write the failing tests** — append to `crates/recovery-core/src/cfb_repair.rs`:

```rust
use std::io::{Cursor, Read};
use std::path::PathBuf;

use cfb::CompoundFile;

use crate::error::RepairError;
use crate::limits::{
    MAX_ENTRY_COUNT, MAX_ENTRY_UNCOMPRESSED_BYTES, MAX_TOTAL_UNCOMPRESSED_BYTES,
};

#[derive(Debug, Clone)]
pub struct SalvagedStream {
    pub path: String,
    pub data: Option<Vec<u8>>,
    pub recovered: bool,
    pub detail: String,
}

#[cfg(test)]
mod salvage_tests {
    use super::*;
    use std::io::Write;

    /// Build a valid version-3 CFB with the given (path, content) streams. Paths are
    /// absolute, e.g. "/WordDocument". Parent storages are created as needed.
    pub(super) fn build_cfb(streams: &[(&str, &[u8])]) -> Vec<u8> {
        let mut cfb = CompoundFile::create(Cursor::new(Vec::new())).unwrap();
        for (path, content) in streams {
            let p = std::path::Path::new(path);
            if let Some(parent) = p.parent() {
                if parent != std::path::Path::new("/") && !cfb.exists(parent) {
                    cfb.create_storage_all(parent).unwrap();
                }
            }
            cfb.create_stream(path).unwrap().write_all(content).unwrap();
        }
        cfb.flush().unwrap();
        cfb.into_inner().into_inner()
    }

    #[test]
    fn salvages_all_streams_from_a_healthy_cfb() {
        let cfb = build_cfb(&[("/WordDocument", b"body text"), ("/\x01CompObj", b"compobj")]);
        let streams = salvage_streams(&cfb).expect("opens");
        assert_eq!(streams.len(), 2);
        assert!(streams.iter().all(|s| s.recovered));
        let wd = streams.iter().find(|s| s.path.contains("WordDocument")).unwrap();
        assert_eq!(wd.data.as_deref(), Some(&b"body text"[..]));
    }

    #[test]
    fn a_non_cfb_input_cannot_be_opened() {
        let result = salvage_streams(b"not a compound file at all, just bytes");
        assert!(result.is_err());
    }
}
```

- [ ] **Step 2: Run to verify they fail** — Run: `cargo test --manifest-path crates/Cargo.toml -p recovery-core cfb_repair::salvage`. Expected: FAIL — `salvage_streams` not defined.

- [ ] **Step 3: Implement `salvage_streams`** — add above the `#[cfg(test)]` block. VERIFY the `cfb` 0.14 API: `CompoundFile::open(Cursor<Vec<u8>>) -> io::Result<_>`, `walk() -> Entries` (preorder, includes root), `Entry::is_stream()` / `Entry::path() -> &Path`, `open_stream(path) -> io::Result<Stream>` where `Stream: Read`. Collect stream paths first (walk borrows immutably; open_stream takes `&mut`):

```rust
/// Open the compound file and best-effort read every stream. A stream that
/// errors on read, or whose size exceeds the per-stream cap, is recorded lost
/// (never partially kept). Returns Err only when the file cannot be opened at
/// all (the header/FAT/directory is too damaged) — manual sector-scan
/// reconstruction of that case is a separate, deeper effort.
pub fn salvage_streams(bytes: &[u8]) -> Result<Vec<SalvagedStream>, RepairError> {
    let cursor = Cursor::new(bytes.to_vec());
    let mut compound = CompoundFile::open(cursor).map_err(|_| RepairError::Unrepairable)?;

    // Collect stream paths first; `walk` borrows the compound file immutably while
    // `open_stream` needs a mutable borrow.
    let paths: Vec<PathBuf> = compound
        .walk()
        .filter(|entry| entry.is_stream())
        .take(MAX_ENTRY_COUNT)
        .map(|entry| entry.path().to_path_buf())
        .collect();

    let mut out = Vec::new();
    let mut total: u64 = 0;
    for path in paths {
        let display = path.to_string_lossy().into_owned();
        if total >= MAX_TOTAL_UNCOMPRESSED_BYTES {
            out.push(SalvagedStream {
                path: display,
                data: None,
                recovered: false,
                detail: "file exceeds the total size cap".into(),
            });
            continue;
        }
        let read = read_capped(&mut compound, &path);
        match read {
            Ok(data) => {
                total = total.saturating_add(data.len() as u64);
                out.push(SalvagedStream { path: display, data: Some(data), recovered: true, detail: String::new() });
            }
            Err(detail) => out.push(SalvagedStream {
                path: display,
                data: None,
                recovered: false,
                detail,
            }),
        }
    }
    Ok(out)
}

/// Read one stream with a per-stream byte cap. Over-cap or a read error → the
/// stream is lost (no partial bytes kept). The error string is a fixed reason,
/// never stream content.
fn read_capped(
    compound: &mut CompoundFile<Cursor<Vec<u8>>>,
    path: &std::path::Path,
) -> Result<Vec<u8>, String> {
    let mut stream = compound
        .open_stream(path)
        .map_err(|_| "stream could not be opened".to_string())?;
    let cap = MAX_ENTRY_UNCOMPRESSED_BYTES.saturating_add(1);
    let mut data = Vec::new();
    Read::take(&mut stream, cap)
        .read_to_end(&mut data)
        .map_err(|_| "stream truncated or corrupt".to_string())?;
    if data.len() as u64 > MAX_ENTRY_UNCOMPRESSED_BYTES {
        return Err("stream exceeds the per-stream size cap".to_string());
    }
    Ok(data)
}
```

- [ ] **Step 4: Run to verify they pass** — Run: `cargo test --manifest-path crates/Cargo.toml -p recovery-core cfb_repair::salvage`. Expected: PASS (2 tests). If `Read::take` on a `cfb::Stream` needs a different call form, adapt to the verified API (the stream implements `std::io::Read`).

- [ ] **Step 5: Commit**

```bash
git add crates/recovery-core/src/cfb_repair.rs
git commit -m "feat(recovery-core): salvage streams from a compound file"
```

---

### Task 3: Re-emit a fresh compound file

**Files:**
- Modify: `crates/recovery-core/src/cfb_repair.rs`

**Interfaces:**
- Produces: `pub fn rebuild_cfb(streams: &[(String, Vec<u8>)]) -> Result<(Vec<u8>, Vec<String>), crate::error::RepairError>` — write a fresh version-3 CFB from recovered (path, bytes) pairs, creating parent storages as needed. A stream whose path the writer rejects is skipped and its path returned in the skipped list (mirroring the ZIP pillar's resilient rebuild). `finish`/flush failure → `Unrepairable`.

- [ ] **Step 1: Write the failing test** — add to the test section of `cfb_repair.rs`:

```rust
#[cfg(test)]
mod rebuild_tests {
    use super::*;

    #[test]
    fn rebuilt_cfb_reopens_with_the_same_streams() {
        let streams = vec![
            ("/WordDocument".to_string(), b"recovered body".to_vec()),
            ("/ObjectPool/item".to_string(), b"nested".to_vec()),
        ];
        let (bytes, skipped) = rebuild_cfb(&streams).expect("rebuild");
        assert!(skipped.is_empty());
        // The result must reopen as a valid compound file with both streams.
        let mut reopened = CompoundFile::open(Cursor::new(bytes)).expect("valid cfb");
        let mut data = Vec::new();
        reopened
            .open_stream("/WordDocument")
            .unwrap()
            .read_to_end(&mut data)
            .unwrap();
        assert_eq!(data, b"recovered body");
        assert!(reopened.exists("/ObjectPool/item"));
    }
}
```

- [ ] **Step 2: Run to verify it fails** — Run: `cargo test --manifest-path crates/Cargo.toml -p recovery-core cfb_repair::rebuild`. Expected: FAIL — `rebuild_cfb` not defined.

- [ ] **Step 3: Implement `rebuild_cfb`** — add to `cfb_repair.rs` (add `use std::io::Write;` near the top if not present):

```rust
/// Write a fresh version-3 CFB from recovered (path, bytes) streams, creating
/// parent storages as needed. A stream the writer rejects is skipped and its
/// path returned, so one bad path never discards the rest. A flush/finalize
/// failure → Unrepairable; if every stream was skipped (and there were streams)
/// → Unrepairable rather than an empty file.
pub fn rebuild_cfb(streams: &[(String, Vec<u8>)]) -> Result<(Vec<u8>, Vec<String>), RepairError> {
    let mut compound =
        CompoundFile::create(Cursor::new(Vec::new())).map_err(|_| RepairError::Unrepairable)?;
    let mut skipped: Vec<String> = Vec::new();
    for (path, data) in streams {
        if write_one_stream(&mut compound, path, data).is_err() {
            skipped.push(path.clone());
        }
    }
    if !streams.is_empty() && skipped.len() == streams.len() {
        return Err(RepairError::Unrepairable);
    }
    compound.flush().map_err(|_| RepairError::Unrepairable)?;
    let bytes = compound.into_inner().into_inner();
    Ok((bytes, skipped))
}

fn write_one_stream(
    compound: &mut CompoundFile<Cursor<Vec<u8>>>,
    path: &str,
    data: &[u8],
) -> std::io::Result<()> {
    let p = std::path::Path::new(path);
    if let Some(parent) = p.parent() {
        if parent != std::path::Path::new("/") && !compound.exists(parent) {
            compound.create_storage_all(parent)?;
        }
    }
    compound.create_stream(path)?.write_all(data)
}
```

- [ ] **Step 4: Run to verify it passes** — Run: `cargo test --manifest-path crates/Cargo.toml -p recovery-core cfb_repair::rebuild`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/recovery-core/src/cfb_repair.rs
git commit -m "feat(recovery-core): re-emit a fresh compound file from recovered streams"
```

---

### Task 4: Diagnose CFB corruption + register the diagnoser

**Files:**
- Modify: `crates/recovery-core/src/cfb_repair.rs`
- Modify: `crates/recovery-core/src/diagnose.rs`

**Interfaces:**
- Produces (in `cfb_repair`): `pub fn diagnose_cfb(bytes: &[u8]) -> (Vec<crate::model::CorruptionKind>, crate::model::Recoverability)` — opens and reads every stream: all readable → (`[]`, `Intact`); opens but ≥1 stream lost → (`[Truncated]`, `Partial`); cannot open → (`[Other]`, `Unrecoverable`).
- Consumes (in `diagnose`): the `Ole2` arm calls `diagnose_cfb` and sets `repair_supported = true`.

- [ ] **Step 1: Write the failing tests** — add to `cfb_repair.rs` test section:

```rust
#[cfg(test)]
mod diagnose_tests {
    use super::*;
    use crate::model::Recoverability;

    #[test]
    fn a_healthy_cfb_is_intact() {
        let cfb = salvage_tests::build_cfb(&[("/WordDocument", b"text")]);
        let (corruption, recoverability) = diagnose_cfb(&cfb);
        assert_eq!(recoverability, Recoverability::Intact);
        assert!(corruption.is_empty());
    }

    #[test]
    fn a_non_cfb_is_unrecoverable() {
        let (_corruption, recoverability) = diagnose_cfb(b"not a compound file");
        assert_eq!(recoverability, Recoverability::Unrecoverable);
    }
}
```

- [ ] **Step 2: Run to verify they fail** — Run: `cargo test --manifest-path crates/Cargo.toml -p recovery-core cfb_repair::diagnose`. Expected: FAIL — `diagnose_cfb` not defined.

- [ ] **Step 3: Implement `diagnose_cfb`** — add to `cfb_repair.rs`:

```rust
use crate::model::{CorruptionKind, Recoverability};

/// Classify a compound file's health by opening it and reading every stream.
/// All readable → intact; opens but some streams lost → partial; cannot open at
/// all → unrecoverable by this pillar (manual reconstruction is a deeper effort).
pub fn diagnose_cfb(bytes: &[u8]) -> (Vec<CorruptionKind>, Recoverability) {
    match salvage_streams(bytes) {
        Err(_) => (vec![CorruptionKind::Other], Recoverability::Unrecoverable),
        Ok(streams) => {
            if streams.iter().all(|s| s.recovered) {
                (Vec::new(), Recoverability::Intact)
            } else {
                (vec![CorruptionKind::Truncated], Recoverability::Partial)
            }
        }
    }
}
```

- [ ] **Step 4: Wire into the diagnose framework** — in `crates/recovery-core/src/diagnose.rs`, add an `Ole2` arm to the `match detect(bytes)` (above the catch-all `Some(format) =>`):

```rust
        Some(Format::Ole2) => {
            let (corruption, recoverability) = crate::cfb_repair::diagnose_cfb(bytes);
            DiagnosisReport {
                detected_format: Some(Format::Ole2),
                corruption,
                recoverability,
                repair_supported: true,
                detail: "cfb / ole2 compound file".into(),
            }
        }
```

- [ ] **Step 5: Add a diagnose-framework test** — in `diagnose.rs` tests:

```rust
    #[test]
    fn a_recognized_cfb_reports_repair_supported() {
        let cfb = crate::cfb_repair::tests_build_minimal_cfb();
        let report = diagnose(&cfb);
        assert_eq!(report.detected_format, Some(Format::Ole2));
        assert!(report.repair_supported);
    }
```

and add a `#[doc(hidden)] pub fn tests_build_minimal_cfb() -> Vec<u8>` to `cfb_repair.rs` (mirrors `tests_build_minimal_zip`): build a one-stream CFB via `CompoundFile::create` and return the bytes.

- [ ] **Step 6: Run the tests** — Run: `cargo test --manifest-path crates/Cargo.toml -p recovery-core` (cfb_repair + diagnose). Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add crates/recovery-core/src/cfb_repair.rs crates/recovery-core/src/diagnose.rs
git commit -m "feat(recovery-core): diagnose cfb corruption + register the diagnoser"
```

---

### Task 5: The CFB repairer + register into the repair dispatch

**Files:**
- Modify: `crates/recovery-core/src/cfb_repair.rs`
- Modify: `crates/recovery-core/src/repair.rs`

**Interfaces:**
- Produces (in `cfb_repair`): `pub fn repair_cfb(bytes: &[u8]) -> Result<RepairResult, RepairError>` — salvage streams; if none recovered → `Err(Unrepairable)`; rebuild a fresh CFB; build the `LossManifest` (one `RecoveredItem` per stream, recovered or lost; re-emit-skipped streams flipped to lost; `synthesized` empty; `fully_recovered` = all recovered).
- Consumes (in `repair`): the `Ole2` arm dispatches to `repair_cfb`.

- [ ] **Step 1: Write the failing tests** — add to `cfb_repair.rs` test section:

```rust
#[cfg(test)]
mod repair_tests {
    use super::*;

    #[test]
    fn repairs_a_healthy_cfb_and_reopens() {
        let cfb = salvage_tests::build_cfb(&[("/WordDocument", b"body"), ("/\x01CompObj", b"co")]);
        let result = repair_cfb(&cfb).expect("repairable");
        // Reopen the salvaged compound file.
        let mut reopened = CompoundFile::open(Cursor::new(result.salvaged.clone())).expect("valid cfb");
        assert!(reopened.exists("/WordDocument"));
        assert!(result.loss.fully_recovered);
        assert!(result.loss.synthesized.is_empty());
        assert_eq!(result.loss.items.iter().filter(|i| i.recovered).count(), 2);
    }

    #[test]
    fn an_unopenable_input_errors() {
        assert!(repair_cfb(b"\xD0\xCF\x11\xE0 garbage after the magic, not a real cfb").is_err());
    }
}
```

- [ ] **Step 2: Run to verify they fail** — Run: `cargo test --manifest-path crates/Cargo.toml -p recovery-core cfb_repair::repair`. Expected: FAIL — `repair_cfb` not defined.

- [ ] **Step 3: Implement `repair_cfb`** — add to `cfb_repair.rs` (reuse `crate::model::{LossManifest, RecoveredItem, RepairResult}`):

```rust
use crate::model::{LossManifest, RecoveredItem, RepairResult};

/// Repair a damaged compound file: salvage every readable stream, re-emit a fresh
/// CFB, and record an honest loss manifest. Errors (rather than emitting an empty
/// file) when nothing is recoverable.
pub fn repair_cfb(bytes: &[u8]) -> Result<RepairResult, RepairError> {
    let salvaged = salvage_streams(bytes)?;
    let recovered: Vec<(String, Vec<u8>)> = salvaged
        .iter()
        .filter_map(|s| s.data.clone().map(|d| (s.path.clone(), d)))
        .collect();
    if recovered.is_empty() {
        return Err(RepairError::Unrepairable);
    }
    let (bytes_out, skipped) = rebuild_cfb(&recovered)?;
    let mut items: Vec<RecoveredItem> = salvaged
        .iter()
        .map(|s| RecoveredItem {
            name: s.path.clone(),
            recovered: s.recovered,
            detail: s.detail.clone(),
        })
        .collect();
    // A stream lost at re-emit is recorded lost.
    for name in &skipped {
        if let Some(item) = items.iter_mut().find(|i| &i.name == name) {
            item.recovered = false;
            item.detail = "stream lost during rebuild".into();
        }
    }
    let fully_recovered = items.iter().all(|i| i.recovered);
    Ok(RepairResult {
        salvaged: bytes_out,
        loss: LossManifest { items, fully_recovered, synthesized: Vec::new() },
    })
}
```

- [ ] **Step 4: Register into the repair dispatch** — in `crates/recovery-core/src/repair.rs`, add the `Ole2` arm before the `Some(_) => Err(Unsupported)` catch-all:

```rust
        Some(Format::Ole2) => crate::cfb_repair::repair_cfb(bytes),
```

- [ ] **Step 5: Run the full crate gate** — Run:
  - `cargo test --manifest-path crates/Cargo.toml -p recovery-core`
  - `cargo fmt --manifest-path crates/Cargo.toml -p recovery-core -- --check` (run `cargo fmt` first if needed; stage everything it touches)
  - `cargo clippy --manifest-path crates/Cargo.toml -p recovery-core --all-targets -- -D warnings`
  - `grep -rniE "golden rule|ADR-[0-9]|spec §" crates/recovery-core/src` (returns nothing)
  Expected: all pass, fmt clean, clippy clean, no citations. Working tree clean after the commit.

- [ ] **Step 6: Commit**

```bash
git add crates/recovery-core/src/cfb_repair.rs crates/recovery-core/src/repair.rs
git commit -m "feat(recovery-core): cfb repairer + register into the repair dispatch"
```

---

## Notes for the implementer

- **Verify the `cfb` 0.14 API against docs.rs** (golden rule 11): `CompoundFile::open(F: Read+Seek) -> io::Result<_>` (use `open`, NOT `open_strict` — strict rejects real-world files); `walk() -> Entries` (preorder incl. root, immutable borrow); `Entry::is_stream()` / `Entry::path()`; `open_stream(path) -> io::Result<Stream>` (`Stream: Read+Seek`, needs `&mut self`); `CompoundFile::create(F: Read+Write+Seek)`, `create_storage_all(path)`, `create_stream(path) -> io::Result<Stream>` (`Stream: Write`), `flush()`, `into_inner()`. Adapt if a name differs in the resolved patch.
- **Collect stream paths before reading** — `walk()` borrows the compound file immutably; `open_stream` needs `&mut`. Collect `PathBuf`s first (the salvage code does this).
- **`open()` covers the truncation case** (header/FAT/directory intact, trailing stream sectors cut) — it succeeds and the truncated stream errors on read, which the per-stream loop records as lost. A cut that damages the header/FAT/directory makes `open()` fail → `Unrepairable` in this pillar.
- **Deeper seam — manual reconstruction (NOT this plan):** when `open()` fails, the MS-CFB format can be parsed by hand to recover streams: parse the 512-byte header (magic at 0; sector shift at 30 → 512/4096-byte sectors; first directory sector at 48; FAT info at 44/76..512), sector-scan for 128-byte directory entries (object type byte at +66 ∈ {0x01,0x02,0x05}; even name-length ≤64 at +64; valid UTF-16LE name), and extract each stream by following its FAT chain or, if the FAT is broken, a contiguous-sector read of `⌈stream_size/sector_size⌉` sectors from the entry's starting sector. This recovers badly-damaged files (header/FAT/directory corrupt) but flattens the storage hierarchy. It is a substantial separate effort — the same kind of deepest-case seam the ZIP pillar left for partial-final-entry recovery.
- **Caps now live in `crate::limits`** — shared by the ZIP and CFB pillars; the PDF/carving pillars reuse them too.
- **Log-safety:** stream paths live in `RecoveredItem.name`/`detail` — owner-facing receipt only, never the redacted log path. Only `RepairError::code()` is log-safe.
- The worker route, container, attach-to-matter, and the `files` catalog group are Plan 6 — this plan is the pure engine pillar only.
```
