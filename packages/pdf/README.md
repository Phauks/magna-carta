# @magna-carta/pdf

A TypeScript wrapper around a pure-Rust PDF renderer compiled to WebAssembly. Given raw PDF bytes, it lets you count pages, measure page dimensions, and render any page to a pixel buffer — entirely in the browser or in the Tauri desktop shell, with no server round-trip and no native binary dependency.

## What it does

- **Parses and renders PDFs in-process.** The render engine is `hayro`, a pure-Rust library compiled to `wasm32-unknown-unknown`. The `.wasm` binary ships with this package under `src/pkg/`.
- **Produces raw pixel data or PNG.** The default output is a flat RGBA byte array (`rgba8`), which you can paint directly onto a `<canvas>`. Pass `encodePng: true` to get a PNG-encoded `Uint8Array` instead.
- **No server call.** Rendering happens in the WASM module; nothing leaves the browser.

## API

### `loadDocument(bytes, wasmInput?)`

Parses a PDF from a `Uint8Array` of raw PDF bytes. Returns a `PdfDocument`. Throws `PdfError` if the bytes are not a valid PDF or the WASM module cannot be initialised.

```ts
import { loadDocument } from "@magna-carta/pdf";

const bytes = new Uint8Array(await file.arrayBuffer());
const doc = await loadDocument(bytes);
```

The optional `wasmInput` argument (`BufferSource | WebAssembly.Module`) lets you supply the WASM bytes directly — useful in Node.js or Vitest, where `fetch` may not be available:

```ts
import { readFileSync } from "node:fs";
import { loadDocument } from "@magna-carta/pdf";

const wasm = readFileSync(new URL("./src/pkg/pdf_core_bg.wasm", import.meta.url));
const doc = await loadDocument(pdfBytes, wasm);
```

### `PdfDocument`

The handle returned by `loadDocument`. It holds a reference to WASM-owned memory.

**`doc.pageCount`** — the number of pages in the document (integer).

**`doc.pageSize(index)`** — dimensions of page `index` (0-based) in PDF points:

```ts
const { widthPt, heightPt } = doc.pageSize(0);
```

**`doc.renderPage(index, opts?)`** — renders page `index` and returns a `RenderedPage`:

| Option      | Type      | Default | Description                                                                                                                   |
| ----------- | --------- | ------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `dpi`       | `number`  | `150`   | Render resolution. Higher values produce sharper images at the cost of more memory.                                           |
| `encodePng` | `boolean` | `false` | When `true`, the returned `data` is a PNG-encoded `Uint8Array`. When `false` (the default), `data` is a flat RGBA byte array. |

```ts
// Paint to a canvas (rgba8 default)
const { data, width, height } = doc.renderPage(0, { dpi: 150 });
const ctx = canvas.getContext("2d")!;
const imageData = new ImageData(new Uint8ClampedArray(data), width, height);
ctx.putImageData(imageData, 0, 0);

// Get a PNG instead
const { data: png } = doc.renderPage(0, { dpi: 150, encodePng: true });
const blob = new Blob([png], { type: "image/png" });
```

**`doc.free()`** — releases the WASM-owned memory for this document. Always call `free()` when you are done with a document; the GC does not reach into WASM memory.

### Memory management — `free()` and `using`

`PdfDocument` holds a handle to an allocation inside the WASM linear memory heap. That memory is not automatically reclaimed when the JavaScript object is garbage-collected. You must release it explicitly:

```ts
const doc = await loadDocument(bytes);
try {
  // ... use doc ...
} finally {
  doc.free();
}
```

If your environment supports the TC39 `using` declaration (TypeScript 5.2+, targeting `ES2022` or later with `lib.esnext.disposable`), `PdfDocument` implements `Symbol.dispose`:

```ts
{
  await using doc = await loadDocument(bytes);
  // doc.free() is called automatically at the end of this block
}
```

### `ensureReady(wasmInput?)`

Initialises the WASM module without parsing a document. Call this once at startup if you want to pay the initialisation cost before the first `loadDocument` call.

```ts
import { ensureReady } from "@magna-carta/pdf";
await ensureReady(); // fetches and compiles the WASM binary
```

The module initialises itself lazily the first time `loadDocument` is called; `ensureReady` lets you move that cost to a more convenient moment (e.g. during an idle period after page load).

## Types

```ts
interface PageSize {
  widthPt: number; // page width in PDF points (1 pt = 1/72 inch)
  heightPt: number; // page height in PDF points
}

interface RenderedPage {
  data: Uint8Array; // pixel data: flat RGBA bytes, or PNG bytes if encodePng was true
  width: number; // pixel width of the rendered image
  height: number; // pixel height of the rendered image
  encoding: "rgba8" | "png"; // matches the encodePng option
}

interface RenderOptions {
  dpi?: number; // default 150
  encodePng?: boolean; // default false
}
```

