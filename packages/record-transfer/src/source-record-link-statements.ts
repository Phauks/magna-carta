import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { TransferRunId } from "@magna-carta/identifiers/types";
import {
  assertLinkableLocalTable,
  assertSourceRecordKey,
  assertSourceSystem,
  type LinkableLocalTable,
  type SourceRecordKey,
} from "./source-record.ts";

// Table name tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test.
export const SOURCE_RECORD_LINK_TABLE = "source_record_link";

export interface SourceRecordLinkRow {
  readonly source_system: string;
  readonly source_kind: string;
  readonly source_id: string;
  readonly local_table: LinkableLocalTable;
  readonly local_id: string;
  readonly transfer_run_id: TransferRunId;
  readonly created_at: string;
}

export interface NewSourceRecordLink {
  readonly source: SourceRecordKey;
  readonly localTable: string;
  readonly localId: string;
  readonly transferRunId: TransferRunId;
}

// A plain INSERT, deliberately without ON CONFLICT. A transfer reads the link first and creates a
// record only when there is none, so a conflict here means two writers raced or a mapper skipped the
// read. Either is a fault to surface, and swallowing it would leave the second record created and
// unlinked, which is the duplicate the link exists to prevent.
export function insertSourceRecordLinkStatement(
  database: SqlDatabase,
  link: NewSourceRecordLink,
  now: string,
): SqlStatement {
  const source = assertSourceRecordKey(link.source);
  return database
    .prepare(
      `INSERT INTO ${SOURCE_RECORD_LINK_TABLE} (source_system, source_kind, source_id, local_table, local_id, transfer_run_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
    .bind(
      source.sourceSystem,
      source.sourceKind,
      source.sourceId,
      assertLinkableLocalTable(link.localTable),
      link.localId,
      link.transferRunId,
      now,
    );
}

// Every record here that one source record became. Usually one row; more when a source record
// produced records of several kinds.
export function selectLinksForSourceRecordStatement(
  database: SqlDatabase,
  source: SourceRecordKey,
): SqlStatement {
  const key = assertSourceRecordKey(source);
  return database
    .prepare(
      `SELECT source_system, source_kind, source_id, local_table, local_id, transfer_run_id, created_at FROM ${SOURCE_RECORD_LINK_TABLE} WHERE source_system = ?1 AND source_kind = ?2 AND source_id = ?3 ORDER BY local_table`,
    )
    .bind(key.sourceSystem, key.sourceKind, key.sourceId);
}

// The one record of a given kind that a source record became, or no row. This is the read a
// transfer makes before it writes: a row means update that record, no row means create one.
export function selectLinkedLocalRecordStatement(
  database: SqlDatabase,
  source: SourceRecordKey,
  localTable: string,
): SqlStatement {
  const key = assertSourceRecordKey(source);
  return database
    .prepare(
      `SELECT local_id, transfer_run_id, created_at FROM ${SOURCE_RECORD_LINK_TABLE} WHERE source_system = ?1 AND source_kind = ?2 AND source_id = ?3 AND local_table = ?4`,
    )
    .bind(key.sourceSystem, key.sourceKind, key.sourceId, assertLinkableLocalTable(localTable));
}

// Where a record here came from. More than one row when several source records were combined into
// it, which is how two cards for the same person arrive.
export function selectSourcesOfLocalRecordStatement(
  database: SqlDatabase,
  localTable: string,
  localId: string,
): SqlStatement {
  return database
    .prepare(
      `SELECT source_system, source_kind, source_id, local_table, local_id, transfer_run_id, created_at FROM ${SOURCE_RECORD_LINK_TABLE} WHERE local_table = ?1 AND local_id = ?2 ORDER BY source_system, source_kind, source_id`,
    )
    .bind(assertLinkableLocalTable(localTable), localId);
}

// How many records of each kind a run linked: the "counts out" half of a run's report.
export function countLinksByTransferRunStatement(
  database: SqlDatabase,
  transferRunId: TransferRunId,
): SqlStatement {
  return database
    .prepare(
      `SELECT source_kind, local_table, COUNT(*) AS link_count FROM ${SOURCE_RECORD_LINK_TABLE} WHERE transfer_run_id = ?1 GROUP BY source_kind, local_table ORDER BY source_kind, local_table`,
    )
    .bind(transferRunId);
}

// How many source records of one system are linked at all, by kind: what a rehearsal compares with
// the source system's own counts.
export function countLinksBySourceSystemStatement(
  database: SqlDatabase,
  sourceSystem: string,
): SqlStatement {
  return database
    .prepare(
      `SELECT source_kind, COUNT(DISTINCT source_id) AS source_record_count FROM ${SOURCE_RECORD_LINK_TABLE} WHERE source_system = ?1 GROUP BY source_kind ORDER BY source_kind`,
    )
    .bind(assertSourceSystem(sourceSystem));
}
