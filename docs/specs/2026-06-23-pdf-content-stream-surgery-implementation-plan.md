# Content-Stream Surgery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a caller-selected text-preserving redaction route that excises detector-marked glyphs from a page's content stream — leaving the rest of the page as live, selectable text — with an outcome-based per-page gate that falls back to the existing image-flatten path whenever removal cannot be confirmed.

**Architecture:** New `crates/pdf-core/src/surgery.rs` computes each page-content glyph's display-point position and byte location from a single content-stream walk (graphics + text state machine), marks glyphs inside the redaction rectangles, excises their bytes with advance-preserving `TJ` compensation, and draws opaque redaction boxes. `redact()` gains a `RedactionMode`; in `Surgery` mode each affected page is attempted and any page failing the gate is flattened via the existing path. The whole-document scrub and final verification gate are unchanged.

**Tech Stack:** Rust (pdf-core), lopdf 0.41 (content model + `Content::decode`/`encode`), hayro 0.7 (the `textpos` observing Device, for the outcome gate only), wasm-bindgen edge, TypeScript wrapper.

## Global Constraints

- Pure-compute engine: typed `Result`, **no logging**, no happy-path `panic!`/`unwrap` on input-derived data. Same conventions as `redact.rs`/`detect.rs`. (CLAUDE.md golden rule 4/10)
- Full names — no shorthand: `data-access layer` etc.; here, spell identifiers fully (`bytes_per_code`, not `bpc`, in code). (golden rule 12)
- **No process references** in source/tests/README/consumer strings — no "ADR-NNNN", "slice N", "Phase N", "spike", "Task N". State reasoning inline or cite a file by path. (golden rule 13; CI `lint:process-refs`)
- Changelog + ADR via **fragments only** (`changelog.d/<slug>.md`, `docs/decisions/pending/<slug>.md`); never hand-edit rendered `CHANGELOG.md`/Decision-Log on a branch. (golden rule 5)
- Latest library APIs, verified against source (lopdf 0.41, hayro 0.7 — already in `crates/pdf-core/Cargo.toml`).
- Redaction `Rect` convention (existing): display **points**, bottom-left origin, corner-order-tolerant. Reuse `redact::Rect`.
- Default behavior unchanged when `mode` is unspecified: `RedactionMode::Flatten`, and `redact()`'s existing observable outputs for flatten must not change.

## Interfaces produced (cross-task reference)

```rust
// surgery.rs
pub(crate) enum FontMetrics {
    Supported { bytes_per_code: usize, widths: std::collections::BTreeMap<u32, f32>, default_width: f32 },
    Unsupported,
}
pub(crate) fn page_fonts(doc: &lopdf::Document, page_id: lopdf::ObjectId)
    -> std::collections::BTreeMap<Vec<u8>, FontMetrics>;

pub(crate) struct GlyphSlot {
    pub op: usize,               // index into Content.operations
    pub elem: Option<usize>,     // Some(i) = i-th element of a TJ array; None = Tj/'/" operand
    pub byte_off: usize,         // offset of this code within the operand string bytes
    pub byte_len: usize,         // 1 (simple) or 2 (Type0 Identity)
    pub code: u32,               // glyph code / CID
    pub cx: f32, pub cy: f32,    // display-point centre (bottom-left origin)
    pub font: Vec<u8>,           // active font resource name
    pub font_size: f32,          // Tfs in effect
    pub char_spacing: f32,       // Tc
    pub word_spacing: f32,       // Tw
}
// Err(()) = page uses something the walk cannot reconstruct -> caller falls back.
pub(crate) fn enumerate_page_glyphs(
    content: &lopdf::content::Content,
    fonts: &std::collections::BTreeMap<Vec<u8>, FontMetrics>,
    page_height_pt: f32,
) -> Result<Vec<GlyphSlot>, ()>;

pub(crate) fn mark_in_rects(slots: &[GlyphSlot], rects: &[redact::Rect]) -> Vec<usize>;

// Rewrites the marked glyphs' operators (Tj/TJ/'/") removing their code bytes and
// inserting advance-preserving TJ adjustments, then appends opaque redaction boxes.
pub(crate) fn apply_excision(
    content: &mut lopdf::content::Content,
    slots: &[GlyphSlot],
    marked: &[usize],
    rects: &[redact::Rect],
);

// None = this page must fall back to flatten. Some(bytes) = edited content stream.
pub(crate) fn try_build_surgery(
    doc: &lopdf::Document,
    page_id: lopdf::ObjectId,
    rects: &[redact::Rect],
    page_height_pt: f32,
) -> Option<Vec<u8>>;

// redact.rs
pub enum RedactionMode { Flatten, Surgery }   // Default = Flatten
// RedactionOptions gains:  pub mode: RedactionMode,
// RedactionReport gains:   pub pages_surgered: Vec<usize>,  pub pages_flattened: Vec<usize>,
```