## Error handling

All errors are thrown as standard `Error` instances (not a custom subclass). The `.message` is one of three fixed strings:

- `"failed to parse PDF"` — thrown by `loadDocument` when the input bytes are not a valid PDF.
- `"page index out of range"` — thrown by `pageSize` or `renderPage` when `index` is outside the document's page range.
- `"failed to render page"` — thrown by `renderPage` when the renderer fails on an otherwise-valid page.

Wrap calls in `try/catch` and inspect `error.message` to distinguish these cases.

## Redaction

`redactDocument(bytes, regions, opts)` permanently removes content from one or more pages by rasterizing each affected page, painting an opaque black box over the specified region, and replacing the page's entire content stream with the resulting image. Original text, vector graphics, and font data do not survive in the output.

### `redactDocument(bytes, regions, opts)`

```ts
import { redactDocument } from "@magna-carta/pdf";

const regions = [
  {
    page: 0, // 0-based page index
    rect: { x0: 50, y0: 100, x1: 300, y1: 200 }, // display points, bottom-left origin (same units as the page size)
    reason: "privileged", // optional — not written into the output PDF
  },
];
const result = await redactDocument(new Uint8Array(inputBytes), regions, { dpi: 300 });
// result.pdf — Uint8Array of the redacted PDF
// result.pagesRedacted — array of page indices that were modified
```

**Coordinate convention.** `rect` values are in display points with a bottom-left origin — the same units and orientation as the page dimensions (a US-Letter page is 612 × 792 points). The two corners may be given in any order; they are normalized internally. The hayro render pipeline absorbs page rotation and non-zero `MediaBox` origins automatically, so callers do not need to adjust for those.

**DPI.** The default is 300, which exceeds typical court-filing requirements without producing unreasonably large files. Lower values produce smaller files at the cost of image quality for the remaining (non-redacted) page content.

**Hard gate — the function never returns an unsafe PDF.** After reassembly, a verification gate extracts text from the output and scans the raw output bytes. If any of the strings you supplied in `opts.redactedText` survive — or if the text extraction itself fails structurally — `redactDocument` throws rather than returning the document. This means the caller can treat a successful return as a guarantee of survival failure: either the document is safe, or the call threw.

```ts
try {
  const result = await redactDocument(bytes, regions, {
    dpi: 300,
    redactedText: ["CONFIDENTIAL", "attorney-client"],
  });
  // Safe to use result.pdf — gate passed.
} catch (err) {
  // Gate failed or parse error — do not use the output.
}
```

**What redaction covers.** By default (mode `"flatten"`), each redacted page is replaced in its entirety with a raster image. All text, font data, form XObjects, and vector graphics on that page are removed; only unredacted pages retain their original PDF operators. The text-preserving route (`mode: "surgery"`) removes only the targeted glyphs; see the subsection below.

### `RedactionOptions`

| Field          | Type                     | Default     | Description                                                                                                                             |
| -------------- | ------------------------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `dpi`          | `number`                 | `300`       | Render resolution for rasterization.                                                                                                    |
| `redactedText` | `string[]`               | `[]`        | Strings the gate checks for survival in the output. Pass the verbatim text you are redacting so the gate can verify it does not appear. |
| `mode`         | `"flatten" \| "surgery"` | `"flatten"` | Redaction route. See the Text-preserving redaction subsection below.                                                                    |

Redaction always paints an opaque black box (the standard for legal production); the fill colour is not configurable.

### `RedactionResult`

```ts
interface RedactionResult {
  pdf: Uint8Array; // the redacted PDF bytes
  pagesRedacted: number[]; // all page indices (0-based) where content was redacted
  pagesSurgered: number[]; // pages where text-preserving surgery succeeded (empty in flatten mode)
  pagesFlattened: number[]; // pages rasterised to an image (all pages in flatten mode, plus any surgery fallbacks)
}
```

### Text-preserving redaction

> **Status: incomplete (v1, partial coverage).** Text-preserving surgery is a safe but
> deliberately limited first version. It succeeds only on pages that meet the conditions
> below; **every other page automatically falls back to `"flatten"`**, so on many
> real-world documents (scanned pages, CJK/composite fonts, form-XObject text, inline
> images) most or all pages are still rasterised. The safety guarantee holds in every
> case — but do not assume `"surgery"` will preserve text on an arbitrary document. Known
> not-yet-supported categories that fall back: non-Identity Type0/CID (CJK) fonts, text
> drawn inside Form XObjects, and inline images, plus the others listed below. These are
> planned for later versions; until then the result is correct but coverage is partial.

