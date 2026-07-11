# LZFu compressed-RTF decoder — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decode a `.msg`'s `PidTagRtfCompressed` (0x1009) LZFu-compressed RTF body into `rtf_body`, closing the engine's RTF-only-body gap.

**Architecture:** A standalone `crates/email-core/src/lzfu.rs` codec (compressed bytes → RTF `String`, no CFB/MAPI knowledge), wired into `msg.rs::read_message` which reads the 0x1009 binary stream and sets `rtf_body` from it — leaving `None` on any decode failure so one bad body never discards the message.

**Tech Stack:** Rust 2021, `crates/email-core` (pure, no new dependencies). [MS-OXRTFCP] is the format.

**Spec:** [`2026-07-10-lzfu-compressed-rtf-decoder-design.md`](2026-07-10-lzfu-compressed-rtf-decoder-design.md)

## Global Constraints

Every task's requirements implicitly include this section.

- **Pure Rust, no new dependencies.** No C. `engine-host`'s `r2` feature stays off.
- **No panic on any input.** This runs on `wasm32` in an isolate that cannot unwind — a panic aborts the whole isolate. Never index a slice without a bounds check; never `unwrap`/`expect`/`panic!` on input-derived data (test code excepted). Every ring index is masked `& (RING_SIZE - 1)`. Reading past the input end is a checked `Err`, never a panic.
- **Never trust a declared length for allocation.** `RAWSIZE` from the header is attacker-controlled; the output `Vec` grows as bytes are produced and is capped at `max_output`. No `Vec::with_capacity(raw_size)`.
- **Error codes are fixed `&'static str`** (`EmailError` is a fieldless enum); no code carries file content. Do NOT add a new `EmailError` variant — reuse `EmailError::Malformed`.
- **Graceful degradation:** a malformed/over-cap RTF body → `rtf_body: None` and the message parse still succeeds. Never propagate the RTF decode error out of `read_message`.
- **No process references** in source/tests/comments — no `ADR-NNNN`, "spec", "slice N", "Task N", "plan", "review", "audit", "golden rule". Naming the format document `[MS-OXRTFCP]` or the property `PidTagRtfCompressed` is correct and expected.
- **No emoji. Fully written-out names.** Comments explain *why*.
- **The repo clippy gate is `--all-targets`** (lints test code): `cargo clippy --manifest-path crates/Cargo.toml -p email-core --all-targets -- -D warnings`.
- **Build note:** this box OOMs on parallel cargo (`STATUS_STACK_BUFFER_OVERRUN` / `0xC000012D`). Use `-j 1` on every cargo command.

## File Structure

| Path | Responsibility |
| --- | --- |
| `crates/email-core/src/lzfu.rs` (new) | The LZFu codec: `decompress_rtf(bytes, max_output) -> Result<String, EmailError>`, the header parse, the MELA/LZFu dispatch, the ring-buffer decompressor, the preset dictionary, and all codec-level tests. |
| `crates/email-core/src/lib.rs` (modify) | Add `mod lzfu;`. |
| `crates/email-core/src/msg.rs` (modify) | `read_message` reads the 0x1009 binary stream and sets `rtf_body` via `lzfu::decompress_rtf`; update the two stale comments. Integration tests. |
| `crates/email-core/CLAUDE.md` (modify) | Update the "RTF-only `.msg` bodies" rule. |
| `changelog.d/lzfu-compressed-rtf.md` (new) | Changelog fragment. |

---

### Task 1: The LZFu codec (`lzfu.rs`)

**Files:**
- Create: `crates/email-core/src/lzfu.rs`
- Modify: `crates/email-core/src/lib.rs`

**Interfaces:**
- Consumes: `crate::error::EmailError` (fieldless enum with `Malformed`).
- Produces: `pub(crate) fn decompress_rtf(bytes: &[u8], max_output: usize) -> Result<String, EmailError>`.

- [ ] **Step 1: Add the module to `lib.rs`**

In `crates/email-core/src/lib.rs`, add `mod lzfu;` next to the other `mod` declarations (e.g. after `mod eml;`). It is `pub(crate)`-internal — do not re-export from the crate root.

- [ ] **Step 2: Write the self-contained tests first**

Create `crates/email-core/src/lzfu.rs` with ONLY this test module (the implementation follows in Step 4). These tests do not depend on the preset dictionary except `spec_worked_example` (Step 3).

