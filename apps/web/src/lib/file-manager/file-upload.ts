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
 * TWO LEGS, ONE CEREMONY. At or below the firm's mode threshold (100 MB by default) the host answers
 * a single signed PUT. Above it the host opens a multipart session and this module runs the S3
 * ceremony the host tracks: sign each part, PUT it, keep the ETag the storage answers, and hand the
 * manifest back on completion. Parts are fixed-size (the storage requires every part but the last
 * to be the same size), several go at once, and a part that fails is sent again on its own — never
 * the whole file, which is the point of having parts (docs/conventions/network-resilience.md).
 *
 * BYTES ARE REPORTED AS THEY LEAVE. The write runs on the one browser transport that reports upload
 * progress, and every leg reports the bytes sent so far against the file's size, so a row can say
 * "Sending · 42%" rather than only that it is sending.
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
  duplicateHeldVersion,
  findUploadMatches,
  putUploadBytes,
  readUploadStatus,
  signUploadPart,
  type ApiOutcome,
  type Problem,
  type PutUploadOptions,
  type UploadedPart,
} from "$lib/documents/document-api.ts";
import { problemOutcome, requestJson, transportOutcome } from "$lib/api/request.ts";

export type UploadStage =
  | "matching"
  | "reserving"
  | "uploading"
  | "committing"
  | "scanning"
  | "settled";

export type UploadOutcome =
  /**
   * The bytes cleared the gate: the file is on the matter, in the folder that was asked for.
   * `copiedFrom` is set when no byte crossed the network — the firm already held the bytes on
   * another matter and the file was made from them server-side.
   */
  | { kind: "committed"; fileId: string; versionId: string | null; copiedFrom?: "firm" }
  /** The matter already holds exactly these bytes as a live file; nothing was sent or made. */
  | { kind: "already"; fileId: string; name: string; folderId: string | null }
  /** The gate refused the bytes. The file is on the matter and says so; it has no content. */
  | { kind: "flagged"; fileId: string; reason: string | null }
  /** Everything the caller controls succeeded; the verdict had not landed before the wait ran out. */
  | { kind: "settling"; fileId: string }
  | { kind: "problem"; problem: Problem; stage: UploadStage }
  | { kind: "transport"; stage: UploadStage }
  /** The caller abandoned the transfer. The reservation was given back; nothing is on the matter. */
  | { kind: "cancelled"; stage: UploadStage };

/** The reservation, as the host answers it. */
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

const MEBIBYTE = 1024 * 1024;
/**
 * The part size a multipart upload is cut into. Sixteen mebibytes: large enough that a gigabyte is
 * sixty-odd round trips rather than two hundred, small enough that a lost part costs seconds to
 * resend. The storage's own floor is five; its ceiling is ten thousand parts, so a file past 160 GB
 * takes larger parts to fit under it.
 */
export const MULTIPART_PART_SIZE = 16 * MEBIBYTE;
const MULTIPART_MAX_PARTS = 10_000;
/** How many parts of ONE file are in flight at once. */
export const MULTIPART_CONCURRENCY = 3;
/**
 * How a failed write is retried: progressive backoff, connection kept, the same bytes sent again.
 * Three tries. A part is retried on its own; a single-shot body is small enough that a resend is
 * cheaper than telling the reader to start over.
 */
const RETRY_DELAYS_MILLISECONDS: readonly number[] = [500, 1_500, 4_000];

/** The part size for a file of this many bytes: the fixed size, grown only to fit the part ceiling. */
export function multipartPartSize(totalBytes: number): number {
  const minimum = Math.ceil(totalBytes / MULTIPART_MAX_PARTS);
  if (minimum <= MULTIPART_PART_SIZE) return MULTIPART_PART_SIZE;
  return Math.ceil(minimum / MEBIBYTE) * MEBIBYTE;
}

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
   * The SHA-256 of the file's bytes, when the caller hashed it first. Given, the firm is asked
   * whether it already holds the bytes before any are sent: a live file on the matter with them is
   * reported as already there, and one elsewhere in the firm is duplicated server-side. Null or
   * absent means the question is not put. Never used for a new version of an existing file — the
   * host's own hash check at ingest already answers that case.
   */
  readonly sha256?: string | null;
  /**
   * How a new file is dated: at the upload (the default), or at the source file's own last-modified
   * instant. The source's instant is sent either way, as a fact about where the bytes came from.
   */
  readonly createdAtBasis?: "upload" | "source";
  readonly onStage?: (stage: UploadStage) => void;
  /** Bytes sent so far against the file's size, as they leave the browser. */
  readonly onProgress?: (sentBytes: number, totalBytes: number) => void;
  /** Abandons the transfer. Whatever was reserved is given back; the outcome is `cancelled`. */
  readonly signal?: AbortSignal;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly newIdempotencyKey?: () => string;
  /** The XMLHttpRequest constructor the byte writes use. A seam for tests. */
  readonly xhr?: PutUploadOptions["xhr"];
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Whether the reader has cancelled. A function rather than a read of `signal.aborted` in place,
 * because the flag flips while the code awaits, and a property read is narrowed by the type-checker
 * as if it could not.
 */
