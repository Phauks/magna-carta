# Byte-level content surgery — design

**Status:** design (approved to plan). Area: `crates/pdf-core` (the pure-Rust PDF engine). Relates to the surgery/redaction feature and the `pdf-eval` validation harness.

## Problem

Text-preserving redaction ("surgery") removes marked glyphs from a page's content stream while leaving the rest of the page intact, then verifies the result with an outcome gate (re-observe the page; any surviving marked glyph → fall back to flatten). The current builder (`try_build_surgery` in `surgery.rs`) analyzes the page by decoding the content stream into an operation list, walking a text-state machine to locate every glyph, marking those inside the redaction rectangles, rewriting the show operators, and **re-encoding the whole operation list back to bytes**.

That final whole-stream re-encode is the weak point. `lopdf`'s content decode/encode is **lossy for inline images** (`BI … ID <bytes> EI`) and some exotic constructs: re-encoding mangles or drops them. A round-trip guard up front (decode → encode → decode; flatten if the operation count changes) catches this and refuses the page — so a page whose *text* is perfectly analyzable is thrown away because an unrelated inline image cannot survive lopdf's re-serialization. On the current eval corpus this is the one remaining real flatten (TAMReview); more broadly it is a whole class of "the text is fine but the stream won't round-trip" failures.

## Goal

Add a second surgery path that edits the content stream **at the byte level**: copy the original bytes verbatim and replace only the byte-spans of the show operators actually being edited, so inline images and every untouched operator are byte-identical in the output and never pass through a re-encode. This removes the round-trip-fidelity failure class.

**Scope (bar A):** land the byte-level path as an **additive fallback** — reached only where the whole-stream re-encode would otherwise force a flatten. The proven op-list path is unchanged for every page it already handles (zero regression). Instrument the work to **diagnose bar B** (whether the byte-level path could safely subsume the op-list path entirely) from corpus data rather than by assertion.

## Non-goals

- Not replacing the op-list path in this change (that is bar B — a follow-up gated on the diagnosis below).
- Not parsing or rewriting inline-image bytes — they are copied through opaquely.
- No new public engine API; no change to the WASM surface. This is internal to surgery.
- OCR, signatures (PAdES), CJK/non-Identity Type0 coverage are out of scope.

## Design

### 1. Reorder `try_build_surgery`, then branch on the round-trip guard

Today the round-trip guard sits *before* the glyph analysis, so it discards a page before that page's text is ever examined. Reorder so analysis runs first and the guard only selects which writer to use:

```
decode → fonts → mediabox → rotate → enumerate_page_glyphs → mark_in_rects
   ├─ round-trip guard PASSES → op-path:   apply_excision + whole-stream encode   (unchanged)
   └─ round-trip guard FAILS  → byte-path:  splice the original bytes              (new)
```

`slots` (the located glyphs) and `marked` (those inside the rects) are computed once and shared by both writers. Rotation/MediaBox/font-support refusals are unchanged and still flatten before either writer. The byte-path is only *used* when the guard fails, so common pages are untouched — this is exactly bar A.

