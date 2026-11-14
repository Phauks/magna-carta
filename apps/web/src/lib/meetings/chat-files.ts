/*
 * A file shared in a meeting's chat, on the way to the record.
 *
 * A LINE IN CHAT POINTS AT ONE OF THE MATTER'S FILES, AND NEVER HOLDS ONE. The chat row carries the
 * file's handle; the bytes live where every other document on the matter lives, under the same
 * scan, the same download route and the same permissions. So a file somebody uploads from the room
 * is filed onto the matter first, by the file manager's own upload, and only then said in chat.
 *
 * UPLOADS LAND IN ONE FOLDER, "Meeting files", AT THE MATTER'S ROOT. Found by name, made the first
 * time it is needed, and found again by name if two people in the room make it at once (the create
 * that loses is answered by the list that follows it). A meeting with no matter has nowhere to
 * file anything, so the room does not offer this there, and the server refuses the line if asked.
 *
 * Every edge is a seam, so the folder rule is a unit test rather than a rehearsal.
 */
import type { Failure } from "$lib/api/problem.ts";
import type { ApiOutcome } from "$lib/api/request.ts";
import {
  createFolder,
  listMatterFolders,
  writeKey,
  type FolderSummary,
} from "$lib/file-manager/folder-api.ts";
import {
  uploadIntoFolder,
  type UploadOutcome,
  type UploadRequest,
} from "$lib/file-manager/file-upload.ts";

/** Where a file uploaded from a meeting is filed on the matter. */
export const MEETING_FILES_FOLDER = "Meeting files";

/** The edges this module reaches the outside world through. */
export interface MeetingFileSeams {
  listFolders: (matterId: string) => Promise<ApiOutcome<{ data: FolderSummary[] }>>;
  createFolder: (
    input: { matterId: string; parentFolderId: null; name: string },
    idempotencyKey: string,
  ) => Promise<ApiOutcome<{ folderId: string }>>;
  upload: (request: Omit<UploadRequest, "fetchImpl">) => Promise<UploadOutcome>;
}

/** The seams as the app supplies them. */
export function meetingFileSeams(fetchImpl: typeof fetch = fetch): MeetingFileSeams {
  return {
    listFolders: (matterId) => listMatterFolders(fetchImpl, matterId),
    createFolder: (input, key) => createFolder(fetchImpl, input, key),
    upload: (request) => uploadIntoFolder({ ...request, fetchImpl }),
  };
}

/** What sharing a new file came to: the file on the matter, or why it is not there. */
export type MeetingFileUpload =
  | { kind: "filed"; fileId: string }
  /** Nothing reached the record. `failure` is null where the reason is not a server's answer. */
  | { kind: "refused"; failure: Failure | null; reason: string };

function folderNamed(folders: readonly FolderSummary[]): FolderSummary | undefined {
  return folders.find(
    (folder) => folder.parentFolderId === null && folder.name === MEETING_FILES_FOLDER,
  );
}

/**
 * The "Meeting files" folder at the matter's root, made where there is none.
 *
 * A create that is refused is answered by reading the list again: the likeliest reason is that
 * somebody else in the room made it a moment before, and then it is there to use.
 */
export async function meetingFilesFolder(
  seams: MeetingFileSeams,
  matterId: string,
): Promise<ApiOutcome<string>> {
  const listed = await seams.listFolders(matterId);
  if (listed.kind !== "ok") return listed;
  const found = folderNamed(listed.value.data);
  if (found !== undefined) return { kind: "ok", value: found.id };

  const made = await seams.createFolder(
    { matterId, parentFolderId: null, name: MEETING_FILES_FOLDER },
    writeKey(),
  );
  if (made.kind === "ok") return { kind: "ok", value: made.value.folderId };

  const again = await seams.listFolders(matterId);
  const raced = again.kind === "ok" ? folderNamed(again.value.data) : undefined;
  return raced === undefined ? made : { kind: "ok", value: raced.id };
}

/**
 * File a new document onto the matter, in "Meeting files", ready to be said in chat.
 *
 * A file the scan refused is on the matter with no content, so it is not shared: a line pointing at
 * something nobody can open is a line that says the wrong thing. One still being checked is shared,
 * because the download route already holds it back until the check clears.
 */
export async function uploadMeetingFile(
  seams: MeetingFileSeams,
  matterId: string,
  file: File,
): Promise<MeetingFileUpload> {
  const folder = await meetingFilesFolder(seams, matterId);
  if (folder.kind !== "ok") {
    return {
      kind: "refused",
      failure: folder.failure,
      reason: `The "${MEETING_FILES_FOLDER}" folder could not be reached, so the file was not uploaded.`,
    };
  }
  const outcome = await seams.upload({ matterId, folderId: folder.value, file });
  switch (outcome.kind) {
    case "committed":
    case "settling":
      return { kind: "filed", fileId: outcome.fileId };
    case "flagged":
      return {
        kind: "refused",
        failure: null,
        reason:
          "The file was uploaded to the matter but did not pass the check, so it was not shared.",
      };
    case "cancelled":
      return { kind: "refused", failure: null, reason: "The upload was cancelled." };
    case "problem":
      return {
        kind: "refused",
        failure: { problem: outcome.problem, request: "Upload a file", failedAt: new Date() },
        reason: "The file was not uploaded.",
      };
    case "transport":
      return {
        kind: "refused",
        failure: { problem: null, request: "Upload a file", failedAt: new Date() },
        reason: "The file was not uploaded.",
      };
  }
}
