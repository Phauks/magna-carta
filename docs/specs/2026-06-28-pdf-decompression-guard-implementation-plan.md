# PDF Decompression-Bomb Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound memory for every `pdf-core` operation against decompression bombs via one shared, parser-agnostic pre-flight wired into every public entrypoint.

**Architecture:** A new `crates/pdf-core/src/guard.rs` exposes `guard_input(bytes, &GuardLimits)`: an input-size cap plus a raw-bytes scan that bounded-inflates every top-level `stream` blob (deflate / raw-deflate) into a discarding counting sink, rejecting on per-stream or cumulative overflow. Every public operation calls it as its first statement, before lopdf or hayro parses anything. Because PDF streams are always top-level objects, bounding the raw blobs transitively bounds every later inflate.

**Tech Stack:** Rust (lopdf 0.41, hayro 0.7, flate2 1.x — pure-Rust miniz_oxide backend), TypeScript (`@magna-carta/pdf` wasm wrapper), Vitest.

## Global Constraints

- Default caps (verbatim): `max_input_bytes` = 256 MiB · `max_stream_inflated` = 256 MiB · `max_total_inflated` = 1 GiB. Source `GuardLimits::default()`.
- Pure-Rust only — `flate2` must use its default `rust_backend` (miniz_oxide); never enable the `zlib`/C feature (golden rule 14).
- `flate2` is already a transitive dependency (via lopdf) at the version in `crates/Cargo.lock`. Adding it as a direct dependency must NOT change `Cargo.lock` — verify with `git diff -- crates/Cargo.lock` (expect empty).
- No process-doc references in source/tests (no "ADR", "slice", "spec §" — golden rule 13). Explain reasoning inline or cite a file path.
- Passwords/plaintext never logged or placed in errors (the guard runs before decrypt, but keep the rule in mind for decrypt.rs edits).
- Native `cargo test` on this machine can OOM while *linking* pdf-core; build/test with: `CARGO_BUILD_JOBS=1 CARGO_PROFILE_TEST_DEBUG=0 RUSTFLAGS="-C debuginfo=0 -C codegen-units=1" cargo test -p pdf-core --lib`. This is a build-memory workaround, unrelated to runtime.
- All `cargo` commands run from `crates/` (the workspace root); paths below are relative to the repo root.

---

### Task 1: `guard.rs` — limits, pre-flight, bounded inflate

**Files:**
- Create: `crates/pdf-core/src/guard.rs`
- Modify: `crates/pdf-core/src/lib.rs` (add `mod guard;` near the other `mod` lines, e.g. after `mod standard_fonts_data;`)
- Modify: `crates/pdf-core/Cargo.toml` (add `flate2 = "1"` under `[dependencies]`)

**Interfaces:**
- Produces:
  - `pub(crate) struct GuardLimits { pub max_input_bytes: usize, pub max_stream_inflated: usize, pub max_total_inflated: u64 }` with `Default` (256 MiB / 256 MiB / 1 GiB).
  - `pub(crate) enum BombError { InputTooLarge, StreamTooLarge, TotalTooLarge }` (derives `Debug, Clone, Copy, PartialEq, Eq`).
  - `pub(crate) fn guard_input(bytes: &[u8], limits: &GuardLimits) -> Result<(), BombError>`.

- [ ] **Step 1: Add the dependency**

In `crates/pdf-core/Cargo.toml`, under `[dependencies]` (alongside `lopdf = "0.41"`), add:

```toml
flate2 = "1"
```

Run: `cd crates && cargo tree -p pdf-core -i flate2 >/dev/null && git diff --quiet -- Cargo.lock && echo "LOCK CLEAN" || echo "LOCK CHANGED — investigate"`
Expected: `LOCK CLEAN`

- [ ] **Step 2: Declare the module**

In `crates/pdf-core/src/lib.rs`, add this line after `mod standard_fonts_data;`:

```rust
mod guard;
```

- [ ] **Step 3: Write `guard.rs` with the failing unit tests first**

Create `crates/pdf-core/src/guard.rs` with the test module only (the impl is Step 4). The tests fail to compile until the impl exists — that is the intended failing state.