Pass `mode: "surgery"` to attempt text-preserving content-stream surgery instead of full-page rasterization. Surgery excises only the glyphs whose centres fall inside a redaction rectangle, leaving the remaining text on the page as selectable PDF operators.

```ts
const result = await redactDocument(bytes, regions, { mode: "surgery" });
// result.pagesSurgered — pages where surgery succeeded (text preserved)
// result.pagesFlattened — pages rasterised (surgery fell back to flatten)
```

**The safety guarantee is unchanged.** Surgery is attempted per page and falls back to `"flatten"` for any page it cannot confirm clear. A page is only counted as surgered when an outcome gate re-observes the page after the edit and finds no glyph centre remaining inside any redaction rectangle. Any page that does not pass the gate is rasterised instead. The result of a surgery call is never less safe than a flatten call.

**Over-removal is the only residual non-safety failure mode.** Surgery may excise a neighbouring glyph that was not strictly inside the redaction rectangle (because glyph centre position is approximated during the content-stream walk). Over-removal is a precision loss, not a content-survival bug.

**Surgery falls back to flatten for a page when:**

- The page uses a simple font (Type1, TrueType, or MMType1) that is not one of the standard-14 fonts and omits the `/Widths` array — the advance widths required to locate individual glyphs are not available.
- The page uses a Type3 font, or a Type0 (CID) font with a non-Identity encoding — these cannot be reliably walked to locate individual glyph positions.
- The page dictionary carries a non-zero `/Rotate` entry.
- The content stream contains inline image operators (`BI`/`ID`/`EI`).
- A redaction rectangle overlaps a raster image XObject (for example, a scanned page with embedded images).
- The content stream does not round-trip cleanly through the PDF content parser (the byte count after encode/decode does not match).

On those pages, flatten produces the output; the page appears in `pagesFlattened` rather than `pagesSurgered`.

One narrow case is not detected as an image overlap: a tiling pattern that embeds a raster image and is used as a fill under a redaction rectangle is treated as vector content, so the page may surger rather than flatten. Patterns are rare in redaction-bearing documents, but if a production may contain image-bearing patterns under redactions, use `mode: "flatten"` for a guaranteed raster result.

## Sanitize

`sanitizeDocument(bytes, opts?)` removes document-level metadata and embedded surfaces that should not accompany a document shared outside the firm. It operates on the document as a whole — it is not page-specific and does not rasterize anything.

### `sanitizeDocument(bytes, opts?)`

```ts
import { sanitizeDocument } from "@magna-carta/pdf";

const { pdf } = await sanitizeDocument(new Uint8Array(inputBytes));
// pdf — Uint8Array of the sanitized PDF
```

Pass a `ScrubOptions` object as the second argument to opt individual surfaces out of removal. All flags default to `true` (remove the surface):

### `ScrubOptions`

| Field             | Type      | Default | Surface removed when `true`                                                                                                                                   |
| ----------------- | --------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `metadata`        | `boolean` | `true`  | Document metadata stream (`/Metadata`) and the information dictionary (`/Info`) — author, creation date, application name, and similar properties.            |
| `xfa`             | `boolean` | `true`  | The XFA form definition (`/XFA` in `AcroForm`). Blank AcroForm fields are kept so the document remains a usable form; only the XFA-specific data is stripped. |
| `structureTree`   | `boolean` | `true`  | The document structure tree (`/StructTreeRoot`) used for accessibility tagging.                                                                               |
| `outlines`        | `boolean` | `true`  | The bookmark outline tree (`/Outlines`).                                                                                                                      |
| `optionalContent` | `boolean` | `true`  | Optional-content configuration (`/OCProperties` in the catalog). See the boundaries note below.                                                               |
| `attachments`     | `boolean` | `true`  | Embedded file attachments — the `/EmbeddedFiles` name tree and any `FileAttachment` annotations on pages.                                                     |
| `formFieldValues` | `boolean` | `true`  | Form field values and appearance streams; blank field shells are kept.                                                                                        |

**Redaction is sanitized-by-default.** `redactDocument` accepts an optional `scrub` field in `RedactionOptions`. When `scrub` is omitted (the default) it is treated as `true`, so the output of a redaction is also sanitized. Pass `scrub: false` to skip sanitization on a redaction output.

### Verification gate

`sanitizeDocument` enforces a hard gate: after removing the surfaces, it verifies that every surface you asked to scrub is actually absent from the output. If a scrubbed surface survives — or the document cannot be reassembled — the call throws rather than returning an output. Surfaces you opt out of are not checked.