function cancelled(signal: AbortSignal | undefined): boolean {
  return signal?.aborted ?? false;
}

/**
 * Reserve the version. This is the one call the loop's client cannot make for us, because its input
 * type has no folder on it. The body is the contract's own InitiateUploadRequest.
 */
function reserveUpload(
  fetchImpl: typeof fetch,
  body: Record<string, unknown>,
  idempotencyKey: string,
  signal: AbortSignal | undefined,
): Promise<ApiOutcome<ReservedUpload>> {
  return requestJson(fetchImpl, "/api/v1/uploads", {
    method: "POST",
    body,
    idempotencyKey,
    ...(signal === undefined ? {} : { signal }),
  });
}

function at(outcome: ApiOutcome<unknown>, stage: UploadStage): UploadOutcome {
  if (outcome.kind === "problem") return { kind: "problem", problem: outcome.problem, stage };
  return { kind: "transport", stage };
}

/** Whether a failed write is worth sending again: nothing answered, or the storage's side broke. */
function retryable(outcome: ApiOutcome<unknown>): boolean {
  if (outcome.kind === "transport") return true;
  return outcome.kind === "problem" && outcome.problem.status >= 500;
}

/**
 * Run a write, and run it again with progressive backoff when the failure is the kind that a
 * second try can answer. An abort ends the attempts at once: the reader has changed their mind, and
 * a retry would be the opposite of what they asked.
 */
async function withRetries<T>(
  attempt: () => Promise<ApiOutcome<T>>,
  sleep: (milliseconds: number) => Promise<void>,
  signal: AbortSignal | undefined,
): Promise<ApiOutcome<T>> {
  let outcome = await attempt();
  for (const delay of RETRY_DELAYS_MILLISECONDS) {
    if (outcome.kind === "ok" || !retryable(outcome) || cancelled(signal)) return outcome;
    await sleep(delay);
    if (cancelled(signal)) return outcome;
    outcome = await attempt();
  }
  return outcome;
}

/** The single-shot leg: the whole file to the URL the reservation signed, with its signed headers. */
async function sendSingle(
  request: UploadRequest,
  reservation: ReservedUpload & { url: string },
  sleep: (milliseconds: number) => Promise<void>,
): Promise<ApiOutcome<unknown>> {
  const { fetchImpl, file, signal, xhr } = request;
  return withRetries(
    () =>
      putUploadBytes(fetchImpl, reservation.url, reservation.headers ?? {}, file, {
        ...(request.onProgress === undefined ? {} : { onProgress: request.onProgress }),
        ...(signal === undefined ? {} : { signal }),
        ...(xhr === undefined ? {} : { xhr }),
      }),
    sleep,
    signal,
  );
}

/**
 * The multipart leg: the file cut into fixed parts, each signed and sent on its own, several at a
 * time, each retried on its own. Answers the manifest the completion needs, or the first failure
 * that survived its retries.
 */
