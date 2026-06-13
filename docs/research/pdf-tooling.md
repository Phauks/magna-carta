# PDF tooling — one engine across runtimes (EmbedPDF / PDFium), licensing, and redaction parity

**Date:** 2026-06-13 · **Status:** Tentative analysis (owner-collaborative; pre-build, with a verifying spike run) · **Decision home:** ADR-0088 (refines ADR-0045) · **Owner:** Trevor Goldsmith

This is the research backing for the platform's PDF capabilities. It supersedes the first pass (a five-library spread) with a single-engine model after research found the integrated SDK the first pass missed. The _decision_ lives in ADR-0088; the _analysis and evidence_ live here (one home per fact).

> **Tentative.** Library facts below were checked against primary sources on 2026-06-13 and one claim (server-side execution) was verified by a local spike (§C). The remaining open items (§I) must be settled before build. PDF is a large, irregular format; these designs are expected to iterate.

## Relationship to what is already decided

- **ADR-0045** (Proposed) established an in-house PDF service from permissive engines, client-side by default, and **deferred true content-level redaction** citing AGPL engines. This note resolves that deferral and replaces the engine composition with a single SDK.
- **ADR-0030** (file conversion) already runs LibreOffice, libvips, OCR, FFmpeg in Containers. DOCX/XLSX ↔ PDF stays LibreOffice headless — reused, not re-opened.
- **ADR-0024 / ADR-0039** fix the shared-core and placement model: one engine, WASM for web + native for desktop; lean Workers (stream, never buffer); heavy work in Containers + Queues + a per-job Durable Object; the browser main thread kept free. The single-engine finding below realizes this rather than approximating it.
- The white paper (_Inline file preview_) already names a PDF render Container and a safe-rendition path.

## A. The finding — the ecosystem converged on one engine