`sanitizeDocument` takes no `redactedText` list; its gate is structural. The byte-level decompress-and-scan for specific strings (see the boundaries below) belongs to `redactDocument`, where you pass the text being redacted via `redactedText`. To flatten a region _and_ verify a particular string is gone document-wide, use `redactDocument` — it is sanitized-by-default, so it scrubs these same surfaces too.

### Boundaries

Three limitations apply and should be understood before use:

1. **Optional-content scrub is configuration-level.** Setting `optionalContent: true` removes the `/OCProperties` entry, which means no layer stays hidden — all content that was toggled off becomes unconditionally visible. It does not excise the marked-content operators (`BMC`/`EMC` boundaries and their enclosed drawing instructions) from page content streams. Text within those operators therefore remains in the document as drawn content. When you redact with `redactDocument` and pass that text via `redactedText`, the byte-level scan does catch it inside such operators, including inside compressed streams, so that path is covered for known strings.

2. **Removing the structure tree drops accessibility tagging.** `structureTree: true` deletes the `/StructTreeRoot` and associated role maps. Screen readers and other assistive technologies rely on the structure tree; documents that must remain accessible should pass `structureTree: false`.

3. **The supplied-text survival check is byte-level.** When you pass `redactedText` to `redactDocument`, the gate decompresses streams and searches for each string as literal bytes. It catches a string stored as plain text, including inside compressed (`FlateDecode`) streams. It does not decode custom-font glyph encodings or pixel-encoded images: a string that was rendered only as glyph codes (where the raw byte sequence does not spell out the text) or rasterized into a pixel image is not matched as literal text. Redacting the region with `redactDocument` removes that page's content entirely (it becomes an image), which is the way to handle those encodings.

## Detection

`detectDocument(bytes)` scans a PDF for bad-redaction patterns — content that appears hidden to a viewer but remains recoverable from the file. It returns a `DetectionReport` describing what was found and how severe it is.

**This function is read-only: it never modifies the input bytes.** It also **never asserts a document is clean** — an empty `findings` list means none of these mechanisms detected anything, not a guarantee of safety. The report includes `pagesUnreadable`: page indices the renderer could not interpret. An empty `findings` list does not clear those pages — they were not examined.

### `detectDocument(bytes)`

```ts
import { detectDocument } from "@magna-carta/pdf";

const bytes = new Uint8Array(await file.arrayBuffer());
const report = await detectDocument(bytes);
// report.findings  — ranked list of DetectionFinding (Critical first)
// report.pagesScanned — number of pages examined by the geometric detectors
// report.glyphsExamined — total glyphs considered across all scanned pages
// report.pagesUnreadable — page indices (0-based) the renderer could not parse
```

### `DetectionFinding`

Each entry in `report.findings` has this shape:

```ts
interface DetectionFinding {
  category:
    | "coveredText"
    | "invisibleText"
    | "whiteoutText"
    | "removableAnnotation"
    | "hiddenLayer"
    | "metadataLeak"
    | "orphanedText";
  severity: "critical" | "high" | "medium" | "low" | "info";
  page: number | null; // 0-based page index; null for document-level findings
  region: { x0: number; y0: number; x1: number; y1: number } | null; // display-point bbox; null for document-level findings
  recoveredText: string; // the text string recovered from the hidden location
  detail: string; // human-readable explanation of the finding
}
```

### Detection categories and severities

| `category`            | `severity` | What it means                                                                                                                                                                             |
| --------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `coveredText`         | `critical` | Extractable text sits under an opaque fill that hides it from view. The classic bad redaction: the words are present in the file and selectable; only the visual rendering conceals them. |
| `invisibleText`       | `high`     | Text drawn in an invisible render mode (PDF text rendering mode 3, "invisible"). Recoverable by extraction even though it does not appear on screen.                                      |
| `whiteoutText`        | `high`     | Text painted the same color as the covering fill — for example, white text under a white box. Both the text and the fill are light-colored, creating a same-color concealment.            |
| `removableAnnotation` | `critical` | Extractable text sits under an annotation that can be deleted to reveal it — for example an unapplied redaction mark.                                                                     |
| `hiddenLayer`         | `high`     | Text drawn on an optional-content layer that the document hides by default.                                                                                                               |
| `metadataLeak`        | `medium`   | The document's information dictionary, XMP metadata stream, bookmark titles, or AcroForm field values carry text content. These surfaces survive even when page content is removed.       |
| `orphanedText`        | `high`     | Text present in a PDF object that no page references, but which remains in the file bytes. A copy-and-paste or search tool that reads the raw cross-reference table can recover it.       |

**Why `invisibleText` is `high` rather than `critical`:** PDF invisible text (rendering mode 3) is overwhelmingly benign in practice — OCR workflows commonly place a transparent text layer over a scanned image to enable selection and search. The finding is flagged because invisible text on a document that should not have a text layer is suspicious, but it is not treated as the most severe category.

