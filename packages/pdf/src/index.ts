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
}

export interface RedactionResult {
  pdf: Uint8Array;
  pagesRedacted: number[];
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

import { detectDocument as wasmDetect } from "./pkg/pdf_core.js";

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
