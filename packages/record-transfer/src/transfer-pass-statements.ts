import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  TransferPassId,
  TransferRunId,
  TransferSourceFileId,
  UserId,
} from "@magna-carta/identifiers/types";
import { assertSourceFileKind } from "./source-file.ts";
import type { TransferPassReport } from "./transfer-pass.ts";

// A pass that was asked for: which file, which kind of record, under which rules, and how it ended.
// The row is what a screen lists and what the background job picks up. The report itself (every
// rejected row, every finding) is kept as one object beside the source file and not in this table,
// because it grows with the file and a list of passes needs only the counts.

// Table name tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test.
export const TRANSFER_PASS_TABLE = "transfer_pass";

// The kinds of record a pass can load. One per `...PassPlan` builder in transfer-pass.ts.
export const TRANSFER_PASS_RECORD_KINDS = ["person", "organization", "matter"] as const;

export type TransferPassRecordKind = (typeof TRANSFER_PASS_RECORD_KINDS)[number];

export class UnknownTransferPassRecordKindError extends Error {
  constructor() {
    super("a pass loads people, organizations or matters");
    this.name = "UnknownTransferPassRecordKindError";
  }
}

export function assertTransferPassRecordKind(value: string): TransferPassRecordKind {
  if (!(TRANSFER_PASS_RECORD_KINDS as readonly string[]).includes(value)) {
    throw new UnknownTransferPassRecordKindError();
  }
  return value as TransferPassRecordKind;
}

export class InvalidTransferPassRulesError extends Error {
  constructor() {
    super("a pass's mapping rules are stored as a JSON object");
    this.name = "InvalidTransferPassRulesError";
  }
}

// What the operator stated is stored as it was stated (the key column, the delimiter and the mapping
// rules), so the pass that ran can be shown and asked for again. Its shape is the contract's
// question; this asks only that it is an object.
function assertRulesJson(value: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new InvalidTransferPassRulesError();
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new InvalidTransferPassRulesError();
  }
  return value;
}

// Where a pass's report is kept. Built from the two identifiers alone, beside the run's source
// files, so releasing a run's objects is one prefix.
export function transferPassReportObjectKey(
  transferRunId: TransferRunId,
  transferPassId: TransferPassId,
): string {
  return `transfers/${transferRunId}/passes/${transferPassId}.json`;
}

const COLUMNS =
  "id, transfer_run_id, transfer_source_file_id, record_kind, source_kind, rules_json, report_object_key, requested_by, requested_at, started_at, finished_at, failed_at, rows_read, created_count, already_linked_count, rejected_count, waiting_count, finding_count, columns_missing_count";

export interface TransferPassRow {
  readonly id: TransferPassId;
  readonly transfer_run_id: TransferRunId;
  readonly transfer_source_file_id: TransferSourceFileId;
  readonly record_kind: string;
  readonly source_kind: string;
  readonly rules_json: string;
  readonly report_object_key: string;
  readonly requested_by: UserId;
  readonly requested_at: string;
  readonly started_at: string | null;
  readonly finished_at: string | null;
  readonly failed_at: string | null;
  readonly rows_read: number | null;
  readonly created_count: number | null;
  readonly already_linked_count: number | null;
  readonly rejected_count: number | null;
  readonly waiting_count: number | null;
  readonly finding_count: number | null;
  readonly columns_missing_count: number | null;
}

export interface NewTransferPass {
  readonly id: TransferPassId;
  readonly transferRunId: TransferRunId;
  readonly transferSourceFileId: TransferSourceFileId;
  readonly recordKind: string;
  readonly sourceKind: string;
  readonly rulesJson: string;
  readonly requestedBy: UserId;
}

export function insertTransferPassStatement(
  database: SqlDatabase,
  pass: NewTransferPass,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${TRANSFER_PASS_TABLE} (${COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`,
    )
    .bind(
      pass.id,
      pass.transferRunId,
      pass.transferSourceFileId,
      assertTransferPassRecordKind(pass.recordKind),
      assertSourceFileKind(pass.sourceKind),
      assertRulesJson(pass.rulesJson),
      transferPassReportObjectKey(pass.transferRunId, pass.id),
      pass.requestedBy,
      now,
    );
}

export function selectTransferPassStatement(
  database: SqlDatabase,
  id: TransferPassId,
): SqlStatement {
  return database.prepare(`SELECT ${COLUMNS} FROM ${TRANSFER_PASS_TABLE} WHERE id = ?1`).bind(id);
}

// In the order the passes were asked for, which is the order they ran in.
export function selectTransferPassesStatement(
  database: SqlDatabase,
  transferRunId: TransferRunId,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${COLUMNS} FROM ${TRANSFER_PASS_TABLE} WHERE transfer_run_id = ?1 ORDER BY requested_at, id`,
    )
    .bind(transferRunId);
}

// Take a pass to run it. A queue may deliver the same message twice; only the first delivery
// changes a row, and the second reads zero and leaves the pass to the first.
// fitness:unguarded-write — zero rows means another delivery already took the pass; the caller stops without running it
export function startTransferPassStatement(
  database: SqlDatabase,
  id: TransferPassId,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${TRANSFER_PASS_TABLE} SET started_at = ?2 WHERE id = ?1 AND started_at IS NULL`,
    )
    .bind(id, now);
}

// Record how a pass came out. The counts are the report's, written together with the finish.
// fitness:unguarded-write — zero rows means the pass had already ended; its first ending stands
export function finishTransferPassStatement(
  database: SqlDatabase,
  id: TransferPassId,
  report: TransferPassReport,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${TRANSFER_PASS_TABLE} SET finished_at = ?2, rows_read = ?3, created_count = ?4, already_linked_count = ?5, rejected_count = ?6, waiting_count = ?7, finding_count = ?8, columns_missing_count = ?9 WHERE id = ?1 AND started_at IS NOT NULL AND finished_at IS NULL AND failed_at IS NULL`,
    )
    .bind(
      id,
      now,
      report.rowsRead,
      report.created,
      report.alreadyLinked,
      report.rejected.length,
      report.waiting.length,
      report.findings.length,
      report.columnsMissing.length,
    );
}

// Record that a pass stopped on a fault. Everything it wrote before the fault is linked and stands;
// a new pass over the same file carries on from there.
// fitness:unguarded-write — zero rows means the pass had already ended; its first ending stands
export function failTransferPassStatement(
  database: SqlDatabase,
  id: TransferPassId,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${TRANSFER_PASS_TABLE} SET failed_at = ?2 WHERE id = ?1 AND started_at IS NOT NULL AND finished_at IS NULL AND failed_at IS NULL`,
    )
    .bind(id, now);
}
