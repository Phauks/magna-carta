/*
 * Uploading INTO A FOLDER — the file manager's own half of the upload ceremony.
 *
 * The steps are the contract's and are shared with the document loop's client
 * ($lib/documents/create-document.ts): reserve a pending version and get a signed URL, PUT the
 * bytes straight to object storage, tell the host they are there, then wait for the gate. What is
 * different, and what this module exists for, is the RESERVATION: a file manager always uploads
 * somewhere in particular, and the loop's reservation names no folder at all.
 *
 * That was a real defect, not a missing feature. `POST /api/v1/uploads` accepts `folderId` and
 * `documentTypeId`; the loop's `InitiateUploadInput` carries neither, so every upload made from
 * this screen was filed at the matter root no matter which folder the reader was standing in — and
 * the list, which shows one folder at a time, then had nothing to show. From the reader's side that
 * is indistinguishable from an upload that did not work.
 *
 * Nothing here blocks a file. A suspected finding or a type mismatch never refuses the write: the
 * file is stored and committed, and the reader deals with it afterwards. Refusing to save is the
 * greater hazard.
 *
 * A RESERVATION WHOSE BYTES NEVER LANDED IS GIVEN BACK. The reservation mints the file row and a
 * pending version before a byte moves, so a PUT that fails leaves a file on the matter with nothing
 * behind it — the list showed it as a file with no size, and nothing on screen said it was the
 * husk of a failed upload. Every failure after the reservation now aborts the session, which
 * abandons the version and drops the row from every read; the abort is best-effort, because the
 * failure being reported is the one the reader needs to hear about, and the stale-pending sweep
 * catches whatever an abort could not reach.
 */
import {
  abortUpload,
  completeUpload,
  putUploadBytes,
  readUploadStatus,
  type ApiOutcome,
  type Problem,
} from "$lib/documents/document-api.ts";
import { requestJson } from "$lib/api/request.ts";

export type UploadStage = "reserving" | "uploading" | "committing" | "scanning" | "settled";

export type UploadOutcome =
  /** The bytes cleared the gate: the file is on the matter, in the folder that was asked for. */
  | { kind: "committed"; fileId: string; versionId: string | null }
  /** The gate refused the bytes. The file is on the matter and says so; it has no content. */
  | { kind: "flagged"; fileId: string; reason: string | null }
  /** Everything the caller controls succeeded; the verdict had not landed before the wait ran out. */
  | { kind: "settling"; fileId: string }
  | { kind: "problem"; problem: Problem; stage: UploadStage }
  | { kind: "transport"; stage: UploadStage };

/** The reservation, as the host answers it. Only the single-shot PUT leg is run here. */
interface ReservedUpload {
  mode: "put" | "multipart";
  uploadId: string;
  fileId: string;
  versionId: string;
  key: string;
  url?: string;
  headers?: Record<string, string>;
}

// The gate runs on a queue: fast for a small file, not instant. Twenty attempts a second and a half
// apart is a thirty-second ceiling — long enough for a scan under local emulation, short enough that
// nobody is left staring. Running out is NOT a failure; it is its own outcome.
const POLL_ATTEMPTS = 20;
const POLL_INTERVAL_MILLISECONDS = 1_500;

