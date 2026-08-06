import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  MatterDeadlineId,
  MatterEventId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { MatterDeadlineSource, MatterDeadlineState } from "./types.ts";

// Table name tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test.
export const MATTER_DEADLINE_TABLE = "matter_deadline";

export interface MatterDeadlineRow {
  readonly id: MatterDeadlineId;
  readonly matter_id: MatterId;
  readonly title: string;
  readonly due_on: string;
  readonly due_at_time: string | null;
  readonly time_zone: string;
  readonly source: MatterDeadlineSource;
  readonly catalog_entry_key: string | null;
  readonly catalog_version: string | null;
  readonly authority_text: string | null;
  readonly trigger_event_id: MatterEventId | null;
  readonly state: MatterDeadlineState;
  readonly satisfied_at: string | null;
  readonly satisfied_by: UserId | null;
  readonly satisfying_event_id: MatterEventId | null;
  readonly satisfaction_note: string | null;
  readonly state_reason: string | null;
  readonly superseded_by_deadline_id: MatterDeadlineId | null;
  readonly priority: number | null;
  readonly recorded_at: string;
  readonly recorded_by: UserId | null;
  readonly created_at: string;
  readonly updated_at: string;
}

const DEADLINE_COLUMNS =
  "id, matter_id, title, due_on, due_at_time, time_zone, source, catalog_entry_key, catalog_version, " +
  "authority_text, trigger_event_id, state, satisfied_at, satisfied_by, satisfying_event_id, " +
  "satisfaction_note, state_reason, superseded_by_deadline_id, priority, recorded_at, recorded_by, " +
  "created_at, updated_at";

export interface InsertMatterDeadlineInput {
  readonly id: MatterDeadlineId;
  readonly matterId: MatterId;
  readonly title: string;
  readonly dueOn: string;
  readonly dueAtTime: string | null;
  readonly timeZone: string;
  readonly source: MatterDeadlineSource;
  readonly authorityText: string | null;
  readonly triggerEventId: MatterEventId | null;
  readonly priority: number | null;
  readonly recordedAt: string;
  readonly recordedBy: UserId | null;
  readonly now: string;
}

// The catalog columns are written NULL on every path there is. No caller can supply them: a verified
// jurisdiction-keyed catalog is what would fill them, through a propose-and-confirm path where a
// member accepts a proposed date and that acceptance creates the row. Until one exists, a deadline
// claiming a catalog authority would be claiming an authority nobody verified.
export function insertMatterDeadlineStatement(
  database: SqlDatabase,
  input: InsertMatterDeadlineInput,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MATTER_DEADLINE_TABLE} (id, matter_id, title, due_on, due_at_time, time_zone, source, ` +
        `catalog_entry_key, catalog_version, authority_text, trigger_event_id, state, priority, recorded_at, ` +
        `recorded_by, created_at, updated_at) ` +
        `VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, NULL, ?8, ?9, 'open', ?10, ?11, ?12, ?13, ?13)`,
    )
    .bind(
      input.id,
      input.matterId,
      input.title,
      input.dueOn,
      input.dueAtTime,
      input.timeZone,
      input.source,
      input.authorityText,
      input.triggerEventId,
      input.priority,
      input.recordedAt,
      input.recordedBy,
      input.now,
    );
}

export function updateMatterDeadlineStatement(
  database: SqlDatabase,
  id: MatterDeadlineId,
  patch: {
    readonly title: string;
    readonly dueOn: string;
    readonly dueAtTime: string | null;
    readonly timeZone: string;
    readonly authorityText: string | null;
    readonly triggerEventId: MatterEventId | null;
    readonly priority: number | null;
  },
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MATTER_DEADLINE_TABLE} SET title = ?2, due_on = ?3, due_at_time = ?4, time_zone = ?5, ` +
        `authority_text = ?6, trigger_event_id = ?7, priority = ?8, updated_at = ?9 WHERE id = ?1`,
    )
    .bind(
      id,
      patch.title,
      patch.dueOn,
      patch.dueAtTime,
      patch.timeZone,
      patch.authorityText,
      patch.triggerEventId,
      patch.priority,
      updatedAt,
    );
}

