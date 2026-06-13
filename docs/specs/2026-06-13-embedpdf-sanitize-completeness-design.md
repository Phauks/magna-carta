# EmbedPDF document-sanitization primitive — design

**Status:** Accepted (design) · **Date:** 2026-06-13 · **Owner:** Trevor Goldsmith
**Research input:** [`docs/research/pdf-tooling.md`](../research/pdf-tooling.md) (§F redaction, §J upstream-first)
**ADRs:** ADR-0088 (PDF engine + upstream-first policy — the decision home; item 6 names this contribution) · ADR-0051 (engine-vs-product seam) · ADR-0048 (license/audit CI the fork dependency joins)

This spec is the implementation-grade design for the first execution of the ADR-0088 **upstream-first engine-extension policy**: contributing a generic **document-sanitization primitive** to EmbedPDF (MIT, over a PDFium-WASM fork) and consuming it through our own fork from day one. It is **engine-primitive work only** — the proprietary product layer (the redaction _verification gate_ and the non-incremental-save _assertion_) stays in our tree and is deferred to the redaction product slice. It is the metadata-completeness target of ADR-0088 §J, sharpened by analysis to its real gap: the **XMP metadata stream** and the other non-metadata hidden vectors a redaction scrub must reach.

This contribution is **decoupled from the PDF product-slice timeline.** It is self-contained engine work started early, deliberately, so the upstream approval clock begins running long before the redaction slice needs the capability. Nothing in the product depends on the merge; the fork delivers the capability regardless of outcome.

The _signing_ contribution (the other ADR-0088 §J target — PAdES seal creation to drop `@signpdf`) is **out of scope** here and gets its own spec.

---

## 0. The gap — what a scrub must reach, and where the engine falls short

PDF carries hidden, recoverable content in several places beyond the visible page. A redaction is only defensible if the scrub reaches all of them. Against EmbedPDF's current engine (`@embedpdf/engines` `PdfEngine` contract + the `embedpdf/pdfium` fork's `EPDF_*` extensions), the vector-by-vector status is:

| Vector                                   | Where it hides                                                          | Engine status today                                                                                    | This contribution                                                                    |
| ---------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| **Info-dictionary metadata**             | `/Info` dict (author, title, producer, dates)                           | **Covered** — `EPDF_SetMetaText` + key enumeration (`getMetadata`/`setMetadata`)                       | reused by the orchestrator (clear keys)                                              |
| **XMP metadata**                         | catalog `/Metadata` stream                                              | **Missing** — `EPDF_*` metadata functions touch only the Info dict; XMP survives                       | **new `EPDF_RemoveXMPMetadata`**                                                     |
| **JavaScript**                           | catalog `/Names /JavaScript` name tree, `/OpenAction`, document `/AA`   | **Read-only** — `getDocumentJavaScriptActions` extracts but never removes                              | **new `EPDF_RemoveAllJavaScript`**                                                   |
| **Hidden optional-content (OCG) layers** | catalog `/OCProperties`; `/OC` on page objects / XObjects / annotations | **Missing** — no OCG mutation API exposed                                                              | **new `EPDF_RemoveOptionalContentGroups`** (see §4 — the hard one)                   |
| **Embedded thumbnails**                  | each page's `/Thumb` stream (can hold a pre-redaction page image)       | **Missing** — engine _renders_ thumbnails but never strips `/Thumb`                                    | **new `EPDF_RemoveEmbeddedThumbnails`**                                              |
| **Attachments / embedded files**         | catalog `/Names /EmbeddedFiles`, file-attachment annotations            | **Covered** — `removeAttachment` → `FPDFDoc_DeleteAttachment`                                          | reused by the orchestrator (delete loop)                                             |
| **Incremental-update history**           | prior (pre-redaction) revisions physically retained in the file         | **Already correct** — `saveAsCopy` calls `FPDF_SaveAsCopy(doc, fw, 0)`, a full non-incremental rewrite | a _guarantee_, not a primitive — the orchestrator must never pass `FPDF_INCREMENTAL` |

So of the seven vectors, **two are already covered** (Info, attachments), **one is an existing-behavior guarantee** (incremental save = full rewrite), and **four are genuine engine gaps** (XMP, JavaScript, OCG, thumbnails) — the four new exports below.

The XMP miss is the highest-value gap: clearing the Info dict while leaving the XMP `/Metadata` stream intact is the single most common real-world sanitization failure (author/title/history survive in XMP).

---

## 1. Boundary — engine primitive vs. product layer (ADR-0051)

The clean seam the upstream-first policy forces:

- **Upstreamed (generic engine primitive):** the four `EPDF_*` exports and the `sanitizeDocument()` orchestrator that composes them with the existing attachment-delete loop and a non-incremental save. These mutate a PDF; they make no judgement about _whether_ a scrub succeeded.
- **In-tree, deferred (proprietary product layer):** the **redaction verification gate** — re-extract text/objects under each redaction region after the scrub and _refuse to emit_ if anything survives — and the **non-incremental-save assertion** that hardens the scrub call site against a future `FPDF_INCREMENTAL` regression. These are our defensibility differentiator (`docs/research/competitive-analysis.md`) and never leave our tree.

