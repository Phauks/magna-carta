/*
 * The record transfer's writes and its one-off reads, through the generated client.
 *
 * The screens read a run and the list of runs through the generated query options and the shared
 * cache. What is here is everything else: the writes (a run, a file, a pass, a file's mapping, and
 * the two ways a run ends), and the reads a screen asks once and holds itself (a file's first rows,
 * its saved mapping, the values of one of its columns, what a pass was asked with, a pass's report
 * and its rejected rows). Each answers with the three-outcome `ApiOutcome` every failure surface
 * renders from, never a throw.
 */
import {
  recordTransferAbandonRun,
  recordTransferAcceptRun,
  recordTransferAddSourceFile,
  recordTransferAddSourceFileUploadPart,
  recordTransferCompleteSourceFileUpload,
  recordTransferDownloadRejectedRows,
  recordTransferGetPass,
  recordTransferGetPassReport,
  recordTransferGetPassRules,
  recordTransferGetSourceFileMapping,
  recordTransferListSourceFileColumnValues,
  recordTransferPreviewSourceFile,
  recordTransferRequestPass,
  recordTransferSaveSourceFileMapping,
  recordTransferStartRun,
  recordTransferStartSourceFileUpload,
  type RecordTransferPass,
  type RecordTransferPassFailure,
  type RecordTransferPassReport,
  type RecordTransferPassStatedResponse,
  type RecordTransferRun,
  type RecordTransferSourceFile,
  type RecordTransferSourceFileColumnValuesResponse,
  type RecordTransferSourceFilePreviewResponse,
  type RequestRecordTransferPassRequest,
} from "@magna-carta/api-client";
import { outcomeOf } from "$lib/api/api-client.ts";
import type { ApiOutcome } from "$lib/api/request.ts";
import type { StatedFailure } from "$lib/diagnostics/failure-view.ts";
import type { ColumnCode, DelimiterName, FileMapping } from "./column-mapping.ts";
import {
  PIECE_RETRY_LIMIT,
  planFilePieces,
  uploadRouteFor,
  type FilePiece,
} from "./file-upload-plan.ts";

/** The permission every record transfer route asks for. */
export const TRANSFER_RECORDS_PERMISSION = "firm:transferRecords";

/** A report once its pass has ended: exactly one of the two is present. */
export interface TransferPassOutcome {
  report: NonNullable<RecordTransferPassReport> | null;
  failure: NonNullable<RecordTransferPassFailure> | null;
}

/** A file's saved mapping, with who saved it and when. */
export interface SavedFileMapping {
  mapping: FileMapping;
  savedBy: string;
  savedAt: string;
}

/** How the read of one column's codes stands. */
export type ColumnCodesRead =
  | { readonly kind: "reading" }
  | {
      readonly kind: "read";
      readonly codes: readonly ColumnCode[];
      /** The column has more codes than were answered, or a value too long to be a code. */
      readonly truncated: boolean;
    }
  | { readonly kind: "failed"; readonly failure: StatedFailure };

async function outcome<T>(call: () => Promise<{ data: T }>): Promise<ApiOutcome<T>> {
  try {
    const { data } = await call();
    return { kind: "ok", value: data };
  } catch (error) {
    return outcomeOf(error);
  }
}

/** Start a run. The key is the caller's, so a repeated press starts one run. */
export function startTransferRun(
  request: { sourceSystem: string; label: string },
  idempotencyKey: string,
): Promise<ApiOutcome<{ run: RecordTransferRun }>> {
  return outcome(() =>
    recordTransferStartRun({
      body: request,
      headers: { "idempotency-key": idempotencyKey },
      throwOnError: true,
    }),
  );
}

/** How far an upload has got. */
export interface UploadProgress {
  readonly sentBytes: number;
  readonly totalBytes: number;
}

/** What an upload is told while it runs. */
export interface UploadOptions {
  /** Called as bytes arrive: once for a file sent whole, and after every piece otherwise. */
  readonly onProgress?: (progress: UploadProgress) => void;
  /** Aborting it stops the upload: the request in flight is dropped and no further piece is sent. */
  readonly signal?: AbortSignal;
}

