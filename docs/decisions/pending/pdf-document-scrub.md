---
slug: pdf-document-scrub
status: Accepted
area: Documents
date: 2026-06-22
summary: PDF document sanitization removes seven document-level surfaces by default with per-surface opt-outs; a five-layer hard gate including logical-content decompress-and-scan closes compressed string survival; OCG content-level operator excision and selective metadata retention are deferred.
---

**PDF document sanitization removes seven document-level surfaces by default with per-surface opt-outs; a five-layer hard gate including logical-content decompress-and-scan closes compressed string survival; OCG content-level operator excision and selective metadata retention are deferred.**

**Context:** Sharing a PDF outside the firm requires stripping surfaces that carry firm-internal or personal data beyond the visible page content — document metadata (author, application, creation timestamps), XFA form definitions, accessibility structure trees, bookmark outlines, optional-content layer configurations, embedded file attachments, and form field values. These surfaces are document-level, not page-level, and their removal does not alter the visible content of any page. A second concern is survivability: any of these surfaces could contain or reference sensitive text, and a naive strip that leaves compressed copies of the data in linearization or cross-reference artifacts would be a silent correctness failure.

**Decision — sanitize-by-default with per-surface opt-outs:** The `sanitize` function (and the corresponding `sanitizeDocument` WASM export) removes all seven surfaces in a single pass unless the caller opts a surface out via `ScrubOptions`. Every flag defaults to `true`. The per-surface removals are:

- `metadata`: deletes the `/Metadata` stream and the `/Info` dictionary from the document catalog.
- `xfa`: strips `/XFA` from the `AcroForm` dictionary; blank field shells are kept so the document remains operable as a form.
- `structure_tree`: removes `/StructTreeRoot` and associated role-map entries. Callers that need the output to remain accessible must pass `structure_tree: false`.
- `outlines`: removes the `/Outlines` bookmark tree.
- `optional_content`: removes `/OCProperties` from the catalog, eliminating the layer configuration so no content remains conditionally hidden.
- `attachments`: removes the `/EmbeddedFiles` name tree and deletes any `FileAttachment`-subtype annotations from every page.
- `form_field_values`: clears the `/V` (value) and `/AP` (appearance) entries from every form field; sets `NeedAppearances` so viewers regenerate blank appearances on open.

After all surface passes, orphaned objects are pruned so that the original bytes do not survive in unused cross-reference entries.

**Redaction is sanitized-by-default.** `redact` accepts an optional `scrub` field in `RedactionOptions`. When omitted the default is `true`, so a redaction output is also sanitized. This decision wires the two operations as a composed pipeline: redact first (rasterize-and-reassemble), then sanitize the result, before the verification gate runs.

**Five-layer hard gate:** After reassembly, `sanitize` enforces a verification gate before returning output. The gate runs five checks in order:

1. **Structural-absence scan** — walks the document object graph and asserts that each opted-in surface is absent from the catalog and all page dictionaries.
2. **Metadata text scan** — confirms no `/Info` dictionary and no `/Metadata` stream remain (belt-and-suspenders over the structural pass).
3. **Logical-content decompress-and-scan** — for any caller-supplied `redacted_text` strings, decompresses every content stream in the document and scans for the strings as literal bytes. This closes the compressed-survival path: a string stored inside a `FlateDecode`-compressed stream is found. This is the same scan that backs the `redact` gate, now also applied to sanitization.
4. **Raw-byte scan** — scans the emitted PDF bytes for the supplied strings as a raw byte subsequence, catching any uncompressed literal survivors outside content streams.
5. **Fail-closed on any check failure** — the function returns `ScrubError::GateFailed` and never returns an output PDF if any check fails or if the structural scan itself errors.

The gate does not decode custom-font glyph encodings or pixel-encoded image content; a string rendered only as glyph codes or rasterized into a pixel image is not matched as literal text. This boundary is documented at the call site.

**OCG content-level excision deferred:** Removing the `/OCProperties` configuration eliminates layer toggling — no content stays hidden — but does not excise the `BMC`/`EMC` marked-content operator boundaries and their enclosed drawing instructions from page content streams. Full operator excision requires a content-stream parser that is not yet built. The logical-content decompress-and-scan covers the known-string case. Content-level OCG excision is deferred to the slice that introduces the content-stream parsing primitive.

**Selective metadata retention deferred:** Some use cases require preserving a subset of metadata (e.g. the document title for a cover sheet) while stripping the rest. The current design is all-or-nothing per surface. Selective field-level retention within the `/Info` dictionary is deferred as an opt-in feature for a later revision of `ScrubOptions`.

**Consequences:** The sanitize pass is fast (no rasterization, pure object-graph manipulation + one decompression scan) and correct by construction for the seven covered surfaces. The accessibility penalty (`structureTree: true` drops tagging) is caller-controlled. The OCG and custom-encoding boundaries are documented honestly so consumers can decide whether rasterization is needed for their threat model.
