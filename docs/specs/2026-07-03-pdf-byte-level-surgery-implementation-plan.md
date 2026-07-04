# Byte-level content surgery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a byte-level content-surgery path to the pure-Rust PDF engine so a page whose text is analyzable but whose content stream cannot survive lopdf's whole-stream re-encode (inline images, exotic constructs) has its marked glyphs surgically removed instead of being flattened.

**Architecture:** Reuse the existing text-state walk, marking, and excision/compensation rebuild unchanged. Add a raw content-stream tokenizer that records each operator's byte span (inline images opaque). The new writer copies the original bytes verbatim and re-encodes *only* the edited show operators individually, splicing them in — the whole-stream re-encode (which mangles inline images) is never run. Reached as an additive fallback exactly where today's round-trip guard would flatten.

**Tech Stack:** Rust, `lopdf` 0.41 (content model), `kurbo` (affine math). Crate `pdf-core` (`crates/pdf-core`); eval harness `pdf-eval` (`crates/pdf-eval`).

## Global Constraints

- Memory-safe Rust only; no new C/C++ dependency. The tokenizer is pure Rust — no new crates.
- Native `pdf-core` test builds OOM this machine without limits. Every Rust test command uses: `CARGO_BUILD_JOBS=1 RUSTFLAGS="-C debuginfo=0 -C codegen-units=1"`.
- Do **not** run `cargo fmt` over the crate — local rustfmt drift churns pre-existing files. Format only the lines you add, matching surrounding style.
- No process-artifact references in source/tests (no "ADR-NNNN", "spec", "slice N", "phase N", plan/task citations). State reasoning inline or cite a `docs/conventions/` path. Enforced by `pnpm run lint:process-refs`.
- Fully-spelled names, no shorthand: `content_tokens`, `op_replacements`, `fill_box_operations`, `build_byte_splice`, `tokenize`.
- Every task ends green and committed. Commit messages end with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

- `crates/pdf-core/src/content_tokens.rs` — **new.** Pure raw-content-stream tokenizer: `tokenize(&[u8]) -> Option<Vec<RawToken>>`. No PDF-model knowledge.
- `crates/pdf-core/src/lib.rs` — register `mod content_tokens;`.
- `crates/pdf-core/src/surgery.rs` — factor `op_replacements` + `fill_box_operations` out of `apply_excision` (op-path behavior unchanged); add `encode_operations` + `build_byte_splice`; reorder `try_build_surgery` to branch on the round-trip guard.
- `crates/pdf-eval/src/validate/operations/surgery.rs` — **new.** A `ValidationOperation` running both surgery paths in shadow per page; the bar-A/bar-B report.
- `crates/pdf-eval/src/validate/operations/mod.rs`, `crates/pdf-eval/src/validate/mod.rs` — register the operation.

---

## Task 1: Raw content-stream tokenizer

**Files:**
- Create: `crates/pdf-core/src/content_tokens.rs`
- Modify: `crates/pdf-core/src/lib.rs` (add `mod content_tokens;`)
- Test: inline `#[cfg(test)]` module in `content_tokens.rs`

**Interfaces:**
- Produces: `pub(crate) struct RawToken { pub operator: Vec<u8>, pub start: usize, pub end: usize }` and `pub(crate) fn tokenize(bytes: &[u8]) -> Option<Vec<RawToken>>`. Tokens are one per operator in the **same order and count** as `lopdf::content::Content::decode` produces operations. `start` is the byte offset of the operator invocation's first operand (or the operator keyword itself when it has no operands); `end` is one past the operator keyword's last byte. `BI … ID <data> EI` is a single token with `operator == b"BI"` spanning the whole construct. Returns `None` on an unterminated string / dict / array / inline image.

- [ ] **Step 1: Write the failing tests**

Add to a new file `crates/pdf-core/src/content_tokens.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn ops(bytes: &[u8]) -> Vec<Vec<u8>> {
        tokenize(bytes).unwrap().into_iter().map(|t| t.operator).collect()
    }

    #[test]
    fn tokenizes_simple_text_show() {
        // Operators only, in order.
        assert_eq!(
            ops(b"BT /F1 12 Tf (Hello) Tj ET"),
            vec![b"BT".to_vec(), b"Tf".to_vec(), b"Tj".to_vec(), b"ET".to_vec()]
        );
    }

    #[test]
    fn tj_operator_span_covers_operand_array_through_operator() {
        let raw = b"BT [(Hi) -250 (lo)] TJ ET";
        let toks = tokenize(raw).unwrap();
        let tj = toks.iter().find(|t| t.operator == b"TJ").unwrap();
        // start at '[', end just past the 'J' of TJ.
        assert_eq!(&raw[tj.start..tj.end], b"[(Hi) -250 (lo)] TJ");
    }

    #[test]
    fn true_false_null_are_operands_not_operators() {
        // `true` is an operand of the operator `Tr`-like keyword here; ensure the only
        // operator emitted is the trailing bareword `BDC`, not `true`.
        assert_eq!(ops(b"/OC true BDC"), vec![b"BDC".to_vec()]);
    }

    #[test]
    fn string_with_escaped_and_balanced_parens_does_not_end_early() {
        // The literal contains an escaped ')' and a balanced '()' — the operator is Tj.
        assert_eq!(ops(b"(a\\)b (c) d) Tj"), vec![b"Tj".to_vec()]);
    }

    #[test]
    fn hex_string_is_not_confused_with_dict() {
        assert_eq!(ops(b"<48656C6C6F> Tj"), vec![b"Tj".to_vec()]);
        assert_eq!(ops(b"<< /A 1 >> BDC"), vec![b"BDC".to_vec()]);
    }

    #[test]
    fn comment_is_skipped() {
        assert_eq!(ops(b"BT % this is (not) a string\n(Hi) Tj ET"),
                   vec![b"BT".to_vec(), b"Tj".to_vec(), b"ET".to_vec()]);
    }

    #[test]
    fn inline_image_is_one_opaque_bi_token_spanning_to_ei() {
        let raw = b"q BI /W 2 /H 2 /CS /G ID \x00\xFF\x10\x20 EI Q";
        let toks = tokenize(raw).unwrap();
        assert_eq!(toks.iter().map(|t| t.operator.clone()).collect::<Vec<_>>(),
                   vec![b"q".to_vec(), b"BI".to_vec(), b"Q".to_vec()]);
        let bi = toks.iter().find(|t| t.operator == b"BI").unwrap();
        assert_eq!(&raw[bi.start..bi.end], b"BI /W 2 /H 2 /CS /G ID \x00\xFF\x10\x20 EI");
    }

    #[test]
    fn unterminated_string_returns_none() {
        assert!(tokenize(b"(oops").is_none());
    }

    #[test]
    fn matches_lopdf_operation_count_on_mixed_stream() {
        let raw = b"q 1 0 0 1 10 10 cm BT /F1 12 Tf (Hi) Tj [(a) -5 (b)] TJ ET Q";
        let lopdf_count = lopdf::content::Content::decode(raw).unwrap().operations.len();
        assert_eq!(tokenize(raw).unwrap().len(), lopdf_count);
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `CARGO_BUILD_JOBS=1 RUSTFLAGS="-C debuginfo=0 -C codegen-units=1" cargo test -p pdf-core --lib content_tokens`
Expected: FAIL — `tokenize` / `RawToken` not found.

- [ ] **Step 3: Implement the tokenizer**

Write the module body above the test block in `crates/pdf-core/src/content_tokens.rs`:

```rust
//! A raw content-stream tokenizer: locate each operator invocation and its byte span
//! without decoding operand values. It exists so surgery can rewrite a stream by
//! splicing only the operators it edits and copying every other byte verbatim —
//! inline images and exotic constructs never pass through a re-encode. Token order and
//! count match `lopdf::content::Content::decode` so the two can be zipped by index.