### Honest boundaries

Before acting on a detection report, understand these limits:

1. **Metadata and orphaned findings are document-level.** `page` and `region` are `null` for `metadataLeak` and `orphanedText` findings — they describe content anywhere in the file, not a specific visible location.

2. **Custom-font glyph codes without a ToUnicode map may yield empty `recoveredText`.** When a font uses custom glyph codes and the PDF carries no `ToUnicode` mapping, the text extractor cannot decode the characters. The finding is still raised (a covered glyph is still a covered glyph), but `recoveredText` may be an empty string.

3. **Text rasterized into an image is not recovered.** If the page content was previously converted to a pixel image — the correct output of `redactDocument` — the detector finds no text on that page. That is the intended result of proper redaction.

4. **HiddenLayer findings are document-level for the layer text (`region: null`) and recover the text but not per-glyph geometry.** The detector resolves the optional-content group by a `/Properties` resource name and does not resolve a rare inline optional-content dictionary where the group is specified without a named resource.

5. **RemovableAnnotation keys off the annotation subtype.** The detector flags text whose glyph center falls within the bounding rectangle of an annotation whose subtype is one of: Redact, Square, Circle, Polygon, FreeText, Stamp, Highlight, or Ink. A transparent annotation of such a subtype over text is still flagged (high-recall). An obscuring annotation whose subtype is outside that list is not flagged.

6. **Covered-text detection is glyph-center based.** A glyph is flagged as covered when the center of its bounding box falls within the covering fill. A glyph that is more than half outside the fill — or a fill that is rotated or non-rectangular (it is approximated by its axis-aligned bounding box) — may not be flagged even though most of the character is concealed. Covers that fully contain the text they hide (the usual case) are detected reliably.

### `DetectionReport`

```ts
interface DetectionReport {
  findings: DetectionFinding[]; // ranked critical → info; empty means nothing detected
  summary: { critical: number; high: number; medium: number; low: number; info: number }; // finding counts per tier
  pagesScanned: number; // pages the geometric detectors successfully examined
  glyphsExamined: number; // total glyphs considered
  pagesUnreadable: number[]; // page indices the renderer could not interpret
}
```

## Bates numbering

`stampBates(bytes, options?)` adds a sequential identifying label to every page of a PDF. Each label is printed in Helvetica at a configurable corner of the page and reads upright regardless of the page's rotation.

**Additive overlay — not redaction.** The label is added as selectable PDF text on top of existing content. No existing text, images, vector graphics, or metadata are removed or modified. To permanently remove content, use `redactDocument`.