```rust
#[cfg(test)]
mod tests {
    use super::*;

    // Build a 16-byte little-endian header for CONTENTS of the given length and magic.
    fn header(contents_len: usize, raw_size: u32, magic: u32) -> Vec<u8> {
        // COMPSIZE counts RAWSIZE(4) + COMPTYPE(4) + CRC(4) + contents.
        let comp_size = (12 + contents_len) as u32;
        let mut header = Vec::new();
        header.extend_from_slice(&comp_size.to_le_bytes());
        header.extend_from_slice(&raw_size.to_le_bytes());
        header.extend_from_slice(&magic.to_le_bytes());
        header.extend_from_slice(&0u32.to_le_bytes()); // CRC, ignored
        header
    }

    #[test]
    fn the_preset_dictionary_is_exactly_207_bytes() {
        assert_eq!(DICTIONARY.len(), 207);
    }

    #[test]
    fn stored_uncompressed_contents_are_returned_verbatim() {
        let contents = b"{\\rtf1 plain}";
        let mut stream = header(contents.len(), contents.len() as u32, MAGIC_UNCOMPRESSED);
        stream.extend_from_slice(contents);
        assert_eq!(decompress_rtf(&stream, 1 << 20).unwrap(), "{\\rtf1 plain}");
    }

    #[test]
    fn an_all_literal_compressed_stream_decodes_to_its_literal_bytes() {
        // Control byte 0x00 => the next 8 units are literals. Emit "ABCDEFGH", then a
        // second control byte 0x00 with the end handled by input exhaustion.
        let mut contents = vec![0x00u8];
        contents.extend_from_slice(b"ABCDEFGH");
        let mut stream = header(contents.len(), 8, MAGIC_COMPRESSED);
        stream.extend_from_slice(&contents);
        assert_eq!(decompress_rtf(&stream, 1 << 20).unwrap(), "ABCDEFGH");
    }

    #[test]
    fn a_header_shorter_than_16_bytes_is_malformed() {
        assert!(decompress_rtf(&[0x00; 8], 1 << 20).is_err());
    }

    #[test]
    fn an_unknown_magic_is_malformed() {
        let contents = b"x";
        let mut stream = header(contents.len(), 1, 0xDEAD_BEEF);
        stream.extend_from_slice(contents);
        assert!(decompress_rtf(&stream, 1 << 20).is_err());
    }

    #[test]
    fn a_comp_size_claiming_more_than_the_buffer_holds_is_malformed() {
        // COMPSIZE says there are 100 contents bytes, but none are present.
        let mut stream = 112u32.to_le_bytes().to_vec(); // comp_size = 12 + 100
        stream.extend_from_slice(&0u32.to_le_bytes()); // raw
        stream.extend_from_slice(&MAGIC_COMPRESSED.to_le_bytes());
        stream.extend_from_slice(&0u32.to_le_bytes()); // crc
        assert!(decompress_rtf(&stream, 1 << 20).is_err());
    }

    #[test]
    fn a_literal_stream_past_the_output_cap_is_refused_not_unbounded() {
        // 8 literals but max_output = 4 => the cap fires, no panic, bounded.
        let mut contents = vec![0x00u8];
        contents.extend_from_slice(b"ABCDEFGH");
        let mut stream = header(contents.len(), 8, MAGIC_COMPRESSED);
        stream.extend_from_slice(&contents);
        assert!(matches!(decompress_rtf(&stream, 4), Err(EmailError::Malformed)));
    }

    #[test]
    fn truncated_mid_chunk_stops_gracefully_without_panic() {
        // Control byte says 8 literals, but only 3 bytes follow: finish with what we have.
        let mut contents = vec![0x00u8];
        contents.extend_from_slice(b"ABC");
        let mut stream = header(contents.len(), 8, MAGIC_COMPRESSED);
        stream.extend_from_slice(&contents);
        assert_eq!(decompress_rtf(&stream, 1 << 20).unwrap(), "ABC");
    }
}
```

- [ ] **Step 3: Add the spec worked-example test (validates the dictionary)**

The self-contained tests never exercise a dictionary back-reference, so they cannot catch a wrong dictionary byte. Add one oracle test using the **[MS-OXRTFCP] worked example** — do NOT invent the bytes; transcribe the compressed input and its expected decompressed output from the [MS-OXRTFCP] specification's decompression example (the "hello world"-style sample in its examples section). Append to the test module:

