/*
 * The upload history — pure half: what is remembered, how a finished batch becomes a record, and
 * the read-time validator that guards the stored payload. The reactive store beside this file
 * (upload-history.svelte.ts) adds the rune state and the cross-tab follower. Same split as the
 * persisted-preference primitive it sits on, and for the same reason: the validation rules are the
 * part worth pinning, and they are testable here without a browser.
 *
 * WHY ANY OF THIS EXISTS. A transfer lives in the tab that started it: the files are the browser's
 * own File handles and cannot survive a reload, so the upload queue
 * ($lib/file-manager/upload-queue.svelte.ts) is rightly transient. But the RECORD of a finished
 * batch is not a transfer — it is a list of names, a matter, a folder and, for each file that
 * landed, the file it became. None of that needs a File handle, and all of it is what somebody is
 * asking for the next morning. The register that held only live state answered "nothing uploading"
 * to that question, which is true and useless.
 *
 * WHAT IS KEPT, AND WHAT IS NOT. A name, a size, how the file ended, and its file id — never bytes,
 * never a digest, never anything privileged. The file id is the whole point: a landed file is
 * downloaded again straight from the matter it landed on, over the route the file list already uses.
 *
 * PER BROWSER, NOT PER MEMBER, so it goes to localStorage rather than onto the member's record —
 * the same standing the download tray's last-seen mark has. It follows the machine somebody uploads
 * from, and a browser refusing site data simply has no history rather than a broken screen. The
 * downloads register opposite it is the server-side case and stays so: it holds documents the
 * platform generated, which a second machine has every right to.
 *
 * BOUNDED, because localStorage is a few megabytes for the whole origin and one upload of a folder
 * of discovery is thousands of names.
 */
import { jsonPreference, type PreferenceCodec } from "$lib/preferences/persisted-preference.ts";
import { UPLOAD_HISTORY_FILE_LIMIT, UPLOAD_HISTORY_LIMIT } from "./transfers.ts";

export const UPLOAD_HISTORY_STORAGE_KEY = "mc-upload-history";

/** How a file in a finished batch ended. The four standings the queue can leave an item in. */
export type UploadHistoryOutcome = "landed" | "failed" | "skipped" | "not-sent";

const OUTCOMES = new Set<string>(["landed", "failed", "skipped", "not-sent"]);

export interface UploadHistoryFile {
  /** What the row was called: its path when it came from a folder, else its name. */
  readonly name: string;
  readonly byteSize: number;
  readonly outcome: UploadHistoryOutcome;
  /** The file it became on the matter — the handle a re-download needs. Null unless it landed. */
  readonly fileId: string | null;
}

export interface UploadHistoryEntry {
  readonly id: string;
  readonly matterId: string;
  readonly matterTitle: string;
  readonly destinationFolderId: string | null;
  readonly destinationLabel: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  /** The batch's files, capped — `files.length` may be under `total`, and the screen says so. */
  readonly files: readonly UploadHistoryFile[];
  readonly total: number;
  readonly landed: number;
}

export interface UploadHistoryValue {
  readonly entries: readonly UploadHistoryEntry[];
}

/**
 * The shape a finished batch is remembered as. Structural rather than the queue's own type, so this
 * module does not import the queue that writes to it — the record is a DESCRIPTION of what
 * happened, and describing it is all the history wants to know about a batch.
 */
export interface FinishedUpload {
  readonly id: string;
  readonly matterId: string;
  readonly matterTitle: string;
  readonly destinationFolderId: string | null;
  readonly destinationLabel: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly files: readonly UploadHistoryFile[];
}

/** How many files in a remembered batch can be downloaded again. */
export function redownloadableCount(entry: UploadHistoryEntry): number {
  return entry.files.filter((file) => file.fileId !== null).length;
}

/** A finished batch as the history keeps it: capped files, and the two counts read off the whole. */
export function entryFromFinished(finished: FinishedUpload): UploadHistoryEntry {
  return {
    id: finished.id,
    matterId: finished.matterId,
    matterTitle: finished.matterTitle,
    destinationFolderId: finished.destinationFolderId,
    destinationLabel: finished.destinationLabel,
    startedAt: finished.startedAt,
    finishedAt: finished.finishedAt,
    files: finished.files.slice(0, UPLOAD_HISTORY_FILE_LIMIT),
    // Counted over EVERY file the batch had, not over the ones that fit: a batch of two thousand
    // that reports "250 of 250 uploaded" is a lie about the upload rather than about the cap.
    total: finished.files.length,
    landed: finished.files.filter((file) => file.outcome === "landed").length,
  };
}

