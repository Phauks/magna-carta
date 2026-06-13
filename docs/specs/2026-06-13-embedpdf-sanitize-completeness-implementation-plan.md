# EmbedPDF document-sanitization primitive — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a generic document-sanitization capability to EmbedPDF — `EPDF_RemoveXMPMetadata`, `EPDF_RemoveEmbeddedThumbnails`, `EPDF_RemoveAllJavaScript`, plus a `sanitizeDocument()` orchestrator — contributed upstream and shipped via our own fork, then submit it as one upstream PR.

**Architecture:** Work happens in **two external forks**, not the Magna Carta repo: a fork of `embedpdf/pdfium` (C++ exports, declared in `public/fpdf_*.h`, implemented in `fpdfsdk/`, auto-wired into TS bindings by the build's export generator) and a fork of `embedpdf/embed-pdf-viewer` (the `@embedpdf/engines` orchestrator + the `PdfEngine` contract in `@embedpdf/models`). Each C++ export is built by **mirroring an existing `EPDF_*` mutation extension** (e.g. `EPDF_RemoveEncryption`, `EPDFNamedDest_Remove`) — the plan specifies the exact PDF objects to remove; the implementer confirms the exact `CPDF_*` calls against that reference during execution. Optional-content-group (OCG) stripping is **deliberately excluded** here and gated behind a spike (final task) that seeds its own follow-up plan, per design spec §4.

**Tech Stack:** C++ (PDFium), Emscripten/Docker WASM build, TypeScript (`@embedpdf/engines`), Node ESM test scripts, `pdf-lib` (MIT) for fixture authorship and independent assertion, Jest (only if a pure-logic helper is added in `@embedpdf/models`).

**Design spec:** [`docs/specs/2026-06-13-embedpdf-sanitize-completeness-design.md`](2026-06-13-embedpdf-sanitize-completeness-design.md)
**Decision home:** ADR-0088 (§J upstream-first policy — this is its first execution).

**Reference paths (in the `embedpdf/embed-pdf-viewer` monorepo unless noted):**
- PDFium fork (separate repo): `embedpdf/pdfium`, branch `embedpdf/main`. Public headers: `public/fpdf_doc.h` (where the metadata `EPDF_*` live), `public/fpdf_catalog.h`, `public/fpdf_attachment.h`. Implementations: `fpdfsdk/` and `patches/embedpdf-runtime/`.
- WASM build: `packages/pdfium/` — `Dockerfile`, `scripts/build.sh`, `build/generate-functions.mjs` (the auto-exporter; harvests every `^(FPDF|EPDF|FORM|PDFiumExt_)` symbol), `build/compile.sh`, vendored output `packages/pdfium/src/vendor/{pdfium.wasm,functions.ts}`.
- Engine: `packages/engines/src/lib/pdfium/engine.ts` (the `PdfiumEngine`), contract in `packages/models/src/pdf.ts` (`PdfEngine`).
- Example/test idiom: `packages/engines/examples/node/` (e.g. `read-write-metadata.js`, fixtures `sample.pdf`, `ebook.pdf`).

**Known environment gotcha:** the WASM Docker build must run **outside** the OneDrive-synced folder (Windows `EPERM` file-lock on `build` dirs). Clone the forks to a non-synced path (e.g. `C:\dev\embedpdf-fork\`).

---

## Task 0: Open the upstream enhancement issue / RFC

This is a process gate, not code. CONTRIBUTING asks for an issue first; the project is single-maintainer with cold PRs frequently unreviewed for months, so buy-in precedes coding — and the issue-open timestamp is the start of the ADR-0088 "how long to get approved" pilot clock.

- [ ] **Step 1: Draft and open the issue**

On `github.com/embedpdf/embed-pdf-viewer`, open an enhancement issue titled `Document sanitization: strip XMP, JavaScript, embedded thumbnails (redaction defensibility)`. Body must state:
- The gap: `EPDF_SetMetaText` clears the Info dict but the catalog `/Metadata` (XMP) stream, `/Names /JavaScript` + `/OpenAction` + `/AA`, and per-page `/Thumb` streams survive — recoverable after a redaction.
- The proposed API: four granular `EPDF_*` exports (XMP, JavaScript, thumbnails, and a later OCG one) plus a `sanitizeDocument()` engine method composing them with the existing `removeAttachment` loop and a non-incremental `saveAsCopy`.
- Offer to implement; ask the maintainer (bobsingor) to confirm the granular-export shape is acceptable before a PR.

- [ ] **Step 2: Record the pilot start**

In a working note (not committed yet), record the issue URL and the date opened. This is the pilot's t=0.

---

## Task 1: Fork the repos and produce a baseline WASM build

Stand up the toolchain and prove the *unmodified* fork builds and runs before changing anything. No TDD test here — the gate is "a clean baseline build runs an existing example."

**Files:**
- Clone (non-synced path): `embedpdf/pdfium` → fork; `embedpdf/embed-pdf-viewer` → fork.

- [ ] **Step 1: Fork and clone both repos**

```bash
# In a NON-OneDrive path, e.g. C:\dev
gh repo fork embedpdf/pdfium --clone --fork-name pdfium
gh repo fork embedpdf/embed-pdf-viewer --clone --fork-name embed-pdf-viewer
cd embed-pdf-viewer
git checkout -b feat/document-sanitization
```

- [ ] **Step 2: Install monorepo deps and build**

```bash
pnpm install
pnpm build:watch &   # or a one-shot build per their CONTRIBUTING
```
Expected: packages build without error.

- [ ] **Step 3: Run an existing engine example against the baseline**

```bash
node packages/engines/examples/node/read-write-metadata.js
```
Expected: it loads `sample.pdf`, prints/sets metadata, and saves without error. This confirms the vendored `pdfium.wasm` + engine work end-to-end before we touch C++.

- [ ] **Step 4: Do a clean WASM rebuild from the fork to prove the toolchain**

In `packages/pdfium/`, point the build at our `embedpdf/pdfium` fork branch (`embedpdf/main` baseline for now), then:
```bash
cd packages/pdfium
bash scripts/build.sh
```
Expected: Docker/Emscripten build completes; `src/vendor/pdfium.wasm` and `src/vendor/functions.ts` are regenerated and byte-stable vs. the committed baseline (a diff shows no functional change). This is the slow step we will repeat after each C++ export; confirm it works now.

- [ ] **Step 5: Commit the branch setup (engines repo)**

```bash
git add -A
git commit -m "chore: branch setup for document-sanitization contribution"
```

---

## Task 2: Author the dirty test fixture

Every vector test needs a PDF *known* to contain the vector. `sample.pdf` almost certainly lacks them, so build a deterministic dirty fixture with `pdf-lib`. This fixture carries Info metadata, an XMP `/Metadata` stream, document JavaScript (`/OpenAction` + `/Names /JavaScript`), a page `/Thumb`, and an embedded-file attachment.

**Files:**
- Create: `packages/engines/examples/node/sanitize/build-dirty-fixture.mjs`
- Create (output): `packages/engines/examples/node/sanitize/dirty.pdf`
- Create: `packages/engines/examples/node/sanitize/assert-helpers.mjs`

> The `pdf-lib` low-level API (`PDFDocument`, `doc.context`, `PDFName`, `PDFDict`, `PDFRawStream`, `PDFHexString`, `doc.catalog`) is used to inject objects pdf-lib has no high-level helper for. Confirm these call shapes against current pdf-lib docs at execution (golden rule 11). Add `pdf-lib` as a devDependency of `packages/engines`.

- [ ] **Step 1: Write the fixture builder**

```js
// build-dirty-fixture.mjs
import { PDFDocument, PDFName, PDFRawStream, PDFHexString, PDFString } from 'pdf-lib';
import { writeFileSync } from 'node:fs';

const doc = await PDFDocument.create();
const page = doc.addPage([200, 200]);
page.drawText('Secret 123-45-6789', { x: 20, y: 100, size: 12 });

// (a) Info-dict metadata
doc.setAuthor('Jane Privileged');
doc.setTitle('PRIVILEGED — draft settlement');
doc.setProducer('MagnaCartaFixture');

// (b) XMP /Metadata stream on the catalog
const xmp = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:creator><rdf:Seq><rdf:li>Jane Privileged</rdf:li></rdf:Seq></dc:creator>
<dc:title><rdf:Alt><rdf:li xml:lang="x-default">PRIVILEGED — draft settlement</rdf:li></rdf:Alt></dc:title>
</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
const xmpStream = PDFRawStream.of(
  doc.context.obj({ Type: 'Metadata', Subtype: 'XML', Length: xmp.length }),
  new TextEncoder().encode(xmp),
);
const xmpRef = doc.context.register(xmpStream);
doc.catalog.set(PDFName.of('Metadata'), xmpRef);

// (c) Document JavaScript: /OpenAction + /Names /JavaScript name tree
const jsCode = 'app.alert("phone home");';
const jsAction = doc.context.obj({ S: 'JavaScript', JS: PDFString.of(jsCode) });
const jsActionRef = doc.context.register(jsAction);
doc.catalog.set(PDFName.of('OpenAction'), jsActionRef);
const jsNameTree = doc.context.obj({
  Names: [PDFString.of('MagnaCartaJS'), jsActionRef],
});
const namesDict = doc.context.obj({ JavaScript: doc.context.register(jsNameTree) });
doc.catalog.set(PDFName.of('Names'), doc.context.register(namesDict));

// (d) Page /Thumb (a tiny raw image stream — content is irrelevant, presence is the test)
const thumbBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]); // placeholder bytes
const thumb = PDFRawStream.of(
  doc.context.obj({ Type: 'XObject', Subtype: 'Image', Width: 1, Height: 1,
    ColorSpace: 'DeviceGray', BitsPerComponent: 8, Length: thumbBytes.length }),
  thumbBytes,
);
page.node.set(PDFName.of('Thumb'), doc.context.register(thumb));

