import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { MatterId } from "@magna-carta/identifiers/types";

// The matter-number counter, one row per {firm, scope_key}. The natural scope key is the primary
// key. The ensure-row + guarded-increment pair (with the allocation primary key below as the
// backstop) is what makes concurrent number draws yield distinct, sequential numbers without an
// interactive transaction: every drawer reads the same next_value, but only one guarded increment
// matches — and only one drawer can land the allocation row for the value they all read.
export const MATTER_NUMBER_COUNTER_TABLE = "matter_number_counter";

// One row per counter value a draw consumed, keyed by {scope_key, drawn_value}.
export const MATTER_NUMBER_ALLOCATION_TABLE = "matter_number_allocation";

// Creates the counter at its start value if absent; a no-op if the row already exists (never
// clobbers a running counter). Composed into the draw batch before the guarded increment.
export function ensureCounterRowStatement(
  database: SqlDatabase,
  scopeKey: string,
  startValue: number,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MATTER_NUMBER_COUNTER_TABLE} (scope_key, next_value) VALUES (?1, ?2) ON CONFLICT (scope_key) DO NOTHING`,
    )
    .bind(scopeKey, startValue);
}

// Advances the counter only if next_value still equals the value the drawer observed. A concurrent
// draw that already advanced it makes this match zero rows (meta.changes === 0) — the loser. A
// zero-row UPDATE is not an error in SQLite, so the loser is caught by the allocation row below,
// which aborts its whole batch for a retry.
export function guardedIncrementStatement(
  database: SqlDatabase,
  scopeKey: string,
  observedValue: number,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MATTER_NUMBER_COUNTER_TABLE} SET next_value = next_value + 1 WHERE scope_key = ?1 AND next_value = ?2`,
    )
    .bind(scopeKey, observedValue);
}

// Claims the counter value this draw consumed. This is the load-bearing backstop on the draw, NOT
// the matter_number UNIQUE index: that index only fires when two draws render the same STRING, and a
// scheme carrying a variable segment that is not marked scoping (a client code, staff initials)
// renders different strings from the same counter value in the same scope. The composite primary key
// {scope_key, drawn_value} fires on the value itself, so the losing draw's whole batch aborts and its
// bounded retry re-reads the advanced counter. Composed AFTER the matter write in the draw batch —
// matter_id is a foreign key, so the matter row has to exist by the time this statement runs.
export function allocateCounterValueStatement(
  database: SqlDatabase,
  scopeKey: string,
  drawnValue: number,
  matterId: MatterId,
  allocatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MATTER_NUMBER_ALLOCATION_TABLE} (scope_key, drawn_value, matter_id, allocated_at) VALUES (?1, ?2, ?3, ?4)`,
    )
    .bind(scopeKey, drawnValue, matterId, allocatedAt);
}

// A losing concurrent draw aborts its batch on the allocation primary key. Mirrors
// isMatterNumberConflict — both are retryable outcomes of the same draw race.
export function isNumberAllocationConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("UNIQUE constraint failed") &&
    error.message.includes(`${MATTER_NUMBER_ALLOCATION_TABLE}.scope_key`)
  );
}

export function selectCounterValueStatement(database: SqlDatabase, scopeKey: string): SqlStatement {
  return database
    .prepare(`SELECT next_value FROM ${MATTER_NUMBER_COUNTER_TABLE} WHERE scope_key = ?1`)
    .bind(scopeKey);
}

// Reads the next value to assign for a scope, or undefined when the counter has never been drawn
// (the caller falls back to the scheme's configured start).
export async function readCounterValue(
  database: SqlDatabase,
  scopeKey: string,
): Promise<number | undefined> {
  const { results } = await selectCounterValueStatement(database, scopeKey).all<{
    next_value: number;
  }>();
  return results[0]?.next_value;
}