/** How an upload ended. `stopped` is an upload its own signal ended, which is nobody's failure. */
export type UploadOutcome =
  | ApiOutcome<{ file: RecordTransferSourceFile }>
  | { readonly kind: "stopped" };

/**
 * Give a run a file. A file at or under the single-request limit is the body of one request. A
 * larger one is started, sent one piece at a time, and completed, and the run has no file until
 * the completion answers. A piece that fails is sent again a couple of times before the upload
 * gives up. No route here asks for an idempotency key: the file's checksum refuses the same bytes
 * twice, with a 409, and a piece sent again replaces itself.
 *
 * A file over the largest size a run takes is the caller's to refuse before calling this.
 */
export async function uploadSourceFile(
  runId: string,
  file: File,
  fileKind: string,
  options: UploadOptions = {},
): Promise<UploadOutcome> {
  const { onProgress, signal } = options;
  const totalBytes = file.size;
  const stopped = (): boolean => signal?.aborted === true;

  if (uploadRouteFor(totalBytes) !== "pieces") {
    const whole = await outcome(() =>
      recordTransferAddSourceFile({
        path: { runId },
        query: { fileName: file.name, sourceKind: fileKind },
        body: file,
        signal,
        throwOnError: true,
      }),
    );
    if (whole.kind !== "ok" && stopped()) return { kind: "stopped" };
    if (whole.kind === "ok") onProgress?.({ sentBytes: totalBytes, totalBytes });
    return whole;
  }

  const started = await outcome(() =>
    recordTransferStartSourceFileUpload({ path: { runId }, signal, throwOnError: true }),
  );
  if (stopped()) return { kind: "stopped" };
  if (started.kind !== "ok") return started;
  const { fileId, uploadId, partBytes } = started.value;

  const sendPiece = (
    piece: FilePiece,
  ): Promise<ApiOutcome<{ part: { partNumber: number; etag: string } }>> =>
    outcome(() =>
      recordTransferAddSourceFileUploadPart({
        path: { runId, fileId, partNumber: piece.partNumber },
        query: { uploadId },
        body: file.slice(piece.start, piece.end),
        signal,
        throwOnError: true,
      }),
    );

  const parts: { partNumber: number; etag: string }[] = [];
  onProgress?.({ sentBytes: 0, totalBytes });
  for (const piece of planFilePieces(totalBytes, partBytes)) {
    let sent = await sendPiece(piece);
    for (let again = 0; sent.kind !== "ok" && again < PIECE_RETRY_LIMIT && !stopped(); again += 1) {
      sent = await sendPiece(piece);
    }
    if (stopped()) return { kind: "stopped" };
    if (sent.kind !== "ok") return sent;
    parts.push(sent.value.part);
    onProgress?.({ sentBytes: piece.end, totalBytes });
  }

  const completed = await outcome(() =>
    recordTransferCompleteSourceFileUpload({
      path: { runId, fileId },
      body: { uploadId, fileName: file.name, sourceKind: fileKind, parts },
      signal,
      throwOnError: true,
    }),
  );
  if (completed.kind !== "ok" && stopped()) return { kind: "stopped" };
  return completed;
}

/** The header row and the first three data rows of a file. */
export function previewSourceFile(
  runId: string,
  fileId: string,
  delimiter: DelimiterName,
): Promise<ApiOutcome<RecordTransferSourceFilePreviewResponse>> {
  return outcome(() =>
    recordTransferPreviewSourceFile({
      path: { runId, fileId },
      query: { delimiter },
      throwOnError: true,
    }),
  );
}

