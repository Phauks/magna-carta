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