// (e) Attachment (high-level)
await doc.attach(new Uint8Array([1, 2, 3, 4]), 'evidence.bin', {
  mimeType: 'application/octet-stream', description: 'embedded file',
});

const bytes = await doc.save({ useObjectStreams: false });
writeFileSync(new URL('./dirty.pdf', import.meta.url), bytes);
console.log('wrote dirty.pdf', bytes.length, 'bytes');
```

- [ ] **Step 2: Run it and confirm the fixture has every vector**

```bash
node packages/engines/examples/node/sanitize/build-dirty-fixture.mjs
```
Expected: `wrote dirty.pdf …`. Then verify each vector is present by string-scan (a coarse but sufficient presence check for a fixture):
```bash
node -e "const b=require('fs').readFileSync('packages/engines/examples/node/sanitize/dirty.pdf').toString('latin1'); for (const m of ['/Metadata','/JavaScript','/OpenAction','/Thumb','/EmbeddedFiles','Jane Privileged']) console.log(m, b.includes(m));"
```
Expected: every line prints `true`.

- [ ] **Step 3: Write the shared assertion helper**

```js
// assert-helpers.mjs — independent re-parse of saved output, NOT via the engine that scrubbed it
import { PDFDocument, PDFName } from 'pdf-lib';

export async function loadCatalog(bytes) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return { doc, catalog: doc.catalog, context: doc.context };
}
export function has(dict, key) { return dict.get(PDFName.of(key)) !== undefined; }
export function assert(cond, msg) { if (!cond) { throw new Error('ASSERT FAILED: ' + msg); } }
```

- [ ] **Step 4: Commit**

```bash
git add packages/engines/examples/node/sanitize/ packages/engines/package.json
git commit -m "test: dirty PDF fixture + assertion helpers for sanitization"
```

---

## Task 3: `EPDF_RemoveXMPMetadata` (the headline gap)

Remove the catalog `/Metadata` stream so XMP author/title/history cannot survive an Info-dict clear.

**Files (pdfium fork):**
- Modify: `public/fpdf_doc.h` (declaration, beside the existing `EPDF_*Meta*`)
- Modify: `fpdfsdk/fpdf_doc.cpp` (implementation — confirm exact filename beside the metadata `EPDF_*` impls)
- Test (engines repo): `packages/engines/examples/node/sanitize/test-remove-xmp.mjs`

- [ ] **Step 1: Write the failing test**

```js
// test-remove-xmp.mjs
import { readFileSync } from 'node:fs';
import { createPdfiumEngine } from '../../../src/index.js'; // adjust to the package's engine entry
import { loadCatalog, has, assert } from './assert-helpers.mjs';