**Reuse (make `pub(crate)` in `detect.rs`):** `to_display_rect(kurbo::Rect, f32) -> redact::Rect` (`detect.rs:44`) and `rect_contains(&Rect, f32, f32) -> bool` (`detect.rs:394`). These are shared geometry — do not duplicate. The detector's `Rect` is already `redact::Rect` (see `detect.rs:36`).

---

### Task 1: Font metrics — bytes-per-code and per-code advance widths

**Files:**
- Create: `crates/pdf-core/src/surgery.rs`
- Modify: `crates/pdf-core/src/lib.rs` (add `mod surgery;`)

**Interfaces:** Produces `FontMetrics`, `page_fonts` (signatures above).

Width values are in glyph-space thousandths (the PDF `/Widths` unit). Rules:
- **Simple font** (`/Subtype` Type1/TrueType/MMType1/Type0-absent): `bytes_per_code = 1`. Read `/FirstChar` (int) and `/Widths` (array of numbers); `widths[FirstChar + i] = Widths[i]`. `default_width` = `/MissingWidth` from `/FontDescriptor` if present else `0.0`. If `/Widths` is absent → `Unsupported`.
- **Type0** (`/Subtype` = `Type0`): `/Encoding` must be `Object::Name(b"Identity-H")` or `b"Identity-V"`; any other encoding → `Unsupported`. `bytes_per_code = 2`. Resolve `/DescendantFonts` (array; first element, a reference) → descendant dict; read `/DW` (default width, default `1000.0`) and `/W`. Parse `/W` in both forms: `c [w1 w2 …]` (consecutive CIDs from `c`) and `c_first c_last w` (range gets one width). `default_width = DW`.
- **Type3** or any other subtype → `Unsupported`.

Resolve references with a local `resolve_dict` helper (follow `Object::Reference` via `doc.get_object`; accept `Dictionary` or `Stream.dict`) — same shape as the spike (`spikes/surgery-feasibility/src/main.rs`). Reuse it across tasks.

