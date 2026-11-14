import type { TransferPassBody, TransferRunBody, TransferSourceFileBody } from "./contract.ts";
import { assertSourceFileFormat } from "./source-file.ts";
import { assertTransferPassRecordKind, type TransferPassRow } from "./transfer-pass-statements.ts";
import { transferPassStateOf } from "./transfer-requests.ts";
import type { TransferRunRow } from "./transfer-run-statements.ts";
import type { TransferSourceFileRow } from "./transfer-source-file-statements.ts";

// A stored row as the routes answer it. Three things never leave: a file's object key and a pass's
// report key, which are where bytes are kept and no caller's business, and a pass's stored rules,
// which a screen that wants them asks for by the pass.

export function transferRunBody(row: TransferRunRow): TransferRunBody {
  return {
    id: row.id,
    sourceSystem: row.source_system,
    label: row.label,
    startedBy: row.started_by,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    abandonedAt: row.abandoned_at,
  };
}

export function transferSourceFileBody(row: TransferSourceFileRow): TransferSourceFileBody {
  return {
    id: row.id,
    sourceKind: row.source_kind,
    format: assertSourceFileFormat(row.format),
    fileName: row.file_name,
    byteLength: row.byte_length,
    contentSha256: row.content_sha256,
    keyColumn: row.key_column,
    rowCount: row.row_count,
    registeredAt: row.registered_at,
    removedAt: row.removed_at,
  };
}

export function transferPassBody(row: TransferPassRow, now: string): TransferPassBody {
  return {
    id: row.id,
    fileId: row.transfer_source_file_id,
    recordKind: assertTransferPassRecordKind(row.record_kind),
    sourceKind: row.source_kind,
    state: transferPassStateOf(row, now),
    requestedBy: row.requested_by,
    requestedAt: row.requested_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    failedAt: row.failed_at,
    counts:
      row.rows_read === null
        ? null
        : {
            rowsRead: row.rows_read,
            created: row.created_count ?? 0,
            alreadyLinked: row.already_linked_count ?? 0,
            rejected: row.rejected_count ?? 0,
            waiting: row.waiting_count ?? 0,
            findings: row.finding_count ?? 0,
            columnsMissing: row.columns_missing_count ?? 0,
          },
  };
}
