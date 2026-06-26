# AcroForm Support (v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Read, fill, and flatten AcroForms in `crates/pdf-core`, with generated appearances that render in our own engine and a flatten that bakes them into permanent page content.

**Architecture:** New `crates/pdf-core/src/forms.rs`. Reuses surgery's `resolve_inherited_resources`/`resolve_dict`/`resolve_mediabox` (make any not-yet-`pub(crate)` ones so), the `standard_fonts` Helvetica metrics, and the `scrub.rs` AcroForm field-walk pattern.

**Tech Stack:** Rust, lopdf 0.41, hayro 0.7 (tests, to verify appearances render).

## Global Constraints

- Pure-compute: typed `Result`, no logging, no `unwrap`/`panic` on input data outside tests.
- No process references in source/tests/README/consumer strings. Full names. Changelog/ADR via fragments.
- Forms is NOT redaction — never imply it removes hidden content; say so in docs.
- Reuse before building (the resolve_* helpers, the Helvetica metrics, the AcroForm walk).
- Appearance font name in generated streams: `MagnaCartaFormFont` (distinctive).

## Interfaces produced

```rust
pub enum FieldKind { Text, Checkbox, Radio, Choice, PushButton, Signature, Unknown }
pub struct FormField { pub name: String, pub kind: FieldKind, pub value: Option<String>,
    pub options: Vec<String>, pub read_only: bool, pub page: usize, pub rect: Option<[f32;4]> }
pub enum FieldValue { Text(String), Bool(bool), Choice(String) }
pub struct FormFillOptions { pub flatten: bool }            // Default { flatten: false }
pub enum FormError { Parse, Reassemble, NoAcroForm }
pub fn read_form(bytes: &[u8]) -> Result<Vec<FormField>, FormError>;
pub fn fill_form(bytes: &[u8], values: &std::collections::BTreeMap<String, FieldValue>,
    opts: &FormFillOptions) -> Result<Vec<u8>, FormError>;
pub fn flatten_form(bytes: &[u8]) -> Result<Vec<u8>, FormError>;
// internal helpers (pub(crate)) the tasks build:
pub(crate) fn terminal_fields(doc: &lopdf::Document) -> Vec<TerminalField>;  // (Task 1)
pub(crate) fn text_appearance(doc: &mut lopdf::Document, rect: [f32;4], da_size: f32,
    quadding: i64, font_id: lopdf::ObjectId, value: &str) -> lopdf::ObjectId;  // (Task 2)
```

`TerminalField { id: ObjectId, name: String, kind: FieldKind, da_size: f32, quadding: i64, widgets: Vec<ObjectId> }` (Task 1 detail).

---

### Task 1: Read — field enumeration with inheritance

**Files:** Create `crates/pdf-core/src/forms.rs`; modify `lib.rs` (`mod forms;` + re-export `FormField`, `FieldKind`, `FieldValue`, `FormFillOptions`, `FormError`, `read_form`).

Walk `catalog /AcroForm /Fields` depth-first over `/Kids`. Resolve inherited `/FT`, `/Ff`, `/DA`, `/V` from parents (carry them down the walk). A node is a **terminal field** when it has an effective `/FT` and no field-kids (a kid is a *field* if it has `/T`; a kid with only `/Subtype /Widget` and no `/T` is a widget of the same field). `kind` from `/FT`+`/Ff`: `Tx`→Text, `Ch`→Choice, `Sig`→Signature, `Btn`→ PushButton if `/Ff` bit 17 (0x10000) set, Radio if bit 16 (0x8000) set, else Checkbox. Fully-qualified `name` = ancestor `/T` values joined by `.` (decode UTF-16BE strings — a `/T` beginning `\xFE\xFF` is UTF-16BE; else PDFDocEncoding/ASCII). `read_only` = `/Ff` bit 1. `value` = effective `/V` (Name→its text; String→decoded). `options` = `/Opt` (Choice) or the kids' on-state names (Radio). `widgets` = the field id itself if it has `/Rect`, else its widget kids. `page`/`rect` from the first widget: find the page whose deref'd `/Annots` references the widget; `rect` = that widget's `/Rect`.

