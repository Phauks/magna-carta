# PDF Generate Primitives — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** merge / split / rotate / watermark (text + image) in `crates/pdf-core`, exposed through the `packages/pdf` WASM binding. Full scope: merge carries outlines + AcroForm fields + named destinations; watermark does text and image (PNG/JPEG).

**Architecture:** new `crates/pdf-core/src/generate.rs` (merge / split / rotate — pure lopdf model) and `src/watermark.rs` (additive overlay; reuses Bates's font/escape/resource-merge helpers and surgery's `resolve_mediabox`/`resolve_rotate`). Shared types in `generate.rs`.

**Tech Stack:** Rust, lopdf 0.41 (`renumber_objects_with`, `get_pages`, `prune_objects`, `Bookmark`/outline, `Object`/`Dictionary`/`Stream`), the `image` crate (already a dep) for image-watermark decode, hayro (tests, to confirm outputs render).

## Global Constraints

- Pure-compute: typed `Result`, no logging, no `unwrap`/`panic` on input data outside tests.
- No process references in source/tests/README/consumer strings; full names; changelog/ADR via fragments. ("spike" etc. are forbidden in source — `pnpm run lint:process-refs`.)
- watermark/rotate are ADDITIVE/visible — never imply they remove content; point to `redact`/`sanitize`.
- Reuse before building: lopdf merge/rotate recipes; Bates `stamp_page`/`escape_pdf_literal`/font tables; surgery resolvers; the `image` crate.
- Overlay resource names distinctive (e.g. `MagnaCartaWatermark`, `MagnaCartaWmGs`, `MagnaCartaWmImg`).

## Interfaces produced

```rust
pub enum GenerateError { Parse, NoPages, PageOutOfRange, EmptyInput, Reassemble, Image }
pub struct PageRange { pub start: usize, pub end: usize }     // inclusive, 0-based
pub enum PageSelection { All, Pages(Vec<usize>) }              // 0-based
pub enum Rotation { Cw90, Cw180, Cw270 }
pub fn merge(documents: &[&[u8]]) -> Result<Vec<u8>, GenerateError>;
pub fn split(bytes: &[u8], ranges: &[PageRange]) -> Result<Vec<Vec<u8>>, GenerateError>;
pub fn rotate(bytes: &[u8], rotation: Rotation, pages: &PageSelection) -> Result<Vec<u8>, GenerateError>;
pub struct WatermarkOptions { pub content: WatermarkContent, pub opacity: f32, pub rotation_deg: f32, pub placement: WatermarkPlacement }
pub enum WatermarkContent { Text { text: String, font: BatesFont, font_size_pt: f32, color: [f32;3] }, Image { bytes: Vec<u8>, scale: f32 } }
pub enum WatermarkPlacement { Center, Tiled }
pub fn watermark(bytes: &[u8], opts: &WatermarkOptions) -> Result<Vec<u8>, GenerateError>;
```

---

### Task 1: rotate + shared types

**Files:** create `crates/pdf-core/src/generate.rs` (types + `rotate`); modify `lib.rs` (`mod generate;` + re-export the types + `rotate`).

`rotate`: `load_mem` (→Parse); resolve target pages from `PageSelection` (All = every page in reading order; Pages = the listed 0-based indices, any out of range → `PageOutOfRange`); for each, `get_object_mut`→`as_dict_mut`, set `/Rotate` to `((current + delta) % 360 + 360) % 360` (delta from `Rotation`: Cw90=90, Cw180=180, Cw270=270). `save_to` (→Reassemble).

- [ ] **Step 1: failing tests:** `rotate_all_sets_90`; `rotate_composes_with_existing` (a page at `/Rotate 90` + Cw270 → 0, normalised); `rotate_selected_pages_only`; `rotate_out_of_range_errs`. Build docs with the bates `page_doc` pattern (multi-page).
- [ ] **Step 2-4:** FAIL → implement → `cargo test -p pdf-core --lib generate::` green; clippy `--all-targets -D warnings` + fmt clean.
- [ ] **Step 5:** commit `feat(pdf-core): rotate pages (relative, normalised)`.

---

### Task 2: split

**Files:** modify `generate.rs` (`split`, `PageRange`), `lib.rs` (re-export).