```rust
    #[test]
    fn the_spec_worked_example_decompresses_correctly() {
        // Compressed bytes and expected output taken verbatim from the [MS-OXRTFCP]
        // decompression example. A wrong dictionary byte fails this test.
        const COMPRESSED: &[u8] = &[
            /* transcribe the example's compressed stream bytes here */
        ];
        const EXPECTED: &str = /* the example's decompressed RTF, verbatim */ "";
        assert_eq!(decompress_rtf(COMPRESSED, 1 << 20).unwrap(), EXPECTED);
    }
```

If you cannot obtain the exact spec example, substitute an equivalent known-good vector from an established reference implementation and cite where it came from in a comment — the requirement is a real compressed-with-dictionary-references vector whose expected output is independently known, so the dictionary is proven, not assumed.

- [ ] **Step 4: Run the tests and watch them fail to compile**

Run: `cargo test -p email-core --manifest-path crates/Cargo.toml -j 1 lzfu`
Expected: FAIL — `DICTIONARY`, `MAGIC_UNCOMPRESSED`, `MAGIC_COMPRESSED`, `decompress_rtf` not found.

- [ ] **Step 5: Write the codec**

Prepend to `crates/email-core/src/lzfu.rs` (above the test module):

```rust
//! LZFu decompression for a .msg's compressed RTF body (PidTagRtfCompressed),
//! per [MS-OXRTFCP]. A compression codec: compressed bytes in, RTF bytes out, with
//! no CFB or MAPI knowledge, so it is testable in isolation. It runs on
//! attacker-controlled bytes in an isolate that cannot unwind, so it never indexes
//! out of bounds, never trusts a declared length for allocation, and turns every
//! structural fault into an ordinary error instead of a panic.

use crate::error::EmailError;

const MAGIC_COMPRESSED: u32 = 0x7546_5a4c; // "LZFu"
const MAGIC_UNCOMPRESSED: u32 = 0x414c_454d; // "MELA"

const RING_SIZE: usize = 4096;

/// The ring buffer is preloaded with this fixed RTF preamble so back-references
/// save space from the first byte; the write cursor starts just past it. Exactly
/// 207 bytes. VERIFY against [MS-OXRTFCP] section 2.1.1 (the preset dictionary) —
/// one wrong byte corrupts every dictionary-referenced run, which the worked-example
/// test guards.
const DICTIONARY: &[u8] = b"{\\rtf1\\ansi\\mac\\deff0\\deftab720{\\fonttbl;}{\\f0\\fnil \\froman \\fswiss \\fmodern \\fscript \\fdecor MS Sans SerifSymbolArialTimes New RomanCourier{\\colortbl\\red0\\green0\\blue0\r\n\\par \\pard\\plain\\f0\\fs20\\b\\i\\u\\tab\\tx";

/// Decompress a `.msg` compressed-RTF stream into RTF text. `max_output` bounds the
/// decompressed size against a decompression bomb; the header's declared raw size is
/// never used to size an allocation.
pub(crate) fn decompress_rtf(bytes: &[u8], max_output: usize) -> Result<String, EmailError> {
    // 16-byte little-endian header: COMPSIZE, RAWSIZE, COMPTYPE, CRC.
    if bytes.len() < 16 {
        return Err(EmailError::Malformed);
    }
    let comp_size = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as usize;
    // RAWSIZE (bytes[4..8]) is attacker-controlled and deliberately not used for allocation.
    let magic = u32::from_le_bytes([bytes[8], bytes[9], bytes[10], bytes[11]]);
    // CRC (bytes[12..16]) is not validated: safety comes from bounding the output and
    // the end marker, not from the checksum.

    // COMPSIZE counts everything after itself, so the stream is COMPSIZE + 4 bytes.
    let declared_end = comp_size.checked_add(4).ok_or(EmailError::Malformed)?;
    if declared_end < 16 || declared_end > bytes.len() {
        return Err(EmailError::Malformed);
    }
    let contents = &bytes[16..declared_end];

    match magic {
        MAGIC_UNCOMPRESSED => {
            let end = contents.len().min(max_output);
            Ok(String::from_utf8_lossy(&contents[..end]).into_owned())
        }
        MAGIC_COMPRESSED => decompress_lzfu(contents, max_output),
        _ => Err(EmailError::Malformed),
    }
}

fn decompress_lzfu(contents: &[u8], max_output: usize) -> Result<String, EmailError> {
    let mut ring = [0u8; RING_SIZE];
    ring[..DICTIONARY.len()].copy_from_slice(DICTIONARY);
    let mut write = DICTIONARY.len() & (RING_SIZE - 1); // cursor, always masked
    let mut out: Vec<u8> = Vec::new();
    let mut pos = 0usize;

    // Emit one byte to both the output and the ring, enforcing the output cap.
    fn emit(
        byte: u8,
        out: &mut Vec<u8>,
        ring: &mut [u8; RING_SIZE],
        write: &mut usize,
        max_output: usize,
    ) -> Result<(), EmailError> {
        if out.len() >= max_output {
            return Err(EmailError::Malformed); // decompression bomb: stop, do not grow
        }
        out.push(byte);
        ring[*write] = byte;
        *write = (*write + 1) & (RING_SIZE - 1);
        Ok(())
    }

    loop {
        let Some(&control) = contents.get(pos) else {
            return Ok(String::from_utf8_lossy(&out).into_owned());
        };
        pos += 1;
        for bit in 0..8 {
            if (control >> bit) & 1 == 0 {
                // Literal.
                let Some(&literal) = contents.get(pos) else {
                    return Ok(String::from_utf8_lossy(&out).into_owned());
                };
                pos += 1;
                emit(literal, &mut out, &mut ring, &mut write, max_output)?;
            } else {
                // Two-byte reference: offset (12 bits) and length (low nibble + 2).
                let (Some(&b1), Some(&b2)) = (contents.get(pos), contents.get(pos + 1)) else {
                    return Ok(String::from_utf8_lossy(&out).into_owned());
                };
                pos += 2;
                let offset = ((b1 as usize) << 4) | ((b2 as usize) >> 4);
                let length = ((b2 as usize) & 0x0F) + 2;
                if offset == write {
                    // A reference to the current write cursor marks end of stream.
                    return Ok(String::from_utf8_lossy(&out).into_owned());
                }
                for i in 0..length {
                    let byte = ring[(offset + i) & (RING_SIZE - 1)];
                    emit(byte, &mut out, &mut ring, &mut write, max_output)?;
                }
            }
        }
    }
}
```