/** Ask for a pass. It is recorded and answered at once; the work runs afterwards. */
export function requestTransferPass(
  runId: string,
  request: RequestRecordTransferPassRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<{ pass: RecordTransferPass }>> {
  return outcome(() =>
    recordTransferRequestPass({
      path: { runId },
      body: request,
      headers: { "idempotency-key": idempotencyKey },
      throwOnError: true,
    }),
  );
}

/** How one pass stands now. */
export function readTransferPass(
  runId: string,
  passId: string,
): Promise<ApiOutcome<{ pass: RecordTransferPass }>> {
  return outcome(() => recordTransferGetPass({ path: { runId, passId }, throwOnError: true }));
}

/** What a pass was asked with. */
export function readTransferPassRules(
  runId: string,
  passId: string,
): Promise<ApiOutcome<RecordTransferPassStatedResponse>> {
  return outcome(() => recordTransferGetPassRules({ path: { runId, passId }, throwOnError: true }));
}

/** A pass's report, or the reason it has none. Both are null until the pass has ended. */
export function readTransferPassReport(
  runId: string,
  passId: string,
): Promise<ApiOutcome<TransferPassOutcome>> {
  return outcome(async () => {
    const { data } = await recordTransferGetPassReport({
      path: { runId, passId },
      throwOnError: true,
    });
    return { data: { report: data.report ?? null, failure: data.failure ?? null } };
  });
}

/** A file's saved mapping, or null where nothing has been saved for it. */
export function readSourceFileMapping(
  runId: string,
  fileId: string,
): Promise<ApiOutcome<{ saved: SavedFileMapping | null }>> {
  return outcome(() =>
    recordTransferGetSourceFileMapping({ path: { runId, fileId }, throwOnError: true }),
  );
}

/**
 * Save a file's mapping over the one saved before. The route asks for no idempotency key: saving
 * the same mapping twice leaves the same mapping. A run that has ended refuses it with a 409.
 */
export function saveSourceFileMapping(
  runId: string,
  fileId: string,
  mapping: FileMapping,
): Promise<ApiOutcome<{ saved: SavedFileMapping | null }>> {
  return outcome(() =>
    recordTransferSaveSourceFileMapping({
      path: { runId, fileId },
      body: { mapping },
      throwOnError: true,
    }),
  );
}

/** The different values of one column of a file, most used first, each with its number of rows. */
export function listSourceFileColumnValues(
  runId: string,
  fileId: string,
  column: string,
  delimiter: DelimiterName,
): Promise<ApiOutcome<RecordTransferSourceFileColumnValuesResponse>> {
  return outcome(() =>
    recordTransferListSourceFileColumnValues({
      path: { runId, fileId },
      query: { column, delimiter },
      throwOnError: true,
    }),
  );
}

/**
 * The rows a finished pass rejected, as a file: the source file's own columns with the reason for
 * each row in front. The answer is the file's own content, so it is handed on and never logged.
 */
export function downloadRejectedRows(runId: string, passId: string): Promise<ApiOutcome<Blob>> {
  return outcome(async () => {
    const { data } = await recordTransferDownloadRejectedRows({
      path: { runId, passId },
      parseAs: "blob",
      throwOnError: true,
    });
    const body: unknown = data;
    return { data: body instanceof Blob ? body : new Blob([String(body)], { type: "text/csv" }) };
  });
}

/**
 * Accept a run: it is complete, and a conflicts check is asked for each open matter it brought in.
 * Refused with a 409 while a pass has not ended. It cannot be undone.
 */
export function acceptTransferRun(
  runId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ run: RecordTransferRun }>> {
  return outcome(() =>
    recordTransferAcceptRun({
      path: { runId },
      headers: { "idempotency-key": idempotencyKey },
      throwOnError: true,
    }),
  );
}

/**
 * Stop a run without accepting it. Everything that arrived stays and nothing further is asked for.
 * Refused with a 409 while a pass has not ended. It cannot be undone.
 */
export function stopTransferRun(
  runId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ run: RecordTransferRun }>> {
  return outcome(() =>
    recordTransferAbandonRun({
      path: { runId },
      headers: { "idempotency-key": idempotencyKey },
      throwOnError: true,
    }),
  );
}
