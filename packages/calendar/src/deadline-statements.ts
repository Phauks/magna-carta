import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  MatterDeadlineId,
  MatterEventId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { OverdueCutoff } from "./overdue.ts";
import type { MatterDeadlineSource, MatterDeadlineState } from "./types.ts";
import type { VisibleMatterPredicate } from "./visibility.ts";

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

// The precondition fence for an edit. `updateMatterDeadline` reads the row, refuses a non-open
// state, and then writes — and between those two there is no transaction to hold the state still. A
// guarded UPDATE alone would silently match zero rows and report success, so the fence goes FIRST in
// the batch and re-asserts the state against the row as the batch actually sees it: it re-inserts the
// row's own primary key when the state is no longer open, which collides and aborts the whole batch
// (the audit row included). The same shape `assertCustodyPacketStatusStatement` uses in
// packages/custodian/src/packet-statements.ts, for the same reason.
export function assertMatterDeadlineOpenStatement(
  database: SqlDatabase,
  id: MatterDeadlineId,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MATTER_DEADLINE_TABLE} (${DEADLINE_COLUMNS}) ` +
        `SELECT ${DEADLINE_COLUMNS} FROM ${MATTER_DEADLINE_TABLE} WHERE id = ?1 AND state <> 'open'`,
    )
    .bind(id);
}

// Guarded on the state the caller observed, exactly as satisfy and close below are. D1 has no
// interactive transaction, so the state check rides the write itself: a paralegal moving the due date
// and an attorney marking the deadline satisfied both read `state = 'open'`, and whichever commits
// second must lose. Unguarded, the edit would rewrite the due date, the zone, and the authority note
// on a deadline the firm has already recorded as discharged — which is precisely what the service's
// own refusal ("a settled deadline is superseded by a new one rather than edited") says cannot happen.
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
        `authority_text = ?6, trigger_event_id = ?7, priority = ?8, updated_at = ?9 ` +
        `WHERE id = ?1 AND state = 'open'`,
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

// The single-deadline read, and it takes the visible-matter predicate for the same reason the
// single-event read does: resolving a row by its own identifier is the shape that reads past the
// matter that owns it. A deadline on an invisible matter is a 404, not a row.
export function selectMatterDeadlineStatement(
  database: SqlDatabase,
  id: MatterDeadlineId,
  visibility: VisibleMatterPredicate,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${DEADLINE_COLUMNS} FROM ${MATTER_DEADLINE_TABLE} WHERE id = ? AND ` +
        visibility.fragmentFor(`${MATTER_DEADLINE_TABLE}.matter_id`),
    )
    .bind(id, ...visibility.bindings);
}

export async function readMatterDeadline(
  database: SqlDatabase,
  id: MatterDeadlineId,
  visibility: VisibleMatterPredicate,
): Promise<MatterDeadlineRow | undefined> {
  const { results } = await selectMatterDeadlineStatement(
    database,
    id,
    visibility,
  ).all<MatterDeadlineRow>();
  return results[0];
}

// The zones a bounded set of open deadlines is recorded in — the input to the overdue narrowing
// below, which needs one cutoff per zone and cannot get one from SQLite (there is no zone database
// behind a D1 query). Read over the same coarse date bound the narrowing then refines, so the answer
// is exactly the zones that could possibly appear on the page, and carrying the visible-matter
// predicate so an invisible matter's zone is not even learned.
export function selectOpenDeadlineTimeZonesStatement(
  database: SqlDatabase,
  options: {
    readonly throughDate: string;
    readonly limit: number;
    readonly visibilityFragment: string;
    readonly visibilityBindings: readonly unknown[];
  },
): SqlStatement {
  return database
    .prepare(
      `SELECT DISTINCT time_zone FROM ${MATTER_DEADLINE_TABLE} ` +
        `WHERE matter_deadline.state = 'open' AND matter_deadline.due_on <= ? AND ` +
        `${options.visibilityFragment} LIMIT ?`,
    )
    .bind(options.throughDate, ...options.visibilityBindings, options.limit);
}

export async function readOpenDeadlineTimeZones(
  database: SqlDatabase,
  options: {
    readonly throughDate: string;
    readonly limit: number;
    readonly visibilityFragment: string;
    readonly visibilityBindings: readonly unknown[];
  },
): Promise<string[]> {
  const { results } = await selectOpenDeadlineTimeZonesStatement(database, options).all<{
    time_zone: string;
  }>();
  return results.map((row) => row.time_zone);
}