**Scope (v1).** `stampBates` produces one stamped file per input document; combining a set into a single merged PDF and inserting slip or cover pages are not part of this version. To number a set continuously, thread the counter across calls (pass the previous result's `end + 1` as the next `startNumber`).

### `stampBates(bytes, options?)`

```ts
import { stampBates } from "@magna-carta/pdf";

const bytes = new Uint8Array(await file.arrayBuffer());
const result = await stampBates(bytes, {
  prefix: "SMITH-",
  startNumber: 1,
  padding: 6,
  position: "bottomRight",
});
// result.pdf      — Uint8Array of the stamped PDF
// result.start    — Bates number on the first page (1)
// result.end      — Bates number on the last page
// result.pageCount — total pages stamped
```

### `BatesStampOptions`

| Field         | Type            | Default         | Description                                                                                                                                                                                                                                                      |
| ------------- | --------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prefix`      | `string`        | `""`            | Text prepended before the zero-padded number, e.g. `"SMITH-"` produces labels like `SMITH-000001`.                                                                                                                                                               |
| `suffix`      | `string`        | `""`            | Text appended after the zero-padded number, e.g. `"-CONF"` produces labels like `SMITH-000001-CONF`.                                                                                                                                                             |
| `startNumber` | `number`        | `1`             | Bates number assigned to the first page.                                                                                                                                                                                                                         |
| `stopNumber`  | `number`        | _(none)_        | Inclusive ceiling on the last Bates number that may be stamped. When set, the call throws if any page in the document would receive a number greater than `stopNumber`. The check runs before any page is modified, so either all pages are stamped or none are. |
| `padding`     | `number`        | `6`             | Minimum digit width. Numbers shorter than `padding` digits are zero-padded to that width; numbers longer than `padding` digits are not truncated.                                                                                                                |
| `position`    | `BatesPosition` | `"bottomRight"` | Corner or edge where the label is placed.                                                                                                                                                                                                                        |
| `font`        | `BatesFont`     | `"helvetica"`   | Typeface for the stamp label. Must be one of the twelve built-in standard PDF Type 1 text fonts listed below. Custom or uploaded fonts are not supported in this version.                                                                                        |
| `marginPt`    | `number`        | `18`            | Distance in PDF points from the nearest page edge.                                                                                                                                                                                                               |
| `fontSizePt`  | `number`        | `8`             | Font size in PDF points.                                                                                                                                                                                                                                         |

`BatesPosition` is one of: `"bottomRight"` · `"bottomLeft"` · `"bottomCenter"` · `"topRight"` · `"topLeft"` · `"topCenter"`.

`BatesFont` is one of the twelve built-in standard PDF Type 1 text fonts. These fonts are guaranteed to be present in every conforming PDF viewer without requiring font embedding — the stamp adds a three-key font reference only, never a font file:

| Value                     | Family    | Style        |
| ------------------------- | --------- | ------------ |
| `"helvetica"`             | Helvetica | Regular      |
| `"helvetica-bold"`        | Helvetica | Bold         |
| `"helvetica-oblique"`     | Helvetica | Oblique      |
| `"helvetica-boldoblique"` | Helvetica | Bold Oblique |
| `"times-roman"`           | Times     | Regular      |
| `"times-bold"`            | Times     | Bold         |
| `"times-italic"`          | Times     | Italic       |
| `"times-bolditalic"`      | Times     | Bold Italic  |
| `"courier"`               | Courier   | Regular      |
| `"courier-bold"`          | Courier   | Bold         |
| `"courier-oblique"`       | Courier   | Oblique      |
| `"courier-boldoblique"`   | Courier   | Bold Oblique |

### `BatesStampResult`

```ts
interface BatesStampResult {
  pdf: Uint8Array; // the stamped PDF bytes
  start: number; // Bates number on the first page (inclusive)
  end: number; // Bates number on the last page (inclusive)
  pageCount: number; // total pages stamped
}
```

### Stamping a multi-document set with continuous numbering

`stampBates` stamps a single document. To stamp a set of documents with a continuous Bates range (where each document continues from where the previous one left off), call `stampBates` in sequence, threading `startNumber` from the previous result's `end + 1`:

```ts
let nextNumber = 1;
const stamped: Uint8Array[] = [];
for (const docBytes of documentSet) {
  const result = await stampBates(docBytes, { prefix: "SMITH-", startNumber: nextNumber });
  stamped.push(result.pdf);
  nextNumber = result.end + 1;
}
```

### Placement and rotation

The label is placed in the requested corner of the page as it appears to a viewer — after the viewer applies any `/Rotate` entry. On a page rotated 90°, `"bottomRight"` still places the label at the visual bottom right of the displayed page, and the text reads upright.

The engine uses the chosen built-in standard font (default Helvetica), which is natively available in every PDF viewer without embedding. The label is placed using a shared font object added once per document, so stamping a 500-page document adds a single font dictionary regardless of page count.

## Forms

`readForm`, `fillForm`, and `flattenForm` provide AcroForm support: enumerate fields, fill values, and bake a form into permanent static content.

**Forms are not redaction.** Filling sets visible field values; flattening makes them permanent. Neither operation removes hidden content, metadata, or any other surface. Use `redactDocument`/`sanitizeDocument` for that.

### Supported field types

The four fillable types are **text**, **checkbox**, **radio**, and **choice** (list/combo). Pass a string for text/choice/radio fields; pass a boolean for checkboxes. `"pushButton"` and `"signature"` fields are enumerated by `readForm` but filling their values is a no-op in this version.

### `readForm(bytes)`

```ts
import { readForm } from "@magna-carta/pdf";

const fields = await readForm(new Uint8Array(inputBytes));
// fields — FormField[] sorted by page and field tree order
// Each field: { name, kind, value, options, readOnly, page, rect }
```

Returns a `FormField[]`. Each entry carries the fully-qualified field name, kind, current value (string, boolean, or `null`), option list for choice/radio fields, read-only flag, 0-based page index, and bounding-box rect.

### `fillForm(bytes, values, options?)`

```ts
import { fillForm } from "@magna-carta/pdf";

const result = await fillForm(
  new Uint8Array(inputBytes),
  {
    "topmostSubform[0].Page1[0].f1_01[0]": "Jane Smith",
    "topmostSubform[0].Page1[0].c1_1[0]": true, // checkbox
  },
  { flatten: false },
);
// result.pdf — Uint8Array of the PDF with field values written
```

`values` maps fully-qualified field names (as returned by `readForm`) to fill values. Extra keys that do not match any field are silently ignored. `options.flatten` (default `false`): when `true`, appearances are baked into content and the AcroForm is dropped (see `flattenForm` below).

### `flattenForm(bytes)`

```ts
import { flattenForm } from "@magna-carta/pdf";

const result = await flattenForm(new Uint8Array(inputBytes));
// result.pdf — Uint8Array of the flattened static PDF
```

Bakes each widget's current appearance into the page via a `Do` operator, merges page resources non-destructively, removes widget annotations, and drops the `/AcroForm` dictionary. The output renders identically in any PDF viewer, including those without form support. After flattening, `readForm` returns an empty array.

### V1 boundaries

- **Appearances use Helvetica (base-14).** Filled text and choice appearances are generated in Helvetica — no font embedding, no custom typeface, single-line only (no rich text or multiline).
- **Checkbox/radio render through their existing state appearances.** Filling a checkbox or radio sets the field value and the widget's selected state (`/V` and `/AS`); it does not generate an appearance. Rendering — and what `flattenForm` bakes — relies on the on/off state appearance streams the field already carries. A checkbox or radio widget that lacks those streams is filled at the value level but will not show a mark until a viewer synthesizes one. Text and choice fields do not have this caveat (their appearances are generated).
- **No XFA.** XFA-only documents are not supported; the call throws `"document has no interactive form"`.
- **No digital-signature creation.** Signature fields are enumerated by `readForm` but signing is deferred.
- **No `/MK` border styling.** Widget appearance dictionaries (`/MK`) are not applied to generated appearances.

### Types

```ts
type FieldKind = "text" | "checkbox" | "radio" | "choice" | "pushButton" | "signature" | "unknown";

interface FormField {
  name: string; // fully-qualified dot-joined field name
  kind: FieldKind;
  value: string | boolean | null; // current value, or null
  options: string[]; // /Opt entries (choice/radio)
  readOnly: boolean;
  page: number | null; // 0-based page index
  rect: [number, number, number, number] | null; // [llx, lly, urx, ury] display points
}

type FormFillValues = Record<string, string | boolean>;
interface FormFillOptions {
  flatten?: boolean;
}
interface FormFillResult {
  pdf: Uint8Array;
}
```

## Security

Inspect a PDF's protection, unlock a password-protected document, or re-protect one. These
run entirely in WebAssembly: **the password and document bytes never leave the caller's
process.** Unlocking needs a password you already have — it does not recover or guess
passwords.

### `inspectSecurity(bytes)`

Classify a document's security without a password:

```ts
const info = await inspectSecurity(bytes);
// { encrypted, handler, algorithm, hasUserPassword, permissions }
```

`handler` is `"standard" | "publicKey" | "none"`; a `"publicKey"` (certificate) document is
reported but cannot be opened. `algorithm` is `"rc4" | "aes128" | "aes256" | "unknown" |
"none"`. `permissions` is `null` (and `algorithm` is `"unknown"`) when the detail cannot be read —
which happens for a document that opens with an empty password (the underlying reader
consumes the encryption dictionary on load). `hasUserPassword` is `true` when an open
password is required to view.

### `decryptDocument(bytes, password)`

Unlock a protected PDF, returning `{ pdf: Uint8Array }` of plaintext. An unencrypted input
is returned unchanged. A wrong password throws `WrongPasswordError` (distinct from a parse
failure), so a caller can re-prompt; the password is never echoed in an error.

```ts
try {
  const { pdf } = await decryptDocument(bytes, password);
} catch (error) {
  if (error instanceof WrongPasswordError) {
    // ask the user for the password again
  }
}
```

### `secureDocument(bytes, options)`

Protect a PDF, returning `{ pdf: Uint8Array }`. Writes **AES-256 by default and never RC4**.

```ts
const { pdf } = await secureDocument(bytes, {
  ownerPassword: "…", // required — governs permission changes
  userPassword: "…", // optional open password; omit for "opens without a prompt"
  permissions: { copy: false }, // omitted bits default to allowed
  // encryptMetadata?: boolean     (default true)
  // algorithm?: "aes256" | "aes128"  (default aes256; aes128 for old readers, never RC4)
});
```

**Permissions are advisory.** PDF permission bits are honored only by cooperating viewers
and can be stripped by any tool that opens the document. The only real confidentiality
control is the open password plus the cipher — do not rely on the permission flags to keep
anyone out.

### Types

```ts
interface SecurityPermissions {
  print: boolean;
  printHighRes: boolean;
  copy: boolean;
  modify: boolean;
  annotate: boolean;
  fillForms: boolean;
  assemble: boolean;
  accessibilityCopy: boolean;
}
interface SecurityInfo {
  encrypted: boolean;
  handler: "standard" | "publicKey" | "none";
  algorithm: "rc4" | "aes128" | "aes256" | "unknown" | "none";
  hasUserPassword: boolean;
  permissions: SecurityPermissions | null; // null when not readable
}
interface SecureOptions {
  ownerPassword: string;
  userPassword?: string;
  permissions?: Partial<SecurityPermissions>;
  encryptMetadata?: boolean;
  algorithm?: "aes256" | "aes128";
}
class WrongPasswordError extends Error {
  readonly code: "wrong-password";
}
```

## Generate / assembly

Combine, split, rotate, and watermark documents. These are visible, reversible operations —
they reorganise pages or draw on top and **remove nothing** (use `redactDocument` /
`sanitizeDocument` to remove hidden content or metadata). All run client-side.

### `mergeDocuments(documents)`

Concatenate the pages of several PDFs into one, in order. Each input's **outlines, AcroForm
fields, and named destinations are carried across** — colliding top-level field and destination
names are suffixed (`name` → `name_2`). Returns `{ pdf: Uint8Array }`.

```ts
const { pdf } = await mergeDocuments([exhibitA, exhibitB, exhibitC]);
```

### `splitDocument(bytes, ranges)`

Return one independent document per inclusive, 0-based page range. Returns `{ pdfs: Uint8Array[] }`.

```ts
const { pdfs } = await splitDocument(doc, [
  { start: 0, end: 4 },
  { start: 5, end: 9 },
]);
```

### `rotatePages(bytes, rotation, pages?)`

Rotate pages clockwise by `90`, `180`, or `270` degrees, **relative** to each page's existing
rotation (so it composes rather than overwrites). Omit `pages` to rotate all; otherwise pass
0-based indices. Returns `{ pdf: Uint8Array }`.

### `watermarkDocument(bytes, options)`

Stamp an **additive** watermark on every page — diagonal text (`"CONFIDENTIAL"`, `"DRAFT"`) or an
image/logo — at a chosen opacity, rotation, and placement. Returns `{ pdf: Uint8Array }`.

```ts
await watermarkDocument(doc, {
  content: { kind: "text", text: "CONFIDENTIAL" }, // or { kind: "image", bytes: pngOrJpeg, scale: 0.3 }
  opacity: 0.3, // default 0.3
  rotationDeg: 45, // default 45 (diagonal)
  placement: "center", // or "tiled"
});
```

```ts
interface PageRange {
  start: number;
  end: number;
} // inclusive, 0-based
type WatermarkContent =
  | {
      kind: "text";
      text: string;
      font?: BatesFont;
      fontSizePt?: number;
      color?: [number, number, number];
    }
  | { kind: "image"; bytes: Uint8Array; scale?: number }; // PNG or JPEG
interface WatermarkOptions {
  content: WatermarkContent;
  opacity?: number;
  rotationDeg?: number;
  placement?: "center" | "tiled";
}
```

**Stated limits:** merge does not carry the inputs' document metadata or attachments, and when two
documents reuse the same named-destination _name_ for different targets, by-name links in the
second may resolve to the first's target (the destination table and explicit array destinations
are unaffected). Image watermarks support PNG and RGB/grayscale JPEG (a CMYK JPEG is decoded to
RGB); placement is centred or tiled.

## Decompression-bomb guard

Every operation in this package — load, redact, sanitize, detect, Bates stamping, forms,
security, and generate/assembly — rejects a malicious input before doing any real work:
oversize input (over 256 MiB) and any compressed stream that would inflate past the
engine's caps are both rejected up front, throwing a typed `DecompressionBombError`
rather than exhausting memory.

```ts
import { loadDocument, DecompressionBombError } from "@magna-carta/pdf";

try {
  const doc = await loadDocument(bytes);
} catch (error) {
  if (error instanceof DecompressionBombError) {
    // reject the document — do not retry with the same bytes
  }
}
```

The bound is **rigorous for deflate** (`FlateDecode`, the dominant high-ratio compression
filter in PDF), which the guard scans and caps before either underlying parser touches the
bytes. **LZW and RunLength compression, and image-codec expansion (e.g. JBIG2/CCITT
bilevel rasters), are not decoded by the guard** and fall back to the plain input-size cap
rather than the tighter per-stream bound — a disclosed residual for those rarer,
lower-ratio vectors. **Encrypted stream bodies fall back to the input cap too:** the guard
scans raw bytes before decryption, so it cannot see inside an encrypted stream, and a
password-protected document that decrypts to a compression bomb is only bounded by the
oversize-input check, not the tighter per-stream/cumulative caps.

## Build notes

The WASM binary at `src/pkg/pdf_core_bg.wasm` is produced by `wasm-pack build crates/pdf-core --target web --out-dir packages/pdf/src/pkg --release --no-opt`. It is not committed to version control; run `vp run rust-wasm-build` (or `pnpm --filter @magna-carta/pdf run build:wasm`) to regenerate it. In development the binary is rebuilt automatically as part of `vp run build-all`.