```rust
//! Decompression-bomb defense shared by every pdf-core operation.
//!
//! PDF streams inflate without any size bound in lopdf and hayro, both at load
//! time (object streams) and at our explicit decode sites. `guard_input` runs a
//! raw-bytes pre-flight before either parser sees the document: an input-size cap
//! plus a scan that bounded-inflates every top-level `stream` blob and rejects on
//! per-stream or cumulative overflow. Because a PDF stream is always a top-level
//! indirect object, bounding the raw blobs transitively bounds everything either
//! parser can later inflate.

use std::io::Write;

const MIB: usize = 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct GuardLimits {
    pub max_input_bytes: usize,
    pub max_stream_inflated: usize,
    pub max_total_inflated: u64,
}

impl Default for GuardLimits {
    fn default() -> Self {
        Self {
            max_input_bytes: 256 * MIB,
            max_stream_inflated: 256 * MIB,
            max_total_inflated: 1024 * MIB as u64, // 1 GiB
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BombError {
    InputTooLarge,
    StreamTooLarge,
    TotalTooLarge,
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::write::{DeflateEncoder, ZlibEncoder};
    use flate2::Compression;
    use std::io::Write as _;

    // Build a zlib stream that inflates to `inflated` zero bytes, using a small
    // working buffer so constructing a large bomb stays cheap on memory.
    fn zlib_bomb(inflated: u64) -> Vec<u8> {
        let mut e = ZlibEncoder::new(Vec::new(), Compression::best());
        let chunk = vec![0u8; 64 * 1024];
        let mut left = inflated;
        while left > 0 {
            let n = left.min(chunk.len() as u64) as usize;
            e.write_all(&chunk[..n]).unwrap();
            left -= n as u64;
        }
        e.finish().unwrap()
    }

    fn raw_deflate_bomb(inflated: u64) -> Vec<u8> {
        let mut e = DeflateEncoder::new(Vec::new(), Compression::best());
        let chunk = vec![0u8; 64 * 1024];
        let mut left = inflated;
        while left > 0 {
            let n = left.min(chunk.len() as u64) as usize;
            e.write_all(&chunk[..n]).unwrap();
            left -= n as u64;
        }
        e.finish().unwrap()
    }

    fn pdf_with_stream(blob: &[u8]) -> Vec<u8> {
        let mut v = Vec::new();
        v.extend_from_slice(b"%PDF-1.5\n1 0 obj<</Length 0>>stream\n");
        v.extend_from_slice(blob);
        v.extend_from_slice(b"\nendstream endobj\n%%EOF");
        v
    }

    // Tight limits keep every test fast: nothing here inflates past ~4 MiB.
    fn small() -> GuardLimits {
        GuardLimits {
            max_input_bytes: 8 * MIB,
            max_stream_inflated: MIB,
            max_total_inflated: 3 * MIB as u64,
        }
    }

    #[test]
    fn rejects_oversize_input() {
        let big = vec![0u8; small().max_input_bytes + 1];
        assert_eq!(guard_input(&big, &small()), Err(BombError::InputTooLarge));
    }

    #[test]
    fn passes_a_benign_deflate_stream() {
        let blob = zlib_bomb(256 * 1024); // 256 KiB inflated < 1 MiB cap
        let pdf = pdf_with_stream(&blob);
        assert_eq!(guard_input(&pdf, &small()), Ok(()));
    }

    #[test]
    fn rejects_a_zlib_bomb_over_the_stream_cap() {
        let blob = zlib_bomb(2 * MIB as u64); // 2 MiB inflated > 1 MiB cap
        let pdf = pdf_with_stream(&blob);
        assert_eq!(guard_input(&pdf, &small()), Err(BombError::StreamTooLarge));
    }

    #[test]
    fn rejects_a_raw_deflate_bomb() {
        let blob = raw_deflate_bomb(2 * MIB as u64);
        let pdf = pdf_with_stream(&blob);
        assert_eq!(guard_input(&pdf, &small()), Err(BombError::StreamTooLarge));
    }

    #[test]
    fn rejects_cumulative_total_across_streams() {
        // Three streams, each under the 1 MiB per-stream cap but summing past the
        // 3 MiB total cap.
        let one = zlib_bomb(900 * 1024);
        let mut pdf = Vec::new();
        for _ in 0..4 {
            pdf.extend_from_slice(b"1 0 obj<</Length 0>>stream\n");
            pdf.extend_from_slice(&one);
            pdf.extend_from_slice(b"\nendstream endobj\n");
        }
        assert_eq!(guard_input(&pdf, &small()), Err(BombError::TotalTooLarge));
    }

    #[test]
    fn self_terminates_without_an_endstream_keyword() {
        // No `endstream`, plus trailing garbage: the decoder still stops at the
        // deflate end and the bomb is still caught.
        let blob = zlib_bomb(2 * MIB as u64);
        let mut pdf = Vec::new();
        pdf.extend_from_slice(b"%PDF-1.5\n1 0 obj<</Length 0>>stream\n");
        pdf.extend_from_slice(&blob);
        pdf.extend_from_slice(b"\x00\x01\x02trailing-garbage-no-endstream");
        assert_eq!(guard_input(&pdf, &small()), Err(BombError::StreamTooLarge));
    }

    #[test]
    fn ignores_non_deflate_and_streamless_input() {
        assert_eq!(guard_input(b"not a pdf at all", &small()), Ok(()));
        // An uncompressed (non-deflate) stream body is skipped, not rejected.
        let pdf = pdf_with_stream(b"plain uncompressed bytes, not deflate");
        assert_eq!(guard_input(&pdf, &small()), Ok(()));
    }
}
```

- [ ] **Step 4: Run the tests to verify they fail (no impl yet)**

Run: `cd crates && cargo test -p pdf-core --lib guard:: 2>&1 | tail -20`
Expected: compile error — `guard_input` not found.

- [ ] **Step 5: Write the implementation**

Insert this ABOVE the `#[cfg(test)]` line in `crates/pdf-core/src/guard.rs`:

