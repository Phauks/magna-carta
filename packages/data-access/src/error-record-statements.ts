/*
 * The control plane's error record: one row per failure a member was shown, keyed by the Error ID on
 * their screen, so the ID can be looked up after the fact. The table is
 * @magna-carta/database's `error_record`; what may go in each column is stated there.
 */
import type { SqlDatabase, SqlStatement } from "./idempotency-statements.ts";

// Table name tracked against @magna-carta/database's control-plane schema.
export const ERROR_RECORD_TABLE = "error_record";

/** How long a record is kept. The daily pass deletes anything older. */
export const ERROR_RECORD_RETENTION_DAYS = 30;

export type ErrorRecordSource = "server" | "browser";

export interface ErrorRecordInput {
  readonly errorId: string;
  readonly recordedAt: string;
  readonly source: ErrorRecordSource;
  readonly service: string | null;
  readonly operation: string | null;
  readonly status: number | null;
  readonly problemType: string | null;
  readonly title: string | null;
  readonly errorName: string | null;
  readonly messageHead: string | null;
  readonly location: string | null;
  readonly build: string | null;
  readonly firmId: string | null;
  readonly userId: string | null;
  readonly correlationId: string | null;
}

// Read shape: snake_case as stored in D1 (callers map to camelCase at the edge).
export interface ErrorRecordRow {
  readonly id: string;
  readonly recorded_at: string;
  readonly source: string;
  readonly service: string | null;
  readonly operation: string | null;
  readonly status: number | null;
  readonly problem_type: string | null;
  readonly title: string | null;
  readonly error_name: string | null;
  readonly message_head: string | null;
  readonly location: string | null;
  readonly build: string | null;
  readonly firm_id: string | null;
  readonly user_id: string | null;
  readonly correlation_id: string | null;
}

const COLUMNS =
  "id, recorded_at, source, service, operation, status, problem_type, title, error_name, " +
  "message_head, location, build, firm_id, user_id, correlation_id";

// A second write of one Error ID is a no-op: the first record of a failure is the one that stands,
// and a browser re-sending a crash it already sent must not overwrite it.
export function insertErrorRecordStatement(
  database: SqlDatabase,
  values: ErrorRecordInput,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${ERROR_RECORD_TABLE} (${COLUMNS}) ` +
        `VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15) ` +
        `ON CONFLICT DO NOTHING`,
    )
    .bind(
      values.errorId,
      values.recordedAt,
      values.source,
      values.service,
      values.operation,
      values.status,
      values.problemType,
      values.title,
      values.errorName,
      values.messageHead,
      values.location,
      values.build,
      values.firmId,
      values.userId,
      values.correlationId,
    );
}

export function selectErrorRecordStatement(database: SqlDatabase, errorId: string): SqlStatement {
  return database
    .prepare(`SELECT ${COLUMNS} FROM ${ERROR_RECORD_TABLE} WHERE id = ?1 LIMIT 1`)
    .bind(errorId);
}

// Read shape of one group: every record of one kind of failure since a moment.
export interface ErrorRecordGroupRow {
  readonly source: string;
  readonly service: string | null;
  readonly operation: string | null;
  readonly status: number | null;
  readonly error_name: string | null;
  readonly title: string | null;
  readonly message_head: string | null;
  readonly latest_error_id: string;
  readonly count: number;
  readonly first_seen: string;
  readonly last_seen: string;
}

/*
 * One row per kind of failure since `sinceIso`, newest first. A kind is the source, the Worker, the
 * place and the status and error name — the same fold the Workers Logs reader makes. The newest
 * record in each group supplies its Error ID, title and message head, through SQLite's documented
 * bare-column rule: with a single MAX() aggregate, the other bare columns come from the row that
 * held the maximum. COUNT() is not a min/max aggregate, so it does not disturb that rule; the first
 * sighting is a correlated MIN() for exactly that reason, since a second min/max would.
 */
export function selectErrorRecordGroupsStatement(
  database: SqlDatabase,
  sinceIso: string,
  limit: number,
): SqlStatement {
  return database
    .prepare(
      `SELECT source, service, operation, status, error_name, title, message_head, ` +
        `id AS latest_error_id, MAX(recorded_at) AS last_seen, COUNT(*) AS count, ` +
        `(SELECT MIN(recorded_at) FROM ${ERROR_RECORD_TABLE} inner_record WHERE ` +
        `inner_record.recorded_at >= ?1 AND inner_record.source = outer_record.source AND ` +
        `inner_record.service IS outer_record.service AND ` +
        `inner_record.operation IS outer_record.operation AND ` +
        `inner_record.status IS outer_record.status AND ` +
        `inner_record.error_name IS outer_record.error_name) AS first_seen ` +
        `FROM ${ERROR_RECORD_TABLE} outer_record WHERE recorded_at >= ?1 ` +
        `GROUP BY source, service, operation, status, error_name ` +
        `ORDER BY last_seen DESC LIMIT ?2`,
    )
    .bind(sinceIso, limit);
}

/** Delete records recorded before `beforeIso`. */
export function deleteErrorRecordsBeforeStatement(
  database: SqlDatabase,
  beforeIso: string,
): SqlStatement {
  return database
    .prepare(`DELETE FROM ${ERROR_RECORD_TABLE} WHERE recorded_at < ?1`)
    .bind(beforeIso);
}
