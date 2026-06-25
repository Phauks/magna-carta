# PDF engine slice 2 — redaction (rasterize-and-reassemble) — design

**Status:** Draft (implementation-grade design) · **Date:** 2026-06-22 · **Owner:** Trevor Goldsmith
**Roadmap home:** [`2026-06-21-rust-pdf-engine-roadmap-design.md`](2026-06-21-rust-pdf-engine-roadmap-design.md) §6 (slice 2) · builds on slice 1 ([`2026-06-21-pdf-slice-1-core-render-design.md`](2026-06-21-pdf-slice-1-core-render-design.md))
**Feasibility:** [`2026-06-22-pdf-redaction-feasibility-findings.md`](2026-06-22-pdf-redaction-feasibility-findings.md) (this cycle) — both redaction strategies proven feasible in pure Rust; the gate (lopdf `extract_text`) and the text-position primitive (`hayro-interpret` `Device::draw_glyph`) both confirmed.
**Relates to / revisits:** white paper _PDF services_ ("Deferred — true redaction", AGPL wall) — **this slice retires that deferral**; ADR-0090 (the redaction _verification gate_ is the protected product layer); _Discovery_ (the eventual consumer).
**ADRs to raise:** `pdf-redaction-rasterize-route` (the safe-by-construction strategy + the hard verification gate + surgery deferred).
**Build gates:** slice 1 landed (`pdf-core` + `@magna-carta/pdf` + harness). Backend-first — no UI.

Legally-sound redaction must **remove** content, not hide it. Slice 2 ships the **safe-by-construction** route: every page touched by a redaction is flattened to a rasterized image with opaque black boxes burned over the regions, its text/annotations stripped, and a **verification gate** confirms no redacted text survives before any bytes are emitted. The white paper deferred this as AGPL-bound; the pure-Rust engine + the object model dissolves that wall.

---

## 1. Scope

**In:**

