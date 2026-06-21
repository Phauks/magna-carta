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
    const size = this.handle.pageSize(index);
    return { widthPt: size.widthPt, heightPt: size.heightPt };
  }

  renderPage(index: number, opts: RenderOptions = {}): RenderedPage {
    const encodePng = opts.encodePng ?? false;
    const rendered = this.handle.renderPage(index, opts.dpi ?? 150, encodePng);
    return {
      data: rendered.data,
      width: rendered.width,
      height: rendered.height,
      encoding: encodePng ? "png" : "rgba8",
    };
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