```rust
/// A `Write` sink that counts bytes and discards them, failing once it passes `cap`.
/// Lets us inflate a stream for measurement without ever holding the output.
struct CountingSink {
    count: u64,
    cap: u64,
    overflowed: bool,
}

impl CountingSink {
    fn new(cap: u64) -> Self {
        Self { count: 0, cap, overflowed: false }
    }
}

impl Write for CountingSink {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.count += buf.len() as u64;
        if self.count > self.cap {
            self.overflowed = true;
            // Stop the decoder early; the variant is irrelevant, we read `overflowed`.
            return Err(std::io::Error::from(std::io::ErrorKind::Other));
        }
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

enum Inflated {
    /// Produced more than the per-stream cap.
    Overflow,
    /// Decoded this many bytes (0 means the blob is not deflate).
    Bytes(u64),
}

/// Inflate `blob` as zlib, then (only if that produced nothing) as raw deflate,
/// discarding output. The first decoder that overflows or produces bytes wins; a
/// non-deflate blob yields `Bytes(0)`. Short-circuits so a bomb is inflated once.
fn inflate_deflate(blob: &[u8], cap: u64) -> Inflated {
    use flate2::read::{DeflateDecoder, ZlibDecoder};
    // zlib (RFC 1950)
    match copy_counted(ZlibDecoder::new(blob), cap) {
        Inflated::Overflow => return Inflated::Overflow,
        Inflated::Bytes(n) if n > 0 => return Inflated::Bytes(n),
        Inflated::Bytes(_) => {}
    }
    // raw deflate (RFC 1951) for streams stored without a zlib header
    copy_counted(DeflateDecoder::new(blob), cap)
}

fn copy_counted<R: std::io::Read>(mut reader: R, cap: u64) -> Inflated {
    let mut sink = CountingSink::new(cap);
    // Ignore the result: a decoder error (non-deflate / truncated) just ends the
    // copy; overflow is reported via `sink.overflowed`.
    let _ = std::io::copy(&mut reader, &mut sink);
    if sink.overflowed {
        Inflated::Overflow
    } else {
        Inflated::Bytes(sink.count)
    }
}

/// First index at or after `from` where `needle` occurs in `hay`.
fn find_from(hay: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    if needle.is_empty() || from >= hay.len() {
        return None;
    }
    let first = needle[0];
    let mut i = from;
    while i + needle.len() <= hay.len() {
        if hay[i] == first && &hay[i..i + needle.len()] == needle {
            return Some(i);
        }
        i += 1;
    }
    None
}

pub(crate) fn guard_input(bytes: &[u8], limits: &GuardLimits) -> Result<(), BombError> {
    if bytes.len() > limits.max_input_bytes {
        return Err(BombError::InputTooLarge);
    }
    let per_stream = limits.max_stream_inflated as u64;
    let mut cumulative: u64 = 0;
    let mut cursor = 0usize;

    while let Some(kw) = find_from(bytes, b"stream", cursor) {
        // Stream data begins after the EOL that follows the `stream` keyword
        // (CRLF or LF), per the PDF spec. Be lenient about which.
        let mut start = kw + b"stream".len();
        if bytes.get(start) == Some(&b'\r') {
            start += 1;
        }
        if bytes.get(start) == Some(&b'\n') {
            start += 1;
        }
        if start >= bytes.len() {
            break;
        }

        match inflate_deflate(&bytes[start..], per_stream) {
            Inflated::Overflow => return Err(BombError::StreamTooLarge),
            Inflated::Bytes(n) => {
                cumulative += n;
                if cumulative > limits.max_total_inflated {
                    return Err(BombError::TotalTooLarge);
                }
            }
        }

        // Advance the scan cursor. The inflate already self-terminated; `endstream`
        // only moves us past this object's data efficiently. A spurious early match
        // inside binary content merely costs an extra (bounded, fast-failing) inflate.
        cursor = match find_from(bytes, b"endstream", start) {
            Some(e) => e + b"endstream".len(),
            None => start + 1,
        };
    }
    Ok(())
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd crates && cargo test -p pdf-core --lib guard:: 2>&1 | tail -20`
Expected: all 7 `guard::tests::*` pass.

- [ ] **Step 7: Lint**

Run: `cd crates && cargo clippy -p pdf-core --all-targets 2>&1 | tail -15`
Expected: no warnings in `guard.rs`.

- [ ] **Step 8: Commit**

```bash
git add crates/pdf-core/src/guard.rs crates/pdf-core/src/lib.rs crates/pdf-core/Cargo.toml
git commit -m "feat(pdf): decompression-bomb guard module (input cap + deflate pre-flight)"
```

---

### Task 2: Wire the guard into `Document::load` / `load_protected`

**Files:**
- Modify: `crates/pdf-core/src/lib.rs` (`PdfError`, `Document::load`, `Document::load_protected`)
- Modify: `crates/pdf-core/src/redact.rs:313` (switch internal load to the unguarded path)

**Interfaces:**
- Consumes: `crate::guard::{guard_input, GuardLimits}`, `crate::guard::BombError` (Task 1).
- Produces: `PdfError::Rejected`; `pub(crate) fn Document::load_unguarded(bytes: Vec<u8>) -> Result<Self, PdfError>`.

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `crates/pdf-core/src/lib.rs`:

```rust
    #[test]
    fn load_rejects_oversize_input() {
        let limits = crate::guard::GuardLimits::default();
        let big = vec![0u8; limits.max_input_bytes + 1];
        assert_eq!(Document::load(big), Err(PdfError::Rejected));
    }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd crates && cargo test -p pdf-core --lib load_rejects_oversize_input 2>&1 | tail -15`
Expected: compile error — `PdfError::Rejected` not found.

- [ ] **Step 3: Add the `Rejected` variant**

In `crates/pdf-core/src/lib.rs`, change the `PdfError` enum to:

```rust
#[derive(Debug, PartialEq, Eq)]
pub enum PdfError {
    Parse,
    PageOutOfRange,
    Render,
    /// Input rejected by the decompression-bomb guard (oversize or a bomb).
    Rejected,
}
```

- [ ] **Step 4: Split load into guarded + unguarded and guard `load_protected`**

Replace the existing `Document::load` and `Document::load_protected` bodies in `crates/pdf-core/src/lib.rs` with:

```rust
    /// Parse without the bomb guard. Callers that already ran `guard_input` on the
    /// same bytes use this to avoid scanning twice.
    pub(crate) fn load_unguarded(bytes: Vec<u8>) -> Result<Self, PdfError> {
        Pdf::new(bytes)
            .map(|pdf| Document { pdf })
            .map_err(|_| PdfError::Parse)
    }

    pub fn load(bytes: Vec<u8>) -> Result<Self, PdfError> {
        crate::guard::guard_input(&bytes, &crate::guard::GuardLimits::default())
            .map_err(|_| PdfError::Rejected)?;
        Self::load_unguarded(bytes)
    }

    /// Load a possibly-encrypted PDF, decrypting with `password` first so the render
    /// path sees plaintext. An unencrypted input loads normally; a wrong password
    /// yields [`SecureError::WrongPassword`].
    pub fn load_protected(bytes: Vec<u8>, password: &str) -> Result<Self, SecureError> {
        crate::guard::guard_input(&bytes, &crate::guard::GuardLimits::default())
            .map_err(|_| SecureError::Rejected)?;
        match crate::decrypt::decrypt_unguarded(&bytes, password) {
            Ok(plain) => Self::load_unguarded(plain).map_err(|_| SecureError::Parse),
            // The model parser could not read it at all — it may still be a valid
            // unencrypted document the render parser accepts. Try it directly.
            Err(SecureError::Parse) => Self::load_unguarded(bytes).map_err(|_| SecureError::Parse),
            Err(other) => Err(other),
        }
    }
```

