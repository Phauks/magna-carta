# EmbedPDF OCG (hidden-layer) removal — spike findings

**Status:** Spike complete (read-only investigation; no engine build) · **Date:** 2026-06-13 · **Owner:** Trevor Goldsmith
**Seeds:** a follow-up implementation plan + a second upstream PR (the OCG vector deferred from the document-sanitization PR)
**Parent:** [`2026-06-13-embedpdf-sanitize-completeness-design.md`](2026-06-13-embedpdf-sanitize-completeness-design.md) §4 · [`…-implementation-plan.md`](2026-06-13-embedpdf-sanitize-completeness-implementation-plan.md) Task 8
**Decision home:** ADR-0088 (§J upstream-first)

## Why OCG needed a spike (not just another delete-a-key vector)

XMP, JavaScript, and embedded thumbnails are removed by deleting a catalog/page key — safe and unambiguous. **Hidden optional-content groups (OCGs / "layers") are not.** Deleting `/OCProperties` alone would make hidden content _visible_ (the thing hiding it is gone) — the opposite of sanitization. A correct scrub must remove the _content marked by an OFF/hidden OCG_, then drop the now-orphaned OCG machinery. The open question was whether EmbedPDF/PDFium exposes enough to do that cleanly, or whether OCG forces a coarse rasterize-and-flatten fallback.

## Evidence (against the fork at `pdfium-src`, 2026-06-13)

- **No public OCG _mutation_ API.** `functions.ts` (the WASM exports) has zero `OCG`/`OptionalContent`/`OCProperties` symbols. So removal must be a new `EPDF_*` C++ export, like the other vectors.
- **But the content-removal tools exist and are exported:** `FPDFPage_CountObjects` / `FPDFPage_GetObject` / `FPDFPage_RemoveObject` / `FPDFPage_GenerateContent`, plus the full mark-inspection set `FPDFPageObj_CountMarks` / `FPDFPageObj_GetMark` / `FPDFPageObjMark_GetName` / `FPDFPageObjMark_GetParamStringValue` (and `FPDFPageObj_GetMarkedContentID`). Content inside a `/OC … BDC … EMC` bracket surfaces on PDFium's page objects as a mark named `OC` whose param references the OCG — so OCG membership is _discoverable per object_.
- **`CPDF_OCContext` exists in core** (`core/fpdfapi/page/cpdf_occontext.{h,cpp}`) and already encapsulates "is this OCG visible under the default configuration." That is exactly the OFF/hidden decision a sanitizer needs, rather than re-implementing the `/OCProperties /D /OFF` resolution by hand.
- `/OCProperties` itself is read in C++ off the catalog (`GetMutableRoot()->GetMutableDictFor("OCProperties")`), the same pattern the three shipped vectors use.

## Recommended strategy (for the follow-up plan)

A new C++ `EPDF_RemoveOptionalContentGroups(FPDF_DOCUMENT)` in `fpdfsdk/`:

1. Build a `CPDF_OCContext` from the document's default config; enumerate the OCGs that resolve to hidden (the `/OFF` set).
2. For each page, walk page objects; for any object whose `OC` mark (or `/OC` entry) references a hidden OCG, remove it (`RemoveObject` equivalent at the CPDF level) and regenerate content.
3. Remove the catalog `/OCProperties` once the governed content is gone.
4. Save (the existing non-incremental `saveAsCopy`).

Wire it into `sanitizeDocument` behind a new `optionalContentGroups` flag in `SanitizeOptions` (the flag was intentionally omitted from the first PR). Ship as a **separate upstream PR** so its risk never blocks the three clean vectors (design §4).

**Documented fallback:** rasterize-and-flatten the page for content the page-object/mark model cannot cleanly excise (see open items) — already the general maximum-assurance redaction fallback.

## Fixture (built this spike)

`packages/engines/examples/node/sanitize/build-ocg-fixture.mjs` → `ocg-dirty.pdf`: a page with visible text plus an `/OC /MC0 BDC … EMC` section governed by an OCG defaulted **OFF**. The content stream is an unfiltered `PDFRawStream`, so the marked-content operators and the hidden text are verifiable by raw scan. Confirmed present: `/OCProperties`, `/OCG`, `/OC /MC0 BDC`, `EMC`, `HIDDEN-LAYER-SECRET`, `/OFF`.

## Open items to resolve in the follow-up (need the WASM build + CI)

1. **Coverage of the object-mark walk.** Does iterating page objects + `OC` marks catch _all_ OCG-governed content — specifically content inside **form XObjects** (`/OC` on the XObject), **annotations** with `/OC`, and **nested OCMDs** (membership dictionaries, not bare OCGs)? Build fixture variants for each; whatever the object model misses goes to the rasterize fallback.
2. **Orphan GC.** Does `FPDF_SaveAsCopy(doc, …, 0)` garbage-collect the orphaned OCG dictionaries after `/OCProperties` is removed, or must they be removed explicitly? (Same open question flagged for the three-vector PR; resolvable once a build exists.)
3. **`CPDF_OCContext` usage.** Confirm the exact API to enumerate the OFF set under the default config (vs. View/Print usage) and that it is reachable from `fpdfsdk/`.
4. **Verification.** The follow-up test re-extracts page text after removal and asserts the hidden run is gone while the visible run remains (mirrors the `test-vector-isolation.mjs` pattern).

## Net

OCG content removal is **feasible in-engine** — no new exported PDFium primitive is missing; it composes `CPDF_OCContext` + the page-object/mark/remove APIs already in the build. It earns its own PR (and the spike's open items) rather than riding the first one. No blocker found.
