/*
 * What every PDF Editor tab does with the document before and after its own work: read the
 * document's bytes and open it for drawing, and file what the engine made back on the matter.
 *
 * Kept in one place so each tab refuses a document for the same reasons in the same words, and so
 * a document the engine made is never lost because filing it failed: the caller is handed the
 * bytes to offer as a download instead.
 */
import { readDocumentBytes } from "$lib/documents/document-bytes.ts";
import {
  PDF_VIEWER_MAX_BYTES,
  PdfDocumentSource,
  pdfWorkerAvailable,
  type PdfPageSize,
} from "$lib/documents/pdf-pages.ts";
import { uploadIntoFolder } from "$lib/file-manager/file-upload.ts";
import type { MatterFile } from "$lib/file-manager/matter-file-api.ts";

export type OpenedDocument =
  | {
      readonly kind: "ready";
      /** Draws the pages. The caller closes it when the tab goes. */
      readonly source: PdfDocumentSource;
      /** The bytes as read. A tab hands the engine a copy of these and never changes them. */
      readonly original: ArrayBuffer;
      readonly pages: readonly PdfPageSize[];
    }
  | { readonly kind: "refused"; readonly message: string };

/**
 * Read and open a matter's PDF for a tab. `lockedAdvice` is the tab's own sentence for a document
 * locked with a password, because what to do next differs by tool.
 */
export async function openEditorDocument(
  file: MatterFile,
  lockedAdvice: string,
): Promise<OpenedDocument> {
  if (!pdfWorkerAvailable()) {
    return {
      kind: "refused",
      message: "This browser can't run the editor's background worker.",
    };
  }
  const outcome = await readDocumentBytes(fetch, file.id, file.sizeBytes, PDF_VIEWER_MAX_BYTES);
  if (outcome.kind !== "ok") {
    return {
      kind: "refused",
      message:
        outcome.kind === "too-large"
          ? "This document is too large for the editor. Download it to work on it elsewhere."
          : "Couldn't read the document. Try again.",
    };
  }
  const original = outcome.bytes.slice(0);
  const source = new PdfDocumentSource();
  const reason = await source.open(outcome.bytes);
  if (reason !== null) {
    source.close();
    return {
      kind: "refused",
      message:
        reason === "encrypted" || reason === "wrong-password"
          ? lockedAdvice
          : "Couldn't open this document in the editor.",
    };
  }
  return { kind: "ready", source, original, pages: source.pages };
}

export type Filed =
  | { readonly kind: "filed"; readonly fileId: string; readonly name: string }
  /** The engine made the document but the matter did not take it. Offer the bytes; nothing was saved. */
  | { readonly kind: "notFiled"; readonly name: string; readonly url: string };

/**
 * File a document the engine made: as a NEW FILE beside the original, or, given `asVersionOf`, as
 * the next version of the original, which keeps every earlier version in the file's history.
 */
export async function fileMadeDocument(
  file: MatterFile,
  bytes: Uint8Array,
  name: string,
  options: { readonly asVersionOf?: string } = {},
): Promise<Filed> {
  const made = new File([new Uint8Array(bytes)], name, { type: "application/pdf" });
  const saved = await uploadIntoFolder({
    fetchImpl: fetch,
    matterId: file.matterId,
    folderId: file.folderId,
    file: made,
    name,
    ...(options.asVersionOf === undefined ? {} : { fileId: options.asVersionOf }),
  });
  if (saved.kind === "committed" || saved.kind === "settling") {
    return { kind: "filed", fileId: saved.fileId, name };
  }
  return { kind: "notFiled", name, url: URL.createObjectURL(made) };
}