The orchestrator returns scrubbed bytes; it does not verify. Verification is the product layer's job.

---

## 2. Components and placement

### 2.1 Repo 1 — the `embedpdf/pdfium` fork (C++)

A full PDFium tree; `EPDF_*` extensions are declared in `public/fpdf_*.h` and implemented in `fpdfsdk/`. The build's export generator harvests every `^(FPDF|EPDF|FORM|PDFiumExt_)` `FunctionDecl` from the public headers into `exported-functions.txt` + a typed `functions.ts`, so **a new `EPDF_*` symbol is auto-wired into the TS bindings with no manual binding edit.** New exports (each mirrors the existing `EPDF_RemoveEncryption` / `EPDFNamedDest_Remove` extension style for object-level surgery):

- `EPDF_RemoveXMPMetadata(FPDF_DOCUMENT doc)` — remove the `/Metadata` entry from the document catalog.
- `EPDF_RemoveAllJavaScript(FPDF_DOCUMENT doc)` — remove the catalog `/Names /JavaScript` name tree; remove `/OpenAction` when it resolves to a JavaScript action; remove the document-catalog `/AA` additional-actions dict.
- `EPDF_RemoveOptionalContentGroups(FPDF_DOCUMENT doc)` — remove `/OCProperties` **and** the marked content of hidden/OFF layers (§4).
- `EPDF_RemoveEmbeddedThumbnails(FPDF_DOCUMENT doc)` — remove each page's `/Thumb`.

Each returns a success/result code in the style of the neighbouring extensions.

### 2.2 Repo 2 — the `@embedpdf/engines` monorepo package (TypeScript)

- A `sanitizeDocument` method on the engine, with its contract added to the `PdfEngine` interface in `packages/models/src/pdf.ts`.
- It composes: the four new exports (each gated by an option flag) + the existing `getAttachments`/`removeAttachment` loop + a forced non-incremental `saveAsCopy`.

### 2.3 The WASM rebuild

The C++ change requires rebuilding `pdfium.wasm` through the package's Docker/Emscripten/depot_tools/gclient build, then vendoring the new `pdfium.wasm` + regenerated `functions.ts`. One-time per PDFium bump. On Windows this hits the known OneDrive `EPERM` lock — build outside the synced folder (as the 2026-06-13 spike did).

---

## 3. API and data flow

```
sanitizeDocument(doc, options?) -> Uint8Array
  options (all default true):
    xmp, javascript, optionalContentGroups, embeddedThumbnails, attachments
  flow:
    if options.xmp                    -> EPDF_RemoveXMPMetadata(doc)
    if options.javascript             -> EPDF_RemoveAllJavaScript(doc)
    if options.optionalContentGroups  -> EPDF_RemoveOptionalContentGroups(doc)
    if options.embeddedThumbnails     -> EPDF_RemoveEmbeddedThumbnails(doc)
    if options.attachments            -> for each: removeAttachment(...)  // existing
    return saveAsCopy(doc, fw, 0)     // full non-incremental rewrite
```

Info-dictionary clearing is left to the caller via the existing `setMetadata` (already covered), or folded into the orchestrator as an explicit key-clear — decided at plan time; it needs no new export either way.

The method is pure mutation-then-serialize. No verification, no region awareness — it scrubs the whole document.

---

## 4. The hard vector — optional-content groups

"Strip hidden layers" must remove the **content marked by OFF/hidden OCGs**, not merely delete the `/OCProperties` dictionary. Deleting `/OCProperties` alone would make previously-hidden content _visible_ — the opposite of sanitization. Correct behaviour: identify OCGs whose default configuration is OFF (or otherwise hidden), remove the marked content sequences governed by them, then remove the now-orphaned OCG dictionaries and `/OC` references.

This is the riskiest export and the least precedented in the existing `EPDF_*` set. It gets:

- a small **spike** to pin exact semantics (which content-marking operators to excise, how PDFium exposes the OC tree) before the implementation plan firms up;
- its **own option flag and its own commit**, so it can ship last and be merged independently of the other three;
- the most thorough fixture coverage (§5).

If the spike shows OCG content-removal is materially harder than budgeted, it can be split into a follow-up PR without blocking XMP/JS/thumbnails — the granular shape (chosen over a coarse bitmask export) exists precisely to allow this.

---

## 5. Testing

Follow EmbedPDF's own idiom — there is no engine unit-test suite or PR test gate; the engine is exercised by runnable Node example scripts against fixture PDFs (`packages/engines/examples/node/`, e.g. `read-write-metadata.js`).