There are only **two** comprehensive PDF engines in existence: **MuPDF** (AGPL — excluded, §D) and **PDFium** (BSD-3 — Google Chrome's engine: render, edit, extract, forms, create, redact). Every permissive option in any language — `pdfium-render` (Rust), `pypdfium2` (Python), and EmbedPDF (JS/TS) — is a binding or SDK over PDFium. The only "more complete" products are the paid commercial suites (Apryse, Nutrient/PSPDFKit, Syncfusion). So the answer to "is there a real one?" is: **yes — PDFium, and the ecosystem already standardized on it.**

The integrated SDK over it — the part the first pass missed — is **EmbedPDF**.

## B. EmbedPDF — the integrated SDK (the centerpiece)

- **MIT licensed** (PDFium bundled under Apache-2.0). Fully permissive, zero AGPL.
- **Built on a custom PDFium WebAssembly engine**; layered packages: `@embedpdf/pdfium` (low-level WASM wrapper) → `@embedpdf/engines` (`PdfiumNative` executor + `PdfEngine` high-level, promise-first, 100% TypeScript) → framework packages and `@embedpdf/snippet` (full UI).
- **Runs in browsers, Node, and serverless** (confirmed in docs and by the spike, §C) — headless server PDF work with no browser, no Puppeteer. This is the property that makes it _one engine across every runtime_, delivering the ADR-0024/ADR-0039 model off the shelf.
- **First-class Svelte support** — dedicated Svelte packages and docs (`@embedpdf/*` for React, Vue, Svelte, Preact, vanilla), ready-made viewer and headless components.
- **Plugin architecture** — tree-shakable; install only the capabilities used.
- **Maturity:** v2.14.4 (June 2026), ~4.2k stars, 42 releases, an active PDF Association member.

### Plugin/component → capability map

Our PDF feature checklist maps almost one-to-one onto EmbedPDF plugins:

| Capability needed                  | EmbedPDF plugin / component                                         |
| ---------------------------------- | ------------------------------------------------------------------- |
| View / preview                     | Viewer + Scroll / Zoom / Rotate / Spread / Tiling                   |
| Thumbnails, bookmarks, attachments | Thumbnail / Bookmark / Attachment                                   |
| Collaborative markup / review      | **Annotation** (+ History / Commands for undo, Interaction Manager) |
| True redaction                     | **Redaction** (destructive content removal — §F)                    |
| Form fill                          | **Forms**                                                           |
| Bates / stamping                   | **Stamp** + default-stamps                                          |
| Search                             | **Search**                                                          |
| Text selection / extraction        | Selection + engine-level extraction                                 |
| Metadata read and edit             | **Metadata** plugin (a metadata-editor tool ships on their site)    |
| Save modified PDF                  | **Export & Save** (writes a new PDF including changes)              |
| e-signature                        | **Signature** (verify confirmed; seal _creation_ to verify — §I)    |
| Print                              | **Print**                                                           |
| Discovery aids                     | **Layout Analysis** + an **AI** package                             |

So EmbedPDF _is_ the composition layer the first pass proposed building by hand. What remains outside it: DOCX/XLSX→PDF (LibreOffice) and OCR (Tesseract) — separate concerns, not PDF-native — plus our own thin shells (§F, §G).

## C. The spike (empirical evidence, 2026-06-13)

Throwaway Node project (outside the OneDrive-synced repo), `npm i @embedpdf/pdfium @embedpdf/engines` (v2.14.4), Node v25 ESM scripts loading the WASM from disk and driving the low-level API against hand-built PDFs. All six open questions were exercised.

**Baseline — headless in Node:**

- **`@embedpdf/pdfium` runs headless in pure Node** (no browser/DOM). `RESULT: GREEN`.
- **init + `PDFiumExt_Init`: ~41 ms** (one-time, cold); **load + parse: ~4.3 ms**; correct page count and dimensions.
- **`pdfium.wasm`: 4,633,788 bytes raw / 2,149,397 bytes gzipped (~2.05 MB).**

**The five verification items:**

1. **Render CPU (placement)** — `GREEN`. Full-page render to bitmap: **2.9 ms/page @150 DPI, 6.6 ms/page @300 DPI**. A single page is trivially within a Worker's CPU budget; bulk render (hundreds of pages) belongs in a Container. The ADR-0039 edge-vs-Container split is confirmed by measurement, and the WASM size (~2.05 MB gzip) fits under the Workers paid 10 MB bundle limit (ADR-0074) — size is not the blocker.
2. **Signature — verification only.** The build exposes `FPDF_GetSignatureCount`/`FPDF_GetSignatureObject`/`FPDFSignatureObj_Get*` (read/verify) and **no creation function**. So EmbedPDF/PDFium verifies signatures but does **not** create PAdES seals — ADR-0045's e-signature seal creation keeps **`@signpdf`** (or another signer). Resolved.
3. **Metadata + sanitize — write is in-engine.** Beyond PDFium's read-only `FPDF_GetMetaText`, EmbedPDF adds extension functions **`EPDF_SetMetaText`, `EPDF_GetMetaKeyCount`, `EPDF_GetMetaKeyName`, `EPDF_HasMetaText`, `EPDF_SetMetaTrapped`** — so document metadata can be **read, written, and stripped in-engine** (the metadata-editing capability is confirmed). The **verification-gate primitive works**: extracting page text returned the exact content and detected the planted secret (`123-45-6789`), which is what the gate re-runs post-redaction to assert empty. qpdf is therefore only needed (if at all) for _non-metadata_ hidden content (attachments, embedded files), not for metadata strip.
4. **Export round-trip** — `GREEN`. `FPDF_SaveAsCopy` (write callback via the emscripten `addFunction`, which is available in this build) produced a valid PDF that reloaded with correct page count and a `%PDF-` header. The save/export path works headless.
5. **Bates numbering — feasible; use the high-level engine.** All required functions are present (`FPDFPageObj_CreateTextObj`, `FPDFText_SetText`, `FPDFPage_GenerateContent`, `FPDFText_LoadStandardFont`) and save round-trips (#4), so sequential per-page stamping is achievable; sequence orchestration across a production is ours. **Caveat surfaced:** the raw FPDF string marshaling in `@embedpdf/pdfium` is inconsistent (some calls expect a JS string, some a heap pointer) and undocumented — so content _mutation_ (stamping, form fill, annotation) should go through the high-level **`@embedpdf/engines`** API, not raw FPDF calls.

**Interpretation:** server-side is confirmed, all five items clear, and the only hard constraint is #2 (keep `@signpdf` for seals). The marshaling caveat (#5) is a "use the high-level API" note, not a blocker.

## D. Licensing — AGPL/SSPL is a hard prohibition

The platform is proprietary SaaS. **AGPL (and SSPL) are non-starters, including transitive dependencies and isolated-service use.** AGPL §13 treats network interaction as distribution; for SaaS that triggers a source-offer obligation, and linking risks making the whole app a derivative. The prohibition is categorical to avoid relying on the contested process-isolation boundary — consistent with prior rejections (Documenso/DocuSeal in ADR-0045, self-hosted Sentry in ADR-0038, Jasmin-as-fallback-only in ADR-0047).

**Excluded by this rule:**

- **MuPDF / `mupdf.js`** — the only single-library competitor to the PDFium stack (does everything incl. true vector redaction). AGPL; excluded entirely, not even a fallback. EmbedPDF makes this painless: it is the permissive equivalent of what MuPDF would have given us.
- **Ghostscript / OCRmyPDF** — see §E.

**CI gate:** a license-scanning gate (permissive allowlist — MIT, Apache-2.0, BSD, MPL-2.0, ISC, and similar; AGPL/SSPL denied; reads the _as-used_ license of dual-licensed packages) joins the ADR-0048 OSV/audit pipeline so a future AGPL `pnpm add` or Container base image is unmergeable rather than caught by memory.

## E. OCR — Tesseract-direct, not OCRmyPDF

**OCRmyPDF requires Ghostscript (AGPL)** — a transitive copyleft one import deep. The clean pipeline is **Tesseract** (Apache-2.0) for OCR + EmbedPDF/PDFium or qpdf for the rasterize/reassemble steps. Refines ADR-0030's discovery-OCR engine choice.

## F. Redaction — Adobe parity, largely off the shelf

The goal is to **match Adobe Acrobat's redaction functionality.** Adobe is vector/content-level redaction (a scalpel): it removes only the marked objects from the content stream, keeps the rest of the page live/searchable, and pairs with a "Sanitize" step that strips metadata/hidden content.

EmbedPDF's **Redaction plugin is true content removal** — destructive, alters the underlying PDF content, "the original content is removed and cannot be restored," with optional fill boxes (any color). This is the vector-level capability the first pass planned to _build_ on PDFium (the hard text-run-splitting surgery) — now an off-the-shelf MIT plugin. That removes the build/maintenance burden the owner was wary of and gives Adobe-class output (text-native, partial-page) rather than the raster-rebuild fallback.

Two thin shells remain ours, for legal defensibility:

- **Sanitize pass** — confirm EmbedPDF's Metadata + Redaction together strip _every_ hidden vector (attachments, embedded files, hidden layers, scripts); keep **qpdf** (Apache-2.0) as a belt-and-suspenders sanitize/linearize step if not.
- **Verification gate (a differentiator)** — after redaction, re-extract text and assert the corpus under each region is empty; the pipeline **refuses to emit** an unverified redaction. Most real-world redaction leaks come from operators who only highlighted or boxed; a pipeline that cannot emit an un-proven redaction is a defensibility story competitors (who mostly outsource even basic redaction — see `competitive-analysis.md`) do not have.

The **raster-rebuild** approach (render to image, composite fill, re-OCR) is retained only as a documented _fallback_ for cases requiring maximum-assurance flattening, not the primary path.

## G. Placement — client-first by default, a thin server tier

The engine is one WASM build that runs in the browser, the Worker, a Node Container, and Tauri. The placement default is therefore **client-first**: interactive, single-document, user-present work runs on the user's device (browser WASM; Tauri native on desktop), and privileged bytes never leave it. This sharpens ADR-0045's "client-side by default" into the explicit default and is the ADR-0023/0024 parity model (local acceleration, server fallback).

**Client-side (the default — most operations):** view, annotate, redact (true content removal on the working copy), form-fill, single-document stamp/Bates, search, text extract, metadata read/edit, export the modified PDF. The result uploads back to R2 as a matter file (direct-to-R2, ADR-0081) — _compute_ is client-side, the _artifact_ is still server-stored.

**The irreducible server tier (only these four):**

1. **No-user-present generation** — scheduled / workflow / API-triggered document generation, no browser open.
2. **Bulk/batch over a corpus** — Bates a whole production, convert a folder, render a large set (Container + Queue + per-job Durable Object).
3. **Native engines** — OCR (Tesseract) and DOCX/XLSX→PDF (LibreOffice); not browser-runnable at production quality (Container). On desktop, Tauri runs OCR locally (ADR-0024).
4. **Trust/authority** — the PAdES platform seal (server key, ADR-0045) and the authoritative redaction + verification-gate for an evidence/discovery production (server-controlled and audited; a client-side redaction is the working copy, the _produced_ document is sealed server-side).

This server tier is **mostly Container** (native + batch) with the Worker as orchestrator (presign, enqueue, seal). The "Worker does light PDF compute" tier largely **collapses into the client**.

**Device variance is the user's concern (owner decision, 2026-06-13):** interactive client-side work is _not_ backstopped by a required server fallback for large documents — a weak device is the user's problem. This is distinct from the irreducible _batch_ tier above, which is server-side regardless of device.

**Collaboration:**

- _Document_ co-editing → **Collabora** on the source `.docx` (ADR-0010), not the PDF (a final-form format).
- _Shared review/markup_ (multi-user comments / highlights / sign-off) and its coordinating **per-document Durable Object are deferred** (owner, 2026-06-13). v1 markup is **single-user, client-side**, persisted as firm-scoped annotation data on save — no real-time coordination and no markup DO in the near-term design. Revisit when shared comments are scheduled.

## H. Recommended set (collapsed)

- **EmbedPDF (`@embedpdf/engines` + chosen plugins)** — the PDF layer, **client-first** (§G): the same PDFium WASM engine in the browser/Tauri for the interactive default, and in Node/Container for the four irreducible server cases, with the Worker as orchestrator. Replaces the first pass's **pdf.js** (viewer) and **pdf-lib** (create/modify/save), and likely the standalone **`pdfium-render`** binding (the engine runs PDFium-WASM in Node).
- **qpdf** — kept only if EmbedPDF's sanitize is incomplete (linearize / metadata strip for redaction defensibility).
- **LibreOffice** (DOCX/XLSX→PDF, ADR-0030) and **Tesseract-direct** (OCR) — orthogonal services, unchanged.
- **Excluded on the AGPL prohibition:** MuPDF, Ghostscript/OCRmyPDF.
- **Redaction:** EmbedPDF Redaction plugin (true content removal) + our sanitize + verification gate; raster-rebuild retained as a fallback only.
- **CI:** a license-scanning gate denying AGPL/SSPL (incl. transitive) joins the OSV/audit pipeline.
- **Pure-Rust watch-list (not now):** `hayro` (Apache/MIT renderer, experimental, single-maintainer) and `oxidize-pdf` (pure Rust, no C deps) for an eventual ADR-0024 pure-Rust core — too immature to bet on; EmbedPDF/PDFium-WASM is the parity vehicle today.

This is genuinely unified — one engine in two runtimes plus two service helpers — the coherent answer to "fragmented vs. Collabora."

## I. Verification status (spiked 2026-06-13)

The five build-time questions were exercised in the spike (§C); results recorded here.

1. **Worker CPU/placement** — **resolved by measurement.** ~2.9–6.6 ms/page render; single-page ops fit a Worker, bulk goes to a Container (ADR-0039). Re-confirm against real production-density documents in the load harness (ADR-0083) when the slice is built — the spike used light synthetic pages, so treat the numbers as a favorable lower bound.
2. **Signature: sign or only verify?** — **resolved: verify only.** Keep `@signpdf` (or another signer) for the ADR-0045 PAdES seal; EmbedPDF/PDFium handles signature _verification_.
3. **Redaction sanitize completeness** — **metadata strip confirmed in-engine** (`EPDF_SetMetaText` + key enumeration); the verification-gate primitive works. Remaining check at build: whether the Redaction plugin removes _non-metadata_ hidden vectors (attachments, embedded files, JS); keep qpdf as the sanitize backstop only if it does not.
4. **Save/export fidelity** — **resolved: round-trips.** `FPDF_SaveAsCopy` produces a valid reloadable PDF. Re-confirm with a genuinely _modified_ document (redactions/form-fills) through the high-level engine at build.
5. **Bates numbering** — **resolved: feasible.** Required APIs present and save round-trips; sequence orchestration across a production is ours. Build through the high-level `@embedpdf/engines` API (the raw FPDF marshaling caveat, §C).
6. **Bus factor** — single-org project, younger than pdf.js. Mitigation: MIT + thin-over-PDFium means the escape hatch is raw `@embedpdf/pdfium` or `pdfium-render`; no lock-in. (Standing risk, not a spike item.)

**Net:** no blocker found. The one firm constraint is item 2 (`@signpdf` stays for e-sign seals); item 5 carries a "use the high-level API for mutation" note.

## J. Upstream-first engine extensions (scoped: metadata and signing)

When we need generic PDF-engine capability that EmbedPDF lacks, the default is to **contribute it upstream** rather than carry a permanent parallel dependency — strengthening the engine we depend on and reducing our dependency count if accepted. Two named targets:

- **Signing — the dependency-elimination case.** EmbedPDF/PDFium _verifies_ signatures but cannot _create_ a PAdES seal (§C, spike #2), which otherwise forces the external `@signpdf`. Build seal-creation as an EmbedPDF contribution; if merged, **drop `@signpdf`**.
- **Metadata — the gap-filling case.** Read/write/strip is already in-engine via `EPDF_*` extensions (§C, spike #3), so there is no dependency to remove; the contribution is completeness — most likely full-document sanitization of non-metadata hidden vectors (attachments, embedded files, JS) for redaction defensibility, if the Redaction plugin does not already cover it.

**Mechanics (never gate a slice on the merge):** fork + PR under EmbedPDF's MIT terms (verify any CLA/DCO at first contribution); ship locally in parallel via `pnpm patch` or a pinned fork so the capability works on day one; collapse to the released upstream version if/when accepted; keep the patch indefinitely if rejected (MIT permits it).

**Boundary — upstream the engine primitive, keep the product layer:** only the _generic_ capability is contributed (PAdES seal generation; metadata/sanitize completeness). The proprietary layer stays in our tree — the **ESIGN/UETA attribution workflow + Certificate of Completion** (ADR-0045) around the signer, and the **redaction verification gate** around sanitization. Designing for upstreamability forces a clean engine-vs-product seam (ADR-0051), and active contribution upgrades the bus-factor mitigation (§B/§I) from "we could fork" to "we know the codebase well enough to fork." The policy could generalize to other strategic OSS dependencies later.
