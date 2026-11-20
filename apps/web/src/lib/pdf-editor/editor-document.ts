/*
 * What every PDF Editor tab does with the document before and after its own work: read the
 * document's bytes and open it for drawing, and keep what the engine made: on the matter for a
 * matter file, on the File Workbench for a bench file (`editor-subject.ts`).
 *
 * Kept in one place so each tab refuses a document for the same reasons in the same words, and so
 * a document the engine made is never lost because adding it to the matter failed: the caller is
 * handed the bytes to offer as a download instead.
 */
import { readDocumentBytes } from "$lib/documents/document-bytes.ts";
import {
  PDF_VIEWER_MAX_BYTES,
  PdfDocumentSource,
  pdfWorkerAvailable,
  type PdfPageSize,
} from "$lib/documents/pdf-pages.ts";
import { uploadIntoFolder } from "$lib/file-manager/file-upload.ts";
import { changedCopyName, putMadeOnBench, type EditorSubject } from "./editor-subject.ts";

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

const TOO_LARGE = "This document is too large for the editor. Download it to work on it elsewhere.";

/** The subject's bytes, or the sentence saying why they could not be had. */
async function readSubjectBytes(
  subject: EditorSubject,
): Promise<{ readonly bytes: ArrayBuffer } | { readonly refused: string }> {
  if (subject.kind === "matter") {
    const { file } = subject;
    const outcome = await readDocumentBytes(fetch, file.id, file.sizeBytes, PDF_VIEWER_MAX_BYTES);
    if (outcome.kind === "ok") return { bytes: outcome.bytes };
    return {
      refused: outcome.kind === "too-large" ? TOO_LARGE : "Couldn't read the document. Try again.",
    };
  }
  if (subject.sizeBytes > PDF_VIEWER_MAX_BYTES) return { refused: TOO_LARGE };
  try {
    // A copy, because the worker takes the buffer it is handed and the bench keeps its own.
    const bytes = await subject.readBytes();
    return { bytes: bytes.slice().buffer };
  } catch {
    return { refused: "This file is no longer on the bench." };
  }
}

/**
 * Read and open the subject's PDF for a tab. `lockedAdvice` is the tab's own sentence for a
 * document locked with a password, because what to do next differs by tool.
 */
export async function openEditorDocument(
  subject: EditorSubject,
  lockedAdvice: string,
): Promise<OpenedDocument> {
  if (!pdfWorkerAvailable()) {
    return {
      kind: "refused",
      message: "This browser can't run the editor's background worker.",
    };
  }
  const read = await readSubjectBytes(subject);
  if ("refused" in read) return { kind: "refused", message: read.refused };
  const original = read.bytes.slice(0);
  const source = new PdfDocumentSource();
  const reason = await source.open(read.bytes);
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
  /** Put on the File Workbench beside the bench file it was made from. Nothing reached a matter. */
  | { readonly kind: "benched"; readonly name: string }
  /** The engine made the document but the matter did not take it. Offer the bytes; nothing was saved. */
  | { readonly kind: "notFiled"; readonly name: string; readonly url: string };

/**
 * Keep a document the engine made: as a NEW FILE beside the original, or, given `asNextVersion`, as
 * the next version of the original, which keeps every earlier version in the file's history.
 *
 * A bench file has no versions, so there `asNextVersion` puts a changed copy on the bench instead,
 * named for the change (`benchChange`) so the two are told apart on the bench.
 */
export async function fileMadeDocument(
  subject: EditorSubject,
  bytes: Uint8Array,
  name: string,
  options: { readonly asNextVersion?: boolean; readonly benchChange?: string } = {},
): Promise<Filed> {
  if (subject.kind === "bench") {
    const benchName =
      options.asNextVersion !== true
        ? name
        : changedCopyName(name, options.benchChange ?? "Edited");
    return { kind: "benched", name: putMadeOnBench(subject, bytes, benchName) };
  }
  const { file } = subject;
  const made = new File([new Uint8Array(bytes)], name, { type: "application/pdf" });
  const saved = await uploadIntoFolder({
    fetchImpl: fetch,
    matterId: file.matterId,
    folderId: file.folderId,
    file: made,
    name,
    ...(options.asNextVersion === true ? { fileId: file.id } : {}),
  });
  if (saved.kind === "committed" || saved.kind === "settling") {
    return { kind: "filed", fileId: saved.fileId, name };
  }
  return { kind: "notFiled", name, url: URL.createObjectURL(made) };
}
