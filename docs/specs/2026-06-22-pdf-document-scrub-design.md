# PDF engine — whole-document scrub (redaction safety) — design

**Status:** Draft (implementation-grade design) · **Date:** 2026-06-22 · **Owner:** Trevor Goldsmith
**Builds on:** [`2026-06-22-pdf-slice-2-redaction-design.md`](2026-06-22-pdf-slice-2-redaction-design.md) (the page-scoped redaction engine + the verification gate) · roadmap [`2026-06-21-rust-pdf-engine-roadmap-design.md`](2026-06-21-rust-pdf-engine-roadmap-design.md)
**Relates to / revisits:** the redaction slice's named-seam "document-level metadata deep-scrub" — **this design retires that deferral.**
**ADRs to raise:** `pdf-document-scrub` (the sanitize-by-default model + the five-layer hard gate + the decompress-and-scan content guarantee).
**Build gates:** the redaction slice landed on this branch (`pdf-core::redact` + the gate + `@magna-carta/pdf`). Backend-only, no UI. Executes on the existing `pdf-engine-roadmap` worktree.

Page-scoped redaction removes content from the *pages* it touches, but a redacted string can still survive in **document-level surfaces** that no page-render reaches: the Info dictionary and XMP metadata, embedded-file attachments, an XFA form dataset, AcroForm field values, the Tagged-PDF structure tree (`ActualText`/`Alt`), bookmark titles, and content hidden in an optional-content (OCG) layer — and any of these can be **compressed**, so the redaction slice's raw-byte output scan would miss it. This design adds a configurable whole-document **scrub** that removes those surfaces, and extends the verification gate so a redacted string cannot survive *anywhere* in the output — compressed or not.

---

## 1. Dependency foundation (golden rule 11)

The redaction building blocks are all on their **latest published stable** as of this design: `hayro` 0.7.1, `hayro-interpret` 0.7.0, `image` 0.25.10, `lopdf` 0.41.0, `pdf` (pdf-rs) 0.10.0. lopdf's git HEAD is a handful of unreleased bug-fix commits ahead of the 0.41.0 tag (parser nesting limits, an ObjStm xref-writer fix, content-stream newline handling) but carries **no newer published version**; the redaction output already round-trips correctly on 0.41.0. We pin **lopdf 0.41** (latest stable, not a moving git SHA) and pick up 0.42 when it ships.

lopdf 0.41 already provides the helpers this design leans on: `catalog_mut`, `get_dictionary_mut`, `get_outlines`/`build_outline`, `get_named_destinations`, `delete_object`, `prune_objects`, `Stream::decompressed_content`, and the public `objects: BTreeMap<ObjectId, Object>` map. It has **no** built-in EmbeddedFiles/AcroForm/Metadata helpers, so those surfaces are reached by navigating the catalog directly (`/Names/EmbeddedFiles`, `/AcroForm`, `/Metadata`, `/StructTreeRoot`, `/OCProperties`) and removing entries.

## 2. Architecture

A new focused module `crates/pdf-core/src/scrub.rs`. Scrub is a **standalone** capability that `redact` **composes** — sanitize-by-default redaction *plus* a reusable "sanitize a production" seam (e.g. for the eventual Discovery pipeline) that does not require redacting any page.

```
crates/pdf-core/
  src/scrub.rs    # ScrubOptions + sanitize_document + the document-surface removals
  src/redact.rs   # redact() composes sanitize_document; verify_gate gains the new checks
  src/wasm.rs     # + sanitizeDocument edge; redactDocument opts gain `scrub`
  src/lib.rs      # re-export scrub
packages/pdf/src/index.ts   # + sanitizeDocument(bytes, opts?); RedactionOptions gains scrub?
crates/pdf-eval/src/main.rs # + a sanitize smoke
```

