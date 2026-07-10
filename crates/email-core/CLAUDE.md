# email-core (crates/email-core) — CLAUDE.md

**Purpose.** A pure, I/O-free email parse engine: bytes in, a `ParsedMessage` out. Reads structure —
headers, the MIME tree, MAPI property streams, attachment descriptors, authenticity facts — from
`.eml`, `.msg`, and mbox input. Compiles to `wasm32-unknown-unknown` and to native `rlib` alike.

## Parse-only boundary

This crate does not render a message, verify a DKIM signature, store anything, classify content, or
decide filing. `IntegrityFacts` carries DKIM/Authentication-Results/Received evidence verbatim with
no verdict attached (see below) — whatever stands on this crate decides what the evidence means.
Keeping the boundary here is what keeps the crate wasm-shippable and testable with nothing but
`cargo test`: no browser, no crypto stack, no network.

## Pure Rust, no C

`mail-parser` and `cfb` are both pure Rust; a C dependency anywhere in the tree breaks the wasm
target. `engine_host`'s `r2` feature (`dep:reqwest`) stays off in this crate's `Cargo.toml` — this
engine has no R2 egress and enabling it would pull `reqwest`/`rustls`/`ring` into the wasm artifact
for nothing.

## `wasm.rs` is marshalling only

`src/wasm.rs` (compiled only for `target_arch = "wasm32"`) reshapes `ParsedMessage` into JS objects
with camelCase keys. No engine logic lives there — everything delegates to `crate::parse`,
`crate::parse_mbox`, and `crate::extract_part`. Every failure crosses the edge as one of the fixed
`EMAIL_ERROR_CODES` (`"malformed"`, `"unsupported"`, `"limitExceeded"`, `"partNotFound"`, defined in
`src/error.rs`), a `&'static str` that cannot carry a byte of file content. Do not add a fifth code
without adding the matching `EmailError` variant — `error.rs`'s own test asserts the two sets match
exactly, and do not let any code contain `.` or `/`, the shape that would betray a leaked filename or
path.

## `.msg` is read over `cfb`, never `msg_parser`

`msg_parser` 0.3.6 was the crate this engine originally planned to adopt for `.msg`/MAPI. It was
audited before adoption and rejected: it walks past a sub-slice's end on crafted OLE input, a bounds
check that aborts in a release build, and this isolate cannot unwind on `wasm32` — a single crafted
`.msg` would abort the whole isolate. It also had no fuzz target and pulled `regex` + `serde` into the
bundle for no benefit here. `cfb` 0.14 replaced it: `open()`/`walk()`/stream reads propagate every
structural fault as an `io::Error` rather than panicking, bounds-check every persisted FAT/MiniFAT/
directory index with cycle detection, and cap the stream read buffer rather than sizing it from a
declared length. A truncation, bit-flip, and byte-window fuzz sweep of hundreds of thousands of
malformed inputs found no panic and no allocation bomb in either debug or release.

The MAPI property-stream decoding built on top of `cfb` (`src/msg.rs`) is ours, not audited-upstream
code, and must hold itself to the same standard: never index a slice or call `.unwrap()`/`.expect()`
on input-derived data, and let every malformed structure become `Err(EmailError::Malformed)` rather
than a panic. `open_compound_file` is the single gate — every structural fault collapses to one
opaque `EmailError::Malformed` there so no fragment of `cfb`'s error text (which could echo input)
ever reaches a caller.

## A byte-length check never licenses a byte-index slice on a `&str`

A CFB directory entry name is arbitrary Unicode once `cfb` decodes it from UTF-16 — not guaranteed
ASCII. `hex.len() == 8` counts bytes, not characters, so an 8-_byte_ string can still contain a
multi-byte character; slicing at a fixed byte offset like `&hex[0..4]` then risks landing inside that
character instead of on a boundary between two of them, which panics. `parse_substg_name` in
`src/msg.rs` gates on `is_ascii()` before any fixed-offset slice — once every byte is one of the 128
ASCII scalars, byte offsets and char boundaries are the same thing, and the slices are safe. This
shipped once without the `is_ascii()` gate and panicked on a non-ASCII stream name anywhere under the
message root, a recipient storage, or an attachment storage; the fix carries regression tests for a
2-byte and a 3-byte character straddling the split. Apply the same discipline to any new byte-offset
slicing over a `&str` derived from container input.

## `MessageIdentifier` provenance is never flattened to a `String`

A `.msg` carries RFC 5322 headers only when `PidTagTransportMessageHeaders` survived export, which
Outlook frequently drops. When it did, the Message-ID is a real header value
(`MessageIdentifier::FromHeader`); when it did not, an identifier can still be recovered from
`PidTagInternetMessageId`, but that is a MAPI value, not a header one
(`MessageIdentifier::FromMapi`). Downstream dedup depends on telling the two apart — a MAPI-synthesized
identifier is not the same bytes another recipient's `.eml` copy of the same message carries, so
collapsing both into a bare `String` would let dedup silently merge distinct messages. `Absent` is a
third state, not an empty string standing in for "no identifier."

## A `.msg` part uses `PartLocator::MapiStream`, never `InputRange`

An `.eml`/mbox part is literally a span of the input buffer, so `PartLocator::InputRange` is correct
there. A `.msg` part's bytes are reassembled from scattered CFB sectors — no span of the input buffer
denotes them — so every `.msg` `PartDescriptor` is located by `PartLocator::MapiStream { name }`
instead. `extract_part` re-opens the container and reads the named stream back for
`MapiStream`; feeding it an `InputRange` locator for a `.msg` part would return the wrong bytes
entirely, not merely wrong-length ones.

## Integrity facts are captured verbatim with no verdict

`IntegrityFacts` (DKIM signatures, Authentication-Results, the Received chain) is filled only from
what `PidTagTransportMessageHeaders` actually recovered. When a `.msg` lacks that header block,
`raw_headers` is empty and `integrity` is `IntegrityFacts::default()` — never invent authenticity
evidence a message did not carry, and never fall back to inferring a verdict from the MAPI-only
fields.

## RTF-only `.msg` bodies yield no text body yet

`PidTagRtfCompressed` (0x1009) is LZFu-compressed; decoding it is a later slice. `rtf_body` stays
`None` even when the property is present — a `.msg` whose only body is RTF currently produces no
`text_bodies`/`html_bodies` entry at all rather than a wrong or partial one. Do not paper over the gap
with a lossy strip-the-markup decode; land the real LZFu decoder instead.

## Commands

```
cargo test --manifest-path crates/Cargo.toml -p email-core
cargo fmt --manifest-path crates/Cargo.toml --check
cargo clippy --manifest-path crates/Cargo.toml -p email-core --all-targets -- -D warnings
```

The clippy gate runs `--all-targets`, so it lints test code too, not just `src/`.

## Gotchas

- After any `Cargo.toml` dependency change, regenerate and commit `crates/Cargo.lock` — a stale lock
  fails `cargo build --locked` and CI along with it.
- `msg.rs`'s `open_compound_file` is `pub`, not crate-private, on purpose. Monomorphization is lazy: a
  crate-private function reachable only from test code is never generated on a real build, so `cfb`'s
  generic open path for `Cursor<&[u8]>` would silently go uncompiled on wasm and a green build would
  prove nothing. Keeping it as an `rlib` export roots that codegen for real.
- `fuzz/` is a separate Cargo package outside the `crates/Cargo.toml` workspace, so `cargo test`/
  `clippy` over the main workspace never pull it in; run `cargo +nightly fuzz run parse_eml` (or
  `parse_msg`, `parse_mbox`) directly when touching a parse lane.