- [ ] **Step 1: Write failing tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::{dictionary, Document, Object};

    fn doc_with_font(font: lopdf::Dictionary) -> (Document, lopdf::ObjectId) {
        let mut d = Document::with_version("1.5");
        let fid = d.add_object(font);
        let fonts = dictionary! { "F0" => Object::Reference(fid) };
        let res = dictionary! { "Font" => fonts };
        let page = d.add_object(dictionary! { "Type" => "Page", "Resources" => res });
        (d, page)
    }

    #[test]
    fn simple_font_widths_by_code() {
        let font = dictionary! {
            "Type" => "Font", "Subtype" => "Type1",
            "FirstChar" => 65, "Widths" => vec![Object::Integer(500), Object::Integer(600)],
        };
        let (d, page) = doc_with_font(font);
        let fonts = page_fonts(&d, page);
        match fonts.get(b"F0".as_ref()).unwrap() {
            FontMetrics::Supported { bytes_per_code, widths, default_width } => {
                assert_eq!(*bytes_per_code, 1);
                assert_eq!(widths.get(&65), Some(&500.0));
                assert_eq!(widths.get(&66), Some(&600.0));
                assert_eq!(*default_width, 0.0);
                assert_eq!(widths.get(&67), None);
            }
            _ => panic!("expected Supported"),
        }
    }

    #[test]
    fn type0_identity_widths_and_two_byte_codes() {
        // Descendant CIDFont with W = [1 [500 600]] and DW 1000.
        let mut d = Document::with_version("1.5");
        let desc = d.add_object(dictionary! {
            "Type" => "Font", "Subtype" => "CIDFontType2", "DW" => 1000,
            "W" => vec![Object::Integer(1), Object::Array(vec![Object::Integer(500), Object::Integer(600)])],
        });
        let font = dictionary! {
            "Type" => "Font", "Subtype" => "Type0", "Encoding" => "Identity-H",
            "DescendantFonts" => vec![Object::Reference(desc)],
        };
        let fid = d.add_object(font);
        let page = d.add_object(dictionary! {
            "Type" => "Page",
            "Resources" => dictionary! { "Font" => dictionary! { "F0" => Object::Reference(fid) } },
        });
        match page_fonts(&d, page).get(b"F0".as_ref()).unwrap() {
            FontMetrics::Supported { bytes_per_code, widths, default_width } => {
                assert_eq!(*bytes_per_code, 2);
                assert_eq!(widths.get(&1), Some(&500.0));
                assert_eq!(widths.get(&2), Some(&600.0));
                assert_eq!(*default_width, 1000.0);
            }
            _ => panic!("expected Supported"),
        }
    }

    #[test]
    fn type0_nonidentity_encoding_is_unsupported() {
        let mut d = Document::with_version("1.5");
        let desc = d.add_object(dictionary! { "Type" => "Font", "Subtype" => "CIDFontType0" });
        let font = dictionary! {
            "Type" => "Font", "Subtype" => "Type0", "Encoding" => "GBK-EUC-H",
            "DescendantFonts" => vec![Object::Reference(desc)],
        };
        let fid = d.add_object(font);
        let page = d.add_object(dictionary! {
            "Type" => "Page",
            "Resources" => dictionary! { "Font" => dictionary! { "F0" => Object::Reference(fid) } },
        });
        assert!(matches!(page_fonts(&d, page).get(b"F0".as_ref()).unwrap(), FontMetrics::Unsupported));
    }

    #[test]
    fn type3_is_unsupported() {
        let font = dictionary! { "Type" => "Font", "Subtype" => "Type3" };
        let (d, page) = doc_with_font(font);
        assert!(matches!(page_fonts(&d, page).get(b"F0".as_ref()).unwrap(), FontMetrics::Unsupported));
    }
}
```

- [ ] **Step 2:** Run `cargo test -p pdf-core surgery::tests::` — expect FAIL (module/functions missing).
- [ ] **Step 3:** Implement `resolve_dict`, `page_fonts`, `FontMetrics`, the `/W` parser. Add `mod surgery;` to `lib.rs`.
- [ ] **Step 4:** Run the tests — expect PASS. `cargo clippy -p pdf-core --all-targets` + `cargo fmt` clean.
- [ ] **Step 5:** Commit `feat(pdf-core): surgery font metrics — bytes-per-code and advance widths`.

---

### Task 2: Position-tracking glyph enumeration

**Files:**
- Modify: `crates/pdf-core/src/surgery.rs`
- Modify: `crates/pdf-core/src/detect.rs` (make `to_display_rect`, `rect_contains` `pub(crate)`)

**Interfaces:** Consumes `FontMetrics`/`page_fonts`. Produces `GlyphSlot`, `enumerate_page_glyphs`.

The walk maintains: a CTM stack (`Vec<kurbo::Affine>`, push on `q`, pop on `Q`, pre-multiply on `cm`), the text matrix `Tm` and line matrix `Tlm` (`kurbo::Affine`), and text state `font`, `font_size`, `char_spacing`, `word_spacing`, `horiz_scale` (`Tz`/100, default 1.0), `leading` (`TL`), `rise` (`Ts`). Operators handled: `q Q cm BT ET Tm Td TD T* Tc Tw Tz TL Ts Tr Tf Tj TJ ' "`. Any **other operator that is not in a known-ignorable set while text would be shown** does not by itself fail — only an unsupported *font actually showing text*, an unbalanced `Q` (pop on empty stack), or a show op under a font with no metrics entry → `Err(())`.

