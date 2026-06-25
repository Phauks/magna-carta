import init, { PdfDocument as WasmDocument } from "./pkg/pdf_core.js";

// Optional wasm bytes for environments (Node/Vitest) where fetch is unavailable.
// Pass the result of `readFileSync(wasmPath)` — the loader handles both Buffer and Uint8Array.
let ready: Promise<unknown> | undefined;

export async function ensureReady(wasmInput?: BufferSource | WebAssembly.Module): Promise<void> {
  if (ready === undefined) {
    ready = wasmInput !== undefined
      ? init({ module_or_path: wasmInput })
      : init();
  }
  await ready;
}

export interface PageSize {
  widthPt: number;
  heightPt: number;
}

export interface RenderedPage {
  data: Uint8Array;
  width: number;
  height: number;
  encoding: "rgba8" | "png";
}

export interface RenderOptions {
  dpi?: number;
  encodePng?: boolean;
}

/** A parsed PDF document. Call `free()` (or use `using`) to release wasm memory. */
export class PdfDocument {
  private constructor(private readonly handle: WasmDocument) {}

  static async load(bytes: Uint8Array, wasmInput?: BufferSource | WebAssembly.Module): Promise<PdfDocument> {
    await ensureReady(wasmInput);
    return new PdfDocument(WasmDocument.load(bytes));
  }

  get pageCount(): number {
    return this.handle.pageCount;
  }

  pageSize(index: number): PageSize {
    const s = this.handle.pageSize(index);
    try {
      return { widthPt: s.widthPt, heightPt: s.heightPt };
    } finally {
      s.free();
    }
  }

  renderPage(index: number, opts: RenderOptions = {}): RenderedPage {
    const png = opts.encodePng ?? false;
    const r = this.handle.renderPage(index, opts.dpi ?? 150, png);
    try {
      return { data: r.data, width: r.width, height: r.height, encoding: png ? "png" : "rgba8" };
    } finally {
      r.free();
    }
  }

  free(): void {
    this.handle.free();
  }

  [Symbol.dispose](): void {
    this.free();
  }
}

export async function loadDocument(bytes: Uint8Array, wasmInput?: BufferSource | WebAssembly.Module): Promise<PdfDocument> {
  return PdfDocument.load(bytes, wasmInput);
}

export interface RedactionRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface RedactionRegion {
  page: number;
  rect: RedactionRect;
  reason?: string;
}

export interface RedactionOptions {
  /** Raster resolution for flattened pages. Defaults to 300 (the legal-production standard). */
  dpi?: number;
  /** If supplied, redaction also verifies these strings are absent from the output. */
  redactedText?: string[];
  /** Document-level surfaces to scrub. Omitted means all surfaces are scrubbed (redaction is sanitized-by-default); pass individual `false` flags to retain a surface. */
  scrub?: ScrubOptions;
  /**
   * Redaction route. Default `"flatten"`.
   *
   * - `"flatten"` — rasterises every affected page to a pixel image. Original text, fonts,
   *   and vector graphics do not survive. All redacted pages become non-searchable images.
   * - `"surgery"` — excises only the glyphs whose centres fall within the redaction rectangle
   *   from the page content stream, leaving the rest of the page as selectable PDF text.
   *   Surgery is attempted per page and falls back to `"flatten"` for any page it cannot
   *   confirm clear. The result is never less safe than `"flatten"`: a page is only reported
   *   as surgered when the outcome gate finds no glyph centre remaining inside any redaction
   *   rectangle on that page.
   */
  mode?: "flatten" | "surgery";
}

export interface RedactionResult {
  pdf: Uint8Array;
  /** All page indices (0-based) where content was redacted, regardless of route. */
  pagesRedacted: number[];
  /** Page indices (0-based) where text-preserving surgery succeeded. Present in both modes; empty when `mode` is `"flatten"`. */
  pagesSurgered: number[];
  /** Page indices (0-based) where the page was rasterised to an image. Includes all flatten-mode pages and any surgery-mode page that fell back. */
  pagesFlattened: number[];
}

import { redactDocument as wasmRedact } from "./pkg/pdf_core.js";

/**
 * Redact regions from a PDF by flattening each affected page to an image with
 * opaque boxes, then verifying no redacted text survives. Throws if the
 * verification gate fails (no unsafe PDF is ever returned).
 */
export async function redactDocument(
  bytes: Uint8Array,
  regions: RedactionRegion[],
  opts: RedactionOptions = {},
): Promise<RedactionResult> {
  await ensureReady();
  return wasmRedact(bytes, regions, opts) as RedactionResult;
}

