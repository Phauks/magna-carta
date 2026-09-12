import { civilDateOf } from "@magna-carta/civil-time/civil-date";
import { describe, expect, it } from "vitest";
import type { FolderSummary } from "$lib/file-manager/folder-api.ts";
import type { MatterFile } from "$lib/file-manager/matter-file-api.ts";
import {
  attachableFoldersFor,
  isPendingAttachment,
  noteAttachmentsOf,
  pendingAttachmentIdentifier,
  pendingAttachmentsOf,
} from "$lib/matters/note-attachable-documents.ts";
import { noteSheet, occurrenceLine } from "$lib/matters/note-print-sheet.ts";
import type { MatterNote, NoteDocument } from "$lib/matters/notes-api.ts";

// The translation between what the API holds and what the record window's attachments tab renders,
// and the note's printed sheet. Both are pure, and both carry rules worth pinning: an attachment's
// own identity is not its document's, a pending choice must be tellable from a written one, and a
// printed note must state BOTH of the times it carries.

function file(over: Partial<MatterFile> & { id: string; name: string }): MatterFile {
  return {
    matterId: "matter_aaaaaaaaaaaaaaaaaaaaa",
    folderId: null,
    documentTypeId: null,
    currentVersionId: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    versionNumber: 1,
    sizeBytes: null,
    sniffedContentType: null,
    scanVerdict: null,
    status: "clean",
    quarantineReason: null,
    sourceModifiedAt: null,
    uploadedBy: null,
    uploadedByName: null,
    ...over,
  };
}

const folders: FolderSummary[] = [
  { id: "folder_pleadings", parentFolderId: null, name: "Pleadings" },
  { id: "folder_exhibits", parentFolderId: "folder_pleadings", name: "Exhibits" },
];

describe("what the picker may offer", () => {
  it("groups the matter's files under the folder path the File Manager spells", () => {
    const offered = attachableFoldersFor(
      [
        file({ id: "file_1", name: "Complaint.pdf", folderId: "folder_pleadings" }),
        file({ id: "file_2", name: "Exhibit A.pdf", folderId: "folder_exhibits" }),
        file({ id: "file_3", name: "Retainer.pdf", folderId: null }),
      ],
      folders,
    );

    expect(offered.map((group) => group.name)).toEqual([
      "Home",
      "Pleadings",
      "Pleadings / Exhibits",
    ]);
    expect(offered[1]?.documents.map((document) => document.identifier)).toEqual(["file_1"]);
  });

  it("leaves out a folder that holds no files, so no heading stands over nothing", () => {
    const offered = attachableFoldersFor(
      [file({ id: "file_1", name: "Complaint.pdf", folderId: "folder_pleadings" })],
      folders,
    );
    expect(offered.map((group) => group.name)).toEqual(["Pleadings"]);
  });

  it("names documents in reading order within a folder, ignoring case", () => {
    const offered = attachableFoldersFor(
      [file({ id: "file_1", name: "zebra.pdf" }), file({ id: "file_2", name: "Apple.pdf" })],
      [],
    );
    expect(offered[0]?.documents.map((document) => document.name)).toEqual([
      "Apple.pdf",
      "zebra.pdf",
    ]);
  });

  it("carries the media type only where the server knows one", () => {
    const offered = attachableFoldersFor(
      [
        file({ id: "file_1", name: "Known.pdf", sniffedContentType: "application/pdf" }),
        file({ id: "file_2", name: "Unknown.bin" }),
      ],
      [],
    );
    const [known, unknown] = offered[0]?.documents ?? [];
    expect(known?.contentType).toBe("application/pdf");
    expect(unknown).not.toHaveProperty("contentType");
  });
});

