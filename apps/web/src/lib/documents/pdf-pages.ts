/*
 * Reading a PDF in the browser: the contract between the page and the worker that rasterizes it,
 * and the client the viewer talks to.
 *
 * WHY THE PAGES ARE DRAWN HERE RATHER THAN HANDED TO THE BROWSER. A PDF is an active format: it can
 * carry script, and a browser's own PDF viewer will run it. The platform's standing rule is that an
 * active format is never handed raw to the browser, and that what a reader sees is a derived safe
 * view rather than the live file. This module is that derived safe view, produced locally: the
 * bytes are parsed by the firm's own memory-safe engine compiled to WebAssembly, which emits
 * PIXELS and nothing else. No PDF ever reaches a parser that could execute what is inside it, and
 * nothing about the document survives the render but a bitmap.
 *
 * WHY IT RUNS OFF THE MAIN THREAD. Rasterizing a page is real work, and a scanned page at reading
 * size is tens of megabytes of pixels. On the thread that draws the application that is a freeze,
 * so it runs in a Web Worker, the same seam the upload hash uses. The engine is loaded there and
 * only there, which also keeps its several megabytes out of the application's own bundle: nothing
 * is fetched until a reader opens a document.
 *
 * The engine guards its own inputs: a document that inflates past its caps is refused as a
 * decompression bomb rather than parsed, and that refusal arrives here as an ordinary outcome.
 */

/**
 * The most a document may weigh to be opened in the viewer. The whole file is fetched before the
 * first page can be drawn, because a PDF's cross-reference table is at its end. A document past
 * this stays downloadable; it is not a limit on what the firm may store.
 */
export const PDF_VIEWER_MAX_BYTES = 50 * 1024 * 1024;

/**
 * The resolution a page is rasterized at, per unit of the reader's zoom. A PDF point is a 72nd of
 * an inch, so 96 draws a page at about its physical size on an ordinary display.
 */
export const PDF_BASE_DPI = 96;

/**
 * The ceiling on that resolution. A page's pixel buffer grows with the square of the resolution,
 * so this is what stops a reader zooming a large page into a buffer no tab can hold.
 */
export const PDF_MAX_DPI = 300;

/** A page's size in PDF points, which is what the viewer lays a page out from before it is drawn. */
export interface PdfPageSize {
  readonly widthPt: number;
  readonly heightPt: number;
}

/** Why a document could not be opened or a page could not be drawn. */
export type PdfFailureReason =
  /** The bytes are not a PDF this engine can parse. */
  | "unreadable"
  /** The engine refused the document as a decompression bomb. */
  | "decompression-bomb"
  /** The page could not be rasterized, though the document opened. */
  | "render-failed"
  /** The document needs a password. Ask for one and open again with `unlock`. */
  | "encrypted"
  /** A password was tried and did not open the document. Ask again. */
  | "wrong-password";

/** What the page asks the worker to do. */
export type PdfWorkerRequest =
  | { readonly kind: "open"; readonly id: number; readonly bytes: ArrayBuffer }
  /**
   * Try the bytes from the most recent `open` again, decrypted with this password. Reaches for the
   * copy the worker kept when that `open` came back "encrypted" or "wrong-password" — carries no
   * bytes of its own, so a password never rides the same message as a document a second time.
   */
  | { readonly kind: "unlock"; readonly id: number; readonly password: string }
  | { readonly kind: "render"; readonly id: number; readonly page: number; readonly dpi: number }
  | { readonly kind: "close" };

/** What the worker answers, under the id it was asked with. */
export type PdfWorkerReply =
  | {
      readonly kind: "opened";
      readonly id: number;
      readonly pages: readonly PdfPageSize[];
    }
  | {
      readonly kind: "rendered";
      readonly id: number;
      readonly page: number;
      readonly width: number;
      readonly height: number;
      /** Straight rgba8, four bytes a pixel, ready for ImageData with no copy. */
      readonly data: Uint8Array;
    }
  | { readonly kind: "failed"; readonly id: number; readonly reason: PdfFailureReason };

