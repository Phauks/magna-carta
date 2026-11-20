/*
 * Reading another PDF whose pages the Pages tab inserts: one of the matter's own files, or a file
 * from the reader's computer. Both arrive the same way, as bytes kept for the engine and a drawing
 * source for the grid, and are refused for the same reasons in the same words.
 */
import { readDocumentBytes } from "$lib/documents/document-bytes.ts";
import type { DocumentSummary } from "$lib/documents/document-api.ts";
import { viewerKindOf } from "$lib/documents/editable-documents.ts";
import {
  PDF_VIEWER_MAX_BYTES,
  PdfDocumentSource,
  type PdfPageSize,
} from "$lib/documents/pdf-pages.ts";

/** Where the inserted file comes from. */
export type InsertedFileChoice =
  | { readonly kind: "matter"; readonly fileId: string }
  | { readonly kind: "computer"; readonly file: File };

export type OpenedInsertion =
  | {
      readonly kind: "ready";
      /** Draws the inserted pages in the grid. The tab closes it when the pages go. */
      readonly source: PdfDocumentSource;
      /** The bytes as read. The engine is handed a copy of these at every save. */
      readonly bytes: ArrayBuffer;
      readonly pages: readonly PdfPageSize[];
    }
  | { readonly kind: "refused"; readonly message: string };

/** Whether a matter file can have its pages inserted: a PDF the scan has cleared. */
export function insertableDocument(document: DocumentSummary): boolean {
  return document.status === "clean" && viewerKindOf(document) === "pdf";
}

/** Whether a file from the computer looks like a PDF before a byte of it is read. */
export function looksLikePdf(file: Pick<File, "name" | "type">): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

async function readChoice(
  choice: InsertedFileChoice,
): Promise<{ kind: "ok"; bytes: ArrayBuffer } | { kind: "refused"; message: string }> {
  if (choice.kind === "computer") {
    if (!looksLikePdf(choice.file)) return { kind: "refused", message: "Choose a PDF." };
    if (choice.file.size > PDF_VIEWER_MAX_BYTES) {
      return { kind: "refused", message: "This file is too large for the editor." };
    }
    try {
      return { kind: "ok", bytes: await choice.file.arrayBuffer() };
    } catch {
      return { kind: "refused", message: "Couldn't read the file. Try again." };
    }
  }
  const outcome = await readDocumentBytes(fetch, choice.fileId, null, PDF_VIEWER_MAX_BYTES);
  if (outcome.kind === "ok") return { kind: "ok", bytes: outcome.bytes };
  return {
    kind: "refused",
    message:
      outcome.kind === "too-large"
        ? "This file is too large for the editor."
        : "Couldn't read the file. Try again.",
  };
}

/** Read the chosen file and open it for drawing, or say why its pages cannot go in. */
export async function openInsertedFile(choice: InsertedFileChoice): Promise<OpenedInsertion> {
  const read = await readChoice(choice);
  if (read.kind === "refused") return read;
  const bytes = read.bytes.slice(0);
  const source = new PdfDocumentSource();
  const reason = await source.open(read.bytes);
  if (reason !== null) {
    source.close();
    return {
      kind: "refused",
      message:
        reason === "encrypted" || reason === "wrong-password"
          ? "This file has a password. Unlock it in the File Workbench first, then insert the unlocked copy."
          : "Couldn't open this file as a PDF.",
    };
  }
  if (source.pages.length === 0) {
    source.close();
    return { kind: "refused", message: "This file has no pages." };
  }
  return { kind: "ready", source, bytes, pages: source.pages };
}
