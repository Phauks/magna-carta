import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";

// The matter-number counter, one row per {firm, scope_key}. The natural scope key is the primary
// key. The ensure-row + guarded-increment pair (decided with the matter_number UNIQUE backstop) is
// what makes concurrent number draws yield distinct, sequential numbers without an interactive
// transaction: every drawer reads the same next_value, but only one guarded increment matches.
export const MATTER_NUMBER_COUNTER_TABLE = "matter_number_counter";

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
// draw that already advanced it makes this match zero rows (meta.changes === 0) — the loser; its
// matter INSERT then hits the matter_number UNIQUE index and the whole batch aborts for a retry.
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