- [ ] **Step 6: Run the tests**

Run: `cargo test -p email-core --manifest-path crates/Cargo.toml -j 1 lzfu`
Expected: PASS (all tests, including `the_spec_worked_example_decompresses_correctly` once its bytes are filled in). If the worked-example test fails, the `DICTIONARY` bytes are wrong — fix them against the spec, do not adjust the expected output.

- [ ] **Step 7: Clippy and fmt**

Run: `cargo clippy --manifest-path crates/Cargo.toml -p email-core --all-targets -j 1 -- -D warnings`
Run: `cargo fmt --manifest-path crates/Cargo.toml --all -- --check` (pre-existing `pdf-core`/`pdf-eval` drift is not yours)
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add crates/email-core/src/lzfu.rs crates/email-core/src/lib.rs
git commit -m "feat(email-core): decode LZFu compressed RTF into text"
```

---

### Task 2: Wire the RTF body into the `.msg` lane

**Files:**
- Modify: `crates/email-core/src/msg.rs`

**Interfaces:**
- Consumes: `lzfu::decompress_rtf` (Task 1); the existing `find_substream`, `read_stream_bounded`, `PTYPE_BINARY`, and the `substreams`/`limits` bindings already in scope in `read_message`.
- Produces: a `read_message` that sets `rtf_body` from the 0x1009 stream.

- [ ] **Step 1: Add the property id constant**

In `crates/email-core/src/msg.rs`, beside the other `PID_*` constants (around line 204-222), add:

```rust
const PID_RTF_COMPRESSED: u16 = 0x1009;
```

- [ ] **Step 2: Add a helper that reads and decompresses the RTF body**

Add near `read_binary_as_text` (around line 639). It reads the 0x1009 binary substream through the existing bounded reader and decompresses it; a missing stream or any decode failure yields `Ok(None)` — a corrupt RTF body must never fail the whole message.

```rust
/// Read and decompress the LZFu-compressed RTF body (PidTagRtfCompressed). A missing
/// stream, or a body that is malformed or would exceed the decoded-size cap, yields
/// `None` rather than an error: the headers, participants, and attachments of the
/// message are worth more than discarding all of them over one bad body.
fn read_rtf_body(
    compound: &mut Msg,
    substreams: &[SubStream],
    limits: &Limits,
) -> Result<Option<String>, EmailError> {
    let Some(stream) = find_substream(substreams, PID_RTF_COMPRESSED, PTYPE_BINARY) else {
        return Ok(None);
    };
    let bytes = read_stream_bounded(compound, &stream.path)?;
    Ok(crate::lzfu::decompress_rtf(&bytes, limits.max_decoded_part_bytes).ok())
}
```

- [ ] **Step 3: Call it in `read_message` and drop the hardcoded `None`**

In `read_message`, in the bodies section (around line 306-315), after the `html_bodies` line, add:

```rust
    let rtf_body = read_rtf_body(compound, &substreams, limits)?;
