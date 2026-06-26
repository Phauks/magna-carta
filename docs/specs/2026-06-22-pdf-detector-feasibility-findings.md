# Bad-redaction detector — feasibility findings

Spike crate: `spikes/detector-feasibility/` (standalone, not a workspace member).
Run date: 2026-06-22. Corpus: `spikes/pdf-engine-eval/corpus/basicapi.pdf`.

**Verdict: GO.** The flagship "covered text" detector works end-to-end in pure Rust via an observing `hayro_interpret::Device`. The remaining detectors are lower-risk structural scans over the lopdf object model.

---

## What the spike proved

A custom `Device` observes the page's fully-resolved draw sequence (hayro resolves content streams, XObjects, and annotation appearances for us). It records, in paint order, every glyph (recovered Unicode text + page-space bbox + draw mode) and every opaque fill ("cover": bbox + RGBA + order). A glyph is flagged when a *later* opaque cover contains its bbox center.

Results on `basicapi.pdf` (198 glyphs):

| Case | Findings | Note |
| --- | --- | --- |
| Control (original) | **0** | No false positives on a clean document. |
| Partial black band over the title row | **14** | Selective — recovers exactly `"TableOfContent"`, nothing else. |
| Full-page black cover | **155** | All visible text; recovers `"TableOfContentChapter1…"`. |

The detector **recovers the hidden text**, flags **selectively** (a partial cover flags only the covered region, not the page), and produces **no false positives** on unredacted content.

## Key API facts (verified against the installed source)

- **Per-glyph position requires composing both transforms.** `draw_glyph` passes `transform` (the text-run origin) and `glyph_transform` (the per-glyph offset). hayro's renderer draws the outline as `transform * glyph_transform * outline` (`hayro-0.7.1/src/renderer.rs:628`). Using `transform.translation()` alone yields the run origin for every glyph (all glyphs reported `(0, 841.9)`); composing both yields correct per-glyph bboxes (`"T"=(243,86.9)`, `"a"=(252.4,88.6)`, …). The glyph bbox comes from `OutlineGlyph::outline()` (a `kurbo::BezPath`) transformed by `transform * glyph_transform`.
- **Recovered text:** `Glyph::as_unicode() -> Option<BfString>`, where `BfString` is `Char(char) | String(String)`.
- **Cover opacity:** `Paint::Color(Color)`; `Color::to_rgba() -> AlphaColor`; `AlphaColor::to_rgba8() -> [u8;4]` (alpha folds in the painted opacity). Opaque cover ⇒ `rgba[3] >= 250`.
- **Invisible text (Tr 3):** `GlyphDrawMode::Invisible` is delivered directly — the classic OCR-overlay / invisible-text leak is a one-line check (extractable glyph with `Invisible` draw mode).
- **Paint order = Device call order** (a monotonic counter); a cover after a glyph in call order is painted over it.
- **Interpret setup:** `Context::new(initial_transform, bbox, &InterpreterCache::new(), page.xref(), InterpreterSettings::default())` then `interpret_page(page, &mut ctx, &mut device)`. `initial_transform = page.initial_transform(true).to_kurbo()` (the `TransformExt` trait must be in scope). Glyphs and covers pass through the same transform pipeline, so their coordinates are directly comparable — the absolute frame does not matter for overlap.
- **Glyph kinds:** `Glyph::Outline` (outline bbox) and `Glyph::Type3` (drawing-instruction glyphs; fall back to the composed origin as a degenerate bbox, or recurse — a build detail).

## What the spike did NOT cover (lower-risk, handled by design)

- **Removable-annotation covers.** `interpret_page` renders annotations after page content. To attribute a cover to an annotation (so the finding says "delete this annotation to reveal"), drive `interpret()` on the page operations first, then each annotation appearance separately, tagging the source. Confirmed feasible from `interpret_page`'s own structure; not exercised here.
- **Hidden OCG layers.** `InterpreterSettings` has **no** OCG override, and hayro skips drawing content in layers that are inactive by default — so the Device never sees hidden-layer glyphs. OCG-hidden text is therefore recovered **structurally**: read `/OCProperties` (the inactive layers) from lopdf, parse the content stream operators (`lopdf::content::Content::decode`) to find `/OC … BDC … EMC` spans referencing an inactive layer, and extract the text operands. Recovered text, page-level region, no per-glyph bbox (a documented boundary).
- **Off-page recoverable text** (metadata Info/XMP, structure-tree `ActualText`/`Alt`, bookmarks, form values, attachments, orphaned objects). Pure structural lopdf scans — the same surfaces the scrub feature already removes; the detector flags their presence instead.

## Boundaries (to be documented honestly in the engine)

- Text encoded only as custom-font glyph codes whose byte sequence does not spell the Unicode is recovered via `as_unicode()` when a ToUnicode map exists, but not otherwise.
- Per-glyph geometric precision for OCG-hidden text is not available (recovered as text + page-level region).
- A cover that is *not* fully opaque (partial alpha) is a high-recall judgment call; the engine flags it at a lower severity rather than ignoring it.
