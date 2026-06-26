# AcroForm Support (v1) — Design

**Status:** Design (feasibility spike GO, commit `fee83a5`).
**Branch:** pdf-engine-forms (off merged main).
**Reuse:** the `scrub.rs` AcroForm `/Fields`→`/Kids` walk; surgery's `resolve_inherited_resources`/`resolve_dict`/`resolve_mediabox` (deref + inheritance); the baked Helvetica metrics (`standard_fonts`); the additive-overlay content-append pattern from `bates.rs`.

## Goal

Read, fill, and flatten interactive PDF AcroForms — so a firm can complete a court/government
form and produce a permanent, everywhere-renderable document. The spike proved the crux: a
generated `/AP` appearance renders in our own engine (no `NeedAppearances` reliance), and
flattening bakes appearances into the page and drops the form.

Forms is **not redaction** — filling sets visible values and flattening makes them permanent;
neither removes hidden content (use `redact`/`sanitize` for that). Stated in all docs.

## The three operations

```rust
pub fn read_form(bytes: &[u8]) -> Result<Vec<FormField>, FormError>;
pub fn fill_form(bytes: &[u8], values: &BTreeMap<String, FieldValue>, opts: &FormFillOptions)
    -> Result<Vec<u8>, FormError>;
pub fn flatten_form(bytes: &[u8]) -> Result<Vec<u8>, FormError>;
```

`FormFillOptions { flatten: bool }` lets a caller fill-and-flatten in one pass.

## Types

```rust
pub enum FieldKind { Text, Checkbox, Radio, Choice, PushButton, Signature, Unknown }
pub struct FormField {
    pub name: String,            // fully-qualified (parent.child via /T), UTF-16BE decoded
    pub kind: FieldKind,
    pub value: Option<String>,   // current /V (button: the on-state name or "Off")
    pub options: Vec<String>,    // choice /Opt entries; radio: the kids' on-state names
    pub read_only: bool,         // /Ff bit 1
    pub page: usize,             // 0-based page of the (first) widget
    pub rect: Option<[f32; 4]>,  // the (first) widget /Rect, display points
}
pub enum FieldValue { Text(String), Bool(bool), Choice(String) }
pub enum FormError { Parse, Reassemble, NoAcroForm }
```

`read_form` returns an empty vec (not an error) for a PDF with no AcroForm; `fill_form`/`flatten_form`
return `NoAcroForm` only if asked to act on a document that has none.

## Field model (read)

Walk `catalog /AcroForm /Fields` depth-first over `/Kids`. A node is a **terminal field** when it
has an `/FT` (field type) and no field `/Kids` (or its kids are pure widgets). Resolve inherited
`/FT`, `/Ff`, `/DA`, `/V` from parent fields (AcroForm attribute inheritance). Field kind from
`/FT` + `/Ff`: `Tx`→Text; `Ch`→Choice; `Btn` split by `/Ff` — pushbutton (bit 17), radio (bit 16),
else checkbox; `Sig`→Signature. The fully-qualified name joins ancestor `/T` values with `.`.
A terminal field's widget(s): the field dict itself if it has `/Rect` (merged), else its `/Kids`
widget annotations. `page` is found by which page's `/Annots` references the widget.

## Fill

Per requested `(name → FieldValue)`, resolve the terminal field, then by kind:

- **Text / Choice** — set `/V` (a PDF string); **generate the `/AP` `/N` appearance**: a Form XObject
  `/Tx BMC q BT /<font> <size> Tf <color> <tx> <ty> Td (<escaped value>) Tj ET Q EMC`, `BBox` sized to
  the widget rect, `/Resources /Font /<font>` → Helvetica. The font + size + color come from the field
  `/DA` (default appearance string; size `0` = auto-fit to the rect height); the font is always
  Helvetica in v1 (base-14 — we only have those metrics, and they render natively). Horizontal
  alignment from `/Q` (0 left, 1 centre, 2 right) using the baked Helvetica width to measure the value.
  Combo/choice shows the selected value as text; multi-select list is deferred.
- **Checkbox** — `FieldValue::Bool`. The widget's `/AP /N` already holds an `/Off` state and one
  "on" state (the non-`Off` key). To check: set field `/V` and widget `/AS` to the on-state name; to
  uncheck: both to `/Off`. No appearance generation — the states already exist.