```

Then in the `ParsedMessage { ... }` construction (around line 375), replace:

```rust
        // PidTagRtfCompressed (0x1009) uses LZFu compression and is decoded elsewhere.
        rtf_body: None,
```

with:

```rust
        rtf_body,
```

Update the stale comment block at lines 306-309 to state that the RTF body is now decompressed via the codec (compressed bytes → RTF text, not interpreted). Remove the "yields no body text at all" claim.

- [ ] **Step 4: Write integration tests**

The `#[cfg(test)]` block in `msg.rs` has a programmatic `.msg` builder. Find how existing tests add a substream (e.g. the body/subject tests build `__substg1.0_<id><type>` streams) and add:

```rust
    #[test]
    fn a_msg_with_a_compressed_rtf_body_exposes_it_as_rtf_body() {
        // Build a minimal LZFu-compressed stream (all-literal) for a known RTF string,
        // then embed it as the PidTagRtfCompressed (0x1009, PTYPE_BINARY 0x0102) stream.
        let rtf = b"{\\rtf1 hi}";
        let compressed = build_all_literal_lzfu(rtf); // test helper below
        let bytes = MsgBuilder::new()
            .stream("/__substg1.0_10090102", compressed)
            .build();
        let message = parse_msg(&bytes).expect("parses");
        assert_eq!(message.rtf_body.as_deref(), Some("{\\rtf1 hi}"));
        assert!(message.text_bodies.is_empty());
    }

    #[test]
    fn a_msg_with_a_corrupt_rtf_body_still_parses_with_no_rtf_body() {
        // A stream too short to be a valid header: the message must still parse.
        let bytes = MsgBuilder::new()
            .stream("/__substg1.0_10090102", vec![0x00, 0x01, 0x02])
            .build();
        let message = parse_msg(&bytes).expect("parses despite the bad body");
        assert_eq!(message.rtf_body, None);
    }
```

Add the `build_all_literal_lzfu` test helper (in the same `#[cfg(test)]` module) that frames arbitrary bytes as an all-literal LZFu stream, matching the codec's expectations (a 16-byte header with `MAGIC_COMPRESSED`, then for each group of up to 8 bytes a `0x00` control byte followed by those literal bytes). Match the exact stream-name and builder API the existing tests use — read them first; the `.stream(name, bytes)` call above is illustrative, use the real method name.

- [ ] **Step 5: Run the tests**

Run: `cargo test -p email-core --manifest-path crates/Cargo.toml -j 1`
Expected: PASS (the existing 65 + your new ones). If the builder API differs, fix the test calls to match the real API — the assertions are the contract, the builder calls are not.

- [ ] **Step 6: Clippy, fmt, wasm build**

Run: `cargo clippy --manifest-path crates/Cargo.toml -p email-core --all-targets -j 1 -- -D warnings`
Run: `cargo build -p email-core --manifest-path crates/Cargo.toml --target wasm32-unknown-unknown -j 1`
Run: `cargo fmt --manifest-path crates/Cargo.toml --all -- --check`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add crates/email-core/src/msg.rs
git commit -m "feat(email-core): fill rtf_body from a .msg's compressed RTF body"
```

---

### Task 3: Extend the fuzz reach and the docs

**Files:**
- Modify: `crates/email-core/src/lzfu.rs` (a fuzz-shaped property test), `crates/email-core/CLAUDE.md`
- Create: `changelog.d/lzfu-compressed-rtf.md`

- [ ] **Step 1: Add a totality property test**

The `parse_msg` fuzz target already reaches this code through a `.msg`'s RTF stream, but add a direct never-panic property test to `lzfu.rs`'s test module so the codec's totality is asserted in the unit suite too:

```rust
    #[test]
    fn arbitrary_bytes_never_panic() {
        // A spread of hostile shapes: empty, sub-header, every magic, random-ish bodies.
        for len in 0..64usize {
            let filler: Vec<u8> = (0..len).map(|i| (i as u8).wrapping_mul(31)).collect();
            let _ = decompress_rtf(&filler, 1 << 16);
        }
        // Valid-looking headers with hostile contents.
        for magic in [MAGIC_COMPRESSED, MAGIC_UNCOMPRESSED, 0u32] {
            let mut stream = Vec::new();
            stream.extend_from_slice(&64u32.to_le_bytes());
            stream.extend_from_slice(&0xFFFF_FFFFu32.to_le_bytes()); // absurd raw size
            stream.extend_from_slice(&magic.to_le_bytes());
            stream.extend_from_slice(&0u32.to_le_bytes());
            stream.extend(std::iter::repeat_n(0xFFu8, 52));
            let _ = decompress_rtf(&stream, 1 << 16);
        }
    }
