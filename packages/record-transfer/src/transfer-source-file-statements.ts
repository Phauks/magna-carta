import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { TransferRunId, TransferSourceFileId } from "@magna-carta/identifiers/types";
import {
  assertContentSha256,
  assertSourceFileFormat,
  assertSourceFileKind,
  transferSourceFileObjectKey,
} from "./source-file.ts";

// Table name tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test.
export const TRANSFER_SOURCE_FILE_TABLE = "transfer_source_file";

const COLUMNS =
  "id, transfer_run_id, source_kind, format, file_name, object_key, byte_length, content_sha256, key_column, row_count, registered_at, read_at, removed_at";

export interface TransferSourceFileRow {
  readonly id: TransferSourceFileId;
  readonly transfer_run_id: TransferRunId;
  readonly source_kind: string;
  readonly format: string;
  readonly file_name: string;
  readonly object_key: string;
  readonly byte_length: number;
  readonly content_sha256: string;
  readonly key_column: string | null;
  readonly row_count: number | null;
  readonly registered_at: string;
  readonly read_at: string | null;
  readonly removed_at: string | null;
}

export interface NewTransferSourceFile {
  readonly id: TransferSourceFileId;
  readonly transferRunId: TransferRunId;
  readonly sourceKind: string;
  readonly format: string;
  readonly fileName: string;
  readonly byteLength: number;
  readonly contentSha256: string;
  readonly keyColumn: string | null;
}

// Register a file whose bytes are already held. The object key is derived here from the two
// identifiers, so no caller can store a key built from anything else. There is no conflict clause:
// the same bytes given twice to one run fail on the unique index, and the caller tells the operator
// the file is already in the run.
export function insertTransferSourceFileStatement(
  database: SqlDatabase,
  file: NewTransferSourceFile,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${TRANSFER_SOURCE_FILE_TABLE} (${COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, ?10, NULL, NULL)`,
    )
    .bind(
      file.id,
      file.transferRunId,
      assertSourceFileKind(file.sourceKind),
      assertSourceFileFormat(file.format),
      file.fileName,
      transferSourceFileObjectKey(file.transferRunId, file.id),
      file.byteLength,
      assertContentSha256(file.contentSha256),
      file.keyColumn,
      now,
    );
}

export function selectTransferSourceFileStatement(
  database: SqlDatabase,
  id: TransferSourceFileId,
): SqlStatement {
  return database
    .prepare(`SELECT ${COLUMNS} FROM ${TRANSFER_SOURCE_FILE_TABLE} WHERE id = ?1`)
    .bind(id);
}

// In the order the files were given, which is the order a run's report lists them in.
export function selectTransferSourceFilesStatement(
  database: SqlDatabase,
  transferRunId: TransferRunId,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${COLUMNS} FROM ${TRANSFER_SOURCE_FILE_TABLE} WHERE transfer_run_id = ?1 ORDER BY registered_at, id`,
    )
    .bind(transferRunId);
}

// Record the first complete read. The count is written once: a file's bytes never change, so a
// second read that counted differently would be a fault in the reader, and the WHERE keeps the
// first answer for the caller to compare against.
// fitness:unguarded-write — zero rows means the file was already read or is not held; the caller compares its count with the stored one and reports a difference
export function recordTransferSourceFileReadStatement(
  database: SqlDatabase,
  id: TransferSourceFileId,
  rowCount: number,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${TRANSFER_SOURCE_FILE_TABLE} SET row_count = ?2, read_at = ?3 WHERE id = ?1 AND read_at IS NULL`,
    )
    .bind(id, rowCount, now);
}

// Record that the bytes were released. The row stays: the run's report still names the file, its
// digest still says which bytes those were, and every link written from it still stands.
// fitness:unguarded-write — zero rows means the bytes were already released, which is the state the caller wanted
export function recordTransferSourceFileRemovedStatement(
  database: SqlDatabase,
  id: TransferSourceFileId,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${TRANSFER_SOURCE_FILE_TABLE} SET removed_at = ?2 WHERE id = ?1 AND removed_at IS NULL`,
    )
    .bind(id, now);
}