/// One operator invocation located in a raw content stream.
#[derive(Debug, Clone)]
pub(crate) struct RawToken {
    /// Operator keyword bytes (e.g. `b"Tj"`, `b"TJ"`, `b"BT"`, `b"BI"`).
    pub operator: Vec<u8>,
    /// Byte offset of the invocation's first operand, or the operator keyword itself
    /// when it takes no operands. For `BI`, the offset of `BI`.
    pub start: usize,
    /// One past the operator keyword's last byte. For `BI`, one past the `EI` terminator.
    pub end: usize,
}

fn is_whitespace(b: u8) -> bool {
    matches!(b, b'\0' | b'\t' | b'\n' | b'\x0C' | b'\r' | b' ')
}

fn is_delimiter(b: u8) -> bool {
    matches!(b, b'(' | b')' | b'<' | b'>' | b'[' | b']' | b'{' | b'}' | b'/' | b'%')
}

fn is_regular(b: u8) -> bool {
    !is_whitespace(b) && !is_delimiter(b)
}

/// Advance past a literal string starting at `i` (which points at `(`). Returns the
/// index just past the closing `)`, or `None` if unterminated. Handles backslash
/// escapes and balanced interior parens.
fn skip_literal_string(bytes: &[u8], mut i: usize) -> Option<usize> {
    let mut depth = 0i32;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' => i += 2, // skip the escaped byte
            b'(' => { depth += 1; i += 1; }
            b')' => { depth -= 1; i += 1; if depth == 0 { return Some(i); } }
            _ => i += 1,
        }
    }
    None
}

/// Advance past a hex string starting at `i` (which points at `<`, not `<<`). Returns
/// the index just past `>`, or `None` if unterminated.
fn skip_hex_string(bytes: &[u8], mut i: usize) -> Option<usize> {
    i += 1; // past '<'
    while i < bytes.len() {
        if bytes[i] == b'>' { return Some(i + 1); }
        i += 1;
    }
    None
}

/// Advance past a `<< … >>` dictionary starting at `i` (which points at the first `<`).
/// Handles nesting and interior strings. Returns the index just past the closing `>>`.
fn skip_dict(bytes: &[u8], mut i: usize) -> Option<usize> {
    let mut depth = 0i32;
    while i < bytes.len() {
        if bytes[i] == b'<' && bytes.get(i + 1) == Some(&b'<') { depth += 1; i += 2; }
        else if bytes[i] == b'>' && bytes.get(i + 1) == Some(&b'>') {
            depth -= 1; i += 2; if depth == 0 { return Some(i); }
        }
        else if bytes[i] == b'<' { i = skip_hex_string(bytes, i)?; }
        else if bytes[i] == b'(' { i = skip_literal_string(bytes, i)?; }
        else { i += 1; }
    }
    None
}

/// Advance past a `[ … ]` array starting at `i` (which points at `[`). Handles interior
/// strings, hex, and nested arrays/dicts. Returns the index just past the closing `]`.
fn skip_array(bytes: &[u8], mut i: usize) -> Option<usize> {
    let mut depth = 0i32;
    while i < bytes.len() {
        match bytes[i] {
            b'[' => { depth += 1; i += 1; }
            b']' => { depth -= 1; i += 1; if depth == 0 { return Some(i); } }
            b'(' => i = skip_literal_string(bytes, i)?,
            b'<' if bytes.get(i + 1) == Some(&b'<') => i = skip_dict(bytes, i)?,
            b'<' => i = skip_hex_string(bytes, i)?,
            _ => i += 1,
        }
    }
    None
}

/// Advance past a `/Name` starting at `i` (which points at `/`). Returns the index of
/// the first byte that is not part of the name.
fn skip_name(bytes: &[u8], mut i: usize) -> usize {
    i += 1; // past '/'
    while i < bytes.len() && is_regular(bytes[i]) { i += 1; }
    i
}

/// Read a bareword (number, `true`/`false`/`null`, or operator keyword) starting at `i`.
/// Returns `(word, end)`.
fn read_bareword(bytes: &[u8], start: usize) -> (&[u8], usize) {
    let mut i = start;
    while i < bytes.len() && is_regular(bytes[i]) { i += 1; }
    (&bytes[start..i], i)
}

fn is_number(word: &[u8]) -> bool {
    !word.is_empty()
        && word.iter().all(|&b| b.is_ascii_digit() || matches!(b, b'+' | b'-' | b'.'))
        && word.iter().any(|b| b.is_ascii_digit())
}

/// After `BI` (starting scan at `after_bi`), advance past the inline image to just after
/// its `EI` terminator. The `EI` must be whitespace-bounded on the left and followed by
/// whitespace or end-of-stream. Returns `None` if no such `EI` is found.
fn skip_inline_image(bytes: &[u8], after_bi: usize) -> Option<usize> {
    let mut i = after_bi;
    while i + 1 < bytes.len() {
        let at_boundary = i == 0 || is_whitespace(bytes[i - 1]);
        let is_ei = bytes[i] == b'E' && bytes[i + 1] == b'I';
        let followed_ok = i + 2 >= bytes.len() || is_whitespace(bytes[i + 2]);
        if at_boundary && is_ei && followed_ok {
            return Some(i + 2);
        }
        i += 1;
    }
    None
}