export interface UploadRequest {
  readonly fetchImpl: typeof fetch;
  readonly matterId: string;
  /** Where the file is filed. `null` is the matter root, which is a destination like any other. */
  readonly folderId: string | null;
  readonly file: File;
  /** The name to file it under, after the collision rules have had their say. */
  readonly name?: string;
  /** The firm's classification label, when the reader chose one at upload time. */
  readonly documentTypeId?: string | null;
  /** Present = a new version of a file already on the matter; absent = a new file. */
  readonly fileId?: string;
  /**
   * How a new file is dated: at the upload (the default), or at the source file's own last-modified
   * instant. The source's instant is sent either way, as a fact about where the bytes came from.
   */
  readonly createdAtBasis?: "upload" | "source";
  readonly onStage?: (stage: UploadStage) => void;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly newIdempotencyKey?: () => string;
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Reserve the version. This is the one call the loop's client cannot make for us, because its input
 * type has no folder on it. The body is the contract's own InitiateUploadRequest.
 */
function reserveUpload(
  fetchImpl: typeof fetch,
  body: Record<string, unknown>,
  idempotencyKey: string,
): Promise<ApiOutcome<ReservedUpload>> {
  return requestJson(fetchImpl, "/api/v1/uploads", { method: "POST", body, idempotencyKey });
}

function at(outcome: ApiOutcome<unknown>, stage: UploadStage): UploadOutcome {
  if (outcome.kind === "problem") return { kind: "problem", problem: outcome.problem, stage };
  return { kind: "transport", stage };
}

export async function uploadIntoFolder(request: UploadRequest): Promise<UploadOutcome> {
  const {
    fetchImpl,
    matterId,
    folderId,
    file,
    name = file.name,
    documentTypeId,
    fileId,
    createdAtBasis,
    onStage,
    sleep = defaultSleep,
    newIdempotencyKey = () => crypto.randomUUID(),
  } = request;

  onStage?.("reserving");
  const reserved = await reserveUpload(
    fetchImpl,
    {
      matterId,
      // The folder is the whole point of this module. `null` is a real answer (the matter root), so
      // it is sent rather than omitted — omitting it would let a later default decide silently.
      folderId,
      name,
      declaredSize: file.size,
      // An empty type is what a browser reports for a file it does not recognise. The host sniffs
      // the bytes itself, so an honest "unknown" is safer than a type guessed from the extension.
      declaredContentType: file.type === "" ? null : file.type,
      ...(documentTypeId == null ? {} : { documentTypeId }),
      ...(fileId === undefined ? {} : { fileId }),
      // The device's own date for the file, always; and how the record should date a new file.
      sourceModifiedAt: sourceInstantOf(file),
      ...(createdAtBasis === undefined ? {} : { createdAtBasis }),
    },
    newIdempotencyKey(),
  );
  if (reserved.kind !== "ok") return at(reserved, "reserving");

  const reservation = reserved.value;
  if (reservation.mode !== "put" || reservation.url === undefined) {
    // A file over the firm's mode threshold reserves a resumable multipart session instead. That
    // ceremony signs and tracks every part, which this surface does not run — so it says so plainly
    // rather than half-running it. The reservation it was handed is given back first: the session
    // already minted a pending version, and "the matter is unchanged" has to be made true, not said.
    await abortUpload(fetchImpl, reservation.uploadId);
    return {
      kind: "problem",
      stage: "reserving",
      problem: {
        status: 413,
        detail:
          "This file is large enough to need the resumable upload, which this screen does not run " +
          "yet. Nothing was written; the matter is unchanged.",
      },
    };
  }

  onStage?.("uploading");
  // The signed headers carry the object's dimensions and are passed through untouched: bytes
  // written without them land somewhere nothing can place.
  const put = await putUploadBytes(fetchImpl, reservation.url, reservation.headers ?? {}, file);
  if (put.kind !== "ok") {
    await abortUpload(fetchImpl, reservation.uploadId);
    return at(put, "uploading");
  }

  onStage?.("committing");
  const completed = await completeUpload(fetchImpl, reservation.uploadId, newIdempotencyKey());
  if (completed.kind !== "ok") {
    await abortUpload(fetchImpl, reservation.uploadId);
    return at(completed, "committing");
  }

  onStage?.("scanning");
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    const status = await readUploadStatus(fetchImpl, reservation.uploadId);
    if (status.kind !== "ok") return at(status, "scanning");
    if (status.value.versionStatus === "clean") {
      onStage?.("settled");
      return { kind: "committed", fileId: reservation.fileId, versionId: reservation.versionId };
    }
    if (status.value.versionStatus === "quarantined") {
      onStage?.("settled");
      // Flagged, not refused: the row is on the matter and the reader decides what to do about it.
      return {
        kind: "flagged",
        fileId: reservation.fileId,
        reason: status.value.quarantineReason,
      };
    }
    if (status.value.versionStatus === "abandoned") {
      // The host discarded this version deliberately — commonly bytes identical to the file's
      // current version, which is one logical version rather than two. The file is intact.
      onStage?.("settled");
      return { kind: "committed", fileId: reservation.fileId, versionId: null };
    }
    await sleep(POLL_INTERVAL_MILLISECONDS);
  }
  onStage?.("settled");
  return { kind: "settling", fileId: reservation.fileId };
}

/**
 * The instant the reader's device last modified the file, as an ISO-8601 instant, or null when the
 * browser reported none. A zero is what some engines report for a file with no date, and it would
 * read as 1970: it is treated as no date.
 */
export function sourceInstantOf(file: Pick<File, "lastModified">): string | null {
  const milliseconds = file.lastModified;
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return null;
  return new Date(milliseconds).toISOString();
}

/**
 * One file's live line in the Upload dialog: its name, where its ceremony stands, and — when it
 * failed — a reason that names the stage and quotes the Error ID, because "an unexpected error
 * occurred" with nothing to report was exactly the complaint this line exists to answer.
 */
export interface UploadProgressItem {
  readonly name: string;
  readonly stage: UploadStage | "failed";
  readonly reason?: string;
}

/** What the reader is told while an upload runs. One sentence per step, never a bare spinner. */
export const UPLOAD_STAGE_NARRATION: Readonly<Record<UploadStage, string>> = {
  reserving: "Reserving the file",
  uploading: "Sending the bytes to storage",
  committing: "Recording the upload",
  scanning: "Checking the file",
  settled: "Finished",
};