Per glyph code in a show string (split the operand bytes into `bytes_per_code`-sized codes):
- text-space glyph origin = `Tm` applied to `(0, rise)`.
- horizontal advance in text space (before `Tz`): `w = widths.get(code).unwrap_or(default_width)` (glyph-space/1000); `adv = (w/1000.0 * font_size + char_spacing + word_spacing_if_applicable)`. `word_spacing` applies only when `bytes_per_code == 1` and `code == 32`.
- the post-glyph `Tm` update: translate `Tm` by `(adv * horiz_scale, 0)` in text space, i.e. `Tm = Tm * Affine::translate((adv * horiz_scale as f64, 0.0))`.
- `TJ` numeric elements `n` adjust before the next glyph: `Tm = Tm * Affine::translate((-n/1000.0 * font_size * horiz_scale, 0.0))`.
- display point of the glyph: device point = `CTM * Tm_origin`; convert with `to_display_rect`-style y-flip using `page_height_pt`. Compute the glyph's centre as origin advanced by half its own advance horizontally and half `font_size` vertically (cap-height approximation): `cx = device_x + (adv*horiz_scale/2)`-mapped, `cy` mapped from `device_y + font_size*0.35`. (Approximate centre is acceptable — the outcome gate in Task 5 is the safety net; this only decides marking.) Record `byte_off`/`byte_len`/`elem`/`op`.

`Td (tx ty)`: `Tlm = Tlm * translate(tx,ty); Tm = Tlm`. `TD`: also sets `leading = -ty`. `T*`: `Td(0, -leading)`. `'`: `T*` then show. `"` (aw ac string): `word_spacing=aw; char_spacing=ac; T*`? — no: `"` does `T*`-equivalent line move then show with the set spacings; follow the operator's two leading numbers as `Tw`,`Tc`, then a `'`. `Tm (a b c d e f)`: `Tm = Tlm = Affine::new([a,b,c,d,e,f])`.

- [ ] **Step 1: Write failing tests** (use `lopdf::content::{Content, Operation}` built in code; `Object::string_literal` for strings; `Object::Real`/`Integer` for numbers):

```rust
fn simple_fonts() -> std::collections::BTreeMap<Vec<u8>, FontMetrics> {
    let mut m = std::collections::BTreeMap::new();
    let mut widths = std::collections::BTreeMap::new();
    widths.insert(b'A' as u32, 500.0);
    widths.insert(b'B' as u32, 500.0);
    m.insert(b"F0".to_vec(), FontMetrics::Supported { bytes_per_code: 1, widths, default_width: 0.0 });
    m
}

#[test]
fn enumerates_two_glyphs_with_positions() {
    // BT /F0 10 Tf 100 700 Td (AB) Tj ET  on a 792-pt-tall page.
    let ops = vec![
        Operation::new("BT", vec![]),
        Operation::new("Tf", vec![Object::Name(b"F0".to_vec()), 10.into()]),
        Operation::new("Td", vec![100.into(), 700.into()]),
        Operation::new("Tj", vec![Object::string_literal("AB")]),
        Operation::new("ET", vec![]),
    ];
    let content = Content { operations: ops };
    let slots = enumerate_page_glyphs(&content, &simple_fonts(), 792.0).unwrap();
    assert_eq!(slots.len(), 2);
    assert_eq!(slots[0].code, b'A' as u32);
    assert_eq!(slots[0].byte_off, 0);
    assert_eq!(slots[1].byte_off, 1);
    // 'A' origin x≈100; 'B' origin x≈100 + 500/1000*10 = 105.
    assert!((slots[0].cx - (100.0 + 2.5)).abs() < 0.6);   // centre = origin + half-advance(2.5)
    assert!((slots[1].cx - (105.0 + 2.5)).abs() < 0.6);
    // display y (bottom-left origin) near 700 + rise/centre offset.
    assert!((slots[0].cy - (700.0 + 3.5)).abs() < 1.0);
}

