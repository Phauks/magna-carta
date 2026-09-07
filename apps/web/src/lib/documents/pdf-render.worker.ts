/*
 * The rasterizing worker: holds one open PDF and draws the page it is asked for.
 *
 * It is the only place in the application that loads the document engine, which is what keeps the
 * engine's several megabytes off every other screen — nothing fetches it until a reader opens a
 * document. It is also the only place a PDF's bytes are ever parsed, and what leaves here is a
 * bitmap, never anything that could be executed (pdf-pages.ts says why that matters).
 *
 * One document at a time, because that is what a viewer shows. Opening a second frees the first.
 */
import { loadDocument, DecompressionBombError, type PdfDocument } from "@magna-carta/pdf";
import type { PdfFailureReason, PdfWorkerReply, PdfWorkerRequest } from "./pdf-pages.ts";

// The worker's global is typed as a window by the app's DOM library; the two members used here are
// the ones both scopes share, and a reply is posted without a target origin.
const scope = self as unknown as {
  postMessage(message: PdfWorkerReply, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<PdfWorkerRequest>) => void) | null;
};

let open: PdfDocument | null = null;

function closeOpenDocument(): void {
  open?.free();
  open = null;
}

/** The engine's own guard has its own outcome; everything else it throws is an unreadable file. */
function reasonFor(error: unknown): PdfFailureReason {
  return error instanceof DecompressionBombError ? "decompression-bomb" : "unreadable";
}

async function openDocument(id: number, bytes: ArrayBuffer): Promise<void> {
  closeOpenDocument();
  try {
    open = await loadDocument(new Uint8Array(bytes));
    const pages = Array.from({ length: open.pageCount }, (_unused, index) =>
      (open as PdfDocument).pageSize(index),
    );
    scope.postMessage({ kind: "opened", id, pages });
  } catch (error) {
    closeOpenDocument();
    scope.postMessage({ kind: "failed", id, reason: reasonFor(error) });
  }
}

function renderPage(id: number, page: number, dpi: number): void {
  const document = open;
  if (document === null || page < 0 || page >= document.pageCount) {
    scope.postMessage({ kind: "failed", id, reason: "render-failed" });
    return;
  }
  try {
    const rendered = document.renderPage(page, { dpi, encodePng: false });
    // The pixels leave by transfer rather than copy: a page at reading size is tens of megabytes,
    // and structured-cloning that on every page turn is the one cost this seam exists to avoid.
    // `data` is a view over the engine's own buffer, so it is copied into a buffer of its own
    // exactly once, here, and that buffer is what moves.
    const owned = new Uint8Array(rendered.data);
    scope.postMessage(
      {
        kind: "rendered",
        id,
        page,
        width: rendered.width,
        height: rendered.height,
        data: owned,
      },
      [owned.buffer],
    );
  } catch (error) {
    const reason = error instanceof DecompressionBombError ? "decompression-bomb" : "render-failed";
    scope.postMessage({ kind: "failed", id, reason });
  }
}

scope.onmessage = (event) => {
  const request = event.data;
  if (request.kind === "close") {
    closeOpenDocument();
    return;
  }
  if (request.kind === "open") {
    void openDocument(request.id, request.bytes);
    return;
  }
  renderPage(request.id, request.page, request.dpi);
};