describe("what the note already carries", () => {
  const document: NoteDocument = {
    id: "matterNoteDocument_1",
    fileId: "file_1",
    fileName: "Complaint.pdf",
    contentType: "application/pdf",
    linkedAt: "2026-08-30T10:00:00.000Z",
    linkedBy: "user_1",
  };

  it("keeps the association's identity apart from the document's", () => {
    const [attachment] = noteAttachmentsOf([document], () => "Ada Wren");
    // Detaching names the association; the picker asks about the document. Collapsing the two would
    // make "already attached" unanswerable for a document attached to two records.
    expect(attachment?.identifier).toBe("matterNoteDocument_1");
    expect(attachment?.documentIdentifier).toBe("file_1");
    expect(attachment?.attachedBy).toBe("Ada Wren");
  });

  it("states nothing about when or by whom for a choice that has not been written", () => {
    const [pending] = pendingAttachmentsOf(
      ["file_1"],
      [file({ id: "file_1", name: "Complaint.pdf" })],
    );
    expect(pending?.identifier).toBe(pendingAttachmentIdentifier("file_1"));
    expect(pending).not.toHaveProperty("attachedAt");
    expect(pending).not.toHaveProperty("attachedBy");
  });

  it("drops a pending choice whose file the matter no longer offers", () => {
    expect(pendingAttachmentsOf(["file_gone"], [])).toEqual([]);
  });

  it("tells a pending choice from a written association", () => {
    const [pending] = pendingAttachmentsOf(
      ["file_1"],
      [file({ id: "file_1", name: "Complaint.pdf" })],
    );
    const [written] = noteAttachmentsOf([document], () => "Ada Wren");
    expect(pending === undefined ? false : isPendingAttachment(pending)).toBe(true);
    expect(written === undefined ? true : isPendingAttachment(written)).toBe(false);
  });
});

const note: MatterNote = {
  id: "matterNote_1",
  matterId: "matter_aaaaaaaaaaaaaaaaaaaaa",
  authorUserId: "user_1",
  body: "Called the client about the hearing date.",
  lastEditedBy: null,
  occurredOn: "2026-08-30",
  occurredAtTime: null,
  timeZone: null,
  documents: [],
  createdAt: "2026-09-01T09:00:00.000Z",
  updatedAt: "2026-09-01T09:00:00.000Z",
};

describe("when the thing happened, as one line", () => {
  const date = (isoDate: string) => `[${isoDate}]`;

  it("is nothing at all where the note names no moment", () => {
    expect(occurrenceLine({ ...note, occurredOn: null }, date)).toBeNull();
  });

  it("is the date alone where the note names only a day", () => {
    expect(occurrenceLine(note, date)).toBe("[2026-08-30]");
  });

  it("carries the zone with a wall-clock time, because the two are one fact", () => {
    expect(
      occurrenceLine({ ...note, occurredAtTime: "14:30", timeZone: "America/Chicago" }, date),
    ).toBe("[2026-08-30], 14:30 (America/Chicago)");
  });
});

describe("one note on paper", () => {
  const context = {
    matterTitle: "Wren v. Halloway",
    authorName: "Ada Wren",
    lastEditedByName: null,
    instant: (at: string) => `<${at}>`,
    date: (isoDate: string) => `[${isoDate}]`,
    instantDate: (instant: string) => civilDateOf(instant),
    attachedNames: [],
    printedAt: "<printed>",
  };

  it("states both times the note carries, so nobody has to guess which one it means", () => {
    const sheet = noteSheet(note, context);
    const standing = sheet.sections[0];
    expect(standing?.kind).toBe("fields");
    const labels =
      standing?.kind === "fields" ? standing.fields.map((entry) => entry.label) : undefined;
    expect(labels).toEqual(["Date", "Written By", "Written"]);
  });

  it("says outright that a note names no moment rather than leaving the line blank", () => {
    const sheet = noteSheet({ ...note, occurredOn: null }, context);
    const standing = sheet.sections[0];
    const stated = standing?.kind === "fields" ? standing.fields[0]?.value : undefined;
    expect(stated).toContain("Not recorded");
  });

  it("names who last changed the words, and only where anybody has", () => {
    const unedited = noteSheet(note, context).sections[0];
    const edited = noteSheet(
      { ...note, lastEditedBy: "user_2" },
      {
        ...context,
        lastEditedByName: "Bo Ferris",
      },
    ).sections[0];
    const labelsOf = (section: typeof unedited) =>
      section?.kind === "fields" ? section.fields.map((entry) => entry.label) : [];
    expect(labelsOf(unedited)).not.toContain("Last Edited By");
    expect(labelsOf(edited)).toContain("Last Edited By");
  });

  it("says None rather than nothing when the note points at no document", () => {
    const documents = noteSheet(note, context).sections[2];
    expect(documents?.kind === "fields" ? documents.fields[0]?.value : undefined).toBe("None");
  });

  it("names every attached document, because a note's file list is part of the record", () => {
    const documents = noteSheet(note, {
      ...context,
      attachedNames: ["Complaint.pdf", "Exhibit A.pdf"],
    }).sections[2];
    expect(
      documents?.kind === "fields" ? documents.fields.map((entry) => entry.value) : [],
    ).toEqual(["Complaint.pdf", "Exhibit A.pdf"]);
  });
});