- [ ] **Step 1: failing tests** (build AcroForms programmatically with lopdf):
  - `reads_text_and_checkbox_fields`: a 1-page doc, AcroForm with a `/Tx` field (`/T (Name)`) and a `/Btn` checkbox (`/T (Agree)`, `/Ff 0`), each a merged widget with `/Rect` referenced from the page `/Annots`. `read_form` returns 2 fields with `FieldKind::Text`/`Checkbox`, the right names, `page == 0`, and a `Some(rect)`.
  - `decodes_utf16_field_name`: a `/T` of `\xFE\xFF\x00N\x00m` decodes to `"Nm"`.
  - `resolves_inherited_field_type`: a parent field with `/FT /Tx` and a child with `/T` but no `/FT` → child resolves as Text.
  - `radio_options_from_kids`: a `/Btn` radio (`/Ff` bit 16) with two widget kids whose `/AP /N` keys are `/A`/`/B` (+ `/Off`) → `options == ["A","B"]`, kind Radio.
  - `no_acroform_returns_empty`: a plain page PDF → `Ok(vec![])`.
- [ ] **Step 2-4:** FAIL → implement → `cargo test -p pdf-core forms::` (from `crates/`) green; whole crate green; clippy `--all-targets -D warnings` + fmt clean.
- [ ] **Step 5:** commit `feat(pdf-core): read AcroForm fields with attribute inheritance`.

---

### Task 2: Appearance generation (text/choice)

**Files:** modify `forms.rs`.

`pub(crate) fn text_appearance(doc, rect, da_size, quadding, font_id, value) -> ObjectId`: build a Form XObject. `w = rect[2]-rect[0]`, `h = rect[3]-rect[1]`. `size = if da_size > 0.0 { da_size } else { (h*0.6).clamp(6.0, 12.0) }` (auto-fit). Measure `value` width with the baked Helvetica metrics (reuse `standard_fonts`/`standard_fonts_data` Helvetica — a `helvetica_text_width(value, size)` helper; if a shared one exists from bates, reuse it, else add one). `tx` from `quadding`: 0→`2.0` (left pad), 1→`(w - width)/2`, 2→`w - width - 2.0`, clamped ≥ 2.0. `ty = (h - size)/2.0 + size*0.2` (baseline). Content (escape `(`,`)`,`\\` in value):
`/Tx BMC q BT /MagnaCartaFormFont <size> Tf 0 g <tx> <ty> Td (<value>) Tj ET Q EMC`.
Dict: `/Type /XObject /Subtype /Form /FormType 1 /BBox [0 0 w h] /Resources << /Font << /MagnaCartaFormFont <font_id> >> >>`. Return the new stream id.

- [ ] **Step 1: failing tests**
  - `appearance_has_value_and_font`: build an appearance for `"Hello"` on a 100×20 rect → the returned object is a Form XObject whose decoded content contains `(Hello) Tj` and references `/MagnaCartaFormFont`, BBox `[0 0 100 20]`.
  - `appearance_auto_sizes_when_da_zero`: `da_size 0.0` → the `Tf` size is within `[6,12]`.
  - `appearance_right_aligns`: `quadding 2` → `tx` ≈ `w - measured_width - 2` (assert the Td x is near the right edge, not 2.0).
  - `appearance_escapes_parens`: value `"a(b)"` → content contains `a\(b\)`.
- [ ] **Step 2-4:** FAIL → implement → green; clippy + fmt.
- [ ] **Step 5:** commit `feat(pdf-core): generate AcroForm text-field appearances`.

---

### Task 3: Fill

**Files:** modify `forms.rs`.

