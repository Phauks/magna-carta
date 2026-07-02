# File Repair & Salvage — Plan 5 design: Carving fallback pillar

Design output of a brainstorm (2026-07-02). This is the design; the implementation plan follows via writing-plans.

## Purpose

The **universal fallback**: when the format pillars cannot help — `detect()` returns None, or a pillar returns `Unrecoverable` — carving extracts recognizable **embedded known-type files** from the raw bytes by scanning for a header/footer signature table, then validates each candidate. It is format-agnostic: it does not repair a container, it recovers whole embedded files (a JPEG, a PNG, a PDF, a ZIP) that survive inside a damaged or unrecognized blob.

Carving is inherently **best-effort and incomplete** — it cannot know how many files a blob was *supposed* to contain, and a signature match is not proof of a complete, valid file. The design's honesty stance follows from that: carving reports what it *found* and how well each candidate *validated*, and never claims completeness.

## Decisions (this brainstorm)

1. **Output model — uniform `Vec<SalvagedFile>`.** Every pillar's result becomes a list of output files, not a single blob:

   ```rust
   pub struct SalvagedFile {
       pub name: String,              // "repaired.pdf" for a pillar; "0001.jpg" for a carve
       pub bytes: Vec<u8>,
       pub media_type: Option<String>, // detected type; None when unknown
   }
   pub struct RepairResult {
       pub files: Vec<SalvagedFile>,  // ZIP/CFB/PDF return exactly one; carving returns N
       pub loss: LossManifest,
   }
   ```

   The three existing pillars wrap their single output in a one-element vec. Rationale: carving genuinely produces N files, and this maps cleanly to Plan 6's attach-to-matter (N recovered files → N matter file-versions), avoiding an opaque ZIP the user must unpack. The change is contained to `recovery-core` (there is no worker/JS marshalling of `RepairResult` yet — that is Plan 6), so now is the cheapest time to make it.

2. **Trigger — a separate explicit `carve(bytes)` operation.** `repair()` never silently returns carved fragments (it stays honest: an unrecognized blob is `Err(NotRecognized)`). `carve()` is its own top-level entry point, NOT part of the `detect()`-keyed dispatch. `diagnose()` gains a `carve_suggested` flag so the caller learns carving is worth trying when no pillar can help. Rationale: carving is lossy and false-positive-prone; on a legal-evidence tool the user opts into it deliberately.

3. **Validation — pure-Rust, two layers; Magika deferred.** A carved candidate is validated by (a) an `infer`/`file-format` signature check, and (b) for images, a `zune-jpeg`/`zune-png` best-effort decode that confirms the run actually renders. Both are pure Rust, so the whole pillar rides the WASM default lane and the container lane alike. The **Magika ML validation layer is container-only** (ort/ONNX C dependency) and **deferred** — a documented seam and a later container-lane enhancement, exactly as the SP2 design frames it ("the container lane *may additionally* use Magika"). No GPL code (PhotoRec/Scalpel are study-only; signatures are facts).

## Architecture

New pure-Rust module `crates/recovery-core/src/carve.rs`, plus a small shared `signatures` table. Entry point:

```rust
pub fn carve(bytes: &[u8]) -> Result<RepairResult, RepairError>;
```

Not registered in `diagnose.rs`/`repair.rs` dispatch — carving is the format-agnostic fallback, invoked directly (and surfaced by `diagnose`'s `carve_suggested`).

### Algorithm

1. **Scan.** An `aho-corasick` automaton over the signature table's header patterns finds every candidate start offset in one pass.
2. **Extent.** For each candidate, determine the run's end: find the type's footer after the header (JPEG `FFD9`, PNG `IEND`+CRC, GIF `3B` trailer, PDF `%%EOF`, ZIP end-of-central-directory), else bound the run at the next candidate header or a per-type maximum size. A header with no footer within the cap → a *truncated* candidate (extracted to the bound, flagged).
3. **Extract** the byte range as a candidate.
4. **Validate.** `infer`/`file-format` signature check; for images, `zune-jpeg`/`zune-png` best-effort decode. The validation level sets the candidate's honesty flag: *decoded* (rendered) > *signature-confirmed* > *signature-only / truncated*.
5. **Emit.** One `SalvagedFile { name: "NNNN.<ext>", bytes, media_type }` and one `RecoveredItem` per candidate; `RecoveredItem.recovered` = "validated" (decoded or signature-confirmed), `detail` a FIXED literal stating the validation level and any truncation.

### Caps & limits

Reuse `crate::limits`: `MAX_ENTRY_COUNT` bounds the number of carved fragments; the per-fragment and total byte caps bound extraction. A pathological blob (millions of false headers) is bounded by the count cap; the overflow is disclosed, never silently dropped.

## Honesty / evidentiary model

- **`fully_recovered` is `false` for a carve, always.** Carving cannot certify it found every embedded file in the blob, so it must never claim full recovery. Per-fragment truth lives in each `RecoveredItem` (`recovered` = validated; `detail` = validation level / truncation).
- **`synthesized` is empty.** Carving fabricates nothing — every `SalvagedFile` is a verbatim byte range from the input.
- **Log-safety.** `SalvagedFile.name` (`"0001.jpg"`) and every `RecoveredItem.detail` are fixed/structural, never file content; only `RepairError::code()` is log-safe.
- A carved run that validates by signature but will not decode is reported at the lower confidence level, never as a clean recovery — the same non-overclaim discipline as the PDF pillar's number-vs-fidelity distinction.

## v1 signature table

JPEG, PNG, GIF, PDF, ZIP — each has a recognizable header *and* a footer/terminator so the extent is well-defined. (TIFF/BMP/others are a cheap later addition to the table; the table is data, not new logic.)

## What's deferred (documented seams)

- **Magika ML validation** (container-only, ort/ONNX C-dep) — a later container-lane enhancement to classify/label carved runs beyond signature+decode.
- **Deeper image salvage** (re-encoding a partially-decoded image, mid-stream bit-rot) — out of scope; mid-stream bit-rot is unrecoverable without pre-existing redundancy (PAR2, deferred).
- **Additional signatures** beyond the v1 five — data-table additions.

## Testing strategy

- A synthetic blob = junk + embedded JPEG + junk + embedded PNG + junk → `carve` returns two `SalvagedFile`s, correctly typed, each byte-equal to the embedded original; `fully_recovered` is false.
- A header with no footer within the cap → one truncated candidate, flagged, not claimed clean.
- Junk with no signatures → `Err(Unrepairable)` (nothing to carve).
- The count cap truncates a many-header blob and the overflow is disclosed.
- Model refactor: the ZIP/CFB/PDF pillars each return exactly one `SalvagedFile`, and their existing round-trip assertions read `result.files[0].bytes`.
- `diagnose` sets `carve_suggested` for an unrecognized blob.
