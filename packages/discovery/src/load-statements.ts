import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  DiscoveryLoadId,
  RecordCustodianId,
  ReviewSetId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { TranscriptScope } from "./load-source.ts";
import type { DiscoveryLoadLane, DiscoveryLoadState } from "./types.ts";

// Table name tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test.
export const DISCOVERY_LOAD_TABLE = "discovery_load";

export interface DiscoveryLoadRow {
  readonly id: DiscoveryLoadId;
  readonly review_set_id: ReviewSetId;
  readonly lane: DiscoveryLoadLane;
  readonly state: DiscoveryLoadState;
  readonly transcript_scope: TranscriptScope;
  readonly declared_document_count: number;
  readonly loaded_document_count: number;
  readonly processed_count: number;
  readonly exception_count: number;
  readonly default_record_custodian_id: RecordCustodianId | null;
  readonly source_description: string | null;
  readonly initiated_by: UserId;
  readonly initiated_at: string;
  readonly completed_at: string | null;
  readonly manifest_r2_key: string | null;
  readonly exception_report_r2_key: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

const LOAD_COLUMNS =
  "id, review_set_id, lane, state, transcript_scope, declared_document_count, " +
  "loaded_document_count, processed_count, exception_count, default_record_custodian_id, " +
  "source_description, initiated_by, initiated_at, completed_at, manifest_r2_key, " +
  "exception_report_r2_key, created_at, updated_at";

export function selectDiscoveryLoadStatement(
  database: SqlDatabase,
  id: DiscoveryLoadId,
): SqlStatement {
  return database
    .prepare(`SELECT ${LOAD_COLUMNS} FROM ${DISCOVERY_LOAD_TABLE} WHERE id = ?1`)
    .bind(id);
}

export async function readDiscoveryLoad(
  database: SqlDatabase,
  id: DiscoveryLoadId,
): Promise<DiscoveryLoadRow | undefined> {
  const { results } = await selectDiscoveryLoadStatement(database, id).all<DiscoveryLoadRow>();
  return results[0];
}

export function insertDiscoveryLoadStatement(
  database: SqlDatabase,
  row: {
    id: DiscoveryLoadId;
    reviewSetId: ReviewSetId;
    lane: DiscoveryLoadLane;
    transcriptScope: TranscriptScope;
    declaredDocumentCount: number;
    defaultRecordCustodianId: RecordCustodianId | null;
    sourceDescription: string | null;
    initiatedBy: UserId;
    now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${DISCOVERY_LOAD_TABLE} ` +
        `(id, review_set_id, lane, state, transcript_scope, declared_document_count, ` +
        `loaded_document_count, processed_count, exception_count, default_record_custodian_id, ` +
        `source_description, initiated_by, initiated_at, created_at, updated_at) ` +
        `VALUES (?1, ?2, ?3, 'declared', ?4, ?5, 0, 0, 0, ?6, ?7, ?8, ?9, ?9, ?9)`,
    )
    .bind(
      row.id,
      row.reviewSetId,
      row.lane,
      row.transcriptScope,
      row.declaredDocumentCount,
      row.defaultRecordCustodianId,
      row.sourceDescription,
      row.initiatedBy,
      row.now,
    );
}

// Every transition names the state it moves FROM. A statement that named the wrong one would update
// nothing rather than abort — so the WHERE is the optimistic-concurrency guard and the trigger is the
// rule; neither is a substitute for the other.
export function transitionDiscoveryLoadStatement(
  database: SqlDatabase,
  id: DiscoveryLoadId,
  from: DiscoveryLoadState,
  to: DiscoveryLoadState,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${DISCOVERY_LOAD_TABLE} SET state = ?3, updated_at = ?4 WHERE id = ?1 AND state = ?2`,
    )
    .bind(id, from, to, now);
}

// Completion writes the terminal state, the finish time, and the two record artifacts' keys in one
// statement, and the row's reconciliation CHECK is what refuses it while the counts do not add up.
export function completeDiscoveryLoadStatement(
  database: SqlDatabase,
  id: DiscoveryLoadId,
  keys: { manifestR2Key: string; exceptionReportR2Key: string },
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${DISCOVERY_LOAD_TABLE} SET state = 'complete', completed_at = ?2, ` +
        `manifest_r2_key = ?3, exception_report_r2_key = ?4, updated_at = ?2 ` +
        `WHERE id = ?1 AND state = 'processing'`,
    )
    .bind(id, now, keys.manifestR2Key, keys.exceptionReportR2Key);
}

// Relative, so two concurrent chunk commits cannot lose each other's rows. This is the number the
// reconciliation is computed FROM, and it is what actually committed rather than what was declared.
export function advanceLoadedDocumentCountStatement(
  database: SqlDatabase,
  id: DiscoveryLoadId,
  delta: number,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${DISCOVERY_LOAD_TABLE} SET loaded_document_count = loaded_document_count + ?2, ` +
        `updated_at = ?3 WHERE id = ?1`,
    )
    .bind(id, delta, now);
}

export function advanceProcessingCountsStatement(
  database: SqlDatabase,
  id: DiscoveryLoadId,
  deltas: { processed: number; excepted: number },
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${DISCOVERY_LOAD_TABLE} SET processed_count = processed_count + ?2, ` +
        `exception_count = exception_count + ?3, updated_at = ?4 WHERE id = ?1`,
    )
    .bind(id, deltas.processed, deltas.excepted, now);
}

// A review set's loads, newest first. The provenance read: what went into this corpus, when, from
// where, and on whose authority.
export function selectDiscoveryLoadsStatement(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  limit: number,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${LOAD_COLUMNS} FROM ${DISCOVERY_LOAD_TABLE} WHERE review_set_id = ?1 ` +
        `ORDER BY initiated_at DESC, id DESC LIMIT ?2`,
    )
    .bind(reviewSetId, limit);
}

export async function readDiscoveryLoads(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  limit: number,
): Promise<DiscoveryLoadRow[]> {
  const { results } = await selectDiscoveryLoadsStatement(
    database,
    reviewSetId,
    limit,
  ).all<DiscoveryLoadRow>();
  return results;
}
