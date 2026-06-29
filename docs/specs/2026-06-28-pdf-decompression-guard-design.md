# PDF engine — crate-wide decompression-bomb guard

**Status:** Designed (2026-06-28)
**Area:** `crates/pdf-core`

## Problem

Every `pdf-core` operation inflates compressed PDF streams with no size bound. A
malicious PDF can ship a small `FlateDecode` (or `LZWDecode`) stream that expands to
many gigabytes — a decompression bomb that exhausts memory and takes down the process.
This exposure has been disclosed-and-deferred in every engine slice (redaction, scrub,
detector, surgery, secure, generate) because it never belonged to any one of them: it is
a shared seam across the whole crate.

### Confirmed internals

- **lopdf 0.41 `LoadOptions` has no size or decode limit** — only `password`, `filter`,
  `strict`. Load-time inflation cannot be capped through its public API.
- **The inflate is unbounded.** `Stream::decompress_zlib` does
  `ZlibDecoder::new(input).read_to_end(&mut output)` into an unbounded `Vec`. This path
  runs in two places:
  - our explicit `decompressed_content()` calls (detect ×2, redact ×1, watermark ×1) —
    under our control, and
  - inside `load_mem`, where `ObjectStream::new` calls `stream.decompress()` to enumerate
    objects packed in an object stream (ObjStm) — *before any of our code runs*.
- **hayro is a second, independent parser** (`Document::load`, used by redact and detect)
  with its own internal, unbounded decompression.
- **An input byte cap alone does not make load-time safe.** A single zlib stream tops out
  near 1032:1, so a ~1 MB ObjStm inside an otherwise-capped file still inflates to ~1 GB
  at load. Bounding load-time inflation requires either a pre-flight over the raw bytes or
  forking both parsers.

### Precedent

`packages/metadata/src/guards.ts` establishes the codebase vocabulary — a `BombError`, a
`"decompression-bomb"` failure reason, and input / total-inflated / entry-count caps. Its
own comment notes fflate "inflates eagerly, so the inflated total is summed after the
fact": it caps input and checks the total post-hoc with disclosed boundaries. This design
matches that philosophy and goes one better where we control the decoder.

## Goals

- Bound memory for every public `pdf-core` operation against decompression bombs, at both
  load time and our explicit decode sites.
- One parser-agnostic mechanism covering both lopdf and hayro.
- No fork of either parser (charter: compose pure-Rust crates, build only the gaps).
- Honest, disclosed residual where a bound is impractical.

## Non-goals

- Forking or patching lopdf / hayro internals.
- Bounding non-amplifying filters (ASCII85/ASCIIHex) or image codecs (DCTDecode/JPXDecode),
  which do not expand dangerously.
- **Render / raster bombs** — a tiny page with a huge MediaBox rendered at 300 DPI yields a
  giant pixmap. That is a separate attack (rasterization, not decompression) and is out of
  scope here; the generate slice already caps watermark tiling and image megapixels.
- Configurable caps surfaced through the TS/WASM API (v1 uses fixed defaults; the
  `GuardLimits` struct is available to native callers).

## Threat model

`pdf-core` has no production consumer wired yet; the Tool UIs are deferred to the 0·7
cycle and, per the engine's design, run **client-side in WASM**. There a bomb crashes only
the user's own browser tab on a document they chose to open — a self-inflicted denial of
service, not a server or tenant compromise. Inputs are firm-trusted or
received-and-handled documents, not arbitrary internet uploads. Severity is therefore
moderate; the guard is defense-in-depth that also protects any future server-side host.

## Design

### New module: `crates/pdf-core/src/guard.rs`

The single home for bomb defense.

```rust
pub struct GuardLimits {
    pub max_input_bytes: usize,     // default 256 MiB
    pub max_stream_inflated: usize, // default 256 MiB (one stream)
    pub max_total_inflated: u64,    // default 1 GiB (cumulative, pre-flight)
}
// impl Default for GuardLimits { ... }

pub enum BombError { InputTooLarge, StreamTooLarge, TotalTooLarge }

/// Input cap + raw-bytes pre-flight. Called once at every public entrypoint,
/// before either parser sees the bytes. The single mechanism of this slice.
pub fn guard_input(bytes: &[u8], limits: &GuardLimits) -> Result<(), BombError>;
```

The pre-flight's own inflate (the discarding, capped decoder described below) is an
internal helper, not public surface.

