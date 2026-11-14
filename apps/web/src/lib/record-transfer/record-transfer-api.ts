/*
 * The record transfer's writes and its one-off reads, through the generated client.
 *
 * The screens read a run and the list of runs through the generated query options and the shared
 * cache. What is here is everything else: the three writes, and the reads a screen asks once and
 * holds itself (a file's first rows, what a pass was asked with, a pass's report). Each answers with
 * the three-outcome `ApiOutcome` every failure surface renders from, never a throw.
 */
import {
  recordTransferAddSourceFile,
  recordTransferGetPass,
  recordTransferGetPassReport,
  recordTransferGetPassRules,
  recordTransferPreviewSourceFile,
  recordTransferRequestPass,
  recordTransferStartRun,
  type RecordTransferPass,
  type RecordTransferPassFailure,
  type RecordTransferPassReport,
  type RecordTransferPassStatedResponse,
  type RecordTransferRun,
  type RecordTransferSourceFile,
  type RecordTransferSourceFilePreviewResponse,
  type RequestRecordTransferPassRequest,
} from "@magna-carta/api-client";
import { outcomeOf } from "$lib/api/api-client.ts";
import type { ApiOutcome } from "$lib/api/request.ts";
import type { DelimiterName } from "./column-mapping.ts";

/** The permission every record transfer route asks for. */
export const TRANSFER_RECORDS_PERMISSION = "firm:transferRecords";

/** The largest source file the upload takes, which the server enforces with a 413. */
export const SOURCE_FILE_BYTE_CAP = 32 * 1024 * 1024;

/** A report once its pass has ended: exactly one of the two is present. */
export interface TransferPassOutcome {
  report: NonNullable<RecordTransferPassReport> | null;
  failure: NonNullable<RecordTransferPassFailure> | null;
}

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
