# `@magna-carta/file-type` — local notes

## What this package is

Pure mapping package. No file detection happens here. This package receives the raw identification
facts that the scan Container's `/identify` route returns (a `RawIdentifyResult`) and maps them to
a structured `FileTypeReport`. It does not read files, does not make network calls, and has no
dependencies.

## Verdict states

`buildFileTypeReport(raw, filename)` produces one of four `extensionMatch` values:

- **`match`** — the filename's extension is canonical for the detected type. No action needed.
- **`mismatch`** — the filename's extension disagrees with the detected content type.
  `recommendedExtensions` is populated. This is the primary security signal.
- **`no-extension`** — the filename carries no extension. Not an error; a recommendation opportunity.
  `recommendedExtensions` is populated.
- **`unverifiable`** — Magika's confidence score is below the threshold. No verdict is asserted.
  `recommendedExtensions` is empty.

## Detection lives elsewhere

The Magika engine runs in `containers/scan` (the `identify` Rust module). The Magika model is baked
into the scan container image at build time. This package never sees raw bytes or calls out.

## Label table (`src/labels.ts`)

Maps each Magika content-type label to a human label and canonical extension(s). Keep this table
scoped to the types a law firm actually handles — documents, images, archives, common text formats,
and security-relevant executables/scripts. Do not add every possible MIME type: the table is
maintained by hand and bloat increases the cost of keeping it accurate.