**Default caps.** `max_input_bytes` 256 MiB · `max_stream_inflated` 256 MiB ·
`max_total_inflated` 1 GiB. Legit PDFs hold their large payloads in DCTDecode/JPXDecode
(JPEG — will not zlib-inflate), so Flate streams are small; a bomb crosses 256 MiB almost
immediately and aborts cheaply. Caps are generous for real documents, tight for bombs.

### Pre-flight (the core)

`guard_input` runs **once at each public entrypoint, before either parser sees the
bytes**:

1. **Input cap** — reject if `bytes.len() > max_input_bytes` (`InputTooLarge`).
2. **Raw-bytes scan** — walk the file for top-level `stream … endstream` objects. Bound
   each blob by a direct integer `/Length` when present, else by scanning to the next
   `endstream`. Attempt a **bounded inflate** of each blob (zlib → raw-deflate → LZW
   fallback, mirroring lopdf's decoder order) into a **counting sink that discards the
   decompressed bytes** — so pre-flight peak memory is a single small chunk buffer, not the
   cap. Abort the moment one stream exceeds `max_stream_inflated` (`StreamTooLarge`) or the
   running cumulative crosses `max_total_inflated` (`TotalTooLarge`). Non-inflatable blobs
   (JPEG, random bytes) error out instantly and are skipped.

Why this suffices:

- It operates on **raw bytes**, ignoring xref structure entirely, so **one pass covers
  both lopdf and hayro**.
- It catches **ObjStm bombs** because an object stream is itself a top-level `stream`
  object, and objects cannot nest inside a nested ObjStm per the PDF spec.
- Over-cutting a blob boundary (a spurious early `endstream`, or trailing bytes) only
  inflates *more*, which is safe. Under-cutting still expands a uniform bomb past the cap
  before the cut point.

### Wiring

- `guard_input` is the first statement of every public operation: `redact`, `scrub`,
  `secure`, `generate::{merge, split, rotate}`, `watermark`, `bates::stamp_*`,
  `forms::{read_form, fill_form, flatten_form}`, `decrypt`, `detect`, and the public
  `Document::load` / `load_protected`. Internal loads use an **unguarded path** so each
  call pre-flights exactly once.
- **The explicit `decompressed_content()` sites (detect ×2, redact ×1, watermark ×1) stay
  unchanged.** Because every PDF stream is a top-level indirect object — a stream can never
  be packed inside an ObjStm per the spec — the pre-flight has already bounded every stream
  these sites can reach. They are therefore bounded *transitively* and keep lopdf's
  full-fidelity, multi-filter decode. No Flate-only re-implementation is introduced.

### Fail mode

**Uniform fail-closed.** Every operation rejects a bomb or oversize input up front in
`guard_input` with a typed error and emits **no output bytes**. For `detect`, the rejection
is itself the result ("document rejected: decompression bomb") — appropriate for a vetting
tool. There is no separate post-pre-flight decode path to special-case, because the
pre-flight bounds every reachable stream (see Wiring). `detect`'s existing `pages_unreadable`
behavior is unaffected and unrelated.

### Error and WASM surface

Each module's error enum gains a bomb variant constructed from `BombError`. `wasm.rs` maps
it to the stable token **`"decompression-bomb"`** (matching `packages/metadata`'s failure
reason); `packages/pdf/src/index.ts` re-throws a typed `DecompressionBombError`, mirroring
the existing `WrongPasswordError` pattern, so a UI can distinguish a rejected document from
a parse failure.

## Testing

Programmatic bomb fixtures (compress N MiB of zeros into a tiny blob — no `getrandom`
needed):

- Each operation rejects: input-too-large, a single-stream bomb, a **bomb packed inside an
  ObjStm** (proves the load-time vector is closed), and a cumulative many-stream bomb —
  each with the typed error and **zero output bytes**.
- Real fixtures (the W-9 AcroForm, `hello.pdf`, the eval corpus) still pass under the caps:
  no false positives.
- An LZW bomb is rejected (exercises the LZW fallback in the pre-flight inflate).

## Residual (disclosed)

- A bomb using an exotic, non-Flate/LZW amplifying filter, or one whose benign prefix
  inflates small while the tail blows up after a mis-detected `stream`/`endstream` boundary,
  falls back to the input cap rather than the per-stream cap. In the boundary case the
  explicit decode sites, bounded only transitively, would inflate the under-counted stream
  in full — accepted as part of this residual.
- Render / raster bombs are out of scope (see Non-goals).
- `GuardLimits` is not yet caller-configurable through the WASM/TS API; v1 ships fixed
  defaults.