> Note: `SecureError::Rejected` and `decrypt::decrypt_unguarded` are added in Task 3. If implementing strictly in order, temporarily keep `load_protected` calling `decrypt`/`Self::load` until Task 3, then apply the block above. Subagent-driven execution should treat Tasks 2 and 3 as a pair.

- [ ] **Step 5: Point redact's internal load at the unguarded path**

`redact` guards its own input (Task 4), so its render-load must not re-scan. In `crates/pdf-core/src/redact.rs:313`, change:

```rust
    let render_doc = Document::load(bytes.clone()).map_err(|_| RedactError::Parse)?; // hayro, for rendering
```
to:
```rust
    let render_doc = Document::load_unguarded(bytes.clone()).map_err(|_| RedactError::Parse)?; // hayro, for rendering
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd crates && cargo test -p pdf-core --lib load_rejects_oversize_input 2>&1 | tail -15`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add crates/pdf-core/src/lib.rs crates/pdf-core/src/redact.rs
git commit -m "feat(pdf): guard Document::load/load_protected; unguarded internal load"
```

---

### Task 3: Wire the guard into `decrypt`, `inspect_security`, `secure`

**Files:**
- Modify: `crates/pdf-core/src/decrypt.rs` (`SecureError`, `decrypt`, `inspect_security`, add `decrypt_unguarded`)
- Modify: `crates/pdf-core/src/secure.rs` (`secure`)

**Interfaces:**
- Consumes: `crate::guard::{guard_input, GuardLimits}`.
- Produces: `SecureError::Rejected`; `pub(crate) fn decrypt::decrypt_unguarded(bytes: &[u8], password: &str) -> Result<Vec<u8>, SecureError>`.

- [ ] **Step 1: Write the failing tests**

Add to the `tests` module in `crates/pdf-core/src/secure.rs`:

```rust
    #[test]
    fn secure_rejects_oversize_input() {
        let limits = crate::guard::GuardLimits::default();
        let big = vec![0u8; limits.max_input_bytes + 1];
        // `opts(..)` is the existing SecureOptions test helper in this module.
        assert_eq!(secure(&big, &opts(None)), Err(crate::SecureError::Rejected));
    }
```

Add to the `tests` module in `crates/pdf-core/src/decrypt.rs`:

```rust
    #[test]
    fn decrypt_and_inspect_reject_oversize_input() {
        let limits = crate::guard::GuardLimits::default();
        let big = vec![0u8; limits.max_input_bytes + 1];
        assert_eq!(decrypt(&big, "pw"), Err(SecureError::Rejected));
        assert_eq!(inspect_security(&big), Err(SecureError::Rejected));
    }
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd crates && cargo test -p pdf-core --lib reject_oversize 2>&1 | tail -15`
Expected: compile error — `SecureError::Rejected` not found.

- [ ] **Step 3: Add the `Rejected` variant**

In `crates/pdf-core/src/decrypt.rs`, add to the `SecureError` enum (which derives `Debug, PartialEq, Eq`):

```rust
    /// Input rejected by the decompression-bomb guard (oversize or a bomb).
    Rejected,
```

- [ ] **Step 4: Split `decrypt` and guard the entrypoints**

In `crates/pdf-core/src/decrypt.rs`, rename the current `pub fn decrypt` to `pub(crate) fn decrypt_unguarded` (keep its body unchanged), then add a guarded wrapper above it:

```rust
pub fn decrypt(bytes: &[u8], password: &str) -> Result<Vec<u8>, SecureError> {
    crate::guard::guard_input(bytes, &crate::guard::GuardLimits::default())
        .map_err(|_| SecureError::Rejected)?;
    decrypt_unguarded(bytes, password)
}