- **Crafted dirty fixtures.** The shipped `sample.pdf`/`ebook.pdf` almost certainly lack these vectors, so we build fixture PDFs that _carry_ XMP, document JavaScript, OFF-state OCG layers, embedded thumbnails, and attachments.
- **Per-vector assertion scripts.** A `sanitize-document-example.js` (mirroring `read-write-metadata.js`): load a dirty fixture → `sanitizeDocument` → reload → assert the vector is gone by parsing the object tree (independent parse, not the same engine call that removed it). One assertion path per vector; OCG gets a visible-vs-hidden content check.
- **Dual purpose.** These scripts are the upstream PR's tests _and_ our fork's proof. They run in our CI against the forked dependency.
- **Incremental-save check.** Assert the saved output is a single-revision full rewrite (no retained prior xref/trailer chain) — guarding the `flags = 0` guarantee.

The product-layer verification gate is tested separately in the redaction slice, not here.

---

## 6. Upstream + local-ship mechanics

1. **Issue first.** Open an EmbedPDF enhancement issue / RFC describing the scrub and the granular `EPDF_*` API before coding. CONTRIBUTING asks for it, and the project is single-maintainer with cold PRs frequently sitting unreviewed for months — buy-in first is the prudent path and is itself part of the latency observation.
2. **Fork both repos, implement, rebuild WASM.** Wire into our dependency tree via a pinned fork of `@embedpdf/pdfium` (carrying the rebuilt `pdfium.wasm` + `functions.ts`) and a `pnpm patch` or pinned fork of `@embedpdf/engines` (the orchestrator).
3. **One PR, granular commits.** Submit a single PR composed of independent per-vector commits (XMP, JS, thumbnails, then OCG) so a slow maintainer can merge incrementally.
4. **Collapse or keep.** On merge → drop the fork, consume the released packages. On stall/reject → keep the fork indefinitely (MIT permits it). **The capability is ours from day one either way; the merge never gates a slice.**
5. **License CI.** The forked dependency stays within the ADR-0048 permissive allowlist (MIT/Apache-2.0/BSD) — no change to the gate.

**Worst case is a permanently-maintained MIT fork** — the sanctioned ADR-0088 fallback, not a failure mode. Cost: re-syncing the fork and rebuilding WASM on PDFium bumps. Becoming an active contributor also upgrades the ADR-0088 bus-factor mitigation from "we could fork" to "we know the codebase well enough to fork."

---

## 7. Documentation impact

- This spec is the design home; **ADR-0088 remains the decision home** and gets a one-line "pilot underway" note when work starts.
- The research note [`pdf-tooling.md`](../research/pdf-tooling.md) §J already anticipates this; a pointer back to this spec is added there.
- **No `ROADMAP`/`CHANGELOG` product entry yet** — nothing user-facing ships until the fork is wired into a product slice. The `CHANGELOG` entry (a forked `@embedpdf` dependency gaining `sanitizeDocument`) lands when the dependency is actually wired in; per golden rule 5 the user/developer docs for the redaction _feature_ land with the redaction slice that consumes this.

---

## 8. Open items for the implementation plan

1. **OCG semantics spike** (§4) — must precede the OCG export's plan.
2. **Fixture authorship** — which tool builds the dirty fixtures (a small `qpdf`/hand-built generator vs. checked-in binaries); how OFF-state OCGs are synthesized.
3. **Info-dict clearing placement** (§3) — folded into the orchestrator vs. left to the existing `setMetadata`.
4. **`saveAsCopy` orphan behaviour** — confirm whether `flags = 0` garbage-collects unreferenced objects or only collapses the revision chain; if orphans survive, decide whether that is in scope for this contribution or a later one.

---

## 9. Pilot status (ADR-0088 upstream-first, first execution)

The approval-latency pilot. Built and validated green in our fork CI (run #6, full Docker build; run #7, fast TS-only against the committed wasm — both: `PASS test-sanitize-document`, `PASS test-vector-isolation`).

| Item | Where | Date |
| --- | --- | --- |
| Enhancement issue (**pilot t=0**) | [embedpdf/embed-pdf-viewer#673](https://github.com/embedpdf/embed-pdf-viewer/issues/673) | 2026-06-13 |
| PR A — `EPDF_*` C++ (XMP, thumbnails, JavaScript) | [embedpdf/pdfium#27](https://github.com/embedpdf/pdfium/pull/27) | 2026-06-13 |
| PR B — `sanitizeDocument` TS + tests + vendored wasm | [embedpdf/embed-pdf-viewer#674](https://github.com/embedpdf/embed-pdf-viewer/pull/674) (depends on PR A; submodule re-points to the merged SHA) | 2026-06-13 |
| Maintainer first response | — | — |
| Merge / close (**the latency datapoint**) | — | — |

Capability is ours regardless (fork shipped); these dates measure how long upstream approval takes. OCG is a deliberate **separate** follow-up PR (§4). Signing is the other ADR-0088 §J target ([`2026-06-13-embedpdf-signing-options.md`](2026-06-13-embedpdf-signing-options.md)), deferred until this PR lands.