async function sendParts(
  request: UploadRequest,
  reservation: ReservedUpload,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<ApiOutcome<UploadedPart[]>> {
  const { fetchImpl, file, signal, xhr, onProgress } = request;
  const partSize = multipartPartSize(file.size);
  const partCount = Math.max(1, Math.ceil(file.size / partSize));
  const sent = new Array<number>(partCount).fill(0);
  const report = (): void => {
    onProgress?.(
      sent.reduce((sum, bytes) => sum + bytes, 0),
      file.size,
    );
  };
  const parts: UploadedPart[] = [];
  let failure: ApiOutcome<unknown> | null = null;
  let next = 0;

  const sendPart = async (partNumber: number): Promise<void> => {
    const start = (partNumber - 1) * partSize;
    const slice = file.slice(start, Math.min(start + partSize, file.size));
    const outcome = await withRetries(
      async () => {
        const signed = await signUploadPart(fetchImpl, reservation.uploadId, partNumber);
        if (signed.kind !== "ok") return signed;
        return putUploadBytes(fetchImpl, signed.value.url, {}, slice, {
          onProgress: (loaded) => {
            sent[partNumber - 1] = loaded;
            report();
          },
          ...(signal === undefined ? {} : { signal }),
          ...(xhr === undefined ? {} : { xhr }),
        });
      },
      sleep,
      signal,
    );
    if (outcome.kind !== "ok") {
      failure ??= outcome;
      return;
    }
    sent[partNumber - 1] = slice.size;
    report();
    // A storage that exposes no ETag cannot complete a multipart upload: the manifest would be
    // empty-handed. Said as a problem the reader can report, not as a silent hang.
    if (outcome.value.etag === null) {
      failure ??= problemOutcome(
        {
          status: 502,
          detail:
            "The storage did not return the part's ETag, so the upload cannot be assembled. The " +
            "bucket's CORS policy must expose the ETag header.",
        },
        "PUT (presigned object storage)",
      );
      return;
    }
    parts.push({ partNumber, etag: outcome.value.etag });
  };

  const worker = async (): Promise<void> => {
    for (;;) {
      if (failure !== null || cancelled(signal)) return;
      next += 1;
      if (next > partCount) return;
      await sendPart(next);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(MULTIPART_CONCURRENCY, partCount) }, () => worker()),
  );
  if (failure !== null) return failure as ApiOutcome<UploadedPart[]>;
  if (cancelled(signal)) return transportOutcome("PUT (presigned object storage)");
  return { kind: "ok", value: parts.toSorted((left, right) => left.partNumber - right.partNumber) };
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
    onProgress,
    signal,
    sleep = defaultSleep,
    newIdempotencyKey = () => crypto.randomUUID(),
  } = request;

  if (cancelled(signal)) return { kind: "cancelled", stage: "reserving" };

  /*
   * THE QUESTION BEFORE THE BYTES. With a digest in hand, the firm is asked what it already holds.
   * A failure to answer is not a failure to upload: the question is an economy, and the transfer
   * proceeds as if it had not been put. A duplicate that fails likewise falls through to the
   * ordinary upload, so the reader's file always lands one way or the other.
   */
  const sha256 = request.sha256 ?? null;
  if (sha256 !== null && fileId === undefined) {
    onStage?.("matching");
    const matches = await findUploadMatches(
      fetchImpl,
      { matterId, sha256, sizeBytes: file.size },
      signal,
    );
    if (cancelled(signal)) return { kind: "cancelled", stage: "matching" };
    if (matches.kind === "ok") {
      const here = matches.value.onMatter[0];
      if (here !== undefined) {
        onStage?.("settled");
        return { kind: "already", fileId: here.fileId, name: here.name, folderId: here.folderId };
      }
      const held = matches.value.elsewhere[0];
      if (held !== undefined) {
        const made = await duplicateHeldVersion(
          fetchImpl,
          {
            sourceVersionId: held.versionId,
            matterId,
            folderId,
            name,
            documentTypeId: documentTypeId ?? null,
            sourceModifiedAt: sourceInstantOf(file),
            ...(createdAtBasis === undefined ? {} : { createdAtBasis }),
          },
          newIdempotencyKey(),
          signal,
        );
        if (cancelled(signal)) return { kind: "cancelled", stage: "matching" };
        if (made.kind === "ok") {
          onProgress?.(file.size, file.size);
          onStage?.("settled");
          return {
            kind: "committed",
            fileId: made.value.fileId,
            versionId: made.value.versionId,
            copiedFrom: "firm",
          };
        }
      }
    }
  }

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
    signal,
  );
  if (reserved.kind !== "ok") {
    return cancelled(signal)
      ? { kind: "cancelled", stage: "reserving" }
      : at(reserved, "reserving");
  }
  const reservation = reserved.value;

  /** Give the reservation back and say how the transfer ended. */
  const giveBack = async (
    stage: UploadStage,
    outcome: ApiOutcome<unknown>,
  ): Promise<UploadOutcome> => {
    await abortUpload(fetchImpl, reservation.uploadId);
    return cancelled(signal) ? { kind: "cancelled", stage } : at(outcome, stage);
  };

  onStage?.("uploading");
  let manifest: UploadedPart[] | undefined;
  if (reservation.mode === "put" && reservation.url !== undefined) {
    // The signed headers carry the object's dimensions and are passed through untouched: bytes
    // written without them land somewhere nothing can place.
    const put = await sendSingle(request, { ...reservation, url: reservation.url }, sleep);
    if (put.kind !== "ok") return giveBack("uploading", put);
  } else {
    const sentParts = await sendParts(request, reservation, sleep);
    if (sentParts.kind !== "ok") return giveBack("uploading", sentParts);
    manifest = sentParts.value;
  }

  onStage?.("committing");
  const completed = await completeUpload(
    fetchImpl,
    reservation.uploadId,
    newIdempotencyKey(),
    manifest,
  );
  if (completed.kind !== "ok") return giveBack("committing", completed);

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

/** What the reader is told while an upload runs. One sentence per step, never a bare spinner. */
export const UPLOAD_STAGE_NARRATION: Readonly<Record<UploadStage, string>> = {
  matching: "Asking whether the firm already holds it",
  reserving: "Reserving the file",
  uploading: "Sending the bytes to storage",
  committing: "Recording the upload",
  scanning: "Checking the file",
  settled: "Uploaded",
};
