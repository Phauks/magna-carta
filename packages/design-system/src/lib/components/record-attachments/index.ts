/*
 * RecordAttachments — the files riding a record, exported as a single component rather than the
 * house namespace shape. Like the window it sits in, it deliberately has no parts to compose: a
 * record hands over what is attached and the verbs that change it, and every record type in the
 * product then shows its files the same way.
 *
 * The pure rules travel with it, because both have callers outside the markup: which tab a record
 * opens on is decided by whatever builds the window's tab list, and what the picker may offer is
 * worth testing on its own.
 */
export { default } from "./record-attachments.svelte";
export { default as RecordAttachments } from "./record-attachments.svelte";
export type { AttachableDocument, AttachableDocumentFolder, RecordAttachment } from "./types.ts";
export {
  attachableDocumentCount,
  attachableDocumentKeywords,
  unattachedDocumentFolders,
} from "./attachable-documents.ts";
export { ATTACHMENTS_TAB_KEY, openingTabForAttachments } from "./attachments-tab.ts";
