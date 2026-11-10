---
category: Fixed
audience: public
---

**Five defects in the PDF engine, each with the test it was missing.** `scrub_form_field_values` (`crates/pdf-core/src/scrub.rs`) removed `/AP` from every field, and a button's appearance dictionary is the only record of its on-state name, so `fill_form` on a sanitized template found no radio options and guessed `Yes` for every checkbox. A button now keeps `/AP` and has `/AS` reset to `Off`; text and choice fields still lose theirs, and `/RV` is cleared beside `/V` and `/DV`. `/Fields` and `/Kids` are resolved through `resolve_array` (`surgery.rs`) in both `scrub.rs` and `forms.rs`, where an array stored behind a reference used to read as empty. `verify_scrub_absence` no longer repeats the scrub's own walk: it scans every field-like object in the document, so a tree the walk cannot follow fails the gate instead of passing it. `parse_cid_widths` caps a `/W` range at character identifier 65,535, where a file could previously declare four billion entries and be looped over as declared. `signed_bytes` and `embed_signature` (`sign.rs`) check the host-supplied ranges and return the new `SignError::InvalidRange`; `signed_bytes` now returns a `Result`. `extractPdfText` refused any document over 100 pages with the decompression-bomb token; the ceiling is `MAX_TEXT_EXTRACTION_PAGES` (50,000, the discovery engine's own) and the refusal past it is named `document has too many pages`. Word breaks are measured between glyph advances (`GlyphMark::advance_span`, `gap_between` in `textextract.rs`) with the inked boxes as the fallback, because two narrow glyphs set solid sit further apart box to box than a word break does.

## Public

**Checkboxes and radio buttons on a PDF form template work after the template is cleaned.** Uploading a fillable form clears whatever the last person typed into it. That cleaning also removed the drawings of the ticked and unticked boxes, so a box you ticked could come out unticked on the finished document. The boxes are now kept and reset to empty.

**Long PDFs are searchable in full where the built-in reader handles them.** That reader stopped at 100 pages and reported the document as unsafe. It now reads documents of up to 50,000 pages.

**Numbers with repeated narrow digits are found by search.** A year such as 2011 could be indexed as "201 1" in documents set in Helvetica or Arial, so searching for it missed the page. Word spacing is now measured the way the document itself spaces its letters.