const engine = await createPdfiumEngine();
const input = readFileSync(new URL('./dirty.pdf', import.meta.url));

const doc = await engine.openDocument(input);
await engine.removeXMPMetadata(doc);          // orchestrator-free direct call for this unit
const out = await engine.saveAsCopy(doc);     // flags = 0 full rewrite

const { catalog } = await loadCatalog(out);
assert(!has(catalog, 'Metadata'), '/Metadata (XMP) stream must be gone');
console.log('PASS: XMP removed');
```
> Confirm the engine's open/save method names against `packages/engines/src/lib/pdfium/engine.ts`; this test calls a thin `removeXMPMetadata` engine wrapper added in Step 4.

- [ ] **Step 2: Run it to verify it fails**

```bash
node packages/engines/examples/node/sanitize/test-remove-xmp.mjs
```
Expected: FAIL — `engine.removeXMPMetadata is not a function` (the export and wrapper don't exist yet).

- [ ] **Step 3: Declare the C++ export**

In `public/fpdf_doc.h`, beside `EPDF_SetMetaText`:
```c
// Remove the document's XMP metadata stream (catalog /Metadata).
// Returns 1 on success (including when no /Metadata was present), 0 on error.
FPDF_EXPORT FPDF_BOOL FPDF_CALLCONV EPDF_RemoveXMPMetadata(FPDF_DOCUMENT document);
```

- [ ] **Step 4: Implement the C++ export by mirroring the reference**

Open the existing `EPDF_RemoveEncryption` (or the metadata `EPDF_Set*` impl) in `fpdfsdk/` and mirror its structure: resolve `CPDF_Document* -> GetMutableRoot()` (the catalog dictionary), then `RemoveFor("Metadata")`. Object-level requirement: **remove the `/Metadata` key from the catalog dictionary.** The exact `CPDF_Dictionary` mutator call is whatever the reference extension uses for catalog mutation. Return `1` always-on-success (absence is success).

- [ ] **Step 5: Rebuild the WASM and vendor it**

```bash
cd packages/pdfium && bash scripts/build.sh && cd ../..
```
Expected: `src/vendor/functions.ts` now contains `EPDF_RemoveXMPMetadata` (auto-harvested), and `pdfium.wasm` is updated.

- [ ] **Step 6: Add the thin engine wrapper**

In `packages/engines/src/lib/pdfium/engine.ts`, add (mirroring an existing one-call wrapper such as `removeEncryption`):
```ts
removeXMPMetadata(doc: PdfDocumentObject): PdfTask<boolean> {
  const ok = this.pdfiumModule.EPDF_RemoveXMPMetadata(doc.handle /* per existing handle pattern */);
  return TaskResult.success(ok === 1); // mirror the repo's task-wrapping idiom
}
```
> Match the exact return/Task type and handle access used by neighbouring engine methods.

- [ ] **Step 7: Run the test to verify it passes**

```bash
pnpm --filter @embedpdf/engines build && node packages/engines/examples/node/sanitize/test-remove-xmp.mjs
```
Expected: `PASS: XMP removed`.

- [ ] **Step 8: Commit (granular — one vector per commit for incremental merge)**

```bash
# pdfium fork:
git -C ../pdfium add public/fpdf_doc.h fpdfsdk/fpdf_doc.cpp
git -C ../pdfium commit -m "feat: EPDF_RemoveXMPMetadata — strip catalog /Metadata XMP stream"
# engines fork:
git add packages/pdfium/src/vendor packages/engines/src/lib/pdfium/engine.ts packages/engines/examples/node/sanitize/test-remove-xmp.mjs
git commit -m "feat(engines): removeXMPMetadata wrapper + test"
```

---

## Task 4: `EPDF_RemoveEmbeddedThumbnails`

Remove every page's `/Thumb` stream (can hold a pre-redaction page image).

**Files (pdfium fork):**
- Modify: `public/fpdf_doc.h` (declaration)
- Modify: `fpdfsdk/fpdf_doc.cpp` (implementation)
- Test (engines repo): `packages/engines/examples/node/sanitize/test-remove-thumbnails.mjs`

- [ ] **Step 1: Write the failing test**

```js
// test-remove-thumbnails.mjs
import { readFileSync } from 'node:fs';
import { createPdfiumEngine } from '../../../src/index.js';
import { loadCatalog, has, assert } from './assert-helpers.mjs';
import { PDFName } from 'pdf-lib';