#[test]
fn tj_kerning_advances_following_glyph() {
    // [(A) -100 (B)] TJ : the -100 adds +1.0 pt (100/1000*10) before B.
    let ops = vec![
        Operation::new("BT", vec![]),
        Operation::new("Tf", vec![Object::Name(b"F0".to_vec()), 10.into()]),
        Operation::new("Td", vec![0.into(), 0.into()]),
        Operation::new("TJ", vec![Object::Array(vec![
            Object::string_literal("A"), Object::Integer(-100), Object::string_literal("B"),
        ])]),
        Operation::new("ET", vec![]),
    ];
    let slots = enumerate_page_glyphs(&Content { operations: ops }, &simple_fonts(), 792.0).unwrap();
    assert_eq!(slots.len(), 2);
    assert_eq!(slots[1].elem, Some(2));
    // B origin = A origin(0) + advance(5.0) + kern(1.0) = 6.0; centre +2.5.
    assert!((slots[1].cx - (6.0 + 2.5)).abs() < 0.6);
}

#[test]
fn unsupported_font_showing_text_errors() {
    let mut fonts = simple_fonts();
    fonts.insert(b"F9".to_vec(), FontMetrics::Unsupported);
    let ops = vec![
        Operation::new("BT", vec![]),
        Operation::new("Tf", vec![Object::Name(b"F9".to_vec()), 10.into()]),
        Operation::new("Tj", vec![Object::string_literal("A")]),
        Operation::new("ET", vec![]),
    ];
    assert!(enumerate_page_glyphs(&Content { operations: ops }, &fonts, 792.0).is_err());
}

#[test]
fn cm_scaling_moves_positions() {
    // 2x scale via cm before the text: origin x doubles.
    let ops = vec![
        Operation::new("cm", vec![2.into(), 0.into(), 0.into(), 2.into(), 0.into(), 0.into()]),
        Operation::new("BT", vec![]),
        Operation::new("Tf", vec![Object::Name(b"F0".to_vec()), 10.into()]),
        Operation::new("Td", vec![50.into(), 100.into()]),
        Operation::new("Tj", vec![Object::string_literal("A")]),
        Operation::new("ET", vec![]),
    ];
    let slots = enumerate_page_glyphs(&Content { operations: ops }, &simple_fonts(), 792.0).unwrap();
    assert!((slots[0].cx - (100.0 + 2.5 * 2.0)).abs() < 1.0); // origin 50*2=100; advance also scaled
}
```

- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3:** Implement the state machine + `to_display_rect`/`rect_contains` visibility change. Verify the exact display-point y-flip against `detect.rs:44`.
- [ ] **Step 4:** Run — expect PASS; clippy + fmt clean.
- [ ] **Step 5:** Commit `feat(pdf-core): surgery glyph enumeration with text-state positions`.

---

### Task 3: Marking, excision with advance compensation, and redaction boxes

**Files:** Modify `crates/pdf-core/src/surgery.rs`.

**Interfaces:** Consumes `GlyphSlot`. Produces `mark_in_rects`, `apply_excision`.

`mark_in_rects`: return indices of slots whose `(cx, cy)` satisfies `rect_contains(rect, cx, cy)` for any rect.

`apply_excision`: for each operation that has ≥1 marked glyph, rebuild it as a `TJ`:
- Walk the operand's codes in order; accumulate kept code bytes into the current string fragment; when a marked code is dropped, flush the current fragment as an `Object::String`, accumulate the dropped run's compensation, and emit an `Object::Real(n)` where `n = -(sum over dropped glyphs of (w + (char_spacing + word_spacing_term) * 1000.0 / font_size))`, with `w` the glyph width (glyph-space/1000) and `word_spacing_term` applied only for a 1-byte code 32. (For `char_spacing == 0 && word_spacing == 0`, `n = -sum(w)` exactly.) Preserve existing `TJ` numeric elements that are not part of a dropped run.
- Replace the operation's `operator` with `"TJ"` and `operands` with `[Object::Array(rebuilt)]`. (A `'`/`"` becomes the line-move semantics + a `TJ`: emit the line move as a preceding `T*` operation when the original was `'`/`"`, then the `TJ`. Insert the extra operation by rebuilding `content.operations` rather than mutating in place.)
- After processing all operations, append redaction boxes once: for each rect, append `q`, `0 0 0 rg` (`Operation::new("rg", [0,0,0])`), `re` with `[x0, y0, x1-x0, y1-y0]` (normalized corners, display points), `f`, `Q`. These draw opaque black rectangles in page space so the redaction is visibly marked and any sub-glyph remnant is covered.

