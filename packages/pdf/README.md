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

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `dpi` | `number` | `150` | Render resolution. Higher values produce sharper images at the cost of more memory. |
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
  widthPt: number;   // page width in PDF points (1 pt = 1/72 inch)
  heightPt: number;  // page height in PDF points
}

interface RenderedPage {
  data: Uint8Array;            // pixel data: flat RGBA bytes, or PNG bytes if encodePng was true
  width: number;               // pixel width of the rendered image
  height: number;              // pixel height of the rendered image
  encoding: "rgba8" | "png";   // matches the encodePng option
}

interface RenderOptions {
  dpi?: number;        // default 150
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
    page: 0,            // 0-based page index
    rect: { x0: 50, y0: 100, x1: 300, y1: 200 },  // display points, bottom-left origin (same units as the page size)
    reason: "privileged",  // optional — not written into the output PDF
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

**What redaction covers.** Each redacted page is replaced in its entirety with a raster image. All text, font data, form XObjects, and vector graphics on that page are removed; only unredacted pages retain their original PDF operators. Fine-grained surgery (removing only the glyphs whose positions fall within the region while preserving the rest of the page's text as selectable operators) is not yet available; every redacted page becomes a non-searchable image.

### `RedactionOptions`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `dpi` | `number` | `300` | Render resolution for rasterization. |
| `redactedText` | `string[]` | `[]` | Strings the gate checks for survival in the output. Pass the verbatim text you are redacting so the gate can verify it does not appear. |

Redaction always paints an opaque black box (the standard for legal production); the fill colour is not configurable.

### `RedactionResult`

```ts
interface RedactionResult {
  pdf: Uint8Array;          // the redacted PDF bytes
  pagesRedacted: number[];  // page indices (0-based) that were modified
}
```

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

| Field | Type | Default | Surface removed when `true` |
| --- | --- | --- | --- |
| `metadata` | `boolean` | `true` | Document metadata stream (`/Metadata`) and the information dictionary (`/Info`) — author, creation date, application name, and similar properties. |
| `xfa` | `boolean` | `true` | The XFA form definition (`/XFA` in `AcroForm`). Blank AcroForm fields are kept so the document remains a usable form; only the XFA-specific data is stripped. |
| `structureTree` | `boolean` | `true` | The document structure tree (`/StructTreeRoot`) used for accessibility tagging. |
| `outlines` | `boolean` | `true` | The bookmark outline tree (`/Outlines`). |
| `optionalContent` | `boolean` | `true` | Optional-content configuration (`/OCProperties` in the catalog). See the boundaries note below. |
| `attachments` | `boolean` | `true` | Embedded file attachments — the `/EmbeddedFiles` name tree and any `FileAttachment` annotations on pages. |
| `formFieldValues` | `boolean` | `true` | Form field values and appearance streams; blank field shells are kept. |

**Redaction is sanitized-by-default.** `redactDocument` accepts an optional `scrub` field in `RedactionOptions`. When `scrub` is omitted (the default) it is treated as `true`, so the output of a redaction is also sanitized. Pass `scrub: false` to skip sanitization on a redaction output.

### Verification gate

`sanitizeDocument` enforces a hard gate: after removing the surfaces, it verifies that every surface you asked to scrub is actually absent from the output. If a scrubbed surface survives — or the document cannot be reassembled — the call throws rather than returning an output. Surfaces you opt out of are not checked.

`sanitizeDocument` takes no `redactedText` list; its gate is structural. The byte-level decompress-and-scan for specific strings (see the boundaries below) belongs to `redactDocument`, where you pass the text being redacted via `redactedText`. To flatten a region *and* verify a particular string is gone document-wide, use `redactDocument` — it is sanitized-by-default, so it scrubs these same surfaces too.

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
  category: "CoveredText" | "InvisibleText" | "WhiteoutText" | "MetadataLeak" | "OrphanedText";
  severity: "Critical" | "High" | "Medium" | "Low" | "Info";
  page: number | null;      // 0-based page index; null for document-level findings
  region: Rect | null;      // display-point bounding box; null for document-level findings
  recoveredText: string;    // the text string recovered from the hidden location
  detail: string;           // human-readable explanation of the finding
}
```

### v1 categories and severities

| Category | Severity | What it means |
| --- | --- | --- |
| `CoveredText` | **Critical** | Extractable text sits under an opaque fill that hides it from view. The classic bad redaction: the words are present in the file and selectable; only the visual rendering conceals them. |
| `InvisibleText` | **High** | Text drawn in an invisible render mode (PDF text rendering mode 3, "invisible"). Recoverable by extraction even though it does not appear on screen. |
| `WhiteoutText` | **High** | Text painted the same color as the covering fill — for example, white text under a white box. Both the text and the fill are light-colored, creating a same-color concealment. |
| `MetadataLeak` | **Medium** | The document's information dictionary, XMP metadata stream, bookmark titles, or AcroForm field values carry text content. These surfaces survive even when page content is removed. |
| `OrphanedText` | **High** | Text present in a PDF object that no page references, but which remains in the file bytes. A copy-and-paste or search tool that reads the raw cross-reference table can recover it. |

**Why `InvisibleText` is High rather than Critical:** PDF invisible text (rendering mode 3) is overwhelmingly benign in practice — OCR workflows commonly place a transparent text layer over a scanned image to enable selection and search. The finding is flagged because invisible text on a document that should not have a text layer is suspicious, but it is not treated as the most severe category.

### Honest boundaries

Before acting on a detection report, understand these limits:

1. **Metadata and orphaned findings are document-level.** `page` and `region` are `null` for `MetadataLeak` and `OrphanedText` findings — they describe content anywhere in the file, not a specific visible location.

2. **Custom-font glyph codes without a ToUnicode map may yield empty `recoveredText`.** When a font uses custom glyph codes and the PDF carries no `ToUnicode` mapping, the text extractor cannot decode the characters. The finding is still raised (a covered glyph is still a covered glyph), but `recoveredText` may be an empty string.

3. **Text rasterized into an image is not recovered.** If the page content was previously converted to a pixel image — the correct output of `redactDocument` — the detector finds no text on that page. That is the intended result of proper redaction.

4. **Hidden optional-content-layer detection and removable-annotation attribution are not yet covered.** A PDF page may use optional content groups (layers) to hide content, or carry annotation-level content that a viewer hides but the file retains. These two patterns are not detected in the current version.

### `DetectionReport`

```ts
interface DetectionReport {
  findings: DetectionFinding[];   // ranked Critical → Info; empty means nothing detected
  pagesScanned: number;           // pages the geometric detectors successfully examined
  glyphsExamined: number;         // total glyphs considered
  pagesUnreadable: number[];      // page indices the renderer could not interpret
}
```

## Build notes

The WASM binary at `src/pkg/pdf_core_bg.wasm` is produced by `wasm-pack build crates/pdf-core --target web --out-dir packages/pdf/src/pkg --release --no-opt`. It is not committed to version control; run `vp run rust-wasm-build` (or `pnpm --filter @magna-carta/pdf run build:wasm`) to regenerate it. In development the binary is rebuilt automatically as part of `vp run build-all`.
