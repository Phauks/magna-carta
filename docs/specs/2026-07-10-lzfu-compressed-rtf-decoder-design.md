# LZFu compressed-RTF decoder — design

**Status:** Draft — pending owner acceptance · **Date:** 2026-07-10 · **Owner:** Trevor Goldsmith
**Area:** `crates/email-core` (the `.msg` lane) · **Builds on:** the email parse core ([`2026-07-09-email-core-parse-engine-design.md`](2026-07-09-email-core-parse-engine-design.md)).

---

## 0. Why

A `.msg` carries its rich-text body as `PidTagRtfCompressed` (property `0x1009`), LZFu-compressed per [MS-OXRTFCP]. The parse core reads plain-text (`PidTagBody`) and HTML (`PidTagHtml`) bodies directly, but leaves `rtf_body: None` — so a `.msg` whose **only** body is RTF (a common Outlook shape) currently shows no body at all. This decodes it.

The crate's local rules already forbid papering over this with a lossy markup-strip: land the real decompressor. This slice does exactly that — decompression only, into `rtf_body`. Interpreting or rendering the RTF is not in scope (that belongs to the deferred email→PDF render engine).

## 1. Scope

**In:** an LZFu decompressor in a standalone `lzfu.rs` module; wiring it into the `.msg` lane so `rtf_body` fills.

**Out:** RTF→text/HTML conversion, RTF rendering, any change to the `.eml`/mbox lanes (RTF is a `.msg`-only concern), and the larger msg.rs value-decoder extraction (see §5 — deferred to its own slice).

## 2. The algorithm ([MS-OXRTFCP], verified against the freeutils reference)

A 16-byte little-endian header, then contents:

| Field | Bytes | Meaning |
| --- | --- | --- |
| `COMPSIZE` | 4 | length of everything after this field (`RAWSIZE` + `COMPTYPE` + `CRC` + contents) |
| `RAWSIZE` | 4 | declared uncompressed size — **attacker-controlled; never trusted for allocation** |
| `COMPTYPE` | 4 | `0x75465a4c` (`"LZFu"`, compressed) or `0x414c454d` (`"MELA"`, stored uncompressed) |
| `CRC` | 4 | CRC-32 of the contents — **not validated** (see §4) |

- **`MELA`** → the contents after the header are raw RTF; copy them out, bounded by the output cap.
- **`LZFu`** → LZ77 with a preset dictionary. A 4096-byte ring buffer is preloaded with a fixed **207-byte** RTF-preamble dictionary; the write cursor starts at offset 207. The stream is a series of 8-unit chunks, each led by a control byte read **LSB-first**: a `0` bit is a 1-byte literal (emitted and written into the ring at the cursor); a `1` bit is a 2-byte reference where `offset = (b1 << 4) | (b2 >> 4)` (12 bits into the ring) and `length = (b2 & 0x0F) + 2` — copy `length` bytes from the ring starting at `offset`, each byte also written back at the cursor. **A reference whose `offset` equals the current write cursor is the end-of-stream marker.** The cursor advances modulo 4096.

## 3. Component

**A new standalone module `crates/email-core/src/lzfu.rs`** (§5) exposing:

```rust
pub(crate) fn decompress_rtf(bytes: &[u8], max_output: usize) -> Result<String, EmailError>
```

- Parses the header; dispatches on `COMPTYPE`. An unknown magic, a header shorter than 16 bytes, or a `COMPSIZE`/`RAWSIZE` inconsistent with the buffer → `Err(EmailError::Malformed)`.
- The output `Vec<u8>` **grows as bytes are produced and is capped at `max_output`** — a decompression bomb (a tiny stream whose self-referential copies expand without bound) hits the cap and returns `Err(EmailError::Malformed)` rather than allocating gigabytes. `RAWSIZE` is only a sanity hint, never a `with_capacity` argument.
- The ring buffer is a fixed `[u8; 4096]`; every ring index is masked `& 0xFFF`, so ring access is **in-bounds by construction** — no slice can panic. Reading a control or reference byte past the input end is a checked `Err`, never a panic. This is what keeps it safe on the unwind-less isolate (a panic aborts the whole isolate).
- The decompressed bytes become a `String` via `String::from_utf8_lossy`. RTF is 7-bit ASCII (high bytes are `\'hh`-escaped), so well-formed RTF round-trips exactly; hostile stray bytes become the replacement character rather than an error. `rtf_body` stays `Option<String>`, so `model.rs` and the WASM edge are untouched.