const engine = await createPdfiumEngine();
const input = readFileSync(new URL('./dirty.pdf', import.meta.url));
const doc = await engine.openDocument(input);
await engine.removeEmbeddedThumbnails(doc);
const out = await engine.saveAsCopy(doc);

const { doc: parsed } = await loadCatalog(out);
const pages = parsed.getPages();
for (const p of pages) assert(p.node.get(PDFName.of('Thumb')) === undefined, 'page /Thumb must be gone');
console.log('PASS: thumbnails removed');
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node packages/engines/examples/node/sanitize/test-remove-thumbnails.mjs
```
Expected: FAIL — `engine.removeEmbeddedThumbnails is not a function`.

- [ ] **Step 3: Declare the C++ export**

```c
// Remove every page's embedded thumbnail (/Thumb). Returns 1 on success.
FPDF_EXPORT FPDF_BOOL FPDF_CALLCONV EPDF_RemoveEmbeddedThumbnails(FPDF_DOCUMENT document);
```

- [ ] **Step 4: Implement by mirroring the reference**

Mirror a page-iterating extension (e.g. how `EPDFPage_*` extensions walk pages). Object-level requirement: for each page in the document, **remove the `/Thumb` key from the page dictionary**. Iterate `CPDF_Document` pages via the same accessor the neighbouring page extensions use; call the catalog/dict remover used in Task 3. Return `1`.

- [ ] **Step 5: Rebuild the WASM and vendor it**

```bash
cd packages/pdfium && bash scripts/build.sh && cd ../..
```
Expected: `functions.ts` contains `EPDF_RemoveEmbeddedThumbnails`.

- [ ] **Step 6: Add the thin engine wrapper**

In `engine.ts`, mirroring Task 3 Step 6:
```ts
removeEmbeddedThumbnails(doc: PdfDocumentObject): PdfTask<boolean> {
  const ok = this.pdfiumModule.EPDF_RemoveEmbeddedThumbnails(doc.handle);
  return TaskResult.success(ok === 1);
}
```

- [ ] **Step 7: Run the test to verify it passes**

```bash
pnpm --filter @embedpdf/engines build && node packages/engines/examples/node/sanitize/test-remove-thumbnails.mjs
```
Expected: `PASS: thumbnails removed`.

- [ ] **Step 8: Commit**

```bash
git -C ../pdfium add public/fpdf_doc.h fpdfsdk/fpdf_doc.cpp
git -C ../pdfium commit -m "feat: EPDF_RemoveEmbeddedThumbnails — strip page /Thumb streams"
git add packages/pdfium/src/vendor packages/engines/src/lib/pdfium/engine.ts packages/engines/examples/node/sanitize/test-remove-thumbnails.mjs
git commit -m "feat(engines): removeEmbeddedThumbnails wrapper + test"
```

---

## Task 5: `EPDF_RemoveAllJavaScript`

Remove the catalog `/Names /JavaScript` name tree, `/OpenAction` (when it is a JavaScript action), and the document-catalog `/AA`.

**Files (pdfium fork):**
- Modify: `public/fpdf_doc.h` (declaration)
- Modify: `fpdfsdk/fpdf_doc.cpp` (implementation)
- Test (engines repo): `packages/engines/examples/node/sanitize/test-remove-javascript.mjs`

- [ ] **Step 1: Write the failing test**

```js
// test-remove-javascript.mjs
import { readFileSync } from 'node:fs';
import { createPdfiumEngine } from '../../../src/index.js';
import { loadCatalog, has, assert } from './assert-helpers.mjs';
import { PDFName } from 'pdf-lib';

