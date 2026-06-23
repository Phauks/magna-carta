# Surgery Task 5 — Report

## verify_gate refactor

`verify_gate` parameter renamed from `affected_pages_1based` to `flattened_pages_1based`. The text-free structural assertion (each page must return empty text via `extract_text`) now runs only for flattened pages: surgered pages retain live text outside the redaction rects intentionally, so checking them for emptiness would always fail. The document-wide supplied-string check (`redacted_text` needles against all pages) and the `scan_logical_content` call are unchanged — they run regardless of mode.

Callers now pass `flattened_1based` (only the flatten subset) instead of all affected pages.

## Gate mechanics (outcome gate)

After the per-page loop in Surgery mode, a throwaway probe document is serialized (`lo.save_to`) and loaded into hayro (`Pdf::new`). For each surgery candidate:

1. `textpos::observe_page` is called on the probe at the candidate's 0-based page index.
2. If observation returns `None` (hayro cannot interpret the page), the candidate fails the gate.
3. Otherwise, for every `GlyphMark` in the observation, its `bbox` (kurbo device-space, top-left origin) is converted to display-point coordinates via `detect::to_display_rect(glyph.bbox, obs.height_pt)`. The centre `(cx, cy)` is computed as the midpoint of the display rect.
4. If any glyph centre falls inside any redaction rectangle for that page (tested with `detect::rect_contains`), the page fails the gate.
5. Failing pages are immediately flattened from `render_doc` (the original hayro document, untouched by surgery) via `render_redacted_page` + `reassemble_page(&mut lo, ...)`. This overwrites the surgery stream with a raster image. The page is added to `pages_flattened`.
6. Passing pages are added to `pages_surgered`.

This ensures under-removal (text survived inside a rect) is always caught and escalated to the stronger flatten path. The final `verify_gate` and `first_surviving_text` checks then run for all modes.

## Test output summary

64 tests passed, 0 failed, 0 ignored across all modules (redact, surgery, detect, scrub, textpos, lib).

New tests added (all pass):
- `surgery_mode_preserves_nontarget_text` — tiny corner rect on `surgery_simple.pdf`; page lands in `pages_surgered` and still has extractable text.
- `surgery_mode_removes_target_text` — full-page rect on `surgery_simple.pdf` with `redacted_text: ["Hello"]`; `extract_text` and the detector both confirm "Hello" is absent.
- `surgery_falls_back_to_flatten_when_unsupported` — `hello.pdf` (Helvetica, no `/Widths`) causes `try_build_surgery` to return `None`; page is in `pages_flattened`, `pages_surgered` is empty, target text absent.
- `flatten_mode_unchanged` — default options (`RedactionMode::Flatten`); `pages_surgered` is empty, `pages_flattened` contains page 0, `pages_redacted` equals `[0]`.

## Deviations from spec

None. The implementation follows the spec exactly with one minor tightening: `RedactionMode::Default` uses `#[derive(Default)]` + `#[default]` on `Flatten` rather than a manual `impl Default`, which clippy requires and is semantically identical. The existing `redact_removes_target_text_and_passes_gate` test had its `RedactionOptions` literal updated to include `mode: RedactionMode::Flatten` (required by the new field; no behavioral change).