## 4. Decisions (settled with the owner, 2026-07-10)

- **Output cap = `Limits::max_decoded_part_bytes` (64 MiB).** It already means "the max size of a decoded body/part"; an RTF body is exactly that. No new `Limits` field.
- **Graceful degradation.** If the RTF body is malformed LZFu or exceeds the cap, `rtf_body` stays `None` and the message parse **succeeds** — the headers, participants, and attachments (the evidentiary payload) are never discarded over one bad body. This matches the current RTF-only-`None` behavior. (`None` conflates "no RTF" with "RTF present but unreadable/too big" — an accepted limitation for a parse-only inspector.)
- **No CRC validation.** Safety comes from output bounding + the end-marker + checked reads, not from the CRC. A stream that decompresses within bounds is served; a structurally broken one already errors. Skipping avoids a CRC-32 implementation for marginal value.

## 5. Module placement (decided: standalone `lzfu.rs`; the msg.rs extraction is deferred)

`decompress_rtf` lives in its own `crates/email-core/src/lzfu.rs`. LZFu is a **compression codec** ([MS-OXRTFCP]), not a MAPI property-value decoder: it turns compressed bytes into RTF bytes with no CFB or MAPI knowledge, so it is testable in complete isolation with byte vectors. That makes a standalone module its most cohesive home — independent of any decision about msg.rs's structure — and keeps this feature's diff clean and reviewable (a self-contained codec + a few lines of wiring).

`msg.rs` (~1960 lines) does genuinely want a split — it holds CFB structure/walk, message assembly, and a property-value decoding layer (`decode_utf16le`, the FILETIME math, `parse_fixed_properties`, `parse_substg_name`, `read_string`/`read_binary_as_text`, `read_stream_bounded`, the `PTYPE_*` consts). But that extraction is a **separate concern** from shipping a feature: bundling a ~200-line mechanical move of just-audited, just-merged code as a rider muddies the review (a reviewer must disentangle "is the move correct" from "is the decoder correct") and churns audited code incidentally rather than deliberately. So the value-decoder extraction is **deferred to its own pure-refactor slice**, where its diff is reviewed on its own terms. This slice touches msg.rs only for the small `read_message` wiring in §6.

## 6. Wiring (`msg.rs`)

`read_message` reads the `PidTagRtfCompressed` (0x1009, binary) stream through the existing bounded reader, calls `decompress_rtf(bytes, limits.max_decoded_part_bytes)`, and sets `rtf_body` from an `Ok`, leaving `None` on `Err` (graceful, §4). The hardcoded `rtf_body: None` at `msg.rs:375` and the two comments at `msg.rs:306`/`374` are updated.

## 7. Testing

- **Round-trip:** compress a known RTF string in the test (a small LZFu encoder in `#[cfg(test)]`, or committed reference vectors), decompress, assert equality — including a payload that exercises dictionary references (RTF preamble tokens) and literals.
- **MELA:** an uncompressed-magic stream returns its contents verbatim.
- **Adversarial (each → `Err`, never a panic):** truncated header; truncated mid-chunk; unknown magic; a reference into an unwritten ring region; a **decompression bomb** (a tiny stream whose references self-copy past `max_decoded_part_bytes` → cap fires, bounded, no panic).
- **Integration:** a `.msg` fixture whose only body is compressed RTF → `parse_msg` yields `rtf_body: Some(...)` and still no `text_bodies`; a `.msg` with a deliberately corrupt RTF stream → parse succeeds, `rtf_body: None`, headers/attachments intact.
- **Fuzz:** extend the `parse_msg` fuzz target's reach (any bytes in the RTF stream → `Ok`/`Err`, never a panic); optionally a dedicated `decompress_rtf` fuzz target.
- Gates: `cargo test -p email-core`, `clippy --manifest-path crates/Cargo.toml -p email-core --all-targets -- -D warnings`, and `cargo build --target wasm32-unknown-unknown` all green.

## 8. Docs

Update `crates/email-core/CLAUDE.md`'s "RTF-only `.msg` bodies" rule (the deferral becomes "decoded via `decompress_rtf`; the body is decompressed but not interpreted"). A `changelog.d/` fragment. No ROADMAP change beyond marking the engine's LZFu deferral closed.
