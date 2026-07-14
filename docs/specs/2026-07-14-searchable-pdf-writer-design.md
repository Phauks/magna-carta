# Searchable-PDF writer — design

**Date:** 2026-07-14
**Status:** Draft (approval pending) · Area: `crates/pdf-core`
**Scope:** Take the raw facts the OCR engine already produces — recognized text and its word boxes, in PDF user space — and write an **invisible text layer** onto the scanned page it came from, so an image-only page becomes selectable, copyable, and searchable. Strictly additive: no visible pixel changes, and a page that already carried real text is left exactly as it was.

## Why now

The OCR engine reads a scanned page into per-page facts — line text, word quads, confidence — but nothing consumes those facts back into the document. Recognized text lives only in an API response; the PDF a reviewer opens is still an unsearchable picture. The OCR engine design names this the natural next step: "an invisible text layer belongs in `pdf-core` beside the Bates content-append path, consuming exactly the word boxes this slice produces." This slice closes that loop. It is the "scanned PDF → searchable PDF" the white paper's discovery pipeline calls for, and the conversion orchestrator already reserves the edge that dispatches to it.

## Goal

One pure `pdf-core` function: given the original PDF bytes and, per page, the recognized text with its boxes, return new PDF bytes carrying an invisible text layer over the recognized pages. Deterministic (byte-identical on a re-run of the same inputs), non-destructive (every existing byte of an untouched region preserved), and self-verifying (a re-observation gate confirms the layer is present, invisible, and changed nothing visible).

## Scope

- A new `crates/pdf-core/src/searchable.rs`: `write_searchable_text_layer(input: Vec<u8>, pages: &[PageTextLayer]) -> Result<Vec<u8>, PdfError>`.
- A `pdf-core`-native input type (`PageTextLayer { page_index, runs: Vec<TextRun> }`, `TextRun { text: String, quad: [(f32,f32);4] }`) so `pdf-core` takes no dependency on `ocr-core`. The OCR container adapts `PageFacts` into it.
- The invisible-text content stream, the font resource, the `ToUnicode` mapping, and the append/merge plumbing.
- An outcome gate re-observing the result through the existing `textpos` observer.
- A `pdf-eval` validation operation exercising the additive-only invariant on a real render → OCR → write → re-read round trip.
- Wiring into the OCR container as a route that chains recognize → write, so the slice ships end-to-end usable (`POST /ocr/searchable`, PDF in, searchable PDF out).

## Explicitly out of scope

- **Reading order / layout reconstruction.** The layer carries text positioned where it was seen, not reflowed into logical paragraphs. Copy-paste yields visually-ordered text, which is what a scanned exhibit's text layer is.
- **Per-glyph boxes.** Placement is per word (per line where word boxes are absent). The engine emits word quads, not glyph quads.
- **Rewriting or improving an existing text layer.** A page the OCR engine skipped (it already has visible text) gets no layer; the writer only touches pages it was given runs for.
- **The conversion-orchestrator integration and the discovery ingest pipeline** (queues, per-job Durable Object, search-index feed). This slice makes the writer and proves it end-to-end on the OCR container; the orchestrator wires it when that subsystem is built.
- **The end-user UI.**

## Design

### 1. Copy the Bates append shape, change the operators

`bates.rs::stamp_page` is the proven template for "append drawn text to a page without disturbing it": guard the input, resolve the inherited MediaBox and `/Rotate`, clone the page's `/Font` subdict and add ours under a collision-safe name, append a **new** content stream object (never rewrite an existing one, so untouched bytes stay byte-identical), and `doc.save_to`. `watermark.rs` is a second copy of the same pattern. The writer follows it verbatim, with two differences in the emitted stream:

- Every text run is wrapped `BT … 3 Tr … Tm (…) Tj ET` — **`3 Tr` is text render mode "neither fill nor stroke,"** i.e. invisible. Nothing in the tree emits `Tr` today; this is the first. The reader already models it: `textpos::GlyphMark.invisible` is set from `GlyphDrawMode::Invisible`, and `page_visible_text_coverage` excludes invisible glyphs — so the layer we write reads back as "present but invisible," and the OCR skip-check will correctly still treat the page as a scan, not a text page.
- The text matrix `Tm` places each run at its box. The OCR container already maps quads into **PDF user space, bottom-left origin** (`pages::to_user_space` flips y as `page_height - y·scale`), so the writer consumes them directly — no second y-flip. Font size is derived from the box height; a horizontal scale (`Tz`) stretches the run so its rendered width matches the box width, which is what makes a selection highlight land on the word rather than drift off it.

### 2. Word placement from line text + word quads

`TextLine` carries the recognized string only at the **line** level; `word_quads` are boxes without text. So the writer splits the line text on whitespace and, when the word count matches `word_quads.len()`, places each word at its own box — giving word-level selection. When the counts disagree (punctuation, CJK with no spaces), it falls back to placing the whole line string across the line quad. Both cases produce a correct, searchable layer; only selection granularity differs. (The `pdf-core` input type flattens this to `TextRun`s, so the container owns the split-and-zip and `pdf-core` stays simple.)

### 3. The font decision — the one genuinely new problem

Bates and watermark use a **standard-14 Type1 font (Helvetica) with WinAnsi width tables**, which cover Latin only — code ≥ 256 has no advance. The OCR engine reads **Latin, CJK, and Greek** (its dictionary is ~18,700 entries, 15,565 of them CJK ideographs). A Latin-only writer would silently drop the searchability of every Chinese, Japanese, or Greek exhibit the engine can read — the same class of silent-content-loss failure the OCR skip gate exists to prevent.

Because the layer is **invisible**, the font's glyph shapes never render. Only two things matter: the **advance widths** (for placing and scaling the run) and the **`ToUnicode` CMap** (for what copy-paste and search extract). This decouples "what is drawn" from "what is extracted," and is exactly what the OCR-PDF convention (ocrmypdf, Tesseract's `pdf` renderer) exploits:

- **Option A — standard-14 WinAnsi, Latin-only (interim).** Reuses Bates' font and width tables almost verbatim; a `ToUnicode` CMap is optional (WinAnsi already extracts Latin correctly). Ships fast. **Limitation:** CJK/Greek runs are dropped or mangled — the searchable layer covers only Latin-script pages, a real gap against the engine's coverage.
- **Option B — a `Type0` / `Identity-H` CID font + `ToUnicode` (full coverage). Chosen.** A composite font whose two-byte codes are the text's UTF-16BE code units, with `CIDToGIDMap /Identity` and a constructed `ToUnicode` CMap mapping each code to the real Unicode string. Covers **everything the engine reads** — Latin, CJK, Greek (all BMP, no surrogate handling needed) — with one font and one code path, no per-script branching. This is the standard OCR-PDF solution (Tesseract, ocrmypdf).

**Embedded vs. non-embedded — this slice ships non-embedded.** Because the layer is invisible (`3 Tr`), the font's glyph program is never executed: text extraction reads the `ToUnicode` CMap and selection geometry reads the width (`DW`/`W`) and `Tm` — none of which need an embedded font file. Vendoring a foreign glyphless TrueType binary is therefore avoidable, keeping the slice self-contained and pure-Rust. The descendant `CIDFontType2` is written with a `FontDescriptor` (flags, bbox, `DW`) but no `FontFile2`, and a default width chosen so a run's advance can be scaled to its box. The one thing this forgoes is a rendered selection glyph in viewers that draw one from the embedded program; embedding a small glyphless font (a static data asset, no golden-rule-14 concern) is the documented fast-follow if a target viewer needs it. Not PDF/A-conformant by construction — PDF/A is a separate, later concern for produced documents.

The `ToUnicode` CMap is built deterministically: `bfchar`/`bfrange` entries emitted in sorted code order, no timestamps, so the same text yields byte-identical bytes.

### 4. Determinism