1. **lopdf enters `pdf-core`** (the roadmap's predicted point — the object model for rewriting pages). Render stays hayro.
2. A redaction operation `redact(bytes, regions, opts) -> Result<RedactionOutcome, RedactError>` in a new `crates/pdf-core/src/redact.rs`.
3. The **verification gate** (lopdf `extract_text`) — structural (always) + content (when redacted strings are supplied); a hard gate that refuses to emit on survival.
4. The WASM edge + `@magna-carta/pdf` `redactDocument(bytes, regions, opts)`.
5. A `redact` mode + a redaction smoke in `crates/pdf-eval`.

**Out (named seams, §8):** content-stream surgery (text-preserving — feasibility banked, next-after-the-primitive); the **bad-redaction detector** (the next slice — shares the text-position primitive); the text-position primitive itself (`Device` shim); text-selection region picking (UI); document-level metadata deep-scrub; the Discovery Bates/production pipeline.

---

## 2. Architecture

```
crates/pdf-core/
  Cargo.toml            # + lopdf = "0.41"
  src/lib.rs            # re-export redact; extend the error type
  src/redact.rs         # the redaction operation + the gate
  src/wasm.rs           # + redactDocument edge
packages/pdf/src/index.ts   # + redactDocument(bytes, regions, opts)
crates/pdf-eval/src/main.rs  # + `redact` mode + redaction smoke
```

Redaction is a free function (not a method on the hayro-backed `Document`) because it needs **both** the lopdf object model (rewrite) and a hayro render (the raster), over the same bytes:

```rust
pub struct RedactionRegion { pub page: usize, pub rect: Rect, pub reason: Option<String> }
pub struct Rect { pub x0: f32, pub y0: f32, pub x1: f32, pub y1: f32 } // PDF points, bottom-left origin
pub struct RedactionOptions { pub dpi: f32 /*default 300*/, pub redacted_text: Vec<String> }
pub struct RedactionOutcome { pub pdf: Vec<u8>, pub report: RedactionReport }
pub struct RedactionReport { pub pages_redacted: Vec<usize>, pub region_count: usize }

pub fn redact(bytes: Vec<u8>, regions: &[RedactionRegion], opts: &RedactionOptions)
    -> Result<RedactionOutcome, RedactError>;
```

`RedactError` extends the slice-1 error vocabulary: `Parse`, `PageOutOfRange`, `Render`, and the safety-critical **`GateFailed { detail }`** — returned when text survives, with **no PDF emitted**.

---

## 3. The redaction operation (per affected page)

1. **Render** the page to a raster at `opts.dpi` (default **300**) via hayro (slice-1 `render_page` path).
2. **Burn** opaque black rectangles over each region — map the region's PDF-point `Rect` to pixels (§5).
3. **Reassemble** with lopdf: replace the page's content stream with one that draws a single full-page image XObject (the flattened raster), keep the same `MediaBox`, and **remove** the original content stream and the page's `/Annots`.
4. **Prune orphans:** replacing `/Contents` only _unlinks_ the original streams — their bytes (the original text operators, fonts, images) still serialize unless removed. After all pages are reassembled, prune every object no longer reachable from the trailer (lopdf `prune_objects`), so the original content is physically absent from the output, not merely unreferenced. This is the difference between _removed_ and _hidden_ at the byte level, and is enforced by a test asserting the original (uncompressed) text bytes are gone from the emitted file.
5. The page's original text/vectors/annotations are now **gone** — only pixels remain.

**Image encoding:** default **lossless DEFLATE** (no JPEG artifacts on text — defensibility over size). `opts` exposes DPI; colorspace down-conversion (grayscale/bitonal for text pages, a major size win for large productions) is a named optimization seam, not v1.

---

## 4. The verification gate — the safety core

This is _why_ the output is defensible, and it runs after reassembly, before returning:

- **Structural (always):** for every affected page, lopdf `extract_text(page)` must return empty. Because the page is now a single image, surviving text means the rewrite failed.
- **Content (when `opts.redacted_text` is supplied):** none of those strings may appear anywhere in the whole document's extracted text.

On any failure → `Err(RedactError::GateFailed { detail })` and **emit no bytes**. The operation never returns an unsafe redaction.

**The gate is proven non-trivial by a negative test** (§7): a redaction run with the strip deliberately skipped MUST fail the gate. A gate that can't fail is a no-op; this test is mandatory.

---

## 5. Coordinate correctness (the fiddly part — where the tests concentrate)

The engine works in **PDF points, bottom-left origin**. The point→pixel burn-in mapping must handle:

- the **y-flip** (PDF y-up → image y-down): `px_y = (page_height_pt - rect_y) * dpi/72`;
- **`/Rotate`** (90/180/270) — the rendered raster is already rotated by hayro's `render_dimensions`; the region rect must be rotated to match;
- non-zero **`MediaBox`/`CropBox`** origins (subtract the origin before scaling).

Each of these gets a targeted test with a known rect → known pixel block.

---

## 6. WASM + TS surface

`redactDocument(bytes: Uint8Array, regions: RedactionRegion[], opts?: { dpi?, redactedText? }): { pdf: Uint8Array, report }`. Regions marshal JS→Rust as a `Vec`. `GateFailed` surfaces as a thrown `Error` whose message names the failure (the wrapper keeps the slice-1 deterministic-`free()` discipline). Client-side-by-default holds: privileged bytes never leave the device.

---

## 7. Testing

- **Happy path:** redact a known text region → gate passes, the redacted string is absent from `extract_text`, and re-rendering the output shows an opaque box at the region (sample a few pixels in the rect → all near-black).
- **Negative gate test (mandatory):** force the strip to be skipped → `GateFailed` must be returned. Proves the gate catches survival.
- **Coordinate tests:** a rect at a known location maps to the right pixel block, including a `/Rotate 90` page and a non-zero-origin `MediaBox`.
- **Page isolation:** redacting page N leaves page M's text intact (the feasibility spike confirmed lopdf page isolation).
- **Harness:** `pdf-eval redact <pdf> <out> --region ...` + a redaction smoke (redact a corpus file, assert the gate passes), runnable in CI default features.

---

## 8. Deferred / named seams

- **The text-position primitive (`hayro-interpret` `Device::draw_glyph` shim)** — the next slice; the shared foundation for the two below.
- **Bad-redaction detector** _(owner-requested, next slice)_ — the inverse tool: scan a PDF and flag _failed_ redactions — extractable text whose bbox is covered by an opaque fill/image/removable annotation ("recoverable redacted text"), hidden OCG layers, and metadata leaks; report `{page, region, recovered text, severity}`. High-value malpractice-prevention for vetting outbound productions. Validated against a synthetic + real bad-redaction corpus, cross-checked against an LLM reading.
- **Content-stream surgery** — region-precise, text-preserving redaction (keeps the rest of the page selectable); feasibility banked, built on the same primitive.
- **Document-level metadata deep-scrub** (whole-doc XMP/Info) — v1 strips affected-page content + annotations; whole-document metadata scrub flagged as a consideration.
- **Discovery Bates/production pipeline** — the batch consumer.

## 9. Open items to confirm at build (golden rule 11)

- Re-verify `lopdf` `extract_text` + image-XObject insertion API at build.
- Confirm hayro's `/Rotate` handling in `render_dimensions` so the rect-rotation matches the raster.
- Confirm the DEFLATE image-stream construction (predictor/filters) lopdf expects.
- Confirm the gate's content-match is whitespace/encoding-robust (extracted text normalization).
