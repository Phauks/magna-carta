/*
 * What the note's Attachments tab is handed: the documents this note already points at, and the
 * matter's own files offered as the ones it could point at next.
 *
 * The shapes are the design system's, not the API's, and the translation lives here rather than in
 * the window so it can be tested without a browser. Two facts have to survive it. An attachment
 * carries the ASSOCIATION's identity as well as the document's — ending one association must not
 * reach the document, and the picker needs the document's identity to leave out what the note
 * already carries. And a document is offered under the folder somebody filed it in, spelled the way
 * the File Manager spells that path, because that is how the person who filed it remembers where it
 * went.
 *
 * A note being written has no identity yet, so its attachments are PENDING: chosen, held, and
 * written the moment the note itself is. Both kinds render identically here — the reader is looking
 * at the files this note will carry either way — and the identity is what tells them apart when the
 * time comes to write them.
 */
import type {
  AttachableDocumentFolder,
  RecordAttachment,
} from "@magna-carta/design-system/record-attachments";
import { MatterFileIndex } from "$lib/file-manager/file-rows.ts";
import type { FolderSummary } from "$lib/file-manager/folder-api.ts";
import type { MatterFile } from "$lib/file-manager/matter-file-api.ts";
import type { NoteDocument } from "./notes-api.ts";

/**
 * The identity a PENDING attachment carries — one chosen for a note that does not exist yet.
 *
 * It is the document's own identity behind a prefix, which makes it stable across a re-render (the
 * list's render key) and impossible to mistake for an association the server issued: the write path
 * asks which of these are pending, and a prefix answers that without a second field to keep in step.
 */
export const PENDING_ATTACHMENT_PREFIX = "pending:";

export function pendingAttachmentIdentifier(fileId: string): string {
  return PENDING_ATTACHMENT_PREFIX + fileId;
}

/** Whether this attachment is one the server has not been told about yet. */
export function isPendingAttachment(attachment: RecordAttachment): boolean {
  return attachment.identifier.startsWith(PENDING_ATTACHMENT_PREFIX);
}

/**
 * The render key for the group holding files filed at the matter root, which has no folder row and
 * therefore no identity of its own. Folder identities are prefixed identifiers, so this cannot
 * collide with one.
 */
export const MATTER_ROOT_FOLDER_KEY = "matter-root";

/**
 * The matter's files as the picker offers them, grouped by the folder they are filed in.
 *
 * A folder holding no files is left out entirely: the picker's job is to offer documents, and a
 * heading over nothing reads as a defect. Files at the matter root are grouped under the same word
 * the File Manager uses for that place, so a reader is not asked to learn a second name for it.
 */
export function attachableFoldersFor(
  files: readonly MatterFile[],
  folders: readonly FolderSummary[],
): AttachableDocumentFolder[] {
  const index = new MatterFileIndex(folders, files);
  const grouped = new Map<string | null, MatterFile[]>();
  for (const file of files) {
    const held = grouped.get(file.folderId) ?? [];
    held.push(file);
    grouped.set(file.folderId, held);
  }
  return [...grouped.entries()]
    .map(([folderId, held]) => ({
      identifier: folderId ?? MATTER_ROOT_FOLDER_KEY,
      name: index.pathText(folderId),
      documents: held
        .map((file) => ({
          identifier: file.id,
          name: file.name,
          ...(file.sniffedContentType === null ? {} : { contentType: file.sniffedContentType }),
        }))
        .toSorted((left, right) =>
          left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
        ),
    }))
    .toSorted((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
    );
}

/**
 * The documents a saved note points at, as the tab renders them.
 *
 * `nameOf` resolves the member who attached it, because the record carries an account identifier
 * and a person is owed a name. It is passed in rather than read here: the roster is the surface's,
 * and a pure function that reached for it would need a browser to test.
 */
export function noteAttachmentsOf(
  documents: readonly NoteDocument[],
  nameOf: (userId: string | null) => string,
): RecordAttachment[] {
  return documents.map((document) => ({
    identifier: document.id,
    documentIdentifier: document.fileId,
    name: document.fileName,
    ...(document.contentType === null ? {} : { contentType: document.contentType }),
    attachedAt: document.linkedAt,
    attachedBy: nameOf(document.linkedBy),
  }));
}

/**
 * The documents a note being WRITTEN will point at, as the tab renders them.
 *
 * Nothing has been attached yet, so nothing is stated about when or by whom: a pending row that
 * claimed an instant would be claiming something that has not happened.
 */
export function pendingAttachmentsOf(
  fileIds: readonly string[],
  files: readonly MatterFile[],
): RecordAttachment[] {
  const byIdentifier = new Map(files.map((file) => [file.id, file]));
  return fileIds.flatMap((fileId) => {
    const file = byIdentifier.get(fileId);
    if (file === undefined) return [];
    return [
      {
        identifier: pendingAttachmentIdentifier(fileId),
        documentIdentifier: fileId,
        name: file.name,
        ...(file.sniffedContentType === null ? {} : { contentType: file.sniffedContentType }),
      },
    ];
  });
}