// Guarded on the state the caller observed: D1 has no interactive transaction, so the state check
// rides the write itself. A second satisfy against an already-satisfied deadline matches no row and
// the service refuses it before composing anything.
export function satisfyMatterDeadlineStatement(
  database: SqlDatabase,
  id: MatterDeadlineId,
  input: {
    readonly satisfiedAt: string;
    readonly satisfiedBy: UserId;
    readonly satisfyingEventId: MatterEventId | null;
    readonly satisfactionNote: string | null;
  },
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MATTER_DEADLINE_TABLE} SET state = 'satisfied', satisfied_at = ?2, satisfied_by = ?3, ` +
        `satisfying_event_id = ?4, satisfaction_note = ?5, updated_at = ?6 WHERE id = ?1 AND state = 'open'`,
    )
    .bind(
      id,
      input.satisfiedAt,
      input.satisfiedBy,
      input.satisfyingEventId,
      input.satisfactionNote,
      updatedAt,
    );
}

// A vacated or superseded deadline keeps its row and carries WHY. "Why is this deadline no longer in
// force" is the question a person asks six months later, and the only bad answer is silence — which
// is what deleting the row would leave.
export function closeMatterDeadlineStatement(
  database: SqlDatabase,
  id: MatterDeadlineId,
  input: {
    readonly state: "vacated" | "superseded";
    readonly stateReason: string;
    readonly supersededByDeadlineId: MatterDeadlineId | null;
  },
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MATTER_DEADLINE_TABLE} SET state = ?2, state_reason = ?3, superseded_by_deadline_id = ?4, ` +
        `updated_at = ?5 WHERE id = ?1 AND state = 'open'`,
    )
    .bind(id, input.state, input.stateReason, input.supersededByDeadlineId, updatedAt);
}

export function selectMatterDeadlineStatement(
  database: SqlDatabase,
  id: MatterDeadlineId,
): SqlStatement {
  return database
    .prepare(`SELECT ${DEADLINE_COLUMNS} FROM ${MATTER_DEADLINE_TABLE} WHERE id = ?1`)
    .bind(id);
}

export async function readMatterDeadline(
  database: SqlDatabase,
  id: MatterDeadlineId,
): Promise<MatterDeadlineRow | undefined> {
  const { results } = await selectMatterDeadlineStatement(database, id).all<MatterDeadlineRow>();
  return results[0];
}

// The upcoming-deadline read: ASCENDING by due date, because a page of the FIRST fifty deadlines is
// the answer and the last fifty is not. Filtered before it is sorted, and horizon-capped by the
// caller — every condition is composed into the SQL, including the visible-matter predicate.
export function selectMatterDeadlinesStatement(
  database: SqlDatabase,
  options: {
    readonly matterId?: MatterId;
    readonly state?: MatterDeadlineState;
    readonly fromDate?: string;
    readonly throughDate?: string;
    readonly cursor?: { sortKey: string; id: string };
    readonly limit: number;
    readonly visibilityFragment: string;
    readonly visibilityBindings: readonly unknown[];
  },
): SqlStatement {
  const conditions: string[] = [];
  const bindings: unknown[] = [];
  if (options.matterId !== undefined) {
    conditions.push("matter_deadline.matter_id = ?");
    bindings.push(options.matterId);
  }
  if (options.state !== undefined) {
    conditions.push("matter_deadline.state = ?");
    bindings.push(options.state);
  }
  if (options.fromDate !== undefined) {
    conditions.push("matter_deadline.due_on >= ?");
    bindings.push(options.fromDate);
  }
  if (options.throughDate !== undefined) {
    conditions.push("matter_deadline.due_on <= ?");
    bindings.push(options.throughDate);
  }
  if (options.cursor !== undefined) {
    conditions.push(
      "(matter_deadline.due_on > ? OR (matter_deadline.due_on = ? AND matter_deadline.id > ?))",
    );
    bindings.push(options.cursor.sortKey, options.cursor.sortKey, options.cursor.id);
  }
  conditions.push(options.visibilityFragment);
  bindings.push(...options.visibilityBindings);
  bindings.push(options.limit);
  return database
    .prepare(
      `SELECT ${DEADLINE_COLUMNS} FROM ${MATTER_DEADLINE_TABLE} WHERE ${conditions.join(" AND ")} ` +
        `ORDER BY matter_deadline.due_on ASC, matter_deadline.id ASC LIMIT ?`,
    )
    .bind(...bindings);
}