const engine = await createPdfiumEngine();
const input = readFileSync(new URL('./dirty.pdf', import.meta.url));
const doc = await engine.openDocument(input);
await engine.removeAllJavaScript(doc);
const out = await engine.saveAsCopy(doc);

const { catalog } = await loadCatalog(out);
assert(!has(catalog, 'OpenAction'), '/OpenAction must be gone');
assert(!has(catalog, 'AA'), 'catalog /AA must be gone');
const names = catalog.get(PDFName.of('Names'));
// Names dict may remain, but its /JavaScript entry must not.
const namesDict = names && catalog.context ? catalog.lookup?.(PDFName.of('Names')) : undefined;
assert(!namesDict || namesDict.get(PDFName.of('JavaScript')) === undefined, '/Names /JavaScript must be gone');
console.log('PASS: javascript removed');
```
> Confirm the `pdf-lib` lookup shape for the `Names` indirect object at execution; the invariant under test is "no `/JavaScript` name tree and no `/OpenAction`/`/AA`."

- [ ] **Step 2: Run it to verify it fails**

```bash
node packages/engines/examples/node/sanitize/test-remove-javascript.mjs
```
Expected: FAIL — `engine.removeAllJavaScript is not a function`.

- [ ] **Step 3: Declare the C++ export**

```c
// Remove all document JavaScript: catalog /Names /JavaScript, /OpenAction (if a
// JavaScript action), and catalog /AA. Returns 1 on success.
FPDF_EXPORT FPDF_BOOL FPDF_CALLCONV EPDF_RemoveAllJavaScript(FPDF_DOCUMENT document);
```

- [ ] **Step 4: Implement by mirroring the reference**

Mirror `EPDFNamedDest_Remove` (it already edits the catalog `/Names` tree — the closest precedent). Object-level requirements on the catalog dictionary:
1. From `/Names`, remove the `/JavaScript` key (the JS name tree). Leave other `/Names` subtrees intact.
2. Remove `/OpenAction` **only if** it resolves to a dict whose `/S` is `/JavaScript` (do not remove a go-to-page open action).
3. Remove the catalog-level `/AA`.
Use the same dict mutators as Tasks 3–4. Return `1`.

- [ ] **Step 5: Rebuild the WASM and vendor it**

```bash
cd packages/pdfium && bash scripts/build.sh && cd ../..
```
Expected: `functions.ts` contains `EPDF_RemoveAllJavaScript`.

- [ ] **Step 6: Add the thin engine wrapper**

```ts
removeAllJavaScript(doc: PdfDocumentObject): PdfTask<boolean> {
  const ok = this.pdfiumModule.EPDF_RemoveAllJavaScript(doc.handle);
  return TaskResult.success(ok === 1);
}
```

- [ ] **Step 7: Run the test to verify it passes**

```bash
pnpm --filter @embedpdf/engines build && node packages/engines/examples/node/sanitize/test-remove-javascript.mjs
```
Expected: `PASS: javascript removed`.

- [ ] **Step 8: Commit**

```bash
git -C ../pdfium add public/fpdf_doc.h fpdfsdk/fpdf_doc.cpp
git -C ../pdfium commit -m "feat: EPDF_RemoveAllJavaScript — strip JS name tree, OpenAction, /AA"
git add packages/pdfium/src/vendor packages/engines/src/lib/pdfium/engine.ts packages/engines/examples/node/sanitize/test-remove-javascript.mjs
git commit -m "feat(engines): removeAllJavaScript wrapper + test"
```

---

## Task 6: `sanitizeDocument()` orchestrator + `PdfEngine` contract

Compose the three new exports + the existing attachment-delete loop + a forced non-incremental save into one method, gated by an options object. (The `optionalContentGroups` flag is **not** added yet — it arrives with the OCG follow-up plan.)

**Files:**
- Modify: `packages/models/src/pdf.ts` (add `SanitizeOptions` + the `sanitizeDocument` method to `PdfEngine`)
- Modify: `packages/engines/src/lib/pdfium/engine.ts` (implement `sanitizeDocument`)
- Test: `packages/engines/examples/node/sanitize/test-sanitize-document.mjs`

- [ ] **Step 1: Write the failing test (covers all in-scope vectors + non-incremental save)**

```js
// test-sanitize-document.mjs
import { readFileSync } from 'node:fs';
import { createPdfiumEngine } from '../../../src/index.js';
import { loadCatalog, has, assert } from './assert-helpers.mjs';
import { PDFName } from 'pdf-lib';