```rust
/// Which document-level surfaces to remove. Every field defaults to `true`
/// (scrub everything); set a field false to retain that surface.
#[derive(Debug, Clone)]
pub struct ScrubOptions {
    pub metadata: bool,            // Info dict + catalog /Metadata (XMP) stream
    pub attachments: bool,         // /Names/EmbeddedFiles, /FileAttachment annots, /AF, /Collection
    pub xfa: bool,                 // AcroForm /XFA
    pub form_field_values: bool,   // clear field /V, /DV, widget /AP; set /NeedAppearances
    pub structure_tree: bool,      // /StructTreeRoot + /MarkInfo (ActualText/Alt)
    pub outlines: bool,            // /Outlines (bookmarks) + named destinations
    pub optional_content: bool,    // /OCProperties (so nothing stays hidden in a layer)
}
impl Default for ScrubOptions { /* all true */ }

#[derive(Debug)]
pub enum ScrubError { Parse, Reassemble, GateFailed { detail: String } }

/// Sanitize a PDF's document-level surfaces in place. Standalone — usable
/// without any page redaction.
pub fn sanitize_document(doc: &mut lopdf::Document, opts: &ScrubOptions) -> Result<(), ScrubError>;
```

`RedactionOptions` gains a `scrub: ScrubOptions` field (defaulting to all-true). `redact` runs `sanitize_document` after the page-reassembly loop, with `prune_objects()` and the gate after. `ScrubError` reuses the same three cases the redaction error already carries — `Parse`, `Reassemble`, `GateFailed { detail }` — so on the redaction path `redact` maps each `ScrubError` case to the identically-named `RedactError` case (no new `RedactError` variant is needed). `redact.rs` keeps only rasterize/reassemble; all document-surface logic lives in `scrub.rs`.

`sanitize_document` performs only the removals — it does **not** prune or verify. Pruning and the gate are always the caller's responsibility (a single `prune_objects()` pass after both reassembly and scrub, then the gate), so the standalone `sanitizeDocument` edge and `redact` share one ordering.

**Flow inside `redact`:** reassemble each affected page → `sanitize_document(&mut doc, &opts.scrub)` → `prune_objects()` (single pass; drops every now-orphaned object) → `verify_gate` → `save_to`.

## 3. Per-surface scrub semantics

Each runs only if its flag is true.

| Flag | Operation (lopdf) |
| --- | --- |
| `metadata` | Remove the trailer `/Info` dictionary (Title/Author/Subject/Keywords/Creator/Producer/CreationDate/ModDate/custom) and the catalog `/Metadata` (XMP) stream. |
| `attachments` | Remove `/Names/EmbeddedFiles`; remove `/FileAttachment` annotations from every page's `/Annots`; remove `/AF` associated-file arrays (catalog + pages); remove a catalog `/Collection` (portfolio). |
| `xfa` | Remove `AcroForm /XFA` (the XML dataset that mirrors form data). Regular fields untouched. |
| `form_field_values` | Walk `AcroForm /Fields` recursively (through `/Kids`); clear each terminal field's `/V` and `/DV` and each widget's `/AP`; set `AcroForm /NeedAppearances true`. Keeps a blank fillable form. |
| `structure_tree` | Remove catalog `/StructTreeRoot` and `/MarkInfo`. Drops `ActualText`/`Alt` text mirrors. Trade-off: the output loses accessibility tagging — hence an opt-out, not forced. |
| `outlines` | Remove catalog `/Outlines` (bookmark `/Title`s leak text) and `/Names/Dests` named destinations. |
| `optional_content` | Remove catalog `/OCProperties` so no content can stay hidden in an "off" layer. |

**`optional_content` is config-level.** Removing `/OCProperties` un-hides everything but leaves the `/OC` marked-content operators in *unaffected* page content streams (their text is made visible, not removed). True content-level OCG excision is deferred; the decompress-and-scan gate (§4) still catches any *supplied* redacted string inside such content, so it cannot silently survive. The docs state this boundary plainly.

After all enabled removals, the **caller** runs `prune_objects()` (see §2 — `sanitize_document` itself does not prune) so the now-orphaned metadata stream, attachment blobs, struct-tree nodes, and outline nodes are physically dropped — not merely unlinked — exactly as the page redaction prunes the original content streams.

## 4. The hardened verification gate

The redaction gate already runs, after reassembly, three checks: per-affected-page `extract_text` (fails closed on an extraction error), a tolerant whole-document `extract_text` content-string check, and a raw-byte scan of the emitted bytes. Scrub adds two checks, both before any bytes are emitted:

**(a) Structural-absence (always, per scrubbed surface).** For each surface the caller actually scrubbed (opted-out surfaces are skipped), assert the catalog/trailer no longer references it: no `/Info`, no `/Metadata`, no `/Names/EmbeddedFiles`, no `AcroForm /XFA`, no terminal field `/V`·`/DV`, no `/StructTreeRoot`, no `/Outlines`, no `/OCProperties`, as applicable. Any survivor → `GateFailed`, no emit.