`fill_form(bytes, values, opts)`: `load_mem` (→Parse); if no AcroForm → `NoAcroForm`. Add ONE shared Helvetica font object (reuse the bates approach). Build the `name → TerminalField` map (Task 1). For each `(name, FieldValue)` present:
- **Text/Choice** (`FieldValue::Text`/`Choice`): set the field's `/V` (string). For each widget, generate `text_appearance(...)` (font_id shared) and set the widget `/AP` `/N` to it. (Choice: same text appearance for the selected value.)
- **Checkbox** (`FieldValue::Bool`): determine the on-state name = the non-`Off` key of the widget's `/AP /N` dict (default `/Yes`). `true` → set field `/V` and each widget `/AS` to the on-state; `false` → both `/Off`.
- **Radio** (`FieldValue::Choice(state)`): set field `/V` to `/state`; each kid widget `/AS` to `/state` if the kid's `/AP /N` has that key, else `/Off`.
- **PushButton/Signature/Unknown**: no-op.
Set AcroForm `/NeedAppearances` to `false`. If `opts.flatten`, call `flatten_form` on the serialized bytes (Task 4) and return that; else `save_to` (→Reassemble).

- [ ] **Step 1: failing tests**
  - `fills_text_field_value_renders`: programmatic text-field AcroForm → `fill_form` with `Text("ACME")` → reload + observe (hayro) → render contains `"ACME"`; the field `/V` is set.
  - `checks_checkbox_sets_state`: checkbox with `/AP /N` keys `/Yes`,`/Off` → `Bool(true)` → field `/V` and widget `/AS` are `/Yes`; `Bool(false)` → `/Off`.
  - `selects_radio_kid`: radio with kids on-states `/A`,`/B` → `Choice("A")` → field `/V == /A`, the `/A` kid `/AS == /A`, the `/B` kid `/AS == /Off`.
  - `unknown_field_name_is_noop`: filling a name not in the form succeeds and changes nothing.
- [ ] **Step 2-4:** FAIL → implement → green; clippy + fmt.
- [ ] **Step 5:** commit `feat(pdf-core): fill AcroForm text, choice, checkbox, and radio fields`.

---

### Task 4: Flatten

**Files:** modify `forms.rs`.

`flatten_form(bytes)`: `load_mem` (→Parse). For each page (`get_pages`), deref `/Annots` (inline array OR indirect reference — MUST deref). For each annotation whose `/Subtype` is `/Widget` and which has an `/AP`:
- Pick the appearance stream id: if `/AP /N` is a dictionary of states (button), the substream keyed by the widget `/AS` (skip if absent); else `/AP /N` directly (a reference to a stream).
- Read the appearance `BBox` and optional `/Matrix`; compute `cm` mapping the (matrix-transformed) BBox onto the widget `/Rect` (translate to `rect` origin + scale `rect_w/bbox_w`, `rect_h/bbox_h`). Append `q <a> <b> <c> <d> <e> <f> cm /<name> Do Q` to the page content (a new stream pushed last). Add the appearance stream to the page effective `/Resources /XObject` under a fresh name, **non-destructively** (deref via `resolve_inherited_resources`/`resolve_dict`, clone, set page-level — the Bates pattern).
- Mark the widget annotation for removal.
After processing a page: rebuild `/Annots` keeping only the non-removed (non-widget) annotations; remove `/Annots` if empty. Finally remove `/AcroForm` and `/NeedAppearances` from the catalog. `save_to` (→Reassemble).

- [ ] **Step 1: failing tests**
  - `flatten_bakes_value_and_drops_form`: a filled text-field AcroForm (use Task 3 output or build one with an `/AP`) → `flatten_form` → reload: `read_form` returns empty (no AcroForm), no page has widget `/Annots`, and observe renders the value.
  - `flatten_keeps_non_widget_annotations`: a page with a `/Widget` (with `/AP`) AND a `/Link` annotation → after flatten, the `/Link` remains in `/Annots`, the widget is gone.
  - `flatten_scales_bbox_to_rect`: an appearance with `BBox [0 0 10 10]` on a `Rect` `[100 100 300 140]` → the appended `cm` scales by `(20, 4)` and translates to `(100,100)` (assert the operands).
