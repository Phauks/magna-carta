import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { CustodyPacketId } from "@magna-carta/identifiers/types";

// The custody-number counter, one row per {firm, scope_key}, and the allocation ledger behind it.
// This is the matters numbering idiom reused rather than re-derived: the same race (concurrent draws
// against a per-firm counter with no interactive transaction available) already has a documented,
// tested solution in packages/matters/src/numbering/counter-statements.ts, and a second mechanism
// for the same problem is a second thing to keep correct.

export const CUSTODY_NUMBER_COUNTER_TABLE = "custody_number_counter";
export const CUSTODY_NUMBER_ALLOCATION_TABLE = "custody_number_allocation";

// Creates the counter at its start value if absent; a no-op if the row already exists (never
// clobbers a running counter). Composed into the draw batch before the guarded increment.
export function ensureCounterRowStatement(
  database: SqlDatabase,
  scopeKey: string,
  startValue: number,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${CUSTODY_NUMBER_COUNTER_TABLE} (scope_key, next_value) VALUES (?1, ?2) ON CONFLICT (scope_key) DO NOTHING`,
    )
    .bind(scopeKey, startValue);
}

// Advances the counter only if next_value still equals the value the drawer observed. A concurrent
// draw that already advanced it makes this match zero rows — the loser. A zero-row UPDATE is not an
// error in SQLite, so the loser is caught by the allocation row below, which aborts its whole batch.
export function guardedIncrementStatement(
  database: SqlDatabase,
  scopeKey: string,
  observedValue: number,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${CUSTODY_NUMBER_COUNTER_TABLE} SET next_value = next_value + 1 WHERE scope_key = ?1 AND next_value = ?2`,
    )
    .bind(scopeKey, observedValue);
}

// Claims the counter value this draw consumed. This composite primary key — NOT the unique index on
// the rendered custody_number string — is the load-bearing backstop: a firm that scopes numbering
// per custody root renders RNO-00042 and LVS-00042 from the same counter value in different scopes,
// so only a claim on the VALUE catches two draws that observed the same counter. Composed AFTER the
// packet write in the draw batch — packet_id is a foreign key, so the packet row has to exist by the
// time this statement runs.
export function allocateCounterValueStatement(
  database: SqlDatabase,
  scopeKey: string,
  drawnValue: number,
  packetId: CustodyPacketId,
  allocatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${CUSTODY_NUMBER_ALLOCATION_TABLE} (scope_key, drawn_value, packet_id, allocated_at) VALUES (?1, ?2, ?3, ?4)`,
    )
    .bind(scopeKey, drawnValue, packetId, allocatedAt);
}

// A losing concurrent draw aborts its batch on the allocation primary key. Its twin is
// isCustodyNumberConflict — both are retryable outcomes of the same draw race.
export function isNumberAllocationConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("UNIQUE constraint failed") &&
    error.message.includes(`${CUSTODY_NUMBER_ALLOCATION_TABLE}.scope_key`)
  );
}

export function selectCounterValueStatement(database: SqlDatabase, scopeKey: string): SqlStatement {
  return database
    .prepare(`SELECT next_value FROM ${CUSTODY_NUMBER_COUNTER_TABLE} WHERE scope_key = ?1`)
    .bind(scopeKey);
}

// Reads the next value to assign for a scope, or undefined when the counter has never been drawn
// (the caller falls back to the configured start).
export async function readCounterValue(
  database: SqlDatabase,
  scopeKey: string,
): Promise<number | undefined> {
  const { results } = await selectCounterValueStatement(database, scopeKey).all<{
    next_value: number;
  }>();
  return results[0]?.next_value;
}