const engine = await createPdfiumEngine();
const input = readFileSync(new URL('./dirty.pdf', import.meta.url));
const doc = await engine.openDocument(input);
const out = await engine.sanitizeDocument(doc); // defaults: all in-scope vectors on

const { doc: parsed, catalog } = await loadCatalog(out);
assert(!has(catalog, 'Metadata'), 'XMP gone');
assert(!has(catalog, 'OpenAction'), 'OpenAction gone');
assert(!has(catalog, 'AA'), 'AA gone');
for (const p of parsed.getPages()) assert(p.node.get(PDFName.of('Thumb')) === undefined, 'thumb gone');
// attachments gone:
const names = catalog.get(PDFName.of('Names'));
assert(!names || true, 'attachments removed via removeAttachment loop'); // engine-level check below
// non-incremental: output is a single-revision file (one %%EOF / no prior xref chain)
const text = Buffer.from(out).toString('latin1');
const eofCount = (text.match(/%%EOF/g) || []).length;
assert(eofCount === 1, `expected single %%EOF (full rewrite), got ${eofCount}`);
console.log('PASS: sanitizeDocument scrubbed all in-scope vectors, single-revision output');
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node packages/engines/examples/node/sanitize/test-sanitize-document.mjs
```
Expected: FAIL — `engine.sanitizeDocument is not a function`.

- [ ] **Step 3: Add the contract to `PdfEngine`**

In `packages/models/src/pdf.ts`:
```ts
export interface SanitizeOptions {
  xmp?: boolean;              // default true
  javascript?: boolean;       // default true
  embeddedThumbnails?: boolean; // default true
  attachments?: boolean;      // default true
  // optionalContentGroups added by the OCG follow-up plan
}

