# Decryption Core (Slice 1, Plan 1 of 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `crates/decryption-core`, a pure-Rust library that, for PDF/ZIP/OOXML files, decrypts with a known password (`strip_with_key`), extracts an unknown-password recovery hash (`extract_hash`), verifies a candidate password (`verify_guess`), and runs an in-house CPU dictionary loop over those candidates.

**Architecture:** One `FormatAdapter` trait implemented per format behind magic-byte detection. All formats share the RustCrypto primitive suite (AES/SHA/PBKDF2/RC4/MD5); only the container parsing is per-format. The crate is the reusable core that later consumers (the WASM wrapper and the Worker, Plan 2 of 2) call. No network, no platform bindings — fully unit-testable.

**Tech Stack:** Rust (workspace at `crates/`, edition 2021), `lopdf` (PDF), `zip` (ZIP), `cfb` + `office-crypto` (OOXML), the RustCrypto suite (`pbkdf2 hmac sha1 sha2 md-5 aes cbc ctr cfb-mode rc4`), `rayon` (parallel dictionary loop). Tests use hashcat's published `example_hashes` (known hash + password `hashcat`) as deterministic `verify_guess` vectors, plus tiny checked-in encrypted fixtures for round-trip `strip_with_key`/`extract_hash` tests.

## Global Constraints

- **Pure Rust only — no C dependency** (golden rule 14). Every crate above is pure-Rust and builds on `wasm32`. If any candidate pulls a C dependency, stop and raise it.
- **Reuse, don't duplicate** (golden rule 1): `lopdf` is already a workspace dependency (`crates/pdf-core` pins `lopdf 0.41`). Use **one** `lopdf` version across the workspace — promote `lopdf` to `[workspace.dependencies]` and have both crates use `lopdf = { workspace = true }`. The password-decode API (`EncryptionState::decode(password)`) must exist in the chosen version; if it requires `lopdf 0.42`, bump the workspace pin to `0.42` and confirm `pdf-core` still builds + its tests pass in the same task.
- **RustCrypto generation:** pin the **0.10/0.4 generation** (`digest 0.10` / `cipher 0.4` era: `pbkdf2 0.12`, `hmac 0.12`, `sha1 0.10`, `sha2 0.10`, `md-5 0.10`, `aes 0.8`, `cbc 0.1`, `ctr 0.9`, `cfb-mode 0.8`, `rc4 0.1`) to match `zip` and `lopdf`'s trait stack. Confirm exact patch versions with `cargo add` before pinning.
- **Full names, no shorthand** (golden rule 12): `decryption-core`, `FormatAdapter`, `strip_with_key`, `extract_hash`, `verify_guess`, `RecoveryJob` — never abbreviate.
- **No process-doc references in source** (golden rule 13): code comments explain _why_ inline or cite a concrete file/spec path; no "slice N" / "ADR-N" in `.rs` files (a forward-looking "built in Plan 2" schedule note is allowed).
- **Run the gate after every task:** `cargo test -p decryption-core` and `cargo clippy -p decryption-core --all-targets -- -D warnings` and `cargo fmt -p decryption-core -- --check` must pass before each commit.
- **Crate is `publish = false`**, `version = "0.0.0"`, `edition.workspace = true`, matching `pdf-core`.

---

### Task 1: Scaffold `decryption-core` crate

**Files:**

- Create: `crates/decryption-core/Cargo.toml`
- Create: `crates/decryption-core/src/lib.rs`
- Modify: `crates/Cargo.toml` (add member + promote `lopdf` to workspace deps)

**Interfaces:**

- Produces: a compiling `decryption-core` library crate with a `version()` smoke function later replaced by real API.

- [ ] **Step 1: Add the workspace member and shared `lopdf` pin**

In `crates/Cargo.toml`, add `"decryption-core"` to `members` and add to `[workspace.dependencies]`:

```toml
lopdf = "0.41"
```