pub(crate) fn tokenize(bytes: &[u8]) -> Option<Vec<RawToken>> {
    let mut tokens = Vec::new();
    let mut i = 0usize;
    let mut operand_start: Option<usize> = None;

    while i < bytes.len() {
        let b = bytes[i];
        if is_whitespace(b) { i += 1; continue; }
        if b == b'%' {
            while i < bytes.len() && bytes[i] != b'\n' && bytes[i] != b'\r' { i += 1; }
            continue;
        }
        match b {
            b'(' => { operand_start.get_or_insert(i); i = skip_literal_string(bytes, i)?; }
            b'<' if bytes.get(i + 1) == Some(&b'<') => { operand_start.get_or_insert(i); i = skip_dict(bytes, i)?; }
            b'<' => { operand_start.get_or_insert(i); i = skip_hex_string(bytes, i)?; }
            b'[' => { operand_start.get_or_insert(i); i = skip_array(bytes, i)?; }
            b'/' => { operand_start.get_or_insert(i); i = skip_name(bytes, i); }
            b')' | b'>' | b']' | b'}' | b'{' => return None, // unbalanced delimiter
            _ => {
                let word_start = i;
                let (word, end) = read_bareword(bytes, i);
                if end == word_start { return None; } // no progress: malformed byte
                if is_number(word) || word == b"true" || word == b"false" || word == b"null" {
                    operand_start.get_or_insert(word_start);
                    i = end;
                } else {
                    let start = operand_start.take().unwrap_or(word_start);
                    if word == b"BI" {
                        let ei_end = skip_inline_image(bytes, end)?;
                        tokens.push(RawToken { operator: b"BI".to_vec(), start, end: ei_end });
                        i = ei_end;
                    } else {
                        tokens.push(RawToken { operator: word.to_vec(), start, end });
                        i = end;
                    }
                }
            }
        }
    }
    Some(tokens)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `CARGO_BUILD_JOBS=1 RUSTFLAGS="-C debuginfo=0 -C codegen-units=1" cargo test -p pdf-core --lib content_tokens`
Expected: PASS (9 tests).

- [ ] **Step 5: Register the module and confirm clippy is clean**

In `crates/pdf-core/src/lib.rs`, add `mod content_tokens;` in the module list (near the other `mod` declarations; keep alphabetical if the file is alphabetized).

Run: `CARGO_BUILD_JOBS=1 RUSTFLAGS="-C debuginfo=0 -C codegen-units=1" cargo clippy -p pdf-core --lib`
Expected: no new warnings on `content_tokens.rs`.

- [ ] **Step 6: Commit**

```bash
git add crates/pdf-core/src/content_tokens.rs crates/pdf-core/src/lib.rs
git commit -m "feat(pdf): raw content-stream tokenizer with per-operator byte spans

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Factor the rewrite out of `apply_excision`

Lift the two build steps of `apply_excision` into pure helpers so the byte-path can reuse them. The op-path keeps identical behavior — its existing tests are the regression guard.

**Files:**
- Modify: `crates/pdf-core/src/surgery.rs` (`apply_excision` ~843–978; add two helpers above it)
- Test: existing tests in `surgery.rs` (`excise_both_leaves_only_compensation` and siblings) plus one new equality test.

**Interfaces:**
- Produces:
  - `pub(crate) fn op_replacements(content: &Content, slots: &[GlyphSlot], marked: &[usize], fonts: &BTreeMap<Vec<u8>, FontMetrics>) -> BTreeMap<usize, Vec<lopdf::content::Operation>>` — for each affected operation index, the replacement operations (a rebuilt `TJ`, preceded by a `T*` when the original operator was `'` or `"`).
  - `pub(crate) fn fill_box_operations(rects: &[Rect]) -> Vec<lopdf::content::Operation>` — the `q rg re f Q` operations, one box per rect.
- Consumes (unchanged): `rebuild_tj_array`, `OpRewrite`, `GlyphSlot`, `FontMetrics`.

- [ ] **Step 1: Write the failing test**

Add to the `surgery.rs` test module:

```rust
#[test]
fn op_replacements_and_boxes_match_apply_excision() {
    // Building a Content two ways — via the factored helpers vs. apply_excision —
    // must yield identical operations. This pins that the refactor is behavior-preserving.
    let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/surgery_simple.pdf");
    let doc = lopdf::Document::load(&fixture).unwrap();
    let page_id = *doc.get_pages().values().next().unwrap();
    let raw = doc.get_page_content(page_id).unwrap();
    let content = lopdf::content::Content::decode(&raw).unwrap();
    let fonts = page_fonts(&doc, page_id);
    let [llx, lly, _, _] = resolve_mediabox(&doc, page_id).unwrap();
    let slots = enumerate_page_glyphs(
        &content, &fonts, kurbo::Affine::translate((-llx as f64, -lly as f64)),
    ).unwrap();
    let rects = [Rect { x0: 0.0, y0: 0.0, x1: 200.0, y1: 50.0 }];
    let marked = mark_in_rects(&slots, &rects);

    // Path A: apply_excision on a clone.
    let mut via_excision = content.clone();
    apply_excision(&mut via_excision, &slots, &marked, &fonts, &rects);

    // Path B: rebuild from the factored helpers.
    let replacements = op_replacements(&content, &slots, &marked, &fonts);
    let mut rebuilt = Vec::new();
    for (idx, op) in content.operations.iter().enumerate() {
        if let Some(repl) = replacements.get(&idx) {
            rebuilt.extend(repl.iter().cloned());
        } else {
            rebuilt.push(op.clone());
        }
    }
    rebuilt.extend(fill_box_operations(&rects));

    assert_eq!(via_excision.operations.len(), rebuilt.len());
    for (a, b) in via_excision.operations.iter().zip(rebuilt.iter()) {
        assert_eq!(a.operator, b.operator);
        assert_eq!(a.operands, b.operands);
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `CARGO_BUILD_JOBS=1 RUSTFLAGS="-C debuginfo=0 -C codegen-units=1" cargo test -p pdf-core --lib op_replacements_and_boxes_match`
Expected: FAIL — `op_replacements` / `fill_box_operations` not found.

- [ ] **Step 3: Extract the helpers and reimplement `apply_excision` on top of them**

Add above `apply_excision` in `surgery.rs`:

```rust
/// For each text-show operation containing a marked glyph, the operations that replace
/// it: a rebuilt `TJ` (marked glyphs dropped, each contiguous dropped run collapsed to a
/// numeric advance-compensation so following glyphs keep position), preceded by a `T*`
/// when the original operator was `'` or `"` (whose implicit line-advance must be preserved).
pub(crate) fn op_replacements(
    content: &Content,
    slots: &[GlyphSlot],
    marked: &[usize],
    fonts: &BTreeMap<Vec<u8>, FontMetrics>,
) -> BTreeMap<usize, Vec<lopdf::content::Operation>> {
    let marked_set: BTreeSet<usize> = marked.iter().copied().collect();

    let mut ops_with_marked: BTreeMap<usize, ()> = BTreeMap::new();
    for &slot_index in marked {
        ops_with_marked.insert(slots[slot_index].op, ());
    }

    let mut replacements: BTreeMap<usize, Vec<lopdf::content::Operation>> = BTreeMap::new();
    for &op_index in ops_with_marked.keys() {
        let all_slots_for_op: Vec<usize> = slots
            .iter()
            .enumerate()
            .filter(|(_, s)| s.op == op_index)
            .map(|(i, _)| i)
            .collect();

        let op = &content.operations[op_index];
        let original_operator = op.operator.clone();
        let (original_array, single_string_bytes) = match original_operator.as_str() {
            "TJ" => (
                match op.operands.first() {
                    Some(Object::Array(arr)) => Some(arr.clone()),
                    _ => None,
                },
                None,
            ),
            "Tj" | "'" | "\"" => {
                let str_operand_index = if original_operator == "\"" { 2 } else { 0 };
                (
                    None,
                    match op.operands.get(str_operand_index) {
                        Some(Object::String(b, _)) => Some(b.clone()),
                        _ => None,
                    },
                )
            }
            _ => (None, None),
        };

        let rewrite = OpRewrite {
            all_slots: all_slots_for_op,
            original_operator: original_operator.clone(),
            original_array,
            single_string_bytes,
        };
        let rebuilt_array = rebuild_tj_array(&rewrite, slots, &marked_set, fonts);

        let mut ops = Vec::new();
        if original_operator == "'" || original_operator == "\"" {
            ops.push(lopdf::content::Operation::new("T*", vec![]));
        }
        ops.push(lopdf::content::Operation::new(
            "TJ",
            vec![Object::Array(rebuilt_array)],
        ));
        replacements.insert(op_index, ops);
    }
    replacements
}

/// One opaque black redaction box per rect, as `q rg re f Q` operations in page space.
/// Corners are normalised so width/height are positive regardless of caller order.
pub(crate) fn fill_box_operations(rects: &[Rect]) -> Vec<lopdf::content::Operation> {
    let mut ops = Vec::new();
    for rect in rects {
        let x0 = rect.x0.min(rect.x1);
        let y0 = rect.y0.min(rect.y1);
        let x1 = rect.x0.max(rect.x1);
        let y1 = rect.y0.max(rect.y1);
        ops.push(lopdf::content::Operation::new("q", vec![]));
        ops.push(lopdf::content::Operation::new(
            "rg",
            vec![Object::Integer(0), Object::Integer(0), Object::Integer(0)],
        ));
        ops.push(lopdf::content::Operation::new(
            "re",
            vec![
                Object::Real(x0),
                Object::Real(y0),
                Object::Real(x1 - x0),
                Object::Real(y1 - y0),
            ],
        ));
        ops.push(lopdf::content::Operation::new("f", vec![]));
        ops.push(lopdf::content::Operation::new("Q", vec![]));
    }
    ops
}
```

Then replace the body of `apply_excision` (keep its signature) with a thin composition:

```rust
pub(crate) fn apply_excision(
    content: &mut Content,
    slots: &[GlyphSlot],
    marked: &[usize],
    fonts: &BTreeMap<Vec<u8>, FontMetrics>,
    rects: &[Rect],
) {
    if marked.is_empty() && rects.is_empty() {
        return;
    }
    let replacements = op_replacements(content, slots, marked, fonts);
    let original_operations = std::mem::take(&mut content.operations);
    let mut new_operations = Vec::with_capacity(original_operations.len() + replacements.len());
    for (op_index, op) in original_operations.into_iter().enumerate() {
        match replacements.get(&op_index) {
            Some(repl) => new_operations.extend(repl.iter().cloned()),
            None => new_operations.push(op),
        }
    }
    new_operations.extend(fill_box_operations(rects));
    content.operations = new_operations;
}
```

Remove the now-unused inline `OpRewrite`-construction and box-drawing code that previously lived in `apply_excision` (it has moved into the helpers). Keep `OpRewrite`, `rebuild_tj_array`, `rebuild_string_element`, and `glyph_width_from_metrics` as they are.

- [ ] **Step 4: Run the full surgery test suite to verify nothing regressed**

Run: `CARGO_BUILD_JOBS=1 RUSTFLAGS="-C debuginfo=0 -C codegen-units=1" cargo test -p pdf-core --lib surgery`
Expected: PASS — all pre-existing surgery tests plus the new `op_replacements_and_boxes_match_apply_excision`.

- [ ] **Step 5: Commit**

```bash
git add crates/pdf-core/src/surgery.rs
git commit -m "refactor(pdf): factor op_replacements/fill_box_operations out of apply_excision

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: The byte splicer

**Files:**
- Modify: `crates/pdf-core/src/surgery.rs` (add `encode_operations` + `build_byte_splice` after `apply_excision`)
- Test: inline `surgery.rs` test module.

**Interfaces:**
- Consumes: `content_tokens::tokenize`, `op_replacements`, `fill_box_operations` (Task 2), `Content`, `Operation`.
- Produces:
  - `fn encode_operations(ops: &[lopdf::content::Operation]) -> Option<Vec<u8>>` — encode a small operation list to content bytes (`Content { operations }.encode()`).
  - `pub(crate) fn build_byte_splice(raw: &[u8], operations: &[lopdf::content::Operation], replacements: &BTreeMap<usize, Vec<lopdf::content::Operation>>, boxes: &[lopdf::content::Operation]) -> Option<Vec<u8>>` — tokenize `raw`; self-check that token count and each operator name equal `operations`; return `None` on mismatch. Copy `raw` verbatim, replacing each `replacements` key's operator span (from the tokenizer) with `" " + encode_operations(repl) + " "`; append `" " + encode_operations(boxes)`. Splices are applied right-to-left so earlier byte offsets stay valid.

- [ ] **Step 1: Write the failing tests**

Add to the `surgery.rs` test module:

```rust
#[test]
fn byte_splice_preserves_inline_image_and_removes_text() {
    // A page with text followed by an inline image whose colorspace lopdf drops on
    // decode (tripping the round-trip guard). The byte splice must remove the text,
    // keep the inline-image bytes byte-identical, and still parse.
    let raw: &[u8] =
        b"BT /F1 12 Tf 0 0 Td (Hello) Tj ET\nq BI /W 2 /H 2 /CS /Weird /BPC 8 ID \x01\x02\x03\x04 EI Q";
    // Build a tiny doc whose page content is `raw`, with an F1 standard-14 font.
    let (doc, page_id) = crate::surgery::tests::doc_with_content(raw, "Helvetica");
    let content = lopdf::content::Content::decode(raw).unwrap();
    let fonts = page_fonts(&doc, page_id);
    let slots = enumerate_page_glyphs(&content, &fonts, kurbo::Affine::IDENTITY).unwrap();
    let rects = [Rect { x0: -1.0, y0: -1.0, x1: 1000.0, y1: 1000.0 }];
    let marked = mark_in_rects(&slots, &rects);
    assert!(!marked.is_empty(), "the text must be inside the rect");

    let replacements = op_replacements(&content, &slots, &marked, &fonts);
    let boxes = fill_box_operations(&rects);
    let out = build_byte_splice(raw, &content.operations, &replacements, &boxes)
        .expect("byte splice must succeed");

    // Inline-image bytes survive verbatim.
    assert!(out.windows(4).any(|w| w == b"\x01\x02\x03\x04"), "inline image data must be preserved");
    assert!(out.windows(2).any(|w| w == b"BI"), "BI operator preserved");
    assert!(out.windows(2).any(|w| w == b"EI"), "EI terminator preserved");
    // The literal "Hello" no longer appears as a shown string.
    assert!(!out.windows(5).any(|w| w == b"Hello"), "marked text must be gone");
    // Output still decodes.
    lopdf::content::Content::decode(&out).expect("spliced stream must decode");
}

#[test]
fn byte_splice_self_check_flattens_on_operator_desync() {
    // If the operations list disagrees with the raw bytes, the splice must refuse.
    let raw: &[u8] = b"BT (Hi) Tj ET";
    let mut bogus = lopdf::content::Content::decode(raw).unwrap().operations;
    bogus.push(lopdf::content::Operation::new("Tj", vec![])); // extra op, not in raw
    let out = build_byte_splice(raw, &bogus, &BTreeMap::new(), &[]);
    assert!(out.is_none(), "count mismatch must return None");
}
```

Add this test-support constructor to the `surgery.rs` test module (used by this and Task 4 tests):

```rust
/// Build a one-page document whose page content stream is exactly `content_bytes`,
/// with a single standard-14 font resource named `F1`. Returns the doc and page id.
pub(super) fn doc_with_content(
    content_bytes: &[u8],
    base_font: &str,
) -> (lopdf::Document, lopdf::ObjectId) {
    use lopdf::{dictionary, Object, Stream};
    let mut doc = lopdf::Document::with_version("1.5");
    let font_id = doc.add_object(dictionary! {
        "Type" => Object::Name(b"Font".to_vec()),
        "Subtype" => Object::Name(b"Type1".to_vec()),
        "BaseFont" => Object::Name(base_font.as_bytes().to_vec()),
    });
    let resources_id = doc.add_object(dictionary! {
        "Font" => dictionary! { "F1" => font_id },
    });
    let content_id = doc.add_object(Stream::new(dictionary! {}, content_bytes.to_vec()));
    let pages_id = doc.new_object_id();
    let page_id = doc.add_object(dictionary! {
        "Type" => Object::Name(b"Page".to_vec()),
        "Parent" => pages_id,
        "Contents" => content_id,
        "MediaBox" => Object::Array(vec![0.into(), 0.into(), 200.into(), 200.into()]),
        "Resources" => resources_id,
    });
    doc.objects.insert(pages_id, Object::Dictionary(dictionary! {
        "Type" => Object::Name(b"Pages".to_vec()),
        "Kids" => Object::Array(vec![page_id.into()]),
        "Count" => 1,
    }));
    let catalog_id = doc.add_object(dictionary! {
        "Type" => Object::Name(b"Catalog".to_vec()),
        "Pages" => pages_id,
    });
    doc.trailer.set("Root", catalog_id);
    (doc, page_id)
}
```

- [ ] **Step 2: Run to verify failure**

Run: `CARGO_BUILD_JOBS=1 RUSTFLAGS="-C debuginfo=0 -C codegen-units=1" cargo test -p pdf-core --lib byte_splice`
Expected: FAIL — `build_byte_splice` not found.

- [ ] **Step 3: Implement `encode_operations` + `build_byte_splice`**

Add after `apply_excision` in `surgery.rs`:

```rust
/// Encode a small operation list to content-stream bytes.
fn encode_operations(ops: &[lopdf::content::Operation]) -> Option<Vec<u8>> {
    let content = Content { operations: ops.to_vec() };
    content.encode().ok()
}

/// Produce edited content bytes by copying `raw` verbatim and re-encoding only the
/// operators named in `replacements`, splicing them over their raw byte spans. The
/// whole-stream re-encode is never run, so inline images and every untouched operator
/// stay byte-identical. Returns `None` if the raw tokenization disagrees with
/// `operations` (a desync) — the caller then falls back to flatten.
pub(crate) fn build_byte_splice(
    raw: &[u8],
    operations: &[lopdf::content::Operation],
    replacements: &BTreeMap<usize, Vec<lopdf::content::Operation>>,
    boxes: &[lopdf::content::Operation],
) -> Option<Vec<u8>> {
    let tokens = crate::content_tokens::tokenize(raw)?;
    // Self-check: token count and operator names must match the decoded operation list.
    if tokens.len() != operations.len() {
        return None;
    }
    for (token, op) in tokens.iter().zip(operations.iter()) {
        if token.operator.as_slice() != op.operator.as_bytes() {
            return None;
        }
    }

    // Apply splices right-to-left so earlier offsets stay valid.
    let mut out = raw.to_vec();
    let mut indices: Vec<&usize> = replacements.keys().collect();
    indices.sort_unstable();
    for &op_index in indices.iter().rev() {
        let token = &tokens[*op_index];
        let repl_ops = &replacements[op_index];
        let encoded = encode_operations(repl_ops)?;
        let mut padded = Vec::with_capacity(encoded.len() + 2);
        padded.push(b' ');
        padded.extend_from_slice(&encoded);
        padded.push(b' ');
        out.splice(token.start..token.end, padded);
    }

    if !boxes.is_empty() {
        let encoded = encode_operations(boxes)?;
        out.push(b' ');
        out.extend_from_slice(&encoded);
    }
    Some(out)
}
```

Note: `op.operator` is a `String`; compare `op.operator.as_bytes()` to `token.operator`.

- [ ] **Step 4: Run to verify pass**

Run: `CARGO_BUILD_JOBS=1 RUSTFLAGS="-C debuginfo=0 -C codegen-units=1" cargo test -p pdf-core --lib byte_splice`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add crates/pdf-core/src/surgery.rs
git commit -m "feat(pdf): byte-level content splicer with operator self-check

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Wire the byte-path into `try_build_surgery`

Reorder so glyph analysis runs before the round-trip guard, then branch: guard passes → op-path (unchanged); guard fails → byte-path.

**Files:**
- Modify: `crates/pdf-core/src/surgery.rs` (`try_build_surgery` ~1216–1271)
- Test: inline `surgery.rs` test module.

**Interfaces:**
- Consumes: `enumerate_page_glyphs`, `mark_in_rects`, `op_replacements`, `fill_box_operations`, `build_byte_splice`, `apply_excision`.
- Produces: `try_build_surgery` returns `Some(bytes)` for an inline-image page it previously flattened; return type unchanged (`Option<Vec<u8>>`).

- [ ] **Step 1: Write the failing test**

```rust
#[test]
fn inline_image_page_surgers_via_byte_path() {
    // The same inline-image page as Task 3, end-to-end through try_build_surgery.
    // Previously this flattened (round-trip guard); now it must return Some.
    let raw: &[u8] =
        b"BT /F1 12 Tf 0 0 Td (Hello) Tj ET\nq BI /W 2 /H 2 /CS /Weird /BPC 8 ID \x01\x02\x03\x04 EI Q";
    let (doc, page_id) = crate::surgery::tests::doc_with_content(raw, "Helvetica");

    // Confirm the round-trip guard would have tripped (precondition for the byte-path).
    let content = lopdf::content::Content::decode(raw).unwrap();
    let reencoded = content.encode().unwrap();
    let after = lopdf::content::Content::decode(&reencoded).unwrap().operations.len();
    assert_ne!(after, content.operations.len(), "guard must trip for this fixture");

    let rects = [Rect { x0: -1.0, y0: -1.0, x1: 1000.0, y1: 1000.0 }];
    let out = try_build_surgery(&doc, page_id, &rects).expect("byte-path must surger");
    assert!(out.windows(4).any(|w| w == b"\x01\x02\x03\x04"), "inline image preserved");
    assert!(!out.windows(5).any(|w| w == b"Hello"), "text removed");
}
```

- [ ] **Step 2: Run to verify failure**

Run: `CARGO_BUILD_JOBS=1 RUSTFLAGS="-C debuginfo=0 -C codegen-units=1" cargo test -p pdf-core --lib inline_image_page_surgers`
Expected: FAIL — currently returns `None` (guard trips, no byte-path).

- [ ] **Step 3: Reorder and branch `try_build_surgery`**

Replace the body of `try_build_surgery` (steps 1–10) with:

```rust
pub(crate) fn try_build_surgery(
    doc: &lopdf::Document,
    page_id: lopdf::ObjectId,
    rects: &[crate::redact::Rect],
) -> Option<Vec<u8>> {
    // Obtain and decode the content stream.
    let raw = doc.get_page_content(page_id).ok()?;
    let content = lopdf::content::Content::decode(&raw).ok()?;

    // Resolve page geometry and fonts.
    let fonts = page_fonts(doc, page_id);
    let [llx, lly, _urx, _ury] = resolve_mediabox(doc, page_id)?;
    let initial_ctm = kurbo::Affine::translate((-llx as f64, -lly as f64));

    // Non-zero rotation needs a coordinate-frame adjustment not handled here.
    if resolve_rotate(doc, page_id).rem_euclid(360) != 0 {
        return None;
    }

    // Locate glyphs and mark those inside the rectangles. This runs before the
    // round-trip guard: a stream lopdf cannot re-encode (inline images) may still have
    // perfectly analyzable text, and the byte-path below rewrites it without a re-encode.
    let slots = enumerate_page_glyphs(&content, &fonts, initial_ctm).ok()?;
    let marked = mark_in_rects(&slots, rects);

    // Round-trip guard: can lopdf faithfully re-encode this whole stream?
    let roundtrips = content
        .encode()
        .ok()
        .and_then(|enc| lopdf::content::Content::decode(&enc).ok())
        .map(|c| c.operations.len() == content.operations.len())
        .unwrap_or(false);

    if roundtrips {
        // Op-path: rewrite the operation list and re-encode the whole stream.
        let mut edited = content;
        apply_excision(&mut edited, &slots, &marked, &fonts, rects);
        edited.encode().ok()
    } else {
        // Byte-path: copy the original bytes and re-encode only the edited operators,
        // so inline images and exotic constructs pass through byte-identical.
        let replacements = op_replacements(&content, &slots, &marked, &fonts);
        let boxes = fill_box_operations(rects);
        build_byte_splice(&raw, &content.operations, &replacements, &boxes)
    }
}
```

- [ ] **Step 4: Run to verify pass, then the whole surgery suite**

Run: `CARGO_BUILD_JOBS=1 RUSTFLAGS="-C debuginfo=0 -C codegen-units=1" cargo test -p pdf-core --lib surgery`
Expected: PASS — the new test plus every pre-existing surgery test (op-path unchanged for guard-passing pages).

- [ ] **Step 5: Run the full pdf-core lib suite + clippy**

Run: `CARGO_BUILD_JOBS=1 RUSTFLAGS="-C debuginfo=0 -C codegen-units=1" cargo test -p pdf-core --lib`
Expected: PASS (all prior tests + the new ones).
Run: `CARGO_BUILD_JOBS=1 RUSTFLAGS="-C debuginfo=0 -C codegen-units=1" cargo clippy -p pdf-core --lib`
Expected: no new warnings.

- [ ] **Step 6: Commit**

```bash
git add crates/pdf-core/src/surgery.rs
git commit -m "feat(pdf): byte-level surgery fallback when the stream will not re-encode

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Shadow op-path vs byte-path over the corpus (bar-A confirmation + bar-B diagnosis)

Expose an eval-only diagnostic that runs BOTH surgery writers on a page and reports their dispositions, then add a `pdf-eval` validation operation that aggregates the comparison across the corpus. This confirms bar A (TAMReview flips flatten→surger, zero regressions) and answers bar B (can the byte-path replace the op-path everywhere).

**Files:**
- Modify: `crates/pdf-core/src/surgery.rs` (add a `pub` diagnostic entry) and `crates/pdf-core/src/lib.rs` (re-export it).
- Create: `crates/pdf-eval/src/validate/operations/surgery.rs`
- Modify: `crates/pdf-eval/src/validate/operations/mod.rs`, `crates/pdf-eval/src/validate/mod.rs` (register).

**Interfaces:**
- Produces in `pdf-core`:
  - `#[derive(Debug, Clone, Copy, PartialEq)] pub enum SurgeryDisposition { Surgered, Flattened }`
  - `pub struct SurgeryPathComparison { pub op_path: SurgeryDisposition, pub byte_path: SurgeryDisposition }`
  - `pub fn compare_surgery_paths(pdf_bytes: &[u8], page: usize, rects: &[Rect]) -> Option<SurgeryPathComparison>` — loads the doc, runs the op-path (force whole-stream re-encode) and the byte-path (force splice) independently on `page`, assembles a hayro probe per writer, and reports whether each passes the surgery outcome gate. Returns `None` if the page cannot be loaded/enumerated at all.
  - `pub(crate) fn surgery_candidate_passes_gate(probe: &hayro::hayro_syntax::Pdf, page: usize, rects: &[Rect]) -> bool` in `redact.rs` — the surgery outcome gate, extracted verbatim from the inline block in `redact()` (re-observe the page via hayro; fail if any non-whitespace glyph centre lands in a rect, or an image cover intersects a rect). `redact()` is refactored to call it (behavior-preserving).
- Consumes in `pdf-eval`: the `ValidationOperation` trait (`crates/pdf-eval/src/validate/operation.rs`) — `name()` + `run(&[u8]) -> OperationVerdict`. The crate is referenced as `pdf_core::` (e.g. `pdf_core::Rect`, `pdf_core::compare_surgery_paths`).

- [ ] **Step 1: Write the failing pdf-core test**

```rust
#[test]
fn compare_surgery_paths_reports_both_writers() {
    // On the inline-image page: op-path flattens (guard trips), byte-path surgers.
    let raw: &[u8] =
        b"BT /F1 12 Tf 0 0 Td (Hello) Tj ET\nq BI /W 2 /H 2 /CS /Weird /BPC 8 ID \x01\x02\x03\x04 EI Q";
    let (doc, _page_id) = crate::surgery::tests::doc_with_content(raw, "Helvetica");
    let mut pdf = Vec::new();
    { let mut d = doc; d.save_to(&mut pdf).unwrap(); }
    let rects = [Rect { x0: -1.0, y0: -1.0, x1: 1000.0, y1: 1000.0 }];
    let cmp = crate::surgery::compare_surgery_paths(&pdf, 0, &rects).unwrap();
    assert_eq!(cmp.op_path, crate::surgery::SurgeryDisposition::Flattened);
    assert_eq!(cmp.byte_path, crate::surgery::SurgeryDisposition::Surgered);
}
```

- [ ] **Step 2: Run to verify failure**

Run: `CARGO_BUILD_JOBS=1 RUSTFLAGS="-C debuginfo=0 -C codegen-units=1" cargo test -p pdf-core --lib compare_surgery_paths`
Expected: FAIL — `compare_surgery_paths` not found.

- [ ] **Step 3: Implement the diagnostic in `surgery.rs`**

Refactor the two writer bodies from Task 4 into small named functions so both `try_build_surgery` and the diagnostic call them:

```rust
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum SurgeryDisposition {
    Surgered,
    Flattened,
}

pub struct SurgeryPathComparison {
    pub op_path: SurgeryDisposition,
    pub byte_path: SurgeryDisposition,
}

/// Run the op-path writer (whole-stream re-encode) on one page, ignoring the round-trip
/// guard. Returns the surgered bytes, or None if it cannot produce a stream.
fn op_path_write(
    content: &Content, slots: &[GlyphSlot], marked: &[usize],
    fonts: &BTreeMap<Vec<u8>, FontMetrics>, rects: &[Rect],
) -> Option<Vec<u8>> {
    let mut edited = content.clone();
    apply_excision(&mut edited, slots, marked, fonts, rects);
    edited.encode().ok()
}

/// Run the byte-path writer on one page. Returns the spliced bytes, or None on desync.
fn byte_path_write(
    raw: &[u8], content: &Content, slots: &[GlyphSlot], marked: &[usize],
    fonts: &BTreeMap<Vec<u8>, FontMetrics>, rects: &[Rect],
) -> Option<Vec<u8>> {
    let replacements = op_replacements(content, slots, marked, fonts);
    let boxes = fill_box_operations(rects);
    build_byte_splice(raw, &content.operations, &replacements, &boxes)
}

/// Diagnostic: run BOTH writers on one page and report whether each produced a
/// gate-passing stream. Bar-A confirmation and the bar-B decision are read off the
/// aggregate of these across a corpus. `Surgered` = the writer produced a stream that
/// passes the surgery outcome gate; otherwise `Flattened`.
pub fn compare_surgery_paths(
    pdf_bytes: &[u8], page: usize, rects: &[Rect],
) -> Option<SurgeryPathComparison> {
    let doc = lopdf::Document::load_mem(pdf_bytes).ok()?;
    let page_id = *doc.get_pages().get(&((page + 1) as u32))?;
    let raw = doc.get_page_content(page_id).ok()?;
    let content = lopdf::content::Content::decode(&raw).ok()?;
    let fonts = page_fonts(&doc, page_id);
    let [llx, lly, _, _] = resolve_mediabox(&doc, page_id)?;
    if resolve_rotate(&doc, page_id).rem_euclid(360) != 0 {
        return None;
    }
    let slots = enumerate_page_glyphs(
        &content, &fonts, kurbo::Affine::translate((-llx as f64, -lly as f64)),
    ).ok()?;
    let marked = mark_in_rects(&slots, rects);

    // Assemble a hayro probe by installing `candidate` as the page's content stream.
    let build_probe = |candidate: &[u8]| -> Option<hayro::hayro_syntax::Pdf> {
        let mut probe_doc = doc.clone(); // lopdf Document::clone is deep
        let content_id = probe_doc
            .add_object(lopdf::Stream::new(lopdf::Dictionary::new(), candidate.to_vec()));
        probe_doc
            .get_dictionary_mut(page_id)
            .ok()?
            .set("Contents", lopdf::Object::Reference(content_id));
        let mut bytes = Vec::new();
        probe_doc.save_to(&mut bytes).ok()?;
        hayro::hayro_syntax::Pdf::new(bytes).ok()
    };
    let disposition = |candidate: Option<Vec<u8>>| -> SurgeryDisposition {
        match candidate.as_deref().and_then(build_probe) {
            Some(probe) if crate::redact::surgery_candidate_passes_gate(&probe, page, rects) => {
                SurgeryDisposition::Surgered
            }
            _ => SurgeryDisposition::Flattened,
        }
    };
    Some(SurgeryPathComparison {
        op_path: disposition(op_path_write(&content, &slots, &marked, &fonts, rects)),
        byte_path: disposition(byte_path_write(&raw, &content, &slots, &marked, &fonts, rects)),
    })
}
```

**Wire `try_build_surgery` to the same writer functions.** In Task 4's `try_build_surgery`, replace the inline op-path/byte-path bodies with calls to `op_path_write` / `byte_path_write` so there is exactly one copy of each writer.

**Extract the gate in `redact.rs`.** Lift the per-candidate gate body (the `observe_page` + non-whitespace-glyph-centre-in-rect check + image-cover-intersection check that currently lives inline in `redact()`) into:

```rust
/// The surgery outcome gate for one candidate page: re-observe `probe` at `page` via
/// hayro and return true iff no non-whitespace glyph centre lands inside any rect and no
/// image cover intersects any rect. Extracted so both `redact` and `compare_surgery_paths`
/// share one gate.
pub(crate) fn surgery_candidate_passes_gate(
    probe: &hayro::hayro_syntax::Pdf,
    page: usize,
    rects: &[Rect],
) -> bool {
    let Some(obs) = crate::textpos::observe_page(probe, page) else {
        return false; // cannot observe — conservatively fail
    };
    // ... (the existing glyph-centre and image-cover checks verbatim; returns !any_inside)
}
```

Replace the inline block in `redact()` with `let passes_gate = surgery_candidate_passes_gate(&probe_pdf, candidate.page, &candidate.rects);`. The existing redaction tests (`redact_removes_target_text_and_passes_gate`, `gate_fails_when_text_survives`, etc.) are the regression guard that this extraction is behavior-preserving.

Re-export from `lib.rs`: `pub use surgery::{compare_surgery_paths, SurgeryDisposition, SurgeryPathComparison};` (match the existing `pub use` style; `surgery_candidate_passes_gate` stays `pub(crate)`, not re-exported).

- [ ] **Step 4: Run to verify pass**

Run: `CARGO_BUILD_JOBS=1 RUSTFLAGS="-C debuginfo=0 -C codegen-units=1" cargo test -p pdf-core --lib`
Expected: PASS.

- [ ] **Step 5: Commit the diagnostic**

```bash
git add crates/pdf-core/src/surgery.rs crates/pdf-core/src/redact.rs crates/pdf-core/src/lib.rs
git commit -m "feat(pdf): compare_surgery_paths diagnostic (op-path vs byte-path per page)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: Add the pdf-eval `surgery` validation operation**

Create `crates/pdf-eval/src/validate/operations/surgery.rs`. Follow the structure of the existing `forms.rs` operation (same file's sibling) for the `ValidationOperation` impl and reporting style. Per document, redact page 0 with a fixed name-sized rect over its first text and compare the two paths:

```rust
use crate::validate::operation::{Outcome, OperationVerdict, Safety, ValidationOperation};

pub struct SurgeryOperation;

impl ValidationOperation for SurgeryOperation {
    fn name(&self) -> &str { "surgery" }

    fn run(&self, bytes: &[u8]) -> OperationVerdict {
        // A generous rect over the lower-left; page 0. Real corpus pages have text here,
        // and the comparison is only meaningful where glyphs are marked.
        let rects = [pdf_core::Rect { x0: 0.0, y0: 0.0, x1: 300.0, y1: 200.0 }];
        match pdf_core::compare_surgery_paths(bytes, 0, &rects) {
            None => OperationVerdict {
                outcome: Outcome::Skipped { reason: "page 0 not analyzable".into() },
                safety: Safety::NotApplicable,
            },
            Some(cmp) => {
                use pdf_core::SurgeryDisposition::*;
                let variant = match (cmp.op_path, cmp.byte_path) {
                    // Byte-path matches or beats op-path — the bar-B-favourable cases.
                    (Surgered, Surgered) => "both_surgered",
                    (Flattened, Surgered) => "byte_path_recovers", // bar A: the win
                    (Flattened, Flattened) => "both_flattened",
                    // Byte-path LOSES to op-path — the only bar-B blocker.
                    (Surgered, Flattened) => "byte_path_regresses",
                };
                let safety = if variant == "byte_path_regresses" {
                    Safety::Violated { detail: "byte-path flattened a page the op-path surgered".into() }
                } else {
                    Safety::Upheld
                };
                OperationVerdict { outcome: Outcome::Success { variant: variant.into() }, safety }
            }
        }
    }
}
```

Register it: in `crates/pdf-eval/src/validate/operations/mod.rs` add `pub mod surgery;` and re-export `SurgeryOperation`; in `crates/pdf-eval/src/validate/mod.rs` add `Arc::new(SurgeryOperation)` to the `operations` vec beside `FormsOperation`.

The report reads directly as the two bars: any `byte_path_recovers` is a bar-A win (TAMReview); zero `byte_path_regresses` across the corpus means **bar B is safe** (the op-path can be deleted); any `byte_path_regresses` names a page and keeps B deferred.

- [ ] **Step 7: Run the eval validate suite over the corpus**

Run: `CARGO_BUILD_JOBS=1 RUSTFLAGS="-C debuginfo=0 -C codegen-units=1" cargo test -p pdf-eval`
Expected: PASS. Then run the validate mode over the local corpus per `crates/pdf-eval/src/main.rs` usage (the `validate` subcommand) and read the `surgery` operation's variants. Record in the commit message the counts of `byte_path_recovers` (bar A) and `byte_path_regresses` (bar B verdict).

- [ ] **Step 8: Commit**

```bash
git add crates/pdf-eval/src/validate/operations/surgery.rs \
        crates/pdf-eval/src/validate/operations/mod.rs \
        crates/pdf-eval/src/validate/mod.rs
git commit -m "feat(pdf-eval): shadow op-path/byte-path surgery comparison operation

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Definition of done

- All `pdf-core` lib tests and `pdf-eval` tests pass under the memory-limited build flags.
- An inline-image page that previously flattened now surgers, with inline-image bytes byte-identical.
- Every page the op-path already surgered still surgers (op-path untouched for guard-passing streams).
- The `pdf-eval` `surgery` operation reports the bar-A wins and the bar-B verdict from corpus data.
- `pnpm run lint:process-refs` is clean for the touched files; `cargo clippy -p pdf-core --lib` has no new warnings.

## Follow-ups (out of scope here)

- If the corpus shows zero `byte_path_regresses`, execute bar B: delete the op-path branch and route all surgery through `build_byte_splice`, keeping the outcome gate. Separate change.
- Inline-image *editing* (removing a glyph that overlaps an inline image) remains flatten-only; this plan preserves inline images, it does not redact within them.