- **Append-only.** The layer is a new content-stream object plus one shared font (and, for Option B, one CMap and one font-file object) per document; every pre-existing object is untouched, so the byte-level-surgery discipline ("untouched bytes are byte-identical to input") holds trivially.
- **Deterministic assembly.** Object ids come from `lopdf` in a fixed add order; the `ToUnicode` `bfrange` entries are emitted in sorted code order; no timestamps or nondeterministic ids enter the output. The same inputs produce byte-identical bytes — the property re-OCR discipline needs when a production is re-run.

### 5. Outcome gate

Imitating redaction's verify-then-fall-back model: after writing, re-serialize, reload, and re-observe the page through the `textpos` observer, asserting (a) the new glyphs are present with `invisible == true`, and (b) `page_visible_text_coverage` is unchanged from the input — the layer added nothing a human eye can see. A gate failure is a hard error (the writer refuses to return a document it cannot prove is additive), not a silent pass — mirroring "an inference fault is a 503, never a fabricated result."

### 6. Confidence and empties

Every recognized line is written regardless of confidence — the text is the engine's best read, and dropping low-confidence words removes exactly the content a searcher most needs to find. Empty/whitespace runs are not written (nothing to place); `undecoded_regions` carry no text and so contribute no runs — consistent with the engine never emitting an empty line as if it were real text.

## Architecture

```
containers/ocr  POST /ocr/searchable
     │  recognize (existing) → PageFacts
     │  adapt PageFacts → [PageTextLayer]     (container owns the split-and-zip)
     ▼
pdf-core::searchable::write_searchable_text_layer(pdf, &pages) -> Vec<u8>
     │  guard_input → resolve geometry → merge font resource →
     │  append invisible-text stream (+ ToUnicode) → outcome gate → save
     ▼
  searchable PDF bytes
```

`pdf-core` stays free of `ocr-core`; the container is the only place that knows both types.

## Files touched

- **New** `crates/pdf-core/src/searchable.rs` — the writer, input types, `ToUnicode`/font construction, outcome gate.
- **New** `crates/pdf-core/src/fonts/glyphless.ttf` (Option B) — the embedded glyphless font, plus a note on its provenance and license.
- `crates/pdf-core/src/lib.rs` — export `write_searchable_text_layer`, `PageTextLayer`, `TextRun`.
- `crates/pdf-core/src/bates.rs` — extract the shared bits (`escape_pdf_literal`, resource-merge, content-append) into a reusable helper if not already `pub(crate)`, so the writer and Bates share one implementation of the append rule.
- `crates/pdf-eval/src/validate/operations/searchable.rs` — validation op: render a born-digital page, treat its glyph text as ground truth, OCR a rasterized copy, write the layer, reload, and assert the extracted text matches and no visible content changed.
- `containers/ocr/src/lib.rs` — `POST /ocr/searchable`: recognize, adapt, write, return the PDF.
- Docs: `changelog.d/`, `status.d/searchable-pdf-writer.md`, `docs/active-work/…`, and a decision record under `docs/decisions/pending/`.

## Risks

- **Font/coverage scope (§3)** — the load-bearing decision; Option A ships sooner but leaves a multilingual gap. Resolve before implementation.
- **Selection alignment** — a fixed-advance glyphless font plus per-run `Tz` scaling aligns the run box, not each glyph; highlight drift within a long run is possible. Acceptable for a scanned-text layer; per-glyph placement is the escape hatch if a matter needs it.
- **Rotated / non-standard pages** — reuse Bates' rotation-aware `text_matrix`; a page geometry Bates already falls back on, the writer falls back on identically (no layer rather than a misplaced one).

## Consequences

The writer turns the OCR engine from a fact producer into a document transformer, completing the scanned → searchable path without touching the engine's determinism or firm-agnosticism (it runs in the same container, the worker still owns firm scoping). It reuses the Bates/redaction append and observation machinery rather than inventing a second way to modify a PDF. Option B adds one embedded font asset and a CMap builder to `pdf-core`; both are one-time and shared. No prior ADR is amended — this realizes the "scanned-PDF → searchable-PDF" edge ADR-0030 already routes to this engine.