/**
 * Remember one batch, newest first. A batch is remembered ONCE per identity: a retry finishes the
 * same batch again, and the second finish REPLACES the first rather than filing a near-duplicate
 * beside it — what a reader wants remembered is where the batch ended up, not each attempt at it.
 */
export function withFinishedUpload(
  value: UploadHistoryValue,
  finished: FinishedUpload,
): UploadHistoryValue {
  const entry = entryFromFinished(finished);
  const rest = value.entries.filter((candidate) => candidate.id !== entry.id);
  return { entries: [entry, ...rest].slice(0, UPLOAD_HISTORY_LIMIT) };
}

function normalizeFile(parsed: unknown): UploadHistoryFile | null {
  if (parsed === null || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.name !== "string" || record.name === "") return null;
  if (typeof record.outcome !== "string" || !OUTCOMES.has(record.outcome)) return null;
  return {
    name: record.name,
    byteSize:
      typeof record.byteSize === "number" &&
      Number.isFinite(record.byteSize) &&
      record.byteSize >= 0
        ? record.byteSize
        : 0,
    outcome: record.outcome as UploadHistoryOutcome,
    fileId: typeof record.fileId === "string" && record.fileId !== "" ? record.fileId : null,
  };
}

/*
 * The read-time validator. Every field is checked rather than trusted: this payload is hand-
 * editable, arrives from other tabs, and outlives releases — so a shape from an older build folds
 * back to a sane value instead of reaching a screen. A row that cannot be made sense of is DROPPED
 * rather than repaired, because a repaired row is a half-truth about what was uploaded, and this
 * register's whole worth is that a member can believe it.
 */
export function normalizeUploadHistory(parsed: unknown): UploadHistoryValue {
  if (parsed === null || typeof parsed !== "object") return { entries: [] };
  const stored = (parsed as { entries?: unknown }).entries;
  if (!Array.isArray(stored)) return { entries: [] };
  const entries: UploadHistoryEntry[] = [];
  for (const candidate of stored) {
    if (entries.length === UPLOAD_HISTORY_LIMIT) break;
    if (candidate === null || typeof candidate !== "object") continue;
    const record = candidate as Record<string, unknown>;
    if (typeof record.id !== "string" || record.id === "") continue;
    if (typeof record.matterId !== "string" || record.matterId === "") continue;
    if (typeof record.finishedAt !== "string" || record.finishedAt === "") continue;
    const files = Array.isArray(record.files)
      ? record.files
          .map(normalizeFile)
          .filter((file): file is UploadHistoryFile => file !== null)
          .slice(0, UPLOAD_HISTORY_FILE_LIMIT)
      : [];
    const total =
      typeof record.total === "number" &&
      Number.isFinite(record.total) &&
      record.total >= files.length
        ? record.total
        : files.length;
    const landed = files.filter((file) => file.outcome === "landed").length;
    entries.push({
      id: record.id,
      matterId: record.matterId,
      matterTitle: typeof record.matterTitle === "string" ? record.matterTitle : record.matterId,
      destinationFolderId:
        typeof record.destinationFolderId === "string" ? record.destinationFolderId : null,
      destinationLabel:
        typeof record.destinationLabel === "string" ? record.destinationLabel : "Home",
      startedAt: typeof record.startedAt === "string" ? record.startedAt : record.finishedAt,
      finishedAt: record.finishedAt,
      files,
      total,
      // Recounted rather than read: a stored tally that disagrees with the rows beside it is the
      // one number nobody can check, and the rows are the record.
      landed: typeof record.landed === "number" && record.landed > landed ? record.landed : landed,
    });
  }
  return { entries };
}

export function uploadHistoryCodec(): PreferenceCodec<UploadHistoryValue> {
  return jsonPreference<UploadHistoryValue>(UPLOAD_HISTORY_STORAGE_KEY, normalizeUploadHistory);
}