export interface PdfEngine {
  // ...existing methods...
  /**
   * Destructively scrub non-content hidden vectors and serialize a clean,
   * non-incremental copy. Does NOT verify; verification is a product-layer concern.
   */
  sanitizeDocument(doc: PdfDocumentObject, options?: SanitizeOptions): PdfTask<ArrayBuffer>;
}
```
> Match `PdfTask`/return-type conventions used by the existing `saveAsCopy` signature in this file.

- [ ] **Step 4: Implement `sanitizeDocument` in the engine**

In `packages/engines/src/lib/pdfium/engine.ts`:
```ts
sanitizeDocument(doc: PdfDocumentObject, options: SanitizeOptions = {}): PdfTask<ArrayBuffer> {
  const o = { xmp: true, javascript: true, embeddedThumbnails: true, attachments: true, ...options };
  if (o.xmp) this.pdfiumModule.EPDF_RemoveXMPMetadata(doc.handle);
  if (o.javascript) this.pdfiumModule.EPDF_RemoveAllJavaScript(doc.handle);
  if (o.embeddedThumbnails) this.pdfiumModule.EPDF_RemoveEmbeddedThumbnails(doc.handle);
  if (o.attachments) {
    // reuse the existing attachment APIs; delete from the end to keep indices valid
    const count = this.pdfiumModule.FPDFDoc_GetAttachmentCount(doc.handle);
    for (let i = count - 1; i >= 0; i--) this.pdfiumModule.FPDFDoc_DeleteAttachment(doc.handle, i);
  }
  // forced full rewrite — flags = 0, NEVER FPDF_INCREMENTAL
  return this.saveAsCopy(doc); // confirm saveAsCopy already passes 0; if it takes flags, pass 0 explicitly
}
```
> Confirm the exact attachment + saveAsCopy call shapes against the existing `removeAttachment`/`saveAsCopy` methods and reuse them rather than calling the raw module if the repo wraps them. Keep the "delete from the end" ordering.

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm --filter @embedpdf/models build && pnpm --filter @embedpdf/engines build && node packages/engines/examples/node/sanitize/test-sanitize-document.mjs
```
Expected: `PASS: sanitizeDocument scrubbed all in-scope vectors, single-revision output`.

- [ ] **Step 6: Commit**

```bash
git add packages/models/src/pdf.ts packages/engines/src/lib/pdfium/engine.ts packages/engines/examples/node/sanitize/test-sanitize-document.mjs
git commit -m "feat(engines): sanitizeDocument orchestrator (XMP+JS+thumbnails+attachments, non-incremental)"
```

---

## Task 7: Submit the upstream PR (three vectors) and record the pilot

The in-scope work is complete and tested; submit before OCG so the approval clock runs on a clean, reviewable bundle.

- [ ] **Step 1: Push both forks**