// The open deadlines whose trigger names one event — what the continuance operation reports so the
// person holding the order can see what referenced the vacated setting. A LOOKUP, not a cascade:
// nothing here moves a date, and nothing anywhere derives one from the new setting; what a
// continuance does to a stipulated briefing schedule is a legal judgement the person makes. Carries
// the visible-matter predicate like every read of this table.
export function selectOpenDeadlinesByTriggerEventStatement(
  database: SqlDatabase,
  triggerEventId: MatterEventId,
  options: {
    readonly limit: number;
    readonly visibilityFragment: string;
    readonly visibilityBindings: readonly unknown[];
  },
): SqlStatement {
  return database
    .prepare(
      `SELECT ${DEADLINE_COLUMNS} FROM ${MATTER_DEADLINE_TABLE} ` +
        `WHERE matter_deadline.trigger_event_id = ? AND matter_deadline.state = 'open' AND ` +
        `${options.visibilityFragment} ORDER BY due_on ASC, id ASC LIMIT ?`,
    )
    .bind(triggerEventId, ...options.visibilityBindings, options.limit);
}

export async function readOpenDeadlinesByTriggerEvent(
  database: SqlDatabase,
  triggerEventId: MatterEventId,
  options: {
    readonly limit: number;
    readonly visibilityFragment: string;
    readonly visibilityBindings: readonly unknown[];
  },
): Promise<MatterDeadlineRow[]> {
  const { results } = await selectOpenDeadlinesByTriggerEventStatement(
    database,
    triggerEventId,
    options,
  ).all<MatterDeadlineRow>();
  return results;
}

// The overdue narrowing, composed per zone.
//
// One clause per zone the page could contain, each comparing the row's own two columns against the
// latest already-past civil date-and-time in that zone (computed by `overdueCutoffFor` in
// overdue.ts). The result is the exact predicate `isOverdue` applies row by row, expressed in SQL —
// not the `due_on <= <UTC today>` approximation, which reports a Nevada firm's live same-day
// deadlines as already missed for most of the working day, and not a post-filter over the returned
// rows, which would under-fill the page and make the cursor mean something different page to page.
function overdueConditionFor(cutoffs: readonly OverdueCutoff[], bindings: unknown[]): string {
  // No zone, nothing to match. Said explicitly, because an empty OR list would otherwise compose to
  // an empty parenthesis and a syntax error.
  if (cutoffs.length === 0) return "1 = 0";
  // A coarse `due_on` ceiling ahead of the per-zone alternation. It is a strict SUPERSET of every
  // clause below — no zone's cutoff date exceeds it — so it changes no answer, and it gives the
  // planner one indexable range predicate instead of an OR-list it would have to scan. The exact
  // narrowing then happens inside.
  let ceiling = cutoffs[0]?.currentCivilDate ?? "";
  for (const cutoff of cutoffs) {
    if (cutoff.currentCivilDate > ceiling) ceiling = cutoff.currentCivilDate;
    if (cutoff.timedCivilDate > ceiling) ceiling = cutoff.timedCivilDate;
  }
  bindings.push(ceiling);
  const clauses = cutoffs.map((cutoff) => {
    bindings.push(
      cutoff.timeZone,
      cutoff.currentCivilDate,
      cutoff.timedCivilDate,
      cutoff.timedCivilDate,
      cutoff.timedWallClockTime,
    );
    return (
      "(matter_deadline.time_zone = ? AND (" +
      // No recorded time: due at the END of its day, so overdue once the zone has moved past it.
      "(matter_deadline.due_at_time IS NULL AND matter_deadline.due_on < ?) OR " +
      // A recorded time: overdue once its own (date, time) is at or below the latest already-past
      // wall clock in that zone.
      "(matter_deadline.due_at_time IS NOT NULL AND (matter_deadline.due_on < ? OR " +
      "(matter_deadline.due_on = ? AND matter_deadline.due_at_time <= ?)))))"
    );
  });
  return `matter_deadline.due_on <= ? AND (${clauses.join(" OR ")})`;
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
    // When present, narrows to the deadlines that are genuinely overdue in their own zones. Implies
    // `state = 'open'`, since only an open deadline can be.
    readonly overdueCutoffs?: readonly OverdueCutoff[];
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
  if (options.overdueCutoffs !== undefined) {
    conditions.push("matter_deadline.state = 'open'");
    conditions.push(overdueConditionFor(options.overdueCutoffs, bindings));
  } else if (options.state !== undefined) {
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