/** One rasterized page, as the viewer draws it. */
export interface PdfRenderedPage {
  readonly page: number;
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

/**
 * The resolution to rasterize at for a zoom factor, held inside the engine's ceiling. Pure, so the
 * ceiling is testable without a worker.
 */
export function renderDpiFor(zoom: number, devicePixelRatio = 1): number {
  const wanted = PDF_BASE_DPI * zoom * devicePixelRatio;
  return Math.max(1, Math.min(PDF_MAX_DPI, Math.round(wanted)));
}

/**
 * How wide and tall a page is on screen, in CSS pixels, at a zoom factor. The device's own pixel
 * ratio does not enter here: it raises the RESOLUTION the page is drawn at, never the space it
 * takes on screen.
 */
export function pageDisplaySize(
  size: PdfPageSize,
  zoom: number,
): { readonly width: number; readonly height: number } {
  const scale = (PDF_BASE_DPI * zoom) / 72;
  return {
    width: Math.max(1, Math.round(size.widthPt * scale)),
    height: Math.max(1, Math.round(size.heightPt * scale)),
  };
}

/** Whether this environment can run the viewer at all. A test in Node cannot. */
export function pdfWorkerAvailable(): boolean {
  return typeof Worker === "function" && typeof window !== "undefined";
}

/** A document open in the worker: its page sizes, and the way to draw any one of them. */
export class PdfDocumentSource {
  private worker: Worker | null = null;
  private nextId = 1;
  private readonly waiting = new Map<
    number,
    { resolve: (reply: PdfWorkerReply) => void; reject: (error: Error) => void }
  >();

  /** The pages' sizes, in document order. Empty until `open` resolves. */
  pages: readonly PdfPageSize[] = [];

  /**
   * Hand the document's bytes to the worker and read back its page sizes. The buffer is
   * TRANSFERRED, so it is emptied here rather than copied: the caller must not read it afterwards.
   */
  async open(bytes: ArrayBuffer): Promise<PdfFailureReason | null> {
    const reply = await this.ask({ kind: "open", id: this.nextId, bytes }, [bytes]);
    if (reply.kind === "failed") return reply.reason;
    if (reply.kind !== "opened") return "unreadable";
    this.pages = reply.pages;
    return null;
  }

  /**
   * Retry the last `open` with a password, after it came back "encrypted" or "wrong-password". The
   * worker still holds those bytes; nothing is re-fetched or re-sent here.
   */
  async unlock(password: string): Promise<PdfFailureReason | null> {
    const reply = await this.ask({ kind: "unlock", id: this.nextId, password });
    if (reply.kind === "failed") return reply.reason;
    if (reply.kind !== "opened") return "unreadable";
    this.pages = reply.pages;
    return null;
  }

  /** Rasterize one page at a resolution. The pixels come back transferred, never copied. */
  async render(
    page: number,
    dpi: number,
  ): Promise<{ page: PdfRenderedPage } | { failure: PdfFailureReason }> {
    const reply = await this.ask({ kind: "render", id: this.nextId, page, dpi });
    if (reply.kind === "failed") return { failure: reply.reason };
    if (reply.kind !== "rendered") return { failure: "render-failed" };
    return {
      page: { page: reply.page, width: reply.width, height: reply.height, data: reply.data },
    };
  }

  /** Give the worker and the document's memory back. Safe to call twice. */
  close(): void {
    if (this.worker === null) return;
    this.worker.postMessage({ kind: "close" } satisfies PdfWorkerRequest);
    this.worker.terminate();
    this.worker = null;
    for (const pending of this.waiting.values()) {
      pending.reject(new Error("The document was closed."));
    }
    this.waiting.clear();
  }

  private ensureWorker(): Worker {
    if (this.worker !== null) return this.worker;
    const made = new Worker(new URL("./pdf-render.worker.ts", import.meta.url), { type: "module" });
    made.onmessage = (event: MessageEvent<PdfWorkerReply>) => {
      const pending = this.waiting.get(event.data.id);
      if (pending === undefined) return;
      this.waiting.delete(event.data.id);
      pending.resolve(event.data);
    };
    // A worker that dies takes the open document with it. Every waiting question is answered
    // rather than left hanging, and the viewer states the failure instead of showing a page that
    // never arrives.
    made.onerror = () => {
      for (const pending of this.waiting.values()) {
        pending.resolve({ kind: "failed", id: 0, reason: "render-failed" });
      }
      this.waiting.clear();
    };
    this.worker = made;
    return made;
  }

  private ask(request: PdfWorkerRequest, transfer: Transferable[] = []): Promise<PdfWorkerReply> {
    const worker = this.ensureWorker();
    const id = this.nextId;
    this.nextId += 1;
    return new Promise<PdfWorkerReply>((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      worker.postMessage({ ...request, id }, transfer);
    });
  }
}