Process operations’ operands right-to-left within a string when computing byte spans is unnecessary here because the whole operand is rebuilt from `GlyphSlot` byte spans — but the slots for one operand must be grouped and applied together. Group `marked` by `(op, elem)` before rebuilding.

- [ ] **Step 1: Write failing tests:**

```rust
#[test]
fn excise_first_of_two_inserts_compensating_advance() {
    // "(AB) Tj", drop A (width 500). Expect TJ [ -500.0 (B) ] (Tc=Tw=0).
    let ops = vec![ /* BT, Tf F0 10, Td 0 0, Tj (AB), ET as in Task 2 */ ];
    let mut content = Content { operations: ops };
    let slots = enumerate_page_glyphs(&content, &simple_fonts(), 792.0).unwrap();
    apply_excision(&mut content, &slots, &[0], &[]); // mark index 0 = 'A'
    // find the rebuilt TJ
    let tj = content.operations.iter().find(|o| o.operator == "TJ").unwrap();
    if let Object::Array(arr) = &tj.operands[0] {
        assert!(matches!(arr[0], Object::Real(n) if (n + 500.0).abs() < 0.01));
        assert!(matches!(&arr[1], Object::String(s, _) if s == b"B"));
    } else { panic!("expected TJ array"); }
}

#[test]
fn excise_draws_redaction_box() {
    let mut content = Content { operations: vec![] };
    apply_excision(&mut content, &[], &[], &[redact::Rect { x0: 10.0, y0: 20.0, x1: 110.0, y1: 70.0 }]);
    // a fill (re + f) with width 100 height 50 appears
    assert!(content.operations.iter().any(|o| o.operator == "re"
        && matches!(o.operands.as_slice(),
            [a,b,c,d] if real_eq(a,10.0)&&real_eq(b,20.0)&&real_eq(c,100.0)&&real_eq(d,50.0))));
    assert!(content.operations.iter().any(|o| o.operator == "f"));
}
```
(`real_eq` = small helper accepting `Integer` or `Real`.)

- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** PASS; clippy + fmt. **Step 5:** Commit `feat(pdf-core): surgery excision with advance-preserving compensation and redaction boxes`.

---

### Task 4: Single-page surgery builder

**Files:** Modify `crates/pdf-core/src/surgery.rs`.

**Interfaces:** Produces `try_build_surgery(doc, page_id, rects, page_height_pt) -> Option<Vec<u8>>`.

Steps inside:
1. `let raw = doc.get_page_content(page_id).ok()?;`
2. `let content = Content::decode(&raw).ok()?;`
3. **round-trip guard:** `let enc = content.encode().ok()?; if Content::decode(&enc).map(|c| c.operations.len()).ok()? != content.operations.len() { return None; }`
4. `let fonts = page_fonts(doc, page_id);`
5. `let slots = enumerate_page_glyphs(&content, &fonts, page_height_pt).ok()?;` (`Err` → `None`)
6. `let mut edited = content; let marked = mark_in_rects(&slots, rects); apply_excision(&mut edited, &slots, &marked, rects);`
7. `let out = edited.encode().ok()?; Some(out)`

Note: returning `Some` does **not** prove removal — Task 5's outcome gate does. This builder only refuses pages it structurally cannot handle.