export interface ScrubOptions {
  /** Info dictionary + XMP metadata. Default true. */
  metadata?: boolean;
  /** Embedded files, file-attachment annotations, portfolio. Default true. */
  attachments?: boolean;
  /** AcroForm XFA dataset. Default true. */
  xfa?: boolean;
  /** Clear form field values (keeps a blank form). Default true. */
  formFieldValues?: boolean;
  /** Tagged-PDF structure tree (ActualText/Alt). Default true. */
  structureTree?: boolean;
  /** Bookmarks and named destinations. Default true. */
  outlines?: boolean;
  /** Optional-content (layer) configuration. Default true. */
  optionalContent?: boolean;
}

export interface SanitizeResult {
  pdf: Uint8Array;
}

import { sanitizeDocument as wasmSanitize } from "./pkg/pdf_core.js";

/**
 * Remove document-level surfaces where sensitive content can hide (metadata,
 * attachments, form values, structure tree, bookmarks, optional-content). Every
 * surface is removed by default; pass `false` for a surface to retain it. Throws
 * if verification finds a scrubbed surface surviving (no document is returned).
 */
export async function sanitizeDocument(
  bytes: Uint8Array,
  opts: ScrubOptions = {},
): Promise<SanitizeResult> {
  await ensureReady();
  return wasmSanitize(bytes, opts) as SanitizeResult;
}

export interface DetectionFinding {
  category:
    | "coveredText"
    | "invisibleText"
    | "whiteoutText"
    | "removableAnnotation"
    | "hiddenLayer"
    | "metadataLeak"
    | "orphanedText";
  severity: "critical" | "high" | "medium" | "low" | "info";
  page: number | null;
  region: { x0: number; y0: number; x1: number; y1: number } | null;
  recoveredText: string;
  detail: string;
}

export interface DetectionReport {
  findings: DetectionFinding[];
  summary: { critical: number; high: number; medium: number; low: number; info: number };
  pagesScanned: number;
  glyphsExamined: number;
  pagesUnreadable: number[];
}

import { stampBates as wasmStampBates } from "./pkg/pdf_core.js";
import { detectDocument as wasmDetect } from "./pkg/pdf_core.js";

/** One of the six corners or edges where a Bates label can be placed. */
export type BatesPosition =
  | "bottomRight"
  | "bottomLeft"
  | "bottomCenter"
  | "topRight"
  | "topLeft"
  | "topCenter";

/** Options for `stampBates`. All fields are optional; defaults match `BatesOptions::default()` in the engine. */
export interface BatesStampOptions {
  /** Text prepended before the zero-padded number, e.g. `"SMITH-"`. Default `""`. */
  prefix?: string;
  /** Number assigned to the first page. Default `1`. */
  startNumber?: number;
  /** Minimum digit width; shorter numbers are zero-padded to this width. Default `6`. */
  padding?: number;
  /** Corner or edge where the label is drawn. Default `"bottomRight"`. */
  position?: BatesPosition;
  /** Distance in points from the nearest page edge. Default `18`. */
  marginPt?: number;
  /** Font size in points. Default `8`. */
  fontSizePt?: number;
}

/**
 * The result of `stampBates`. `start` and `end` are the inclusive Bates numbers
 * assigned to the first and last pages of the document.
 */
export interface BatesStampResult {
  /** The stamped PDF bytes. */
  pdf: Uint8Array;
  /** Bates number on the first page (inclusive). */
  start: number;
  /** Bates number on the last page (inclusive). */
  end: number;
  /** Number of pages stamped. */
  pageCount: number;
}

/**
 * Stamp sequential Bates labels onto every page of a PDF.
 *
 * **Additive overlay — not redaction.** This function adds selectable Helvetica
 * text to each page. It does not remove, flatten, rasterise, or modify any
 * existing page content. Use `redactDocument` to permanently remove content.
 *
 * The label on each page is `prefix` followed by the page's Bates number
 * zero-padded to `padding` digits. The first page receives `startNumber`; each
 * subsequent page increments by one.
 */
export async function stampBates(
  bytes: Uint8Array,
  options: BatesStampOptions = {},
): Promise<BatesStampResult> {
  await ensureReady();
  return wasmStampBates(bytes, options) as BatesStampResult;
}

/**
 * Scan a PDF for failed redactions — recoverable text that is covered, invisible,
 * whitened-out, in metadata, or orphaned. Returns findings ranked by severity.
 * Read-only: the input is never modified. An empty `findings` list means nothing
 * was detected, not a guarantee that the document is safe.
 */
export async function detectDocument(bytes: Uint8Array): Promise<DetectionReport> {
  await ensureReady();
  return wasmDetect(bytes) as DetectionReport;
}
