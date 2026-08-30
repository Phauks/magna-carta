/*
 * What the picker is allowed to offer.
 *
 * A document this record already carries is not offered again: offering it invites a second
 * association with the same document, which reads to a person as a duplicate file and to the record
 * as two rows that end separately. Filtering it out is cheaper than explaining it afterwards, and it
 * is why an attachment carries the document's identity as well as its own.
 *
 * Pure functions in a plain module rather than logic inside the component, so the rule can be tested
 * on its own and so a caller that needs the same answer elsewhere (a count of what is left to offer,
 * say) gets it from here rather than writing it a second time.
 */
import type { AttachableDocument, AttachableDocumentFolder, RecordAttachment } from "./types.ts";

/**
 * The folders as the picker should show them: every document already on the record removed, and any
 * folder left holding nothing removed with them.
 *
 * An emptied folder is dropped rather than shown empty because a heading over nothing reads as a
 * loading state or a defect. Folder and document order is the caller's throughout — the matter's
 * files decide what order documents are in, not this.
 */
export function unattachedDocumentFolders(
  folders: readonly AttachableDocumentFolder[],
  attachments: readonly RecordAttachment[],
): AttachableDocumentFolder[] {
  const alreadyAttached = new Set(attachments.map((attachment) => attachment.documentIdentifier));
  const remaining: AttachableDocumentFolder[] = [];
  for (const folder of folders) {
    const documents = folder.documents.filter(
      (document) => !alreadyAttached.has(document.identifier),
    );
    if (documents.length > 0) remaining.push({ ...folder, documents });
  }
  return remaining;
}

/**
 * How many documents are left to offer across every folder.
 *
 * The picker needs this to tell two states apart that look alike from inside a search box: nothing
 * matches what you typed, and there is nothing left to match because the record already carries all
 * of it. Those want different sentences.
 */
export function attachableDocumentCount(folders: readonly AttachableDocumentFolder[]): number {
  return folders.reduce((total, folder) => total + folder.documents.length, 0);
}

/**
 * The search vocabulary for one document: its own name and the folder it sits in.
 *
 * A person looking for a document types what it is called, or where they put it, and both should
 * find it. The row's own value is the document's identity, which nobody types, so without this the
 * search would match nothing a reader would think to try.
 */
export function attachableDocumentKeywords(
  document: AttachableDocument,
  folder: AttachableDocumentFolder,
): string[] {
  return [document.name, folder.name];
}
