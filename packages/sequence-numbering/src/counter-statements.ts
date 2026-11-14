import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";

// A sequential, gapless number drawn under concurrency without an interactive transaction. Two
// tables per sequence: a counter row per {firm, scope_key} whose next_value every drawer reads, and
// an allocation row per value a draw consumed, keyed by {scope_key, drawn_value}.
//
// The subtlety this package exists to hold in one place: the guarded increment is NOT the guard. A
// zero-row UPDATE is not an error in SQLite, so a drawer that loses the race commits happily having
// changed nothing, and two drawers walk away believing they hold the same value. The load-bearing
// mechanism is the ALLOCATION primary key — the loser's whole batch aborts on the value itself, and
// the bounded retry (bounded-retry.ts) re-reads the advanced counter. A caller's own uniqueness
// index on the RENDERED number cannot substitute: a scheme carrying a variable segment that is not
// marked scoping renders different strings from the same counter value in one scope.
//
// Consumers differ only in their table names and the column naming the row a draw belongs to, so
// that is exactly what SequenceNumberingTables parameterizes.
export interface SequenceNumberingTables {
  readonly counterTable: string;
  readonly allocationTable: string;
  // The allocation column carrying the handle of the row this draw numbered (a matter, an invoice).
  // A foreign key, which is why the allocation statement is composed AFTER the row's own write.
  readonly ownerColumn: string;
  // Set for a run that writes no allocation row because its rendered number carries its whole scope
  // (the call and text log): the column on `allocationTable` holding that rendered number, which is
  // then how a held value is checked for having been taken already.
  readonly renderedNumberColumn?: string;
}

// Creates the counter at its start value if absent; a no-op if the row already exists (never
// clobbers a running counter). Composed into the draw batch before the guarded increment.
export function ensureCounterRowStatement(
  database: SqlDatabase,
  tables: SequenceNumberingTables,
  scopeKey: string,
  startValue: number,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${tables.counterTable} (scope_key, next_value) VALUES (?1, ?2) ON CONFLICT (scope_key) DO NOTHING`,
    )
    .bind(scopeKey, startValue);
}

// Advances the counter only if next_value still equals the value the drawer observed. A concurrent
// draw that already advanced it makes this match zero rows (meta.changes === 0) — the loser. A
// zero-row UPDATE is not an error in SQLite, so the loser is caught by the allocation row below,
// which aborts its whole batch for a retry.
// fitness:unguarded-write — a repeat is meant to be a no-op — zero rows means the state it moves to was already reached
export function guardedIncrementStatement(
  database: SqlDatabase,
  tables: SequenceNumberingTables,
  scopeKey: string,
  observedValue: number,
): SqlStatement {
  return guardedAdvanceStatement(database, tables, scopeKey, observedValue, 1);
}

// The same guarded advance, by a BLOCK of values rather than one. A capture batch may take several
// records on one scope in a single request (the weekly time grid is the worked case), and the whole
// point of planning a block is that it reads the counter once and consumes `by` consecutive values;
// advancing one at a time would give the batch's own rows different counters to race for.
// fitness:unguarded-write — a repeat is meant to be a no-op — zero rows means the state it moves to was already reached
export function guardedAdvanceStatement(
  database: SqlDatabase,
  tables: SequenceNumberingTables,
  scopeKey: string,
  observedValue: number,
  by: number,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${tables.counterTable} SET next_value = next_value + ?3 WHERE scope_key = ?1 AND next_value = ?2`,
    )
    .bind(scopeKey, observedValue, by);
}

// Claims the counter value this draw consumed. Composed AFTER the owning row's write in the draw
// batch — the owner column is a foreign key, so that row has to exist by the time this runs.
export function allocateCounterValueStatement(
  database: SqlDatabase,
  tables: SequenceNumberingTables,
  scopeKey: string,
  drawnValue: number,
  ownerId: string,
  allocatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${tables.allocationTable} (scope_key, drawn_value, ${tables.ownerColumn}, allocated_at) VALUES (?1, ?2, ?3, ?4)`,
    )
    .bind(scopeKey, drawnValue, ownerId, allocatedAt);
}

// A losing concurrent draw aborts its batch on the allocation primary key. Matched by table name so
// two sequences running in one batch stay distinguishable, and so a uniqueness failure from any
// other table is never mistaken for a retryable draw race.
//
// TWO SHAPES, ONE EVENT. A consumer whose allocation table also carries the append-only
// no-overwrite trigger (a BEFORE INSERT guard that aborts when the key already exists, because
// INSERT OR REPLACE would otherwise delete-then-reinsert without firing the UPDATE/DELETE triggers)
// sees that trigger fire FIRST on a duplicate key, so the loser reads as an append-only refusal
// rather than a UNIQUE constraint. It is the same event — this value is already drawn — and it is
// retried the same way.
export function isNumberAllocationConflict(
  error: unknown,
  tables: SequenceNumberingTables,
): boolean {
  if (!(error instanceof Error)) return false;
  if (
    error.message.includes("UNIQUE constraint failed") &&
    error.message.includes(`${tables.allocationTable}.scope_key`)
  ) {
    return true;
  }
  return error.message.includes(`${tables.allocationTable} is append-only`);
}

export function selectCounterValueStatement(
  database: SqlDatabase,
  tables: SequenceNumberingTables,
  scopeKey: string,
): SqlStatement {
  return database
    .prepare(`SELECT next_value FROM ${tables.counterTable} WHERE scope_key = ?1`)
    .bind(scopeKey);
}

// Reads the next value to assign for a scope, or undefined when the counter has never been drawn
// (the caller falls back to its configured start).
export async function readCounterValue(
  database: SqlDatabase,
  tables: SequenceNumberingTables,
  scopeKey: string,
): Promise<number | undefined> {
  const { results } = await selectCounterValueStatement(database, tables, scopeKey).all<{
    next_value: number;
  }>();
  return results[0]?.next_value;
}