- **Radio** — `FieldValue::Choice(on_state)`. Set field `/V` to the chosen on-state; set each kid
  widget's `/AS` to that state if the kid has it, else `/Off`. Appearances exist.
- **PushButton / Signature** — not fillable; ignored (a fill request naming one is a no-op, reported).

Set the AcroForm `/NeedAppearances` to false (we generated real appearances). Resource merge for the
appearance font is self-contained in the generated Form XObject, so page resources are untouched by
fill (only flatten touches page resources).

## Flatten (proven)

For each page (`get_pages`), deref `/Annots` (inline array **or** indirect reference — the spike's one
bug), and for each **widget** annotation (`/Subtype /Widget`) that has an `/AP /N`:

- Select the appearance stream: for a button, the substream keyed by the widget's `/AS`; otherwise the
  `/N` stream directly.
- Draw it into the page content: append `q <cm> /<name> Do Q`, where `<cm>` maps the appearance `BBox`
  (after its optional `/Matrix`) onto the widget `/Rect` (translate + scale). Add the appearance stream
  to the page `/Resources /XObject` under a fresh name — **non-destructively** (deref the effective
  resources, clone, add — the Bates pattern). The appended content draws on top.
- Remove the flattened widget annotations from `/Annots` (keep non-widget annotations such as links);
  if no widget annotations remain, remove `/Annots` entirely.

Then drop `/AcroForm` (and `/NeedAppearances`) from the catalog. The result renders the field values as
permanent static content with no interactive form.

## Boundaries (disclosed)

- Appearances are Helvetica only (base-14); a field's `/DA` font choice other than a standard font is
  rendered in Helvetica at the `/DA` size. Multiline and rich-text (`/RV`) appearances are single-line
  in v1. Field `/MK` border/background styling is not drawn by generated appearances (existing state
  appearances keep their own).
- Checkbox/radio rely on the field's existing state appearances; a field missing its on/off appearance
  streams is filled at the value level (`/V`/`/AS`) but may not show until flattened by a viewer that
  synthesizes — our flatten only bakes appearances that exist.
- Signature and pushbutton fields are read-only to fill; flatten still bakes any appearance they carry.
- XFA forms are out of scope (the engine's `scrub` already drops `/XFA`); these are AcroForm-only.

## Self-cross-validation

A fill→flatten round trip, re-read with `read_form`, reports **no AcroForm** and the value renders
(observe via the `textpos` device, as the spike checks). A plain `read_form` on a flattened output
returns an empty field list. This is the forms analogue of the redaction↔detector reciprocal.

## API surface

- **Rust** (`crates/pdf-core/src/forms.rs`): the functions + types above, re-exported from `crate::`.
- **wasm / TS** (`packages/pdf`): `readForm(bytes) → FormFieldJson[]`, `fillForm(bytes, values, options)
  → { pdf }`, `flattenForm(bytes) → { pdf }`. `values` is `{ [name]: string | boolean }` (string →
  Text/Choice, boolean → Checkbox; radio takes the on-state string). `options` carries `flatten?`.
  JSDoc states forms is not redaction.

## Testing

- **Read:** the W-9 fixture → fields enumerated with the right kinds; a non-form PDF → empty vec.
- **Fill (per kind):** programmatic AcroForm fixtures (text, checkbox, radio, choice) — after fill, the
  value renders (text/choice via observe; checkbox/radio via the selected `/AS` + the state appearance);
  `/DA` size + `/Q` alignment honored (assert the appearance content / measured position).
- **Flatten:** fill then flatten → `read_form` reports no AcroForm, no widget `/Annots` remain, the
  values render as static content (observe); non-widget annotations (a link) survive.
- **End-to-end (W-9):** fill a text field + a checkbox, flatten, re-render → values present, no form.
- **Inheritance:** a field inheriting `/FT`/`/DA` from a parent resolves correctly.

## What this is not (v1)

- Not redaction or sanitization (additive/value edits only).
- Not XFA, not digital-signature creation, not multiline/rich-text appearances, not `/MK` styling.
- The encryption/permissions ("secure") half is a separate later slice.