- [ ] **Step 1: Test** on a real fixture (`tests/fixtures/hello.pdf`): `try_build_surgery` over a rect covering the text returns `Some`, and the returned bytes, set as the page content and re-extracted, no longer contain the word; a rect covering nothing returns `Some` with the text intact plus a box. (Build a tiny doc, set `/Contents` to the returned stream, `save_to`, reload, `extract_text`.)
- [ ] **Step 2-4:** FAIL → implement → PASS; clippy + fmt.
- [ ] **Step 5:** Commit `feat(pdf-core): single-page surgery builder with structural fallback guards`.

---

### Task 5: `redact()` integration — mode, outcome gate, per-page fallback, report

**Files:** Modify `crates/pdf-core/src/redact.rs`, `crates/pdf-core/src/lib.rs` (re-export `RedactionMode`).

**Interfaces:** Consumes `try_build_surgery`, `enumerate_page_glyphs`/`mark_in_rects` (for the gate, via `observe_page`). Produces `RedactionMode`, the new `RedactionOptions.mode`, `RedactionReport.{pages_surgered, pages_flattened}`.

Add `RedactionMode { Flatten, Surgery }` (derive `Debug, Clone, Copy`), `RedactionOptions.mode` (default `Flatten`), and the two report vecs. In `redact()`:

- `Flatten` mode: unchanged loop; every affected page → `pages_flattened`, `pages_surgered` empty.
- `Surgery` mode, per affected page (0-based `page`, `page_id`, `rects`, `page_height_pt` from `render_doc.page_size`):
  1. `match surgery::try_build_surgery(&lo, page_id, rects, page_h) { Some(stream_bytes) => candidate, None => flatten }`.
     - candidate: add the stream object, set page `/Contents` to it, push to a `candidates: Vec<(usize, ObjectId, Vec<Rect>)>`.
     - flatten: existing `render_redacted_page(&render_doc, page, rects, dpi)` + `reassemble_page(...)`; push to `pages_flattened`.
  2. **Outcome gate** after the per-page loop, before scrub: serialize a throwaway copy — `let mut probe = Vec::new(); lo.save_to(&mut probe)?;` then `let probe_doc = Document::load(probe)?;` For each candidate, `observe_page`-equivalent: render/observe the page and assert **no** glyph centre lies in any of that page's rects (reuse `textpos::observe_page` + `to_display_rect` + `rect_contains`). A candidate that passes → `pages_surgered`. A candidate that **fails** → flatten it now (`render_redacted_page(&render_doc, …)` + `reassemble_page`) and add to `pages_flattened`.
  3. Continue with the existing tail unchanged: `sanitize_document` → `prune_objects` → `verify_scrub_absence` → `verify_gate` → `save_to` → `first_surviving_text`.
- **`verify_gate` adjustment:** it currently asserts every affected page is text-free. Split the affected pages into surgered vs flattened; assert text-free only for **flattened** pages. Surgered pages are already proven clear by the outcome gate (no glyph in rect) and remain subject to the document-wide supplied-string + `scan_logical_content` checks. Pass the surgered/flattened split into `verify_gate` (new params) or perform the per-page structural check inline in `redact()` and call a slimmer `verify_gate`.

- [ ] **Step 1: Tests** (in `redact.rs` tests):
  - `surgery_mode_preserves_nontarget_text`: redact `hello.pdf` with a rect over part of the page in `Surgery` mode; assert the reloaded page still has *some* extractable text (not image-only) when surgery succeeds, and the report lists the page in `pages_surgered`.
  - `surgery_mode_removes_target_text`: a rect over the word → reloaded extract does not contain it; the detector (`crate::detect`) re-run reports no finding for that text (self-cross-check).
  - `surgery_falls_back_to_flatten_when_unsupported`: a fixture page the builder rejects (e.g. force via an inline-image fixture or a Type3) → page appears in `pages_flattened`, target still absent, gate passes.
  - `flatten_mode_unchanged`: `mode = Flatten` (default) → `pages_surgered` empty, behavior identical to today (existing tests still pass).
