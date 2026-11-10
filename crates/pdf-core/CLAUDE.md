# pdf-core (crates/pdf-core) — CLAUDE.md

**Purpose.** Works on PDFs that already exist: renders pages, reads their text, redacts, sanitizes,
stamps, watermarks, merges, splits and rotates, reads, fills and flattens forms, locks and unlocks,
and prepares a document for a signature. Native `rlib`, and the WebAssembly module shipped through
[`@magna-carta/pdf`](../../packages/pdf). A new PDF written from nothing is
[`pdf-compose-core`](../pdf-compose-core/CLAUDE.md), not this crate.

## Key files / entry points

- `src/lib.rs` — `Document` (the render and text side, through `hayro`) and every public re-export.
- `src/guard.rs` — the size and decompression limits every entry point checks first, and
  `is_locked`, which every entry point checks after loading.
- `src/redact.rs`, `src/surgery.rs`, `src/scrub.rs` — redaction: remove the content under a box,
  or flatten the page to a picture when that cannot be done safely, then sanitize.
- `src/textpos.rs`, `src/textextract.rs`, `src/detect.rs` — where each glyph and shape sits, the
  lines they make, and the patterns worth redacting among them.
- `src/bates.rs`, `src/watermark.rs` — text and pictures drawn over existing pages.
- `src/generate.rs` — merge, split and rotate.
- `src/forms/` — `mod.rs` walks the field tree and reads it; `appearance.rs` draws a text field;
  `fill.rs` and `flatten.rs` are the two writers.
- `src/decrypt.rs`, `src/secure.rs` — unlock and lock.
- `src/sign.rs` — the incremental update a signature lives in. No cryptography happens here.
- `src/wasm.rs` — the WebAssembly edge. It converts and maps errors; it decides nothing.
- `tests/` — behaviour across modules: the bomb guard, locked documents, drawn text read back.

## Local conventions

- **Two parsers, on purpose.** `lopdf` edits a document's objects; `hayro` interprets page content
  for rendering and for reading positions. A change to how a page is read belongs with `hayro`, and
  a change to what is written belongs with `lopdf`.
- **Every entry point opens the same way:** `guard::guard_input`, load, `guard::is_locked`. A new
  operation that skips the third works on ciphertext and writes noise.
- **Text drawn with a standard font is Windows-1252.** `bates::win_ansi_literal` encodes it and the
  font object declares `/WinAnsiEncoding`. Writing a Rust string's UTF-8 bytes into a content stream
  draws two wrong glyphs for every accented letter.
- **A string stored in a dictionary is a PDF text string.** `sign::pdf_text_string` writes UTF-16
  with a byte-order mark when the text is not ASCII.
- **An error never carries document content or a password.** Variants are bare or carry a position.

## Invariants that apply here

- **Memory-safe dependencies only** (golden rule 14). Run `cargo tree -p pdf-core -i cc` before
  adding a dependency; it prints nothing today.
- **Redaction removes, it does not cover.** A black box over content that is still in the file is a
  leak. When surgery cannot prove the content under a box is gone, the page is flattened.
- **A signature's input is the literal prefix of its output.** `prepare_signature` only appends.
  Rewriting any earlier byte breaks every signature already in the file.
- **The export names and option shapes in `src/wasm.rs` are a contract** with
  `packages/pdf/src/index.ts` and the screens built on it. Add optional fields; do not rename.

## Gotchas

- **A change to any file under `src/` makes the WebAssembly artefact stale.** Run
  `pnpm exec vp run bootstrap` before the `packages/pdf` tests mean anything.
- **`pdf-core` reports positions from the bottom-left corner**, as a PDF stores them.
  `pdf-compose-core` works from the top-left.
- **A document with only an owner's restrictions opens without a password**, so it is worked on and
  written back without those restrictions.