The glyph analysis is valid on a guard-failing page because the failure is in re-*encoding*, not in *decoding*: `enumerate_page_glyphs` walks the decoded operation list and produces correct `GlyphSlot`s (each carries `op` = operation index, `elem` = `TJ` array element, `byte_off`/`byte_len` = the glyph's range within the decoded string operand). Inline images do not advance text position, so they do not perturb the walk.

### 2. New module `content_tokens.rs` — the raw tokenizer

A pure `&[u8] → Vec<RawToken>` scan of the original content stream, with **no PDF-model knowledge** and no string-content decoding. It emits one token per operator, **in the same order and count as `lopdf::content::Content::decode`**, recording only:

- the operator name, and
- the full byte range `[start, end)` of that operator invocation (its operands plus the operator) in the original stream.

`BI … ID <bytes> EI` is emitted as a single opaque `InlineImage` token spanning the whole construct — matching lopdf, which represents an inline image as one `"BI"` operation — and its bytes are never parsed. This is the core mechanism: an inline image survives because the writer only ever *copies* its span.

The tokenizer deliberately does **not** decode string operands. Decoded string bytes already come from lopdf's `operation.operands`, so the byte-path works in decoded space for string *content* and uses the tokenizer only to answer "where does each operator begin and end in the raw bytes." The tokenizer must still correctly *skip over* string operands (honoring `()` literal nesting/escapes and `<>` hex) so it finds operator boundaries, but it emits no per-byte map.

### 3. The splicer — reuse the op-path's rebuild, encode per-operator

The op-path already contains exactly the rewrite we want: for each show operator (`Tj` / `TJ` / `'` / `"`) with a marked glyph, `apply_excision` rebuilds it into an equivalent `TJ` whose surviving runs are verbatim `Literal` strings taken from the decoded operand (`source_bytes[byte_off..byte_off+byte_len]`) and whose removed runs collapse to a single numeric advance-compensation element, so glyphs surviving to the right of the rect **do not shift**. Its only failure is the final step: re-encoding the *whole* operation list, which forces lopdf to re-serialize the inline images it mangles.

So the byte-path **reuses that rebuild verbatim** and changes only how bytes are produced. Factor the op-path's two build steps into pure helpers shared by both paths:
- `op_replacements(content, slots, marked, fonts) -> BTreeMap<usize, Vec<Operation>>` — for each affected operation index, the replacement operations (a rebuilt `TJ`, preceded by `T*` when the original was `'`/`"`). This is the existing `apply_excision` logic lifted out unchanged; the op-path now consumes it to rebuild the operation list exactly as before (byte-identical op-path behavior, guarded by its existing tests).
- `fill_box_operations(rects) -> Vec<Operation>` — the `q rg re f Q` boxes, likewise lifted out.

The byte-path then:
1. copies the original stream bytes verbatim, and
2. for each affected operation index, encodes **just that operation's** replacement — `Content{operations: replacement}.encode()` — and splices those bytes over the operator's raw byte span (padded with surrounding spaces so it can't glue to a neighbor), and
3. appends `fill_box_operations(rects)` encoded on their own.

Every per-operator re-encode touches only pure text (a `TJ` and, for `'`/`"`, a `T*`) — **never** an inline image — so lopdf's per-operator encode is safe. Surviving content is byte-exact at the decoded level because lopdf's `Literal` escaping is lossless and the kept bytes come straight from the original decoded string. Every untouched byte — inline images, `Do` XObject invocations, graphics-state operators — is identical to the input because it is never re-encoded.

This is strictly less new code than an independent splicer, and the compensation math cannot drift between the two paths because there is only one copy of it.

### 4. Correlation self-check — the safety valve

Zip lopdf's operation list against the tokenizer's tokens by index. If the operator names disagree at any position the writer intends to edit — a sign the tokenizer desynced from lopdf on some construct — the byte-path returns `None` and the page flattens. Because flatten is *today's* outcome for these pages, a tokenizer miss can only ever fall back to safe-flatten; it can never emit a corrupted stream. This runs beneath the existing outcome gate (re-observe the spliced page; any surviving marked glyph or parse failure → flatten), giving two independent nets under the new path.

### 5. Error handling / safety

- The byte-path returns `Option<Vec<u8>>` like the op-path; any uncertainty → `None` → flatten.
- The outcome gate in `redact` is unchanged and runs identically on byte-path output — the ultimate no-leak guarantee.
- No new public API on `Document`; no WASM-surface change.

## Testing

**Unit (`pdf-core`):**
- Mid-string glyph removal preserves the position of glyphs to the right (advance compensation correct).
- A survivor run from a `(...)` literal re-encodes to byte-exact hex.
- A `TJ` operator carrying kerning numbers, partially removed, rebuilds correctly.
- An inline-image page (TAMReview-shaped) surgers instead of flattening, and the inline-image bytes are byte-identical in the output.
- A deliberately desynced tokenizer input → the self-check flattens (no corrupt output).

**Corpus (`pdf-eval` apparatus) — also the bar-B diagnosis.** Add a `surgery` validation operation that, for every corpus page, runs **both** the op-path and the byte-path in shadow and records: does the byte-path gate-pass? does it remove exactly the op-path's marked set? does surviving layout match within tolerance? One run answers both questions:

- **Bar A:** TAMReview flips flatten → surger; the 8 pages that already surger are unchanged; image-only pages (cmykjpeg) still correctly skip. Zero regressions, reported as a number.
- **Bar B:** if the byte-path matches-or-beats the op-path on **every** page with zero leaks, B is safe — the op-path can be deleted and all surgery routed through the byte splicer. If any page shows the byte-path losing, the report names it and B stays deferred with a stated reason. B becomes a data-backed decision, not a leap.

## Files touched

- `crates/pdf-core/src/content_tokens.rs` — new; the raw tokenizer.
- `crates/pdf-core/src/surgery.rs` — factor `op_replacements` + `fill_box_operations` out of `apply_excision` (op-path behavior unchanged); reorder `try_build_surgery` to branch on the guard; add `build_byte_splice`.
- `crates/pdf-core/src/lib.rs` — register the new module.
- `crates/pdf-eval/…` — a `surgery` validation operation running both paths in shadow with the A/B report.
- Tests alongside each.

Net new code is roughly 250–400 lines; the text-state machine, marking, excision/compensation rebuild, and outcome gate are all reused.

## Risks

- **Tokenizer/lopdf desync on exotic streams** — mitigated by the operator-name/count self-check (→ flatten) and the outcome gate (→ flatten). Worst case is a safe-flatten, i.e. today's behavior.
- **Per-operator re-encode changing rendering** — ruled out: the only re-encoded operators are pure-text `TJ`/`T*`, and lopdf's `Literal` escaping is lossless, so decoded content and glyph codes are preserved. Inline images are never re-encoded.
- **Advance-compensation drift between the two paths** — ruled out: `op_replacements` is the single shared source of the rewrite for both paths.
