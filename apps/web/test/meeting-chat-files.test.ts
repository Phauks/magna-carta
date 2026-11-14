/*
 * A file uploaded from a meeting's chat is filed onto the matter in one folder, "Meeting files", at
 * the matter's root: found by name, made the first time, and found again when somebody else in the
 * room made it a moment before.
 */
import { describe, expect, it } from "vitest";
import {
  MEETING_FILES_FOLDER,
  meetingFilesFolder,
  uploadMeetingFile,
  type MeetingFileSeams,
} from "../src/lib/meetings/chat-files.ts";
import type { FolderSummary } from "../src/lib/file-manager/folder-api.ts";
import type { UploadOutcome } from "../src/lib/file-manager/file-upload.ts";

const MATTER = "matter_chatFiles";
const REFUSED = {
  kind: "problem" as const,
  problem: { type: "conflict", title: "Conflict", status: 409 },
  failure: {
    problem: { type: "conflict", title: "Conflict", status: 409 },
    request: "POST /api/v1/folders",
    failedAt: new Date(),
  },
};

function seams(
  lists: FolderSummary[][],
  options: { createRefused?: boolean; upload?: UploadOutcome } = {},
): MeetingFileSeams & { created: string[]; uploadedInto: (string | null)[] } {
  const created: string[] = [];
  const uploadedInto: (string | null)[] = [];
  let read = 0;
  return {
    created,
    uploadedInto,
    listFolders: () => {
      const data = lists[Math.min(read, lists.length - 1)] ?? [];
      read += 1;
      return Promise.resolve({ kind: "ok", value: { data } });
    },
    createFolder: (input) => {
      created.push(input.name);
      return Promise.resolve(
        options.createRefused === true ? REFUSED : { kind: "ok", value: { folderId: "folder_made" } },
      );
    },
    upload: (request) => {
      uploadedInto.push(request.folderId);
      return Promise.resolve(
        options.upload ?? { kind: "committed", fileId: "file_new", versionId: "fileVersion_new" },
      );
    },
  };
}

const ROOT_FOLDER: FolderSummary = {
  id: "folder_meeting",
  parentFolderId: null,
  name: MEETING_FILES_FOLDER,
};

describe("the Meeting files folder", () => {
  it("is used where the matter already has it at its root", async () => {
    const edges = seams([[{ ...ROOT_FOLDER, id: "folder_nested", parentFolderId: "folder_x" }, ROOT_FOLDER]]);
    expect(await meetingFilesFolder(edges, MATTER)).toEqual({ kind: "ok", value: "folder_meeting" });
    expect(edges.created).toEqual([]);
  });

  it("is made the first time", async () => {
    const edges = seams([[]]);
    expect(await meetingFilesFolder(edges, MATTER)).toEqual({ kind: "ok", value: "folder_made" });
    expect(edges.created).toEqual([MEETING_FILES_FOLDER]);
  });

  it("is found again when the make loses to somebody else's", async () => {
    const edges = seams([[], [ROOT_FOLDER]], { createRefused: true });
    expect(await meetingFilesFolder(edges, MATTER)).toEqual({ kind: "ok", value: "folder_meeting" });
  });
});

describe("uploading a file from a meeting", () => {
  const FILE = new File(["x"], "Notes.pdf", { type: "application/pdf" });

  it("files it in Meeting files and answers its handle", async () => {
    const edges = seams([[ROOT_FOLDER]]);
    expect(await uploadMeetingFile(edges, MATTER, FILE)).toEqual({ kind: "filed", fileId: "file_new" });
    expect(edges.uploadedInto).toEqual(["folder_meeting"]);
  });

  it("does not share a file the check refused", async () => {
    const edges = seams([[ROOT_FOLDER]], {
      upload: { kind: "flagged", fileId: "file_new", reason: "malware" },
    });
    expect(await uploadMeetingFile(edges, MATTER, FILE)).toMatchObject({ kind: "refused", failure: null });
  });

  it("uploads nothing where the folder cannot be reached", async () => {
    const edges = seams([[], []], { createRefused: true });
    expect(await uploadMeetingFile(edges, MATTER, FILE)).toMatchObject({ kind: "refused" });
    expect(edges.uploadedInto).toEqual([]);
  });
});
