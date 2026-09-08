/*
 * The rasterizing worker: holds one open PDF and draws the page it is asked for.
 *
 * It is the only place in the application that loads the document engine, which is what keeps the
 * engine's several megabytes off every other screen — nothing fetches it until a reader opens a
 * document. It is also the only place a PDF's bytes are ever parsed, and what leaves here is a
 * bitmap, never anything that could be executed (pdf-pages.ts says why that matters).
 *
 * One document at a time, because that is what a viewer shows. Opening a second frees the first.
 *
 * A PASSWORD NEVER LEAVES THIS WORKER EITHER. Checking whether a document is encrypted and trying
 * a password to open it both run through @magna-carta/pdf's own security functions — the SAME
 * WebAssembly module already loaded here to draw pages, so there is no server round trip and no
 * upload: the bytes this worker already holds are read again, in place, and only a bitmap or a
 * refusal ever crosses back out.
 */
import {
  DecompressionBombError,
  decryptDocument,
  inspectSecurity,
  loadDocument,
  WrongPasswordError,
  type PdfDocument,
} from "@magna-carta/pdf";
import type { PdfFailureReason, PdfWorkerReply, PdfWorkerRequest } from "./pdf-pages.ts";

// The worker's global is typed as a window by the app's DOM library; the two members used here are
// the ones both scopes share, and a reply is posted without a target origin.
const scope = self as unknown as {
  postMessage(message: PdfWorkerReply, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<PdfWorkerRequest>) => void) | null;
};

let open: PdfDocument | null = null;

/**
 * The bytes of the document currently asking for a password. Held only between an `open` that came
 * back "encrypted" (or a failed "unlock") and whatever ends that attempt — a document that opened,
 * one abandoned by a `close`, or one abandoned by opening another. Never kept once a document is
 * open for real, and never touched by anything outside this worker.
 */
let awaitingPassword: Uint8Array | null = null;

function closeOpenDocument(): void {
  open?.free();
  open = null;
  awaitingPassword = null;
}

/**
 * Whether this document is one a password could plausibly open. `publicKey` handlers are
 * certificate-based — no password unlocks them, and offering the wall for one would be a promise
 * this engine cannot keep.
 */
async function classifyUnreadable(raw: Uint8Array): Promise<PdfFailureReason> {
  try {
    const info = await inspectSecurity(raw);
    if (info.encrypted && info.handler === "standard") return "encrypted";
  } catch {
    // inspectSecurity failed too (a decompression bomb already handled above, or bytes that are
    // not a PDF at all) — the caller's own catch already knows this is "unreadable".
  }
  return "unreadable";
}

async function openDocument(id: number, bytes: ArrayBuffer): Promise<void> {
  closeOpenDocument();
  const raw = new Uint8Array(bytes);
  try {
    open = await loadDocument(raw);
    const pages = Array.from({ length: open.pageCount }, (_unused, index) =>
      (open as PdfDocument).pageSize(index),
    );
    scope.postMessage({ kind: "opened", id, pages });
  } catch (error) {
    closeOpenDocument();
    if (error instanceof DecompressionBombError) {
      scope.postMessage({ kind: "failed", id, reason: "decompression-bomb" });
      return;
    }
    const reason = await classifyUnreadable(raw);
    if (reason === "encrypted") awaitingPassword = raw;
    scope.postMessage({ kind: "failed", id, reason });
  }
}

async function unlockDocument(id: number, password: string): Promise<void> {
  const raw = awaitingPassword;
  if (raw === null) {
    // Nothing is waiting on a password — the reader's page and this worker have lost track of one
    // another (a stale retry after a `close`, most plausibly). Unreadable is the honest answer:
    // there is no document here to unlock.
    scope.postMessage({ kind: "failed", id, reason: "unreadable" });
    return;
  }
  try {
    const { pdf } = await decryptDocument(raw, password);
    open = await loadDocument(pdf);
    awaitingPassword = null;
    const pages = Array.from({ length: open.pageCount }, (_unused, index) =>
      (open as PdfDocument).pageSize(index),
    );
    scope.postMessage({ kind: "opened", id, pages });
  } catch (error) {
    if (error instanceof WrongPasswordError) {
      // The document is still exactly as encrypted as it was; awaitingPassword stays so the reader
      // can try again without the page re-fetching the file.
      scope.postMessage({ kind: "failed", id, reason: "wrong-password" });
      return;
    }
    awaitingPassword = null;
    const reason = error instanceof DecompressionBombError ? "decompression-bomb" : "unreadable";
    scope.postMessage({ kind: "failed", id, reason });
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
  if (request.kind === "unlock") {
    void unlockDocument(request.id, request.password);
    return;
  }
  renderPage(request.id, request.page, request.dpi);
};