**(b) Logical-content decompress-and-scan (the compressed-survival closer).** Walk every object in `doc.objects` (the parsed, in-memory document) and, for each supplied `redactedText` string, scan every decoded `Object::String`/`Name` (recursively through arrays and dictionaries) **and** every stream's `decompressed_content()`. Because the scan operates on the *logical* objects — strings already decoded, streams decompressed — it is immune to how the bytes are stored (Flate, object streams, cross-reference streams). A redacted string anywhere in the document's content → `GateFailed`.

The existing raw-byte scan of the final saved bytes is kept as a cheap belt. The full gate is therefore five layers: per-affected-page text (fail-closed) · whole-document text (tolerant) · structural-absence of scrubbed surfaces · logical-content decompress-scan · raw-output byte scan. On any failure: `Err`, **no bytes emitted**.

Cost is one extra decode pass over the document — negligible beside page rendering. The decompress-scan does meaningful work only when the caller supplies `redactedText`; structural-absence runs regardless. `sanitize_document` invoked standalone (no `redactedText`) verifies structural removal only.

## 5. WASM + TS surface

- New edge `sanitizeDocument(bytes: Uint8Array, opts?: ScrubOptions): { pdf: Uint8Array }`, with `ScrubOptions = { metadata?, attachments?, xfa?, formFieldValues?, structureTree?, outlines?, optionalContent? }` (each defaulting `true`). Marshaled JS→Rust via `serde-wasm-bindgen`, same pattern and deterministic discipline as `redactDocument`.
- `redactDocument`'s `opts` gains optional `scrub?: ScrubOptions` (omitted ⇒ scrub-all). Redaction is sanitized-by-default; pass e.g. `scrub: { structureTree: false }` to retain a surface.
- Client-side-by-default holds: privileged bytes never leave the device.

## 6. Testing

TDD, per the slice discipline (failing test first, watch it fail, minimal implementation, watch it pass, commit).

- **Per-surface scrub unit tests:** for each of the seven surfaces, a fixture carrying it → assert it is structurally gone after `sanitize_document`, and still *present* when that surface is opted out (the toggle works both ways).
- **Logical-content scan tests (the security core):** a document with a known string embedded in (i) XMP metadata, (ii) a bookmark title, (iii) a *compressed* content stream, and (iv) an object-stream-packed dictionary → assert the decompress-scan returns `GateFailed` when that string is supplied and would otherwise survive, and passes once the surface is scrubbed.
- **Negative gate test (mandatory):** the logical-content scan must be able to *fail* — a doc that still contains the supplied string must return `GateFailed`. A scan that cannot fail is a no-op.
- **Composition test:** `redact` a page on a document with leaky metadata + a bookmark mirroring the redacted text → the output has those surfaces gone and the gate passes.
- **Harness:** a `sanitize` / `sanitize-smoke` mode in `pdf-eval` (sanitize a corpus file, assert the structural-absence gate passes), runnable in CI default features.

**Fixtures:** the corpus IRS W-4/W-9 AcroForms cover form fields (and likely XMP/XFA); `TAMReview.pdf` likely covers bookmarks and a structure tree. Attachments, OCG, and a guaranteed-compressed-survival case need small synthetic fixtures; the implementation plan sources or constructs each and notes any that must be built.

## 7. Deferred / named seams

- **Content-level OCG excision** (removing hidden marked-content from unaffected pages, not just the `/OCProperties` config) — the decompress-scan covers *supplied-string* survival in the interim.
- **Selective metadata retention** (e.g. keep a sanitized Producer/CreationDate while stripping author/identifying fields) — v1 removes the whole Info dictionary when `metadata` is enabled.
- **Page-content text in unaffected pages** — out of scope by definition; scrub targets document-level surfaces, redaction targets pages.

## 8. Open items to confirm at build (golden rule 11)

- Re-verify lopdf's catalog/Names-tree navigation API for `/EmbeddedFiles` and `/Dests` (name trees can be nested via `/Kids`).
- Confirm `decompressed_content` returns decoded bytes for the filter types in the corpus (Flate; verify behavior on un-filtered and on multiply-filtered streams).
- Confirm the AcroForm `/Fields` walk reaches fields whose values live on `/Kids` widgets vs the field node.
- Confirm `prune_objects` removes name-tree intermediate nodes once the root entry is detached.
