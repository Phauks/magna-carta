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

/** The permission every record transfer route asks for. */
export const TRANSFER_RECORDS_PERMISSION = "firm:transferRecords";

/** The largest source file the upload takes, which the server enforces with a 413. */
export const SOURCE_FILE_BYTE_CAP = 32 * 1024 * 1024;

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

/**
 * Give a run a file. The body is the file itself. The route asks for no idempotency key: the
 * file's checksum refuses the same bytes twice, with a 409.
 */
export function uploadSourceFile(
  runId: string,
  file: File,
  fileKind: string,
): Promise<ApiOutcome<{ file: RecordTransferSourceFile }>> {
  return outcome(() =>
    recordTransferAddSourceFile({
      path: { runId },
      query: { fileName: file.name, sourceKind: fileKind },
      body: file,
      throwOnError: true,
    }),
  );
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