- [ ] **Step 2-4:** FAIL → implement → green; clippy + fmt.
- [ ] **Step 5:** commit `feat(pdf-core): flatten AcroForm widget appearances into page content`.

---

### Task 5: Integration + end-to-end + self-cross-check

**Files:** modify `forms.rs`, `lib.rs` (confirm exports).

Confirm `fill_form` honors `opts.flatten` (fill→flatten in one). Add the W-9 end-to-end + self-cross-check tests using `crates/pdf-eval/corpus-ci/gov_irs_w9_acroform.pdf`.

- [ ] **Step 1: tests**
  - `w9_read_lists_text_fields`: `read_form(W9)` returns multiple `Text` fields.
  - `w9_fill_and_flatten_end_to_end`: pick a W-9 text field name (from `read_form`), `fill_form` with `{name: Text("SPIKE")}` and `opts.flatten = true` → output renders `"SPIKE"` (observe) AND `read_form(output)` is empty (form dropped) — the self-cross-check.
- [ ] **Step 2-4:** FAIL/adjust → green; whole crate `cargo test -p pdf-core`; clippy + fmt.
- [ ] **Step 5:** commit `feat(pdf-core): fill-and-flatten in one pass + W-9 end-to-end`.

---

### Task 6: wasm edge, TypeScript, README, ADR + changelog fragments, ROADMAP/STATUS

**Files:** `crates/pdf-core/src/wasm.rs`, `packages/pdf/src/index.ts`, `packages/pdf/README.md`, `docs/decisions/pending/pdf-forms.md`, `changelog.d/pdf-forms.md`, `ROADMAP.md`, `STATUS.md` (own rows).

- `wasm.rs`: `readForm(bytes) -> JsValue` (array of `{ name, kind, value, options, readOnly, page, rect }`, `kind` a lowercase string); `fillForm(bytes, values, options) -> { pdf }` where `values` is an object `{ [name]: string | boolean }` (string→Text/Choice, boolean→Checkbox; radio on-state as string) mapped to `FieldValue`; `options` carries `flatten?`; `flattenForm(bytes) -> { pdf }`. Add `From<FormError> for JsError`. Numeric JS values via `f64` (the serde-wasm-bindgen u64-as-BigInt gotcha does not apply here, but keep numbers as `f64`).
- `index.ts`: `FieldKind` union, `FormField` interface, `FormFillValues = Record<string, string | boolean>`, `FormFillOptions { flatten?: boolean }`, and `readForm`/`fillForm`/`flattenForm`. JSDoc: forms is not redaction.
- `README.md`: a "Forms" section — read/fill/flatten, the four supported field types, the not-redaction note, and the boundaries (Helvetica appearances, single-line, no XFA/signature/rich-text).
- ADR fragment `pdf-forms.md` (`slug`,`status: Accepted`,`area: Documents`,`date: 2026-06-25`,`summary`): generated-appearance fill (no NeedAppearances reliance) + flatten-into-content + AcroForm-only scope.
- changelog `pdf-forms.md`: concise; real test count; not-redaction note.

- [ ] **Step 1:** build wasm; extend JS tests with a `readForm`/`fillForm`(+flatten) round trip on the W-9; run JS tests.
- [ ] **Step 2:** README ↔ index.ts ↔ wasm agree on kind strings + field names; process-ref scan.
- [ ] **Step 3:** commit `feat(pdf): expose AcroForm read/fill/flatten + docs`.

## Self-Review

- Coverage: read (T1), appearance gen (T2), fill all four kinds (T3), flatten (T4), fill+flatten + W-9 e2e + self-cross-check (T5), surface + docs (T6). Signature/pushbutton read-only; XFA/rich-text/`/MK` deferred.
- Type consistency: `FormField`/`FieldKind`/`FieldValue`/`FormFillOptions`/`FormError` defined in T1, used unchanged after. `MagnaCartaFormFont` is the single appearance font name.
- Honesty: forms-not-redaction stated in ADR/README/JSDoc; boundaries disclosed.