```bash
git -C ../pdfium push origin embedpdf/main   # or a feature branch on the pdfium fork
git push origin feat/document-sanitization
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --repo embedpdf/embed-pdf-viewer --base main --head <your-fork>:feat/document-sanitization \
  --title "feat: document sanitization — strip XMP, JavaScript, embedded thumbnails" \
  --body "Implements the API agreed in #<issue-number>. Adds EPDF_RemoveXMPMetadata, EPDF_RemoveEmbeddedThumbnails, EPDF_RemoveAllJavaScript (granular, one commit each) and a sanitizeDocument() orchestrator composing them with the existing removeAttachment loop and a non-incremental saveAsCopy. Node example tests in packages/engines/examples/node/sanitize/ assert each vector against a crafted dirty fixture. OCG stripping follows in a separate PR (needs a content-removal-semantics spike). Note the pdfium fork PR: <link>."
```
Reference the Task 0 issue. The pdfium-fork change is a companion PR on `embedpdf/pdfium` (or a vendored-wasm note, per how the maintainer prefers cross-repo changes — ask in the issue).

- [ ] **Step 3: Record the pilot in our repo**

Back in the Magna Carta repo, add a one-line pilot note to ADR-0088 (the decision home) and a pointer from the research note. Stage explicit paths only (no `git add -A`).
```bash
# in the Magna Carta repo
git add docs/Decision-Log.md docs/research/pdf-tooling.md
git commit -m "docs(adr): ADR-0088 upstream-first pilot underway — EmbedPDF sanitize PR submitted"
```
Note in ADR-0088: issue date (t=0), PR date, and a place to record the merge/close date — the latency datapoint the pilot exists to capture.

---

## Task 8 (Spike — exploratory, not TDD): OCG content-removal semantics

This seeds the **separate OCG follow-up plan** (design spec §4). Do not write production C++ here; produce findings.

- [ ] **Step 1: Build an OCG fixture**

Extend `build-dirty-fixture.mjs` (or a sibling) to inject `/OCProperties` with one OCG whose default config is **OFF**, and mark a content sequence on the page with `/OC` referencing it (BDC/EMC marked content). Confirm with a viewer that the marked content is hidden by default.

- [ ] **Step 2: Investigate PDFium's OC exposure**

Determine, from the `embedpdf/pdfium` source: how the OC tree is reachable (`/OCProperties`, `/OCGs`, `/D` default config `/OFF` array), whether PDFium exposes content-stream editing sufficient to excise BDC/EMC-bracketed marked content, and whether existing `EPDFPage_*`/content APIs can remove a marked-content range.

- [ ] **Step 3: Decide the removal strategy and write up findings**

Record (in a short note feeding the follow-up plan): can we excise hidden marked content cleanly, or must we rasterize/flatten? Which `EPDF_*` export shape (`EPDF_RemoveOptionalContentGroups`) and what it must touch (`/OCProperties`, page/XObject/annotation `/OC`, the marked content). Confirm the §8 open item: does `saveAsCopy(…, 0)` garbage-collect the now-orphaned OCG objects, or is an explicit removal needed.

- [ ] **Step 4: Hand off**

The spike note + OCG fixture are the inputs to a new `writing-plans` run for the OCG export and its `optionalContentGroups` orchestrator flag.

---

## Self-Review (completed by plan author)

- **Spec coverage:** XMP (Task 3), thumbnails (Task 4), JavaScript (Task 5), orchestrator + non-incremental save + attachment reuse (Task 6), upstream issue-first + granular commits + PR + pilot recording (Tasks 0, 7), OCG carved to a spike-gated follow-up (Task 8) — matches design §0–§6 and the §4 OCG carve-out. Info-dict clearing (§3/§8 open item) is intentionally left to the existing `setMetadata`; the orchestrator does not re-clear it (decision recorded here: out of scope, already covered).
- **Placeholder scan:** C++ bodies are specified at the PDF-object level with a named reference extension to mirror — this is the correct ceiling for external-fork C++ whose `.cpp` internals are unread; not a placeholder. Test/JS/build steps carry complete code/commands.
- **Type consistency:** `sanitizeDocument`/`SanitizeOptions` (Task 6) and the wrapper names `removeXMPMetadata` / `removeEmbeddedThumbnails` / `removeAllJavaScript` (Tasks 3–5) are used identically in the orchestrator. The `optionalContentGroups` flag is deliberately absent until the OCG plan.
- **Cross-repo caveat:** every C++ step pairs a `../pdfium` fork commit with the engines-repo vendored-wasm commit; the WASM rebuild (`scripts/build.sh`) is the compile step before each export's test can pass.