```

Run: `cargo test -p email-core --manifest-path crates/Cargo.toml -j 1 lzfu`
Expected: PASS (no panic).

- [ ] **Step 2: Update the crate CLAUDE.md rule**

In `crates/email-core/CLAUDE.md`, replace the "RTF-only `.msg` bodies yield no text body yet" section. State that `PidTagRtfCompressed` (0x1009) is now decompressed via `lzfu.rs` into `rtf_body` — the body is decompressed but **not interpreted** (RTF→text/HTML is a renderer's job), and a malformed or over-cap body yields `rtf_body: None` gracefully without failing the message parse.

- [ ] **Step 3: Write the changelog fragment**

Create `changelog.d/lzfu-compressed-rtf.md`:

```markdown
---
category: Added
---

**Outlook messages whose only body is rich text now show that body.** A `.msg` file often stores its body as compressed RTF; the Email Inspector previously showed nothing for such a message. That body is now decompressed and surfaced. It is shown as-is, not converted or rendered, and a corrupt or oversized body is skipped rather than failing the whole message.
```

- [ ] **Step 4: Full gate**

Run: `cargo test -p email-core --manifest-path crates/Cargo.toml -j 1`
Run: `cargo clippy --manifest-path crates/Cargo.toml -p email-core --all-targets -j 1 -- -D warnings`
Run: `cargo build -p email-core --manifest-path crates/Cargo.toml --target wasm32-unknown-unknown -j 1`
Run: `pnpm --filter @magna-carta/email build:wasm && pnpm --filter @magna-carta/email test` (the record shape is unchanged, so the TS wrapper needs no edit — this confirms it)
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add crates/email-core/src/lzfu.rs crates/email-core/CLAUDE.md changelog.d/lzfu-compressed-rtf.md
git commit -m "docs(email): record the LZFu decoder and extend its totality test"
```

---

## Self-Review

**Spec coverage.** §2 algorithm → Task 1 (header, MELA/LZFu dispatch, dictionary, ring decompressor). §3 component signature → Task 1 Step 5. §4 decisions: output cap = `max_decoded_part_bytes` → Task 2 Step 2; graceful `None` → Task 2 Step 2 (`.ok()`); no CRC → Task 1 Step 5 (comment). §5 standalone `lzfu.rs` → Task 1. §6 wiring → Task 2. §7 testing → Tasks 1–3 (round-trip, MELA, adversarial incl. bomb + truncation, integration, totality). §8 docs → Task 3.

**Known-unverified constant.** The `DICTIONARY` bytes and the worked-example vector are not asserted from memory: Task 1 Step 3 makes transcribing the spec's example an explicit step, and `the_spec_worked_example_decompresses_correctly` fails loudly if the dictionary is wrong. `the_preset_dictionary_is_exactly_207_bytes` catches a length error immediately.

**Type consistency.** `decompress_rtf(bytes: &[u8], max_output: usize) -> Result<String, EmailError>` is defined in Task 1 and called with that exact signature in Task 2 (`limits.max_decoded_part_bytes` as `max_output`). `EmailError::Malformed` is the only error used (no new variant). `PID_RTF_COMPRESSED` / `PTYPE_BINARY` match the existing `.msg` constant style.

**No new dependency, no record-shape change** — `rtf_body: Option<String>` already exists, so `model.rs`, `wasm.rs`, and the TS wrapper are untouched (confirmed by Task 3 Step 4).
