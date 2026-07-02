import type { IdempotencyRecordId } from "@magna-carta/identifiers/types";

// The minimal SQL surface the statement builders need — satisfied by D1Database AND by
// D1DatabaseSession (so read-replication bookmarks can be threaded through later without API change).
export interface SqlDatabase {
  prepare(sql: string): SqlStatement;
}

export interface SqlStatement {
  readonly sql?: string;
  bind(...values: unknown[]): SqlStatement;
  // meta.changes is the affected-row count (D1Result.meta.changes) — guarded updates branch on it.
  run(): Promise<{ meta: { changes: number } }>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  // Returns the first row object, or null when no rows match. The colName scalar form that
  // D1PreparedStatement.first(colName) supports is intentionally excluded: no implementation
  // in this codebase handles it, so including it would silently return a wrong shape in tests
  // vs. production. D1 remains assignable to this narrower interface.
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

// Table name tracked against @magna-carta/database's schema by the schema-name-sync fitness test.
export const IDEMPOTENCY_TABLE = "idempotency_key";

export function selectIdempotencyRecordStatement(database: SqlDatabase, key: string): SqlStatement {
  return database
    .prepare(
      `SELECT key, fingerprint, status, response_code, response_body FROM ${IDEMPOTENCY_TABLE} WHERE key = ?1`,
    )
    .bind(key);
}

// The batch path writes the record directly as completed, WITH the captured response, in the same
// batch as the effect: record and effect commit or roll back together.
// response_body must already be redacted — never store privileged content.
export interface CompletedIdempotencyRecord {
  readonly id: IdempotencyRecordId;
  readonly key: string;
  readonly fingerprint: string;
  readonly responseCode: number;
  readonly responseBody: string | null;
  readonly createdAt: string;
}

export function insertCompletedIdempotencyRecordStatement(
  database: SqlDatabase,
  record: CompletedIdempotencyRecord,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${IDEMPOTENCY_TABLE} (id, key, fingerprint, status, response_code, response_body, created_at) VALUES (?1, ?2, ?3, 'completed', ?4, ?5, ?6)`,
    )
    .bind(
      record.id,
      record.key,
      record.fingerprint,
      record.responseCode,
      record.responseBody,
      record.createdAt,
    );
}

// A minimal completed-record insert for same-batch dedup guards that do not carry an HTTP response
// (e.g. queue-consumer idempotency records). Uses the key as the id, because the key is already the
// stable unique anchor and no separate identifier is meaningful for a non-HTTP effect.
// The fingerprint is caller-supplied; the status is always 'completed' — a dedup record that commits
// in the same batch as its effect is complete by construction.
export function idempotencyRecordInsertStatement(
  database: SqlDatabase,
  record: { key: string; fingerprint: string; now: string },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${IDEMPOTENCY_TABLE} (id, key, fingerprint, status, response_code, response_body, created_at) VALUES (?1, ?2, ?3, 'completed', NULL, NULL, ?4)`,
    )
    .bind(record.key, record.key, record.fingerprint, record.now);
}

// TTL purge: the record is ephemeral dedup state, not the record of truth. The schedule
// (Cron) lives with apps/worker; the cutoff is an ISO-8601 instant.
export function purgeExpiredIdempotencyRecordsStatement(
  database: SqlDatabase,
  olderThan: string,
): SqlStatement {
  return database.prepare(`DELETE FROM ${IDEMPOTENCY_TABLE} WHERE created_at < ?1`).bind(olderThan);
}

// The UNIQUE(key) violation IS the concurrency signal (the losing duplicate's whole batch rolls
// back). D1 surfaces SQLite's message text; detection is centralized here so a wire-format change
// is a one-line fix.
export function isIdempotencyKeyConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("UNIQUE constraint failed") &&
    error.message.includes(`${IDEMPOTENCY_TABLE}.key`)
  );
}