- [ ] **Step 2-4:** FAIL → implement → PASS; clippy + fmt; run the whole `pdf-core` suite.
- [ ] **Step 5:** Commit `feat(pdf-core): text-preserving redaction mode with outcome gate and per-page flatten fallback`.

---

### Task 6: wasm edge, TypeScript wrapper, README, ADR + changelog fragments, ROADMAP/STATUS

**Files:** Modify `crates/pdf-core/src/wasm.rs`, `packages/pdf/src/index.ts`, `packages/pdf/README.md`; create `docs/decisions/pending/pdf-content-stream-surgery.md`, `changelog.d/pdf-surgery.md`; modify `ROADMAP.md`, `STATUS.md` (own rows only).

- `wasm.rs`: `redactDocument` gains an optional `mode` (string `"flatten"`|`"surgery"`, default `"flatten"`) mapped to `RedactionMode`; return object gains `pagesSurgered`/`pagesFlattened` (arrays of 0-based page indices). Keep existing fields.
- `index.ts`: extend the options type with `mode?: "flatten" | "surgery"` and the result type with `pagesSurgered: number[]`, `pagesFlattened: number[]`. Document both routes in the JSDoc.
- `README.md`: a "Text-preserving redaction" subsection under Redaction — the two modes, the fail-closed per-page fallback, and the honest boundaries (inline images, Form-XObject text, non-Identity Type0, Type3, rotated text → flatten; over-removal is the only residual non-safety failure mode). No process references.
- ADR fragment `pdf-content-stream-surgery.md` (frontmatter: `slug`, `status: Accepted`, `area: Documents`, `date: 2026-06-23`, `summary`): the two-route model, position-from-walk, the outcome gate, mode default Flatten.
- `changelog.d/pdf-surgery.md`: one concise entry; state the real test count after Task 5 (do not inflate).

- [ ] **Step 1:** Build wasm (`packages/pdf` build), run JS tests (extend with a `mode:"surgery"` round-trip asserting the new fields and deterministic `free()`).
- [ ] **Step 2:** Verify README ↔ index.ts ↔ wasm strings agree (`flatten`/`surgery`, field names).
- [ ] **Step 3:** Run `pnpm run lint:process-refs` (or the repo's process-ref scan) over the new source/docs.
- [ ] **Step 4:** Commit `feat(pdf): expose text-preserving redaction mode + docs`.

---

### Task 7: Coverage measurement (non-gating)

**Files:** Modify `crates/pdf-eval` (add a `surgery-coverage` reporter) or extend the existing redact smoke.

Over `spikes/pdf-engine-eval/corpus`, run `redact` in `Surgery` mode with a representative full-page rect per first page and report, per file, surgered-vs-flattened page counts and the reason for any fallback. **Non-gating** (informational) — it must not fail CI; it exists so the real success rate is reported, not claimed. Print a summary line.

- [ ] **Step 1:** Implement the reporter; run it; capture the numbers.
- [ ] **Step 2:** Record the observed coverage in the changelog fragment / ledger (honest numbers).
- [ ] **Step 3:** Commit `test(pdf-eval): non-gating surgery coverage reporter over the corpus`.

---

## Self-Review

- **Spec coverage:** mode selection (T5/T6), position-from-walk (T2), excision + advance preservation (T3), redaction boxes (T3), outcome gate + fallback (T5), font support rules incl. Identity-only Type0 (T1), boundaries in README (T6), coverage measurement (T7), self-cross-check with the detector (T5 test). All spec sections map to a task.
- **Type consistency:** `FontMetrics`, `GlyphSlot`, `RedactionMode`, report fields, and the `try_build_surgery` signature are used identically across T4/T5. `redact::Rect` is the one rect type throughout; `to_display_rect`/`rect_contains` are the shared geometry.
- **No placeholders:** every code task carries test code and the exact advance formula `n = -(Σ w + (Tc + Tw_term)·1000/Tfs)`.
- **Safety:** under-removal always falls back (outcome gate); the final `verify_gate` + `scan_logical_content` + `first_surviving_text` still run for every mode; over-removal is disclosed as the only residual (non-leak) failure mode.