`split`: `load_mem`; `let pages = doc.get_pages()` (1-based map → ordered Vec of page ObjectIds). For each `PageRange` (validate `start<=end<page_count`, else `PageOutOfRange`): clone the doc, collect the kept page ids, rebuild `/Pages` `/Kids`+`/Count` over them (set each kept page's `/Parent` to the pages id), point `/Catalog /Pages` at it, drop `/Outlines`+`/Names`+`/AcroForm` from the clone's catalog (subset-preservation of those is out of scope — disclose), `prune_objects`, `save_to`. Return `Vec<Vec<u8>>`.

- [ ] **Step 1: failing tests:** `split_one_range` (3-page → range [1,2] → a 2-page doc that loads in hayro); `split_multiple_ranges` (→ N outputs with the right page counts); `split_full_range_roundtrips`; `split_out_of_range_errs`; `split_inverted_range_errs`.
- [ ] **Step 2-4:** FAIL → implement → green; clippy + fmt.
- [ ] **Step 5:** commit `feat(pdf-core): split a PDF by page ranges`.

---

### Task 3: merge — pages + content

**Files:** modify `generate.rs` (`merge`), `lib.rs` (re-export).

`merge(documents)`: empty → `EmptyInput`. Build a fresh `Document::with_version("1.5")`. For each input: `load_mem`, `renumber_objects_with(max_id)` (max_id starts 1, advance to `doc.max_id+1` each step) to avoid ID collisions; collect its page ids (`get_pages` order) and `objects.extend` into a combined object map. After all: insert every input object into the output, build one `/Pages` (`/Kids` = all page ids in input-then-page order, `/Count` = total), set each page's `/Parent` to the new pages id, build `/Catalog /Pages`, set trailer `/Root`. `save_to`. (Follows the lopdf merge example; bookmarks/forms/dests handled in Task 4.)

- [ ] **Step 1: failing tests:** `merge_two_docs_sums_pages` (1-page + 2-page → 3-page; loads in hayro); `merge_preserves_each_mediabox` (A4 + Letter inputs keep their sizes); `merge_single_doc_roundtrips`; `merge_empty_list_errs`; `merge_renumbers_without_collision` (two docs whose ids overlap → all pages survive).
- [ ] **Step 2-4:** FAIL → implement → green; clippy + fmt.
- [ ] **Step 5:** commit `feat(pdf-core): merge PDFs (pages + content)`.

---

### Task 4: merge — outlines + AcroForm + named destinations

**Files:** modify `generate.rs` (extend `merge`).

After the page tree is built, fold the inputs' interactive structure (object ids already renumbered, so refs are valid in the combined map):

- **Outlines:** for each input with `/Outlines`, graft its top-level items under one merged `/Outlines` root, re-parenting and fixing `/First`/`/Last`/`/Count`; `/Dest`s already reference renumbered pages.
- **AcroForm:** union the inputs' `/AcroForm /Fields`; on a fully-qualified-name collision, suffix the later field's `/T` (e.g. `name` → `name_2`); merge `/DR` (`/Font` etc.) non-destructively; `/NeedAppearances true` if any input had it.
- **Named dests:** merge `/Names /Dests` (+ legacy `/Dests`) name→dest entries; suffix colliding names.

Keep helpers small and `pub(crate)` so the tests can assert structure.

- [ ] **Step 1: failing tests:** `merge_outline_one_node_per_doc` (each input has a bookmark → merged outline has both, dests resolve to the right merged page); `merge_unions_form_fields` (W-9-style inputs → all fields present); `merge_renames_colliding_field` (two inputs with a `Name` field → `Name` + `Name_2`); `merge_merges_named_dests`.
- [ ] **Step 2-4:** FAIL → implement → green; clippy + fmt.
- [ ] **Step 5:** commit `feat(pdf-core): merge carries outlines, form fields, named dests`.

---

### Task 5: watermark — text

**Files:** create `crates/pdf-core/src/watermark.rs` (`watermark`, `WatermarkOptions`, `WatermarkContent`, `WatermarkPlacement`); modify `lib.rs`. Reuse `bates::{escape_pdf_literal, label_width_pt, BatesFont, postscript_name}` (make any needed one `pub(crate)`) and `surgery::{resolve_mediabox, resolve_rotate, resolve_inherited_resources, resolve_dict}`.

Per page: effective MediaBox `[w,h]`; one shared Helvetica-or-chosen font object + one `/ExtGState << /ca opacity /CA opacity >>` object (deduped per doc). Centre: `cx,cy = w/2,h/2`; text width `tw` from `label_width_pt`; the text matrix = rotate(`rotation_deg`) ∘ translate so the text's centre sits at `(cx,cy)`. Content appended LAST: `q /MagnaCartaWmGs gs BT /MagnaCartaWatermark <size> Tf <r g b> rg <a b c d e f> Tm (escaped) Tj ET Q`. `Tiled`: repeat on a grid stepped by ~`max(tw, size)*1.5`. Non-destructive `/Resources` merge (`/Font` + `/ExtGState`) via the Bates pattern.

- [ ] **Step 1: failing tests:** `text_watermark_is_additive` (page count unchanged, original `/Contents` still referenced, an appended stream added); `text_watermark_sets_extgstate_alpha`; `text_watermark_renders` (hayro loads; `textpos`/observe finds the watermark text); `text_watermark_tiled_repeats` (more than one occurrence). Programmatic page docs.
- [ ] **Step 2-4:** FAIL → implement → green; clippy + fmt.
- [ ] **Step 5:** commit `feat(pdf-core): text watermark overlay (opacity, rotation, tiled)`.

---

### Task 6: watermark — image (PNG/JPEG logo)

**Files:** modify `watermark.rs` (the `Image` arm + an `image_xobject` helper).

`WatermarkContent::Image { bytes, scale }`: detect format; **JPEG** → embed bytes directly as a stream `<< /Type /XObject /Subtype /Image /Width /Height /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode >>` (no re-encode); **PNG/other** → decode with `image` to RGB8 (+ alpha if present), Flate-encode the RGB samples into the image XObject, and when alpha exists add an `/SMask` image XObject (8-bit `/DeviceGray`, Flate). Draw per page: `q /MagnaCartaWmGs gs <cm = translate·rotate·scale(dispW,dispH)> /MagnaCartaWmImg Do Q`, where `dispW = scale*pageW`, `dispH = dispW * imgH/imgW`, centred (+ tiled grid for `Tiled`). Image + SMask + ExtGState deduped per doc. Malformed image → `GenerateError::Image`.

- [ ] **Step 1: failing tests:** `image_watermark_embeds_xobject` (a generated 2×2 RGBA PNG → output has an Image XObject with an `/SMask`; page count unchanged; a `Do` appears in the appended content); `image_watermark_jpeg_uses_dctdecode` (a tiny JPEG → `/DCTDecode`, no re-encode); `image_watermark_renders` (hayro loads); `image_watermark_bad_bytes_errs`. Generate fixtures in-test with the `image` crate.
- [ ] **Step 2-4:** FAIL → implement → green; clippy + fmt.
- [ ] **Step 5:** commit `feat(pdf-core): image/logo watermark (PNG SMask, JPEG DCTDecode)`.

---

### Task 7: WASM bindings + TS + tests

**Files:** `crates/pdf-core/src/wasm.rs` (`mergeDocuments`/`splitDocument`/`rotatePages`/`watermarkDocument` + `From<GenerateError>`); `packages/pdf/src/index.ts` (wrappers + types); `packages/pdf/test/generate.test.ts`. Rebuild wasm (`pnpm --filter @magna-carta/pdf run build:wasm`).

TS surface:

```ts
mergeDocuments(documents: Uint8Array[]): Promise<{ pdf: Uint8Array }>;
splitDocument(bytes: Uint8Array, ranges: { start: number; end: number }[]): Promise<{ pdfs: Uint8Array[] }>;
rotatePages(bytes: Uint8Array, rotation: 90 | 180 | 270, pages?: number[]): Promise<{ pdf: Uint8Array }>;
watermarkDocument(bytes: Uint8Array, options: WatermarkOptions): Promise<{ pdf: Uint8Array }>;
// WatermarkOptions: { content: { kind: "text", text, font?, fontSizePt?, color? } | { kind: "image", bytes, scale? }, opacity?, rotationDeg?, placement? }
```

- [ ] **Step 1: failing tests** (`generate.test.ts`, wasm loaded via the existing harness): merge two fixtures → page count sums + loads; split → N outputs; rotate → loads; text + image watermark → load. Use the W-9 + a generated PNG.
- [ ] **Step 2-4:** FAIL → implement (Rust adapters + TS) → `cargo test -p pdf-core` green; rebuild wasm; `pnpm --filter @magna-carta/pdf test` green; `pnpm check` clean.
- [ ] **Step 5:** commit `feat(pdf): merge/split/rotate/watermark WASM bindings`.

---

### Task 8: docs + fragments

**Files:** `changelog.d/pdf-generate-primitives.md` (Added); `docs/decisions/pending/pdf-generate-primitives.md` (ADR — the four primitives; full merge; text+image watermark; additive-not-redaction); `packages/pdf/README.md` (a "Generate / assembly" section); `STATUS.md` (append to the PDF-engine row); `ROADMAP.md` (slice-4 generate primitives complete); active-work note status.

- [ ] **Step 1:** write fragments + docs (no process refs in README/consumer strings; additive-not-redaction stated). `pnpm run lint:process-refs` green.
- [ ] **Step 2:** `vp run worktrees` before STATUS/ROADMAP; edit only the PDF-engine row/entry.
- [ ] **Step 3:** commit `docs(pdf-generate): ADR + changelog + README + STATUS/ROADMAP`.

---

### Final: package build + review

- [ ] Whole-crate `cargo test` + clippy `--all-targets -D warnings` + fmt; `pnpm check`; `pnpm --filter @magna-carta/pdf test`; rebuild + size-check the wasm.
- [ ] The end-of-build adversarial review (per `docs/conventions/testing.md`), weighting: merge object-id collisions / dangling refs / dropped pages, form-field name-collision correctness, outline/dest remapping, watermark additivity (removes nothing) + image XObject correctness (SMask alpha, DCTDecode), no panics on malformed input/images.
- [ ] Fix findings; then hand to the owner for the merge call.