(If Task's build later shows `EncryptionState::decode(password)` is missing, change this to `lopdf = "0.42"` and re-run `cargo test -p pdf-core`.)

- [ ] **Step 2: Write `Cargo.toml`**

```toml
[package]
name = "decryption-core"
version = "0.0.0"
edition.workspace = true
publish = false

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
lopdf = { workspace = true }
zip = "2"
cfb = "0.10"
office-crypto = "0.1"
pbkdf2 = { version = "0.12", default-features = false, features = ["hmac"] }
hmac = "0.12"
sha1 = "0.10"
sha2 = "0.10"
md-5 = "0.10"
aes = "0.8"
cbc = "0.1"
ctr = "0.9"
cfb-mode = "0.8"
rc4 = "0.1"
rayon = "1"
thiserror = "1"

[dev-dependencies]
hex = "0.4"
```

- [ ] **Step 3: Write a smoke test in `src/lib.rs`**

```rust
//! decryption-core: in-house file decryption + password-recovery primitives.
//! One FormatAdapter per format behind magic-byte detection; shared RustCrypto
//! primitives. Consumed by the WASM wrapper and the Worker (built in Plan 2).

#[cfg(test)]
mod smoke {
    #[test]
    fn crate_builds() {
        assert_eq!(2 + 2, 4);
    }
}
```

- [ ] **Step 4: Run the gate**

Run: `cd crates && cargo test -p decryption-core && cargo test -p pdf-core`
Expected: PASS (decryption-core smoke test passes; pdf-core unaffected by the workspace `lopdf` promotion).

- [ ] **Step 5: Commit**

```bash
git add crates/Cargo.toml crates/decryption-core/Cargo.toml crates/decryption-core/src/lib.rs
git commit -m "feat(decryption): scaffold decryption-core crate"
```

---

### Task 2: Core types + `FormatAdapter` trait

**Files:**

- Create: `crates/decryption-core/src/adapter.rs`
- Modify: `crates/decryption-core/src/lib.rs` (add `mod adapter; pub use`)

**Interfaces:**

- Produces:
  - `enum Format { Pdf, Zip, Ooxml }`
  - `struct DecryptedFile { pub bytes: Vec<u8>, pub filename_hint: Option<String> }`
  - `struct RecoveryJob { pub format: Format, pub hash: String, pub hashcat_mode: u32, pub params: KdfParams }`
  - `enum KdfParams { ... }` (per-format parsed parameters; variants added by adapter tasks)
  - `enum DecryptError`, `enum ExtractError` (via `thiserror`)
  - `trait FormatAdapter { fn strip_with_key(bytes,&str)->Result<DecryptedFile,DecryptError>; fn extract_hash(bytes)->Result<RecoveryJob,ExtractError>; fn verify_guess(job:&RecoveryJob,candidate:&str)->bool; }`

- [ ] **Step 1: Write the failing test**

```rust
// in src/adapter.rs
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recovery_job_round_trips_fields() {
        let job = RecoveryJob {
            format: Format::Pdf,
            hash: "$pdf$...".into(),
            hashcat_mode: 10700,
            params: KdfParams::Placeholder,
        };
        assert_eq!(job.format, Format::Pdf);
        assert_eq!(job.hashcat_mode, 10700);
        assert!(job.hash.starts_with("$pdf$"));
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd crates && cargo test -p decryption-core recovery_job_round_trips_fields`
Expected: FAIL (types not defined).

- [ ] **Step 3: Write the types and trait**

```rust
// src/adapter.rs
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format { Pdf, Zip, Ooxml }

#[derive(Debug, Clone)]
pub struct DecryptedFile {
    pub bytes: Vec<u8>,
    pub filename_hint: Option<String>,
}

/// Per-format parsed key-derivation parameters, used by `verify_guess` to test a
/// candidate without re-parsing the container. Variants are filled in by each
/// adapter task; `Placeholder` exists only until the first real variant lands.
#[derive(Debug, Clone)]
pub enum KdfParams {
    Placeholder,
}

#[derive(Debug, Clone)]
pub struct RecoveryJob {
    pub format: Format,
    /// The cracker hash string (e.g. `$pdf$...`), directly consumable by hashcat.
    pub hash: String,
    /// The hashcat mode matching `hash` (e.g. 10700 for PDF R6).
    pub hashcat_mode: u32,
    pub params: KdfParams,
}

#[derive(Debug, Error)]
pub enum DecryptError {
    #[error("wrong password")]
    WrongPassword,
    #[error("file is not encrypted")]
    NotEncrypted,
    #[error("unsupported variant: {0}")]
    Unsupported(String),
    #[error("malformed container: {0}")]
    Malformed(String),
}

#[derive(Debug, Error)]
pub enum ExtractError {
    #[error("file is not encrypted")]
    NotEncrypted,
    #[error("unsupported variant: {0}")]
    Unsupported(String),
    #[error("malformed container: {0}")]
    Malformed(String),
}

pub trait FormatAdapter {
    fn strip_with_key(bytes: &[u8], password: &str) -> Result<DecryptedFile, DecryptError>;
    fn extract_hash(bytes: &[u8]) -> Result<RecoveryJob, ExtractError>;
    fn verify_guess(job: &RecoveryJob, candidate: &str) -> bool;
}
```

In `src/lib.rs` add:

```rust
mod adapter;
pub use adapter::{
    DecryptError, DecryptedFile, ExtractError, Format, FormatAdapter, KdfParams, RecoveryJob,
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd crates && cargo test -p decryption-core recovery_job_round_trips_fields`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/decryption-core/src/adapter.rs crates/decryption-core/src/lib.rs
git commit -m "feat(decryption): FormatAdapter trait + core types"
```

---

### Task 3: Magic-byte format detection

**Files:**

- Create: `crates/decryption-core/src/detect.rs`
- Modify: `crates/decryption-core/src/lib.rs`

**Interfaces:**

- Consumes: `Format` (Task 2).
- Produces: `fn detect(bytes: &[u8]) -> Option<Format>` — distinguishes PDF (`%PDF`), OOXML-encrypted (OLE2 compound-file magic `D0 CF 11 E0 A1 B1 1A E1`), and ZIP (`PK\x03\x04`). Note an _encrypted_ `.docx` is an OLE2 file, not a zip, so OLE2 → `Ooxml` and `PK` → `Zip`.

- [ ] **Step 1: Write the failing test**

```rust
// src/detect.rs
#[cfg(test)]
mod tests {
    use super::*;
    use crate::Format;
    #[test]
    fn detects_by_magic() {
        assert_eq!(detect(b"%PDF-1.7\n..."), Some(Format::Pdf));
        assert_eq!(detect(&[0xD0,0xCF,0x11,0xE0,0xA1,0xB1,0x1A,0xE1, 0,0]), Some(Format::Ooxml));
        assert_eq!(detect(b"PK\x03\x04rest"), Some(Format::Zip));
        assert_eq!(detect(b"not a known file"), None);
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd crates && cargo test -p decryption-core detects_by_magic`
Expected: FAIL.

- [ ] **Step 3: Implement**

```rust
// src/detect.rs
use crate::Format;

const OLE2_MAGIC: [u8; 8] = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];

pub fn detect(bytes: &[u8]) -> Option<Format> {
    if bytes.starts_with(b"%PDF") {
        return Some(Format::Pdf);
    }
    if bytes.starts_with(&OLE2_MAGIC) {
        // Encrypted OOXML wraps the zip inside an OLE2/CFB compound file.
        return Some(Format::Ooxml);
    }
    if bytes.starts_with(b"PK\x03\x04") {
        return Some(Format::Zip);
    }
    None
}
```

Add `mod detect; pub use detect::detect;` to `src/lib.rs`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd crates && cargo test -p decryption-core detects_by_magic`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/decryption-core/src/detect.rs crates/decryption-core/src/lib.rs
git commit -m "feat(decryption): magic-byte format detection"
```

---

### Task 4: PDF — `strip_with_key`

**Files:**

- Create: `crates/decryption-core/src/pdf.rs`
- Create: `crates/decryption-core/tests/fixtures/README.md` (fixture provenance)
- Create: `crates/decryption-core/tests/fixtures/pdf_userpw_test.pdf` (a 1-page PDF encrypted with user password `test`, RC4-128 or AES; generate with `qpdf --encrypt test test 128 -- plain.pdf pdf_userpw_test.pdf`)
- Modify: `crates/decryption-core/src/lib.rs`

**Interfaces:**

- Consumes: `FormatAdapter`, `DecryptError`, `DecryptedFile` (Task 2).
- Produces: `struct PdfAdapter;` implementing `FormatAdapter::strip_with_key` (the other two methods land in Task 5 — until then, `extract_hash`/`verify_guess` may `unimplemented!()` with a `// filled in Task 5` note, since the trait requires all three; OR implement the trait incrementally by splitting into inherent methods first and the `impl FormatAdapter` last in Task 5). Use inherent methods: `PdfAdapter::strip_with_key(...)`.

- [ ] **Step 1: Document and generate the fixture**

In `tests/fixtures/README.md` record exactly how each fixture was made and its password, e.g.:

```
pdf_userpw_test.pdf — 1-page PDF, user password "test", RC4-128.
  Made with: qpdf --encrypt test test 128 -- hello.pdf pdf_userpw_test.pdf
```

Check the fixture in (it is tiny and non-sensitive).

- [ ] **Step 2: Write the failing test**

```rust
// src/pdf.rs
#[cfg(test)]
mod tests {
    use super::*;
    const ENC: &[u8] = include_bytes!("../tests/fixtures/pdf_userpw_test.pdf");
    #[test]
    fn strips_with_correct_password() {
        let out = PdfAdapter::strip_with_key(ENC, "test").expect("decrypts");
        assert!(out.bytes.starts_with(b"%PDF"));
        // A decrypted PDF is no longer encrypted: re-opening needs no password.
        assert!(lopdf::Document::load_mem(&out.bytes).is_ok());
    }
    #[test]
    fn rejects_wrong_password() {
        let err = PdfAdapter::strip_with_key(ENC, "wrong").unwrap_err();
        assert!(matches!(err, crate::DecryptError::WrongPassword));
    }
}
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd crates && cargo test -p decryption-core strips_with_correct_password`
Expected: FAIL (`PdfAdapter` undefined).

- [ ] **Step 4: Implement `strip_with_key`**

```rust
// src/pdf.rs
use crate::{DecryptError, DecryptedFile};
use lopdf::Document;

pub struct PdfAdapter;

impl PdfAdapter {
    pub fn strip_with_key(bytes: &[u8], password: &str) -> Result<DecryptedFile, DecryptError> {
        let mut doc = Document::load_mem(bytes)
            .map_err(|e| DecryptError::Malformed(e.to_string()))?;
        if !doc.is_encrypted() {
            return Err(DecryptError::NotEncrypted);
        }
        // lopdf: decrypt in place with the user OR owner password.
        doc.decrypt(password).map_err(|_| DecryptError::WrongPassword)?;
        let mut out = Vec::new();
        doc.save_to(&mut out).map_err(|e| DecryptError::Malformed(e.to_string()))?;
        Ok(DecryptedFile { bytes: out, filename_hint: None })
    }
}
```

> Note: the exact `lopdf` decrypt entry point name/signature must be verified against the pinned version (`Document::decrypt(&str)` vs `EncryptionState::decode`). Adjust the call to match; the test is the gate.

Add `mod pdf; pub use pdf::PdfAdapter;` to `src/lib.rs`.

- [ ] **Step 5: Run to verify it passes**

Run: `cd crates && cargo test -p decryption-core pdf::`
Expected: PASS (both PDF tests).

- [ ] **Step 6: Commit**

```bash
git add crates/decryption-core/src/pdf.rs crates/decryption-core/src/lib.rs crates/decryption-core/tests/fixtures/
git commit -m "feat(decryption): PDF strip_with_key"
```

---

### Task 5: PDF — `extract_hash` + `verify_guess`

**Files:**

- Modify: `crates/decryption-core/src/pdf.rs`
- Modify: `crates/decryption-core/src/adapter.rs` (add `KdfParams::Pdf { ... }`)

**Interfaces:**

- Consumes: `RecoveryJob`, `ExtractError`, `KdfParams` (Task 2).
- Produces: `PdfAdapter::extract_hash` (emits the `$pdf$` John/hashcat string + mode), `PdfAdapter::verify_guess`, and the `impl FormatAdapter for PdfAdapter` binding all three.

**Reference (transcribe, then validate against the test vector):**

- The `$pdf$` field order is `$pdf$<V>*<R>*<keyBits>*<P>*<encMeta>*<idLen>*<id>*<uLen>*<U>*<oLen>*<O>` plus `*<ueLen>*<UE>*<oeLen>*<OE>` for R5/R6 — read V/R/P/O/U/OE/UE and the trailer `/ID` from `lopdf`'s `/Encrypt` dict.
- R6 `verify_guess` = ISO 32000-2 Algorithm 2.A (validate password) using the hardened hash Algorithm 2.B (the SHA-256→AES-128-CBC→mod-3→SHA-256/384/512 loop, terminating when `round >= 64 && last_byte(E) <= round - 32`). R2–R4 use the MD5+RC4 derivation. The design doc §7 records both.

- [ ] **Step 1: Add a deterministic `verify_guess` test using hashcat's example hash**

hashcat `example_hashes` mode 10700 (PDF 1.7 L8 / R6) lists a known `$pdf$...` hash whose password is `hashcat`. Paste that exact hash string into the test.

```rust
#[cfg(test)]
mod verify_tests {
    use super::*;
    // hashcat -m 10700 example hash; password is "hashcat".
    const PDF_R6_EXAMPLE: &str = "$pdf$5*6*256*-1028*1*16*..."; // paste full example_hashes value
    #[test]
    fn verifies_known_r6_password() {
        let job = crate::RecoveryJob {
            format: crate::Format::Pdf,
            hash: PDF_R6_EXAMPLE.into(),
            hashcat_mode: 10700,
            params: PdfAdapter::parse_hash(PDF_R6_EXAMPLE).expect("parses"),
        };
        assert!(PdfAdapter::verify_guess(&job, "hashcat"));
        assert!(!PdfAdapter::verify_guess(&job, "wrong"));
    }
}
```

- [ ] **Step 2: Add a round-trip `extract_hash` test**

```rust
#[test]
fn extract_hash_round_trips_with_strip() {
    let job = PdfAdapter::extract_hash(ENC).expect("extracts"); // ENC from Task 4
    assert!(job.hash.starts_with("$pdf$"));
    // The fixture password "test" must verify against the extracted job.
    assert!(PdfAdapter::verify_guess(&job, "test"));
    assert!(!PdfAdapter::verify_guess(&job, "nope"));
}
```

- [ ] **Step 3: Run to verify both fail**

Run: `cd crates && cargo test -p decryption-core pdf::`
Expected: FAIL (`extract_hash`/`verify_guess`/`parse_hash` undefined).

- [ ] **Step 4: Implement `KdfParams::Pdf`, `parse_hash`, `extract_hash`, `verify_guess`, and `impl FormatAdapter`**

Add to `KdfParams` in `adapter.rs`:

```rust
Pdf {
    v: u8, r: u8, key_bits: u32, p: i32, encrypt_metadata: bool,
    id: Vec<u8>, u: Vec<u8>, o: Vec<u8>, ue: Vec<u8>, oe: Vec<u8>,
},
```

In `pdf.rs` implement:

- `PdfAdapter::extract_hash(bytes)` — load with `lopdf`, read the trailer `/Encrypt` dict (V, R, Length, P, /EncryptMetadata, O, U, OE, UE) and trailer `/ID[0]`, format the `$pdf$` string, set `hashcat_mode` (10400/10500/10600/10700 by R), and fill `KdfParams::Pdf`.
- `PdfAdapter::parse_hash(&str) -> Result<KdfParams, ExtractError>` — inverse parse of the `$pdf$` string (used by tests and by callers that only have the hash).
- `PdfAdapter::verify_guess(job, candidate)` — match on `KdfParams::Pdf`; for R6 run Algorithm 2.A/2.B (use `sha2`, `aes`+`cbc` no-padding); for R2–R4 run the MD5/RC4 derivation (`md-5`, `rc4`). Return whether the computed U (or O) matches.
- `impl FormatAdapter for PdfAdapter` delegating to the three inherent methods.

Implement Algorithm 2.B exactly as in design §7; keep it in a private `fn hash2b(pwd: &[u8], salt: &[u8], udata: &[u8]) -> [u8;32]`.

- [ ] **Step 5: Run to verify both pass**

Run: `cd crates && cargo test -p decryption-core pdf::`
Expected: PASS (the example-hash vector proves the R6 algorithm; the round-trip proves extraction).

- [ ] **Step 6: Commit**

```bash
git add crates/decryption-core/src/pdf.rs crates/decryption-core/src/adapter.rs
git commit -m "feat(decryption): PDF extract_hash + verify_guess (R2-R6)"
```

---

### Task 6: ZIP — `strip_with_key`

**Files:**

- Create: `crates/decryption-core/src/zip.rs`
- Create: `crates/decryption-core/tests/fixtures/zip_aes_test.zip` (AES-256, password `test`, one entry `hello.txt` = `hello\n`; make with `7z a -tzip -pPASS -mem=AES256 zip_aes_test.zip hello.txt` — record in fixtures README)
- Create: `crates/decryption-core/tests/fixtures/zip_zipcrypto_test.zip` (legacy ZipCrypto, password `test`; `zip -e` or `7z a -tzip -pPASS -mem=ZipCrypto`)
- Modify: `crates/decryption-core/src/lib.rs`

**Interfaces:**

- Produces: `ZipAdapter::strip_with_key` — decrypts the entry(ies) and returns the **decrypted inner file** (for a single-entry archive, the entry bytes; for multi-entry, re-emit a plain zip — for slice 1, single-entry is enough, return the first entry's bytes with `filename_hint`).

- [ ] **Step 1: Write the failing tests (both AES and ZipCrypto)**

```rust
// src/zip.rs
#[cfg(test)]
mod tests {
    use super::*;
    const AES: &[u8] = include_bytes!("../tests/fixtures/zip_aes_test.zip");
    const ZC: &[u8] = include_bytes!("../tests/fixtures/zip_zipcrypto_test.zip");
    #[test]
    fn strips_aes_with_correct_password() {
        let out = ZipAdapter::strip_with_key(AES, "test").expect("decrypts");
        assert_eq!(out.bytes, b"hello\n");
        assert_eq!(out.filename_hint.as_deref(), Some("hello.txt"));
    }
    #[test]
    fn strips_zipcrypto_with_correct_password() {
        let out = ZipAdapter::strip_with_key(ZC, "test").expect("decrypts");
        assert_eq!(out.bytes, b"hello\n");
    }
    #[test]
    fn rejects_wrong_password() {
        assert!(matches!(ZipAdapter::strip_with_key(AES, "x").unwrap_err(),
            crate::DecryptError::WrongPassword));
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd crates && cargo test -p decryption-core zip::`
Expected: FAIL.

- [ ] **Step 3: Implement using the `zip` crate**

```rust
// src/zip.rs
use crate::{DecryptError, DecryptedFile};
use std::io::{Cursor, Read};

pub struct ZipAdapter;

impl ZipAdapter {
    pub fn strip_with_key(bytes: &[u8], password: &str) -> Result<DecryptedFile, DecryptError> {
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes))
            .map_err(|e| DecryptError::Malformed(e.to_string()))?;
        let mut file = archive
            .by_index_decrypt(0, password.as_bytes())
            .map_err(|e| match e {
                zip::result::ZipError::InvalidPassword => DecryptError::WrongPassword,
                other => DecryptError::Malformed(other.to_string()),
            })?;
        let hint = Some(file.name().to_string());
        let mut out = Vec::new();
        file.read_to_end(&mut out).map_err(|e| DecryptError::Malformed(e.to_string()))?;
        Ok(DecryptedFile { bytes: out, filename_hint: hint })
    }
}
```

> Verify the `zip` crate's decrypt API name/signature against the pinned version (`by_index_decrypt` returns a `Result` whose inner type may itself be `Result`); adjust to match. The tests are the gate.

Add `mod zip; pub use zip::ZipAdapter;` to `src/lib.rs` (use a module name that does not clash with the `zip` crate — name the module `zip_adapter` if the import collides, and `pub use zip_adapter::ZipAdapter;`).

- [ ] **Step 4: Run to verify it passes**

Run: `cd crates && cargo test -p decryption-core zip`
Expected: PASS (all three).

- [ ] **Step 5: Commit**

```bash
git add crates/decryption-core/src/zip_adapter.rs crates/decryption-core/src/lib.rs crates/decryption-core/tests/fixtures/
git commit -m "feat(decryption): ZIP strip_with_key (ZipCrypto + WinZip-AES)"
```

---

### Task 7: ZIP — `extract_hash` + `verify_guess`

**Files:**

- Modify: `crates/decryption-core/src/zip_adapter.rs`
- Modify: `crates/decryption-core/src/adapter.rs` (add `KdfParams::ZipAes`, `KdfParams::ZipCrypto`)

**Reference (transcribe, validate against vectors):**

- **WinZip-AES** (`$zip2$`, hashcat 13600): extra field `0x9901` gives the AES strength byte (1/2/3 = 128/192/256); record layout = `[salt][2-byte verifier][AES-CTR ciphertext][10-byte HMAC]`. KDF = PBKDF2-HMAC-SHA1, 1000 iters, salt = keylen/2 bytes; derived bytes = encKey(keylen) ‖ macKey(keylen) ‖ 2-byte verifier; verify by comparing the last 2 derived bytes to the stored verifier. Use `pbkdf2`, `hmac`, `sha1`.
- **ZipCrypto** (`$pkzip2$`, hashcat 17200-range): 12-byte encryption header; the 12th decrypted byte equals the high byte of the entry CRC-32 (or DOS mod-time high byte when a data descriptor is used). Keys init `0x12345678/0x23456789/0x34567890`, `update_keys` per APPNOTE.

- [ ] **Step 1: Deterministic `verify_guess` tests from hashcat example hashes**

Paste hashcat `example_hashes` mode 13600 (`$zip2$...`, password `hashcat`) and a 17200-series PKZIP example.

```rust
#[test]
fn verifies_known_winzip_aes_password() {
    const Z: &str = "$zip2$*0*3*0*...*$/zip2$"; // paste -m 13600 example
    let job = crate::RecoveryJob{ format: crate::Format::Zip, hash: Z.into(),
        hashcat_mode: 13600, params: ZipAdapter::parse_hash(Z).unwrap() };
    assert!(ZipAdapter::verify_guess(&job, "hashcat"));
    assert!(!ZipAdapter::verify_guess(&job, "nope"));
}
```

- [ ] **Step 2: Round-trip test from the Task 6 fixtures**

```rust
#[test]
fn extract_hash_round_trips_aes() {
    let job = ZipAdapter::extract_hash(AES).expect("extracts");
    assert_eq!(job.hashcat_mode, 13600);
    assert!(ZipAdapter::verify_guess(&job, "test"));
    assert!(!ZipAdapter::verify_guess(&job, "no"));
}
```

- [ ] **Step 3: Run to verify failure**

Run: `cd crates && cargo test -p decryption-core zip`
Expected: FAIL.

- [ ] **Step 4: Implement the header parse, `parse_hash`, `extract_hash`, `verify_guess`**

Add `KdfParams::ZipAes { strength: u8, salt: Vec<u8>, verifier: [u8;2] }` and `KdfParams::ZipCrypto { header12: [u8;12], crc_high: u8 }`. Parse the local file header + extra field `0x9901` for AES, or the 12-byte header for ZipCrypto, directly from `bytes` (walk the central directory with the `zip` crate to locate the first encrypted entry, then read the raw header bytes). `verify_guess`:

- AES: `pbkdf2_hmac::<Sha1>(pw, salt, 1000, &mut derived)` where `derived.len() = 2*keylen + 2`; compare `derived[2*keylen..]` to `verifier`.
- ZipCrypto: run `update_keys` over the password, decrypt the 12-byte header, compare byte 11 to `crc_high`.

- [ ] **Step 5: Run to verify pass**

Run: `cd crates && cargo test -p decryption-core zip`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/decryption-core/src/zip_adapter.rs crates/decryption-core/src/adapter.rs
git commit -m "feat(decryption): ZIP extract_hash + verify_guess"
```

---

### Task 8: OOXML — `strip_with_key`

**Files:**

- Create: `crates/decryption-core/src/ooxml.rs`
- Create: `crates/decryption-core/tests/fixtures/docx_agile_test.docx` (a `.docx` encrypted with password `test`, agile/SHA-512; make in Word/LibreOffice or with python `msoffcrypto-tool` — record in README)
- Modify: `crates/decryption-core/src/lib.rs`

**Interfaces:**

- Produces: `OoxmlAdapter::strip_with_key` — returns the decrypted inner OOXML zip bytes (a valid `.docx`).

- [ ] **Step 1: Write the failing test**

```rust
// src/ooxml.rs
#[cfg(test)]
mod tests {
    use super::*;
    const ENC: &[u8] = include_bytes!("../tests/fixtures/docx_agile_test.docx");
    #[test]
    fn strips_agile_with_correct_password() {
        let out = OoxmlAdapter::strip_with_key(ENC, "test").expect("decrypts");
        // Decrypted OOXML is a zip starting PK\x03\x04.
        assert!(out.bytes.starts_with(b"PK\x03\x04"));
    }
    #[test]
    fn rejects_wrong_password() {
        assert!(matches!(OoxmlAdapter::strip_with_key(ENC, "x").unwrap_err(),
            crate::DecryptError::WrongPassword));
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd crates && cargo test -p decryption-core ooxml::`
Expected: FAIL.

- [ ] **Step 3: Implement using `office-crypto` (adopt) with a `cfb` fallback note**

```rust
// src/ooxml.rs
use crate::{DecryptError, DecryptedFile};

pub struct OoxmlAdapter;

impl OoxmlAdapter {
    pub fn strip_with_key(bytes: &[u8], password: &str) -> Result<DecryptedFile, DecryptError> {
        match office_crypto::decrypt_from_bytes(bytes.to_vec(), password) {
            Ok(plain) => Ok(DecryptedFile { bytes: plain, filename_hint: None }),
            Err(_) => Err(DecryptError::WrongPassword),
        }
    }
}
```

> Verify `office-crypto`'s exact function name/signature and error type against the pinned version; map a wrong-password error to `WrongPassword` and a parse error to `Malformed`. If `office-crypto` cannot distinguish them, treat decrypt failure as `WrongPassword`. The test is the gate. If `office-crypto` proves too thin (e.g. only SHA-512), the fallback is an in-house `cfb` + RustCrypto implementation per design §7 — raise it before forking.

Add `mod ooxml; pub use ooxml::OoxmlAdapter;` to `src/lib.rs`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd crates && cargo test -p decryption-core ooxml::`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/decryption-core/src/ooxml.rs crates/decryption-core/src/lib.rs crates/decryption-core/tests/fixtures/
git commit -m "feat(decryption): OOXML strip_with_key (agile)"
```

---

### Task 9: OOXML — `extract_hash` + `verify_guess`

**Files:**

- Modify: `crates/decryption-core/src/ooxml.rs`
- Modify: `crates/decryption-core/src/adapter.rs` (add `KdfParams::OoxmlAgile`)

**Reference (transcribe, validate against vectors):**

- `$office$` (hashcat 9600 agile / 9500 2010 / 9400 2007). Open the OLE2 container with `cfb`; read `EncryptionInfo` (skip the version header, parse the `<encryption>` XML for `keyData` salt + `encryptedKey` salt/spinCount/encryptedVerifierHashInput/encryptedVerifierHashValue). `verify_guess`: `H0 = SHA512(salt ‖ UTF16LE(pw))`, iterate `Hn = SHA512(LE_u32(i) ‖ H(n-1))` for spinCount; derive block keys with the fixed GUID constants; AES-256-CBC-decrypt the verifier hash input + value; password correct iff `SHA512(decrypted input) == decrypted value`. Primitives: `sha2`, `aes`, `cbc`.

- [ ] **Step 1: Deterministic `verify_guess` test from hashcat example hash (mode 9600)**

```rust
#[test]
fn verifies_known_agile_password() {
    const O: &str = "$office$*2013*100000*256*16*..."; // paste -m 9600 example, pw "hashcat"
    let job = crate::RecoveryJob{ format: crate::Format::Ooxml, hash: O.into(),
        hashcat_mode: 9600, params: OoxmlAdapter::parse_hash(O).unwrap() };
    assert!(OoxmlAdapter::verify_guess(&job, "hashcat"));
    assert!(!OoxmlAdapter::verify_guess(&job, "nope"));
}
```

- [ ] **Step 2: Round-trip test from the Task 8 fixture**

```rust
#[test]
fn extract_hash_round_trips() {
    let job = OoxmlAdapter::extract_hash(ENC).expect("extracts");
    assert_eq!(job.hashcat_mode, 9600);
    assert!(OoxmlAdapter::verify_guess(&job, "test"));
    assert!(!OoxmlAdapter::verify_guess(&job, "no"));
}
```

- [ ] **Step 3: Run to verify failure**

Run: `cd crates && cargo test -p decryption-core ooxml::`
Expected: FAIL.

- [ ] **Step 4: Implement `KdfParams::OoxmlAgile`, `parse_hash`, `extract_hash` (via `cfb`), `verify_guess`, and `impl FormatAdapter for OoxmlAdapter`**

Add `KdfParams::OoxmlAgile { spin_count: u32, key_bits: u32, salt: Vec<u8>, enc_verifier_hash_input: Vec<u8>, enc_verifier_hash_value: Vec<u8> }`. Implement the iterative-hash + block-key derivation in a private helper; format/parse the `$office$` string. Bind `impl FormatAdapter for OoxmlAdapter` to the three inherent methods (and bind `PdfAdapter`/`ZipAdapter` likewise if not already).

- [ ] **Step 5: Run to verify pass**

Run: `cd crates && cargo test -p decryption-core ooxml::`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/decryption-core/src/ooxml.rs crates/decryption-core/src/adapter.rs
git commit -m "feat(decryption): OOXML extract_hash + verify_guess (agile)"
```

---

### Task 10: In-house CPU dictionary engine

**Files:**

- Create: `crates/decryption-core/src/dictionary.rs`
- Modify: `crates/decryption-core/src/lib.rs`

**Interfaces:**

- Consumes: `RecoveryJob`, and a per-format `verify` dispatch (Tasks 5/7/9).
- Produces: `fn run_dictionary(job: &RecoveryJob, candidates: impl IntoIterator<Item = String>) -> Option<String>` — returns the first candidate for which `verify_guess` is true, parallelized with `rayon`.

- [ ] **Step 1: Write the failing test**

```rust
// src/dictionary.rs
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn finds_password_in_wordlist() {
        // Reuse the OOXML example-hash job (deterministic, pw "hashcat").
        const O: &str = "$office$*2013*100000*256*16*..."; // same example as Task 9
        let job = crate::RecoveryJob{ format: crate::Format::Ooxml, hash: O.into(),
            hashcat_mode: 9600, params: crate::OoxmlAdapter::parse_hash(O).unwrap() };
        let words = vec!["foo".to_string(), "bar".into(), "hashcat".into(), "baz".into()];
        assert_eq!(run_dictionary(&job, words), Some("hashcat".to_string()));
    }
    #[test]
    fn returns_none_when_absent() {
        const O: &str = "$office$*2013*100000*256*16*...";
        let job = crate::RecoveryJob{ format: crate::Format::Ooxml, hash: O.into(),
            hashcat_mode: 9600, params: crate::OoxmlAdapter::parse_hash(O).unwrap() };
        assert_eq!(run_dictionary(&job, vec!["a".to_string(), "b".into()]), None);
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd crates && cargo test -p decryption-core dictionary::`
Expected: FAIL.

- [ ] **Step 3: Implement with `rayon` + a `verify` dispatch on `job.format`**

```rust
// src/dictionary.rs
use crate::{Format, OoxmlAdapter, PdfAdapter, RecoveryJob, ZipAdapter};
use rayon::prelude::*;

pub fn verify(job: &RecoveryJob, candidate: &str) -> bool {
    match job.format {
        Format::Pdf => PdfAdapter::verify_guess(job, candidate),
        Format::Zip => ZipAdapter::verify_guess(job, candidate),
        Format::Ooxml => OoxmlAdapter::verify_guess(job, candidate),
    }
}

pub fn run_dictionary(
    job: &RecoveryJob,
    candidates: impl IntoIterator<Item = String>,
) -> Option<String> {
    let words: Vec<String> = candidates.into_iter().collect();
    words.par_iter().find_any(|c| verify(job, c)).cloned()
}
```

Add `mod dictionary; pub use dictionary::{run_dictionary, verify};` to `src/lib.rs`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd crates && cargo test -p decryption-core dictionary::`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/decryption-core/src/dictionary.rs crates/decryption-core/src/lib.rs
git commit -m "feat(decryption): rayon CPU dictionary engine"
```

---

### Task 11: Top-level dispatch API + integration test

**Files:**

- Modify: `crates/decryption-core/src/lib.rs`
- Create: `crates/decryption-core/tests/integration.rs`

**Interfaces:**

- Produces the crate's public façade:
  - `fn strip_with_key(bytes: &[u8], password: &str) -> Result<DecryptedFile, DecryptError>` (detect → adapter)
  - `fn extract_hash(bytes: &[u8]) -> Result<RecoveryJob, ExtractError>` (detect → adapter)
  - re-exports `verify`, `run_dictionary`, `detect`, `Format`, `RecoveryJob`, etc.

- [ ] **Step 1: Write the failing integration test**

```rust
// tests/integration.rs
use decryption_core::{detect, extract_hash, run_dictionary, strip_with_key, verify, Format};

const PDF: &[u8] = include_bytes!("fixtures/pdf_userpw_test.pdf");
const ZIP_AES: &[u8] = include_bytes!("fixtures/zip_aes_test.zip");
const DOCX: &[u8] = include_bytes!("fixtures/docx_agile_test.docx");

#[test]
fn dispatches_strip_by_detected_format() {
    assert!(strip_with_key(PDF, "test").unwrap().bytes.starts_with(b"%PDF"));
    assert_eq!(strip_with_key(ZIP_AES, "test").unwrap().bytes, b"hello\n");
    assert!(strip_with_key(DOCX, "test").unwrap().bytes.starts_with(b"PK\x03\x04"));
}

#[test]
fn dispatches_extract_then_recovers_via_dictionary() {
    let job = extract_hash(PDF).unwrap();
    assert_eq!(job.format, Format::Pdf);
    assert!(verify(&job, "test"));
    let found = run_dictionary(&job, vec!["a".into(), "test".into(), "b".into()]);
    assert_eq!(found, Some("test".to_string()));
}

#[test]
fn unknown_format_is_none() {
    assert!(detect(b"garbage").is_none());
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd crates && cargo test -p decryption-core --test integration`
Expected: FAIL (top-level `strip_with_key`/`extract_hash` undefined).

- [ ] **Step 3: Implement the façade in `lib.rs`**

```rust
pub fn strip_with_key(bytes: &[u8], password: &str) -> Result<DecryptedFile, DecryptError> {
    match detect(bytes) {
        Some(Format::Pdf) => PdfAdapter::strip_with_key(bytes, password),
        Some(Format::Zip) => ZipAdapter::strip_with_key(bytes, password),
        Some(Format::Ooxml) => OoxmlAdapter::strip_with_key(bytes, password),
        None => Err(DecryptError::Unsupported("unrecognized format".into())),
    }
}

pub fn extract_hash(bytes: &[u8]) -> Result<RecoveryJob, ExtractError> {
    match detect(bytes) {
        Some(Format::Pdf) => PdfAdapter::extract_hash(bytes),
        Some(Format::Zip) => ZipAdapter::extract_hash(bytes),
        Some(Format::Ooxml) => OoxmlAdapter::extract_hash(bytes),
        None => Err(ExtractError::Unsupported("unrecognized format".into())),
    }
}
```

- [ ] **Step 4: Run the full gate**

Run: `cd crates && cargo test -p decryption-core && cargo clippy -p decryption-core --all-targets -- -D warnings && cargo fmt -p decryption-core -- --check`
Expected: PASS (all unit + integration tests; clippy clean; fmt clean).

- [ ] **Step 5: Commit**

```bash
git add crates/decryption-core/src/lib.rs crates/decryption-core/tests/integration.rs
git commit -m "feat(decryption): top-level dispatch facade + integration tests"
```

---

## Self-Review

**Spec coverage (design §2 core, §7 dependencies):**

- `FormatAdapter` trait + `strip_with_key`/`extract_hash`/`verify_guess` → Tasks 2, 4–9. ✓
- PDF/ZIP/OOXML v1 formats → Tasks 4–9. ✓
- Magic-byte detection (OLE2 = OOXML, PK = ZIP) → Task 3. ✓
- In-house CPU dictionary loop (rayon) → Task 10. ✓
- Verified pure-Rust dependency stack (lopdf reused, zip, cfb, office-crypto, RustCrypto 0.10/0.4, rayon) → Task 1 + global constraints. ✓
- 7-Zip, the WASM wrapper, the Worker routes, permission/catalog/migration/audit are **out of scope for this plan** — they are Plan 2 of 2 (WASM + Worker integration) and the 7-Zip follow-on slice, per design §11. Recorded here so the boundary is explicit.

**Placeholder scan:** the per-format `extract_hash`/`verify_guess` tasks intentionally instruct "transcribe the algorithm from design §7, then validate against the pasted hashcat example-hash vector." The example hashes (mode 10700/13600/9600) are the concrete, deterministic gate — the implementer pastes the real value from hashcat's `example_hashes` page into the named const. This is a real, checkable spec, not a "TODO". The crypto algorithms themselves are transcribed in design §7 (referenced, not re-pasted, to stay DRY).

**Type consistency:** `RecoveryJob`/`KdfParams`/`Format`/`DecryptError`/`ExtractError` are defined in Task 2 and extended (new `KdfParams` variants) in Tasks 5/7/9; `verify`/`run_dictionary` (Task 10) and the façade (Task 11) use the exact names. `ZipAdapter` lives in module `zip_adapter` to avoid colliding with the `zip` crate (Task 6 note).

## Execution Handoff

This plan is Plan 1 of 2 for Slice 1. Plan 2 (the `@magna-carta/decryption` WASM wrapper + Worker routes, `tools:decryption` permission, catalog row, per-firm migration, attestation + audit, OpenAPI/api-client regen) is written after this plan's core lands and its API is proven.