pub(crate) fn decrypt_unguarded(bytes: &[u8], password: &str) -> Result<Vec<u8>, SecureError> {
    // ... unchanged body of the former `decrypt` ...
}
```

In the same file, add the guard as the first statement of `inspect_security`:

```rust
pub fn inspect_security(bytes: &[u8]) -> Result<SecurityInfo, SecureError> {
    crate::guard::guard_input(bytes, &crate::guard::GuardLimits::default())
        .map_err(|_| SecureError::Rejected)?;
    // ... existing body ...
```

- [ ] **Step 5: Guard `secure`**

In `crates/pdf-core/src/secure.rs`, add the guard as the first statement of `secure` (before `Document::load_mem`):

```rust
pub fn secure(bytes: &[u8], opts: &SecureOptions) -> Result<Vec<u8>, SecureError> {
    crate::guard::guard_input(bytes, &crate::guard::GuardLimits::default())
        .map_err(|_| SecureError::Rejected)?;
    let mut doc = Document::load_mem(bytes).map_err(|_| SecureError::Parse)?;
    // ... existing body ...
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd crates && cargo test -p pdf-core --lib reject_oversize 2>&1 | tail -15`
Expected: both new tests PASS.

- [ ] **Step 7: Verify the existing secure/decrypt suite still passes**

Run: `cd crates && cargo test -p pdf-core --lib decrypt:: secure:: 2>&1 | tail -15`
Expected: all pass (no regression from the load_protected pairing in Task 2).

- [ ] **Step 8: Commit**

```bash
git add crates/pdf-core/src/decrypt.rs crates/pdf-core/src/secure.rs
git commit -m "feat(pdf): guard decrypt/inspect_security/secure entrypoints"
```

---

### Task 4: Wire the guard into the transforms (redact, scrub, generate, watermark, bates)

**Files:**
- Modify: `crates/pdf-core/src/redact.rs` (`RedactError`, `redact`)
- Modify: `crates/pdf-core/src/scrub.rs` (`ScrubError`, `sanitize`)
- Modify: `crates/pdf-core/src/generate.rs` (`GenerateError`, `merge`, `split`, `rotate`)
- Modify: `crates/pdf-core/src/watermark.rs` (`watermark`)
- Modify: `crates/pdf-core/src/bates.rs` (`BatesError`, `stamp_document`)

**Interfaces:**
- Consumes: `crate::guard::{guard_input, GuardLimits}`.
- Produces: `RedactError::Rejected`, `ScrubError::Rejected`, `GenerateError::Rejected`, `BatesError::Rejected`.

- [ ] **Step 1: Write the failing tests**

Add one rejection test per module, each feeding an oversize input. `RedactError`/`ScrubError`/`BatesError` derive only `Debug`, so assert with `matches!`; `GenerateError` derives `PartialEq`, so `assert_eq!` is fine.

In `crates/pdf-core/src/redact.rs` tests:
```rust
    #[test]
    fn redact_rejects_oversize_input() {
        let big = vec![0u8; crate::guard::GuardLimits::default().max_input_bytes + 1];
        assert!(matches!(
            redact(big, &[], &RedactionOptions::default()),
            Err(RedactError::Rejected)
        ));
    }
```
> `redact`'s first parameter is `bytes: Vec<u8>`; `RedactionOptions` derives/impls `Default` (see `redact.rs`).

In `crates/pdf-core/src/scrub.rs` tests:
```rust
    #[test]
    fn sanitize_rejects_oversize_input() {
        let big = vec![0u8; crate::guard::GuardLimits::default().max_input_bytes + 1];
        assert!(matches!(
            sanitize(big, &ScrubOptions::default()),
            Err(ScrubError::Rejected)
        ));
    }
```

In `crates/pdf-core/src/generate.rs` tests:
```rust
    #[test]
    fn generate_ops_reject_oversize_input() {
        let big = vec![0u8; crate::guard::GuardLimits::default().max_input_bytes + 1];
        assert_eq!(split(&big, &[]), Err(GenerateError::Rejected));
        assert_eq!(
            rotate(&big, Rotation::Cw90, &PageSelection::All),
            Err(GenerateError::Rejected)
        );
        assert_eq!(merge(&[&big]), Err(GenerateError::Rejected));
    }
```

In `crates/pdf-core/src/watermark.rs` tests:
```rust
    #[test]
    fn watermark_rejects_oversize_input() {
        let big = vec![0u8; crate::guard::GuardLimits::default().max_input_bytes + 1];
        // `text_opts(..)` is the existing WatermarkOptions test helper in this module.
        let opts = text_opts("x", WatermarkPlacement::Center);
        assert_eq!(watermark(&big, &opts), Err(crate::GenerateError::Rejected));
    }
```

In `crates/pdf-core/src/bates.rs` tests:
```rust
    #[test]
    fn stamp_rejects_oversize_input() {
        let big = vec![0u8; crate::guard::GuardLimits::default().max_input_bytes + 1];
        assert!(matches!(
            stamp_document(&big, &BatesOptions::default(), 1),
            Err(BatesError::Rejected)
        ));
    }
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd crates && cargo test -p pdf-core --lib reject 2>&1 | tail -25`
Expected: compile errors — the `Rejected` variants don't exist yet.

- [ ] **Step 3: Add the `Rejected` variants**

- `crates/pdf-core/src/redact.rs` `RedactError` — add `Rejected,`
- `crates/pdf-core/src/scrub.rs` `ScrubError` — add `Rejected,`
- `crates/pdf-core/src/bates.rs` `BatesError` — add `Rejected,`
- `crates/pdf-core/src/generate.rs` `GenerateError` — add:
  ```rust
      /// Input rejected by the decompression-bomb guard (oversize or a bomb).
      Rejected,
  ```

- [ ] **Step 4: Add the guard call to each entrypoint**

Insert as the FIRST statement of each function (use `&bytes` where the param is `Vec<u8>`, `bytes` where it is `&[u8]`):

`redact` (`bytes: Vec<u8>`):
```rust
    crate::guard::guard_input(&bytes, &crate::guard::GuardLimits::default())
        .map_err(|_| RedactError::Rejected)?;
```
`sanitize` (`bytes: Vec<u8>`):
```rust
    crate::guard::guard_input(&bytes, &crate::guard::GuardLimits::default())
        .map_err(|_| ScrubError::Rejected)?;
```
`split` / `rotate` (`bytes: &[u8]`) and `watermark` (`bytes: &[u8]`):
```rust
    crate::guard::guard_input(bytes, &crate::guard::GuardLimits::default())
        .map_err(|_| GenerateError::Rejected)?;
```
`merge` (`documents: &[&[u8]]`) — guard each input:
```rust
    for doc in documents {
        crate::guard::guard_input(doc, &crate::guard::GuardLimits::default())
            .map_err(|_| GenerateError::Rejected)?;
    }
```
`stamp_document` (`bytes: &[u8]`):
```rust
    crate::guard::guard_input(bytes, &crate::guard::GuardLimits::default())
        .map_err(|_| BatesError::Rejected)?;
```
> `stamp_set` calls `stamp_document` per document, so it inherits the guard — do NOT add a separate call there.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd crates && cargo test -p pdf-core --lib reject 2>&1 | tail -25`
Expected: all new rejection tests PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/pdf-core/src/redact.rs crates/pdf-core/src/scrub.rs crates/pdf-core/src/generate.rs crates/pdf-core/src/watermark.rs crates/pdf-core/src/bates.rs
git commit -m "feat(pdf): guard redact/scrub/generate/watermark/bates entrypoints"
```

---

### Task 5: Wire the guard into forms and detect

**Files:**
- Modify: `crates/pdf-core/src/forms.rs` (`FormError`, `read_form`, `fill_form`, `flatten_form`)
- Modify: `crates/pdf-core/src/detect.rs` (`DetectError`, `detect`)

**Interfaces:**
- Consumes: `crate::guard::{guard_input, GuardLimits}`.
- Produces: `FormError::Rejected`, `DetectError::Rejected`.

- [ ] **Step 1: Write the failing tests**

In `crates/pdf-core/src/forms.rs` tests (`FormError` derives only `Debug`):
```rust
    #[test]
    fn forms_reject_oversize_input() {
        let big = vec![0u8; crate::guard::GuardLimits::default().max_input_bytes + 1];
        assert!(matches!(read_form(&big), Err(FormError::Rejected)));
        assert!(matches!(flatten_form(&big), Err(FormError::Rejected)));
    }
```

In `crates/pdf-core/src/detect.rs` tests (`DetectError` derives only `Debug`):
```rust
    #[test]
    fn detect_rejects_oversize_input() {
        let big = vec![0u8; crate::guard::GuardLimits::default().max_input_bytes + 1];
        assert!(matches!(detect(big), Err(DetectError::Rejected)));
    }
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd crates && cargo test -p pdf-core --lib reject_oversize 2>&1 | tail -15`
Expected: compile errors — `FormError::Rejected` / `DetectError::Rejected` missing.

- [ ] **Step 3: Add the `Rejected` variants**

- `crates/pdf-core/src/forms.rs` `FormError` — add `Rejected,`
- `crates/pdf-core/src/detect.rs` `DetectError` — add `Rejected,`

- [ ] **Step 4: Add the guard calls**

First statement of `read_form`, `fill_form`, `flatten_form` (`bytes: &[u8]`):
```rust
    crate::guard::guard_input(bytes, &crate::guard::GuardLimits::default())
        .map_err(|_| FormError::Rejected)?;
```
First statement of `detect` (`bytes: Vec<u8>`):
```rust
    crate::guard::guard_input(&bytes, &crate::guard::GuardLimits::default())
        .map_err(|_| DetectError::Rejected)?;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd crates && cargo test -p pdf-core --lib reject_oversize 2>&1 | tail -15`
Expected: PASS.

- [ ] **Step 6: Full lib test sweep + lint**

Run: `cd crates && cargo test -p pdf-core --lib 2>&1 | tail -8 && cargo clippy -p pdf-core --all-targets 2>&1 | tail -8`
Expected: all tests pass; no clippy warnings.

- [ ] **Step 7: Commit**

```bash
git add crates/pdf-core/src/forms.rs crates/pdf-core/src/detect.rs
git commit -m "feat(pdf): guard read_form/fill_form/flatten_form/detect entrypoints"
```

---

### Task 6: End-to-end integration test — real deflate bomb at default limits

**Files:**
- Create: `crates/pdf-core/tests/bomb_guard.rs`

**Interfaces:**
- Consumes: the public crate API (`pdf_core::{detect, secure, inspect_security, decrypt, merge, split, read_form, flatten_form, Document, ...}`) and the public error types.

- [ ] **Step 1: Write the test**

This is the only test that exercises the pre-flight (not just the input cap) at the real 256 MiB defaults, so it builds a genuine deflate bomb once and runs it through the cheap-to-call ops. The bomb is ~256 KiB on disk, inflates past 256 MiB, and is caught by streaming discard — low memory, ~1 s CPU per op.

Create `crates/pdf-core/tests/bomb_guard.rs`:

```rust
//! A deflate stream that inflates past the 256 MiB per-stream cap must be rejected
//! by the pre-flight before any parser inflates it. One bomb, several entrypoints.

use flate2::write::ZlibEncoder;
use flate2::Compression;
use std::io::Write;

const OVER_256_MIB: u64 = 256 * 1024 * 1024 + 1;

fn bomb_pdf() -> Vec<u8> {
    let mut e = ZlibEncoder::new(Vec::new(), Compression::best());
    let chunk = vec![0u8; 64 * 1024];
    let mut left = OVER_256_MIB;
    while left > 0 {
        let n = left.min(chunk.len() as u64) as usize;
        e.write_all(&chunk[..n]).unwrap();
        left -= n as u64;
    }
    let blob = e.finish().unwrap();
    let mut v = Vec::new();
    v.extend_from_slice(b"%PDF-1.5\n1 0 obj<</Length 0>>stream\n");
    v.extend_from_slice(&blob);
    v.extend_from_slice(b"\nendstream endobj\n%%EOF");
    v
}

#[test]
fn deflate_bomb_is_rejected_at_default_limits() {
    let pdf = bomb_pdf();

    assert!(matches!(
        pdf_core::detect(pdf.clone()),
        Err(pdf_core::DetectError::Rejected)
    ));
    assert!(matches!(
        pdf_core::Document::load(pdf.clone()),
        Err(pdf_core::PdfError::Rejected)
    ));
    assert_eq!(
        pdf_core::inspect_security(&pdf),
        Err(pdf_core::SecureError::Rejected)
    );
    assert_eq!(
        pdf_core::decrypt(&pdf, "pw"),
        Err(pdf_core::SecureError::Rejected)
    );
    assert_eq!(pdf_core::split(&pdf, &[]), Err(pdf_core::GenerateError::Rejected));
    assert_eq!(pdf_core::merge(&[&pdf]), Err(pdf_core::GenerateError::Rejected));
    assert!(matches!(
        pdf_core::read_form(&pdf),
        Err(pdf_core::FormError::Rejected)
    ));
    assert!(matches!(
        pdf_core::flatten_form(&pdf),
        Err(pdf_core::FormError::Rejected)
    ));
}

// No false positives: real, legitimate documents pass the guard. The largest
// inflated stream in this corpus is ~0.24 MiB, far under the 256 MiB caps.
#[test]
fn real_fixtures_pass_the_guard() {
    let w9 = include_bytes!("../../pdf-eval/corpus-ci/gov_irs_w9_acroform.pdf").to_vec();
    let basicapi = include_bytes!("../../pdf-eval/corpus-ci/basicapi.pdf").to_vec();
    // read_form runs guard_input first; an Ok/NoAcroform result (not Rejected)
    // proves the guard let the document through.
    assert!(!matches!(pdf_core::read_form(&w9), Err(pdf_core::FormError::Rejected)));
    assert!(!matches!(
        pdf_core::read_form(&basicapi),
        Err(pdf_core::FormError::Rejected)
    ));
}
```

> `pdf_core` is the crate name (confirm via `crates/pdf-core/Cargo.toml` `[package] name`). If items are not re-exported at the crate root, qualify them with the actual public path. Confirm the corpus paths resolve from `crates/pdf-core/tests/` (the `../../pdf-eval/corpus-ci/` prefix). `flate2` is available to the integration test as a dev/normal dependency of the crate.

- [ ] **Step 2: Run it**

Run: `cd crates && cargo test -p pdf-core --test bomb_guard 2>&1 | tail -15`
Expected: PASS (one test, a few seconds).

- [ ] **Step 3: Commit**

```bash
git add crates/pdf-core/tests/bomb_guard.rs
git commit -m "test(pdf): end-to-end deflate-bomb rejection at default limits"
```

---

### Task 7: Map the guard error to a stable WASM token

**Files:**
- Modify: `crates/pdf-core/src/wasm.rs` (8 `From<…Error> for JsError` impls)

**Interfaces:**
- Consumes: every `…Error::Rejected` variant from Tasks 2–5.
- Produces: WASM error message token `"decompression-bomb"` for all of them.

- [ ] **Step 1: Add the `Rejected` arm to each `From` impl**

`wasm.rs` is compiled only for `wasm32`, so it is verified by the build in Task 8, not a native unit test. In each impl, add a `Rejected => "decompression-bomb"` arm, matching that impl's existing style:

- `From<PdfError>` (line ~8): `PdfError::Rejected => "decompression-bomb",`
- `From<crate::RedactError>` (line ~89): `crate::RedactError::Rejected => JsError::new("decompression-bomb"),`
- `From<crate::ScrubError>` (line ~199): `crate::ScrubError::Rejected => JsError::new("decompression-bomb"),`
- `From<crate::bates::BatesError>` (line ~252): `crate::bates::BatesError::Rejected => "decompression-bomb",`
- `From<crate::FormError>` (line ~285): `crate::FormError::Rejected => "decompression-bomb",`
- `From<crate::DetectError>` (line ~528): `crate::DetectError::Rejected => JsError::new("decompression-bomb"),`
- `From<crate::SecureError>` (line ~635): `crate::SecureError::Rejected => "decompression-bomb",`
- `From<crate::GenerateError>` (line ~797): `crate::GenerateError::Rejected => "decompression-bomb",`

> Match the surrounding arm shape: impls built as `JsError::new(match e { … })` take a bare string (`Rejected => "decompression-bomb",`); impls built as `match e { X => JsError::new("…") }` take `Rejected => JsError::new("decompression-bomb"),`. Confirm each by reading the few lines around the cited line number.

- [ ] **Step 2: Verify the wasm target compiles**

Run: `cd crates && cargo check -p pdf-core --target wasm32-unknown-unknown 2>&1 | tail -15`
Expected: compiles (the match arms are now exhaustive). If the target is missing: `rustup target add wasm32-unknown-unknown`.

- [ ] **Step 3: Commit**

```bash
git add crates/pdf-core/src/wasm.rs
git commit -m "feat(pdf): map guard rejection to the decompression-bomb wasm token"
```

---

### Task 8: Typed `DecompressionBombError` across the TS surface

**Files:**
- Modify: `packages/pdf/src/index.ts` (add the error class + a guard-mapping helper; apply it to the public wrappers)
- Test: `packages/pdf/test/guard.test.ts` (new)

**Interfaces:**
- Consumes: the `"decompression-bomb"` token thrown by the wasm layer (Task 7).
- Produces: `export class DecompressionBombError extends Error` (`code = "decompression-bomb"`).

- [ ] **Step 1: Rebuild the wasm artifact**

The TS test loads the compiled wasm, so rebuild it with the new token mapping:

Run: `pnpm --filter @magna-carta/pdf run build:wasm 2>&1 | tail -5`
Expected: build succeeds (`src/pkg/` is regenerated; it is gitignored).

- [ ] **Step 2: Write the failing test**

Create `packages/pdf/test/guard.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { deflateSync } from "node:zlib";
import { ensureReady, redactDocument, DecompressionBombError } from "../src/index.ts";

// A zlib stream that inflates past the 256 MiB per-stream cap, embedded as a PDF
// stream object. The guard rejects it before any parsing.
function bombPdf(): Uint8Array {
  const zeros = Buffer.alloc(256 * 1024 * 1024 + 1);
  const blob = deflateSync(zeros); // zlib-wrapped deflate
  const head = Buffer.from("%PDF-1.5\n1 0 obj<</Length 0>>stream\n", "latin1");
  const tail = Buffer.from("\nendstream endobj\n%%EOF", "latin1");
  return new Uint8Array(Buffer.concat([head, blob, tail]));
}

describe("decompression-bomb guard", () => {
  beforeAll(async () => {
    await ensureReady();
  });

  it("throws a typed DecompressionBombError", async () => {
    await expect(redactDocument(bombPdf(), [], {})).rejects.toBeInstanceOf(
      DecompressionBombError,
    );
  });
});
```

> Confirm `redactDocument`'s argument shape against `index.ts` and adjust the call (regions/options) to a minimal valid form; the guard fires before the arguments are used.

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @magna-carta/pdf test guard 2>&1 | tail -20`
Expected: FAIL — `DecompressionBombError` is not exported / not thrown.

- [ ] **Step 4: Add the error class and mapping helper**

In `packages/pdf/src/index.ts`, near the existing `WrongPasswordError` class, add:

```ts
/** Thrown by any operation when the decompression-bomb guard rejects the input
 * (oversize, or a stream that inflates past the engine's caps). */
export class DecompressionBombError extends Error {
  readonly code = "decompression-bomb" as const;
  constructor() {
    super("The document was rejected as a potential decompression bomb.");
    this.name = "DecompressionBombError";
  }
}

/** Re-throw the engine's guard token as a typed error; pass anything else through. */
function mapGuardError(error: unknown): never {
  if (error instanceof Error && error.message === "decompression-bomb") {
    throw new DecompressionBombError();
  }
  throw error;
}
```

- [ ] **Step 5: Wrap each public operation**

Each wrapper that calls a wasm function on caller bytes must route failures through `mapGuardError`. Apply this transformation to every wrapper below — wrap the wasm call in `try { … } catch (error) { mapGuardError(error); }`.

Example — `detectDocument` becomes:
```ts
export async function detectDocument(bytes: Uint8Array): Promise<DetectionReport> {
  await ensureReady();
  try {
    return wasmDetect(bytes) as DetectionReport;
  } catch (error) {
    mapGuardError(error);
  }
}
```

Example — `decryptDocument` already has a catch; fold the guard into it:
```ts
  } catch (error) {
    if (error instanceof Error && error.message === "wrong-password") {
      throw new WrongPasswordError();
    }
    mapGuardError(error);
  }
```

Apply the same wrap to each of these wrappers (the wasm call differs; the try/catch is identical):
`loadDocument`, `redactDocument`, `sanitizeDocument`, `stampBates`, `detectDocument`, `readForm`, `fillForm`, `flattenForm`, `inspectSecurity`, `decryptDocument`, `secureDocument`, `mergeDocuments`, `splitDocument`, `rotatePages`, `watermarkDocument`.

> `mapGuardError` always throws, so TypeScript accepts it as the `catch` body of a function that otherwise returns a value (its return type is `never`). No `return` is needed after it.

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @magna-carta/pdf test guard 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 7: Run the full pdf package suite (no regression)**

Run: `pnpm --filter @magna-carta/pdf test 2>&1 | tail -15`
Expected: all tests pass (33 prior + the new guard test).

- [ ] **Step 8: Commit**

```bash
git add packages/pdf/src/index.ts packages/pdf/test/guard.test.ts
git commit -m "feat(pdf): typed DecompressionBombError across the TS wrappers"
```

---

### Task 9: Documentation and process fragments

**Files:**
- Modify: `packages/pdf/README.md` (a short "Decompression-bomb guard" subsection)
- Create: `changelog.d/pdf-decompression-guard.md`
- Create: `docs/decisions/pending/pdf-decompression-guard.md`
- Modify: `STATUS.md` (the PDF-engine row — own row only)
- Modify: `ROADMAP.md` (PDF-engine entry)

**Interfaces:** none (docs only).

- [ ] **Step 1: README subsection**

Add to `packages/pdf/README.md` a brief section stating: every operation rejects oversize input (>256 MiB) and deflate streams that inflate past the engine's caps, throwing `DecompressionBombError`; the bound is deflate-rigorous with LZW/RunLength and image-codec expansion disclosed as residual. No process-doc references.

- [ ] **Step 2: Changelog fragment**

Create `changelog.d/pdf-decompression-guard.md`:

```markdown
### Added

- PDF engine: a crate-wide decompression-bomb guard. Every operation now rejects
  oversize input and streams that inflate past safe caps, surfacing a typed
  `DecompressionBombError` to callers.
```

- [ ] **Step 3: ADR fragment**

Create `docs/decisions/pending/pdf-decompression-guard.md` following the repo's ADR fragment frontmatter convention (copy the shape of an existing file in `docs/decisions/pending/`). Record: the decision to bound deflate via a raw-bytes pre-flight rather than fork lopdf/hayro; the 256 MiB / 256 MiB / 1 GiB caps and their basis; deflate-only with LZW/RunLength/image-codec disclosed residual; client-side threat model.

- [ ] **Step 4: STATUS and ROADMAP**

Run `vp run worktrees` first to confirm no concurrent edit to the PDF-engine row, then update only that row in `STATUS.md` and the PDF-engine entry in `ROADMAP.md` to note the guard is built. Do not touch other rows.

- [ ] **Step 5: Verify the process-ref fitness function**

Run: `pnpm run lint:process-refs 2>&1 | tail -10`
Expected: passes (no ADR/slice/spec references in source or tests).

- [ ] **Step 6: Commit**

```bash
git add packages/pdf/README.md changelog.d/pdf-decompression-guard.md docs/decisions/pending/pdf-decompression-guard.md STATUS.md ROADMAP.md
git commit -m "docs(pdf): document the decompression-bomb guard + fragments"
```

---

## Final verification (after all tasks)

- [ ] `cd crates && cargo test -p pdf-core --lib 2>&1 | tail -5` — all unit tests pass.
- [ ] `cd crates && cargo test -p pdf-core --test bomb_guard 2>&1 | tail -5` — integration test passes.
- [ ] `cd crates && cargo clippy -p pdf-core --all-targets 2>&1 | tail -5` — no warnings.
- [ ] `cd crates && cargo check -p pdf-core --target wasm32-unknown-unknown 2>&1 | tail -5` — wasm compiles.
- [ ] `pnpm --filter @magna-carta/pdf test 2>&1 | tail -5` — TS suite passes.
- [ ] `git diff -- crates/Cargo.lock` — empty (no lock churn from the `flate2` direct dep).
- [ ] `pnpm run lint:process-refs 2>&1 | tail -5` — passes.
- [ ] The 7-angle adversarial package review (the engine's pre-merge standard) before merge.
