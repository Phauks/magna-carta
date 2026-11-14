import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { SequenceNumberingTables } from "./counter-statements.ts";
import type { SchemeNumberingPurpose } from "./purposes.ts";

// The reads and writes over `number_reservation`, the one table every sequence holds its draft
// numbers in. Kept apart from ./reservation.ts (the hold's lifecycle) so the draw planner in
// ./scheme-draw.ts can read a hold without importing the service that writes one.
//
// WHAT A ROW MEANS. A value the counter has already moved past, kept out of every other draw. With a
// token it is HELD by one open panel until `expires_at`; with no token it was GIVEN BACK, and an
// expired hold reads the same. Either way the next record in that scope takes the lowest such value
// before the counter moves again, which is the whole of how a cancelled panel leaves no gap.

export const NUMBER_RESERVATION_TABLE = "number_reservation";

/** A row as the planner and the service read it. */
export interface NumberReservationRow {
  readonly purpose: string;
  readonly scope_key: string;
  readonly drawn_value: number;
  readonly token: string | null;
  readonly holder_user_id: string | null;
  readonly expires_at: string | null;
}

export async function readReservationByToken(
  database: SqlDatabase,
  token: string,
): Promise<NumberReservationRow | undefined> {
  const { results } = await database
    .prepare(
      `SELECT purpose, scope_key, drawn_value, token, holder_user_id, expires_at FROM ${NUMBER_RESERVATION_TABLE} WHERE token = ?1`,
    )
    .bind(token)
    .all<NumberReservationRow>();
  return results[0];
}

// The values in one scope that nobody holds any more, lowest first: given back, or held past their
// lapse. `now` decides the second; without it only given-back values count, which keeps a caller
// that has no clock from taking a value somebody is still looking at.
export async function readReclaimableValues(
  database: SqlDatabase,
  purpose: SchemeNumberingPurpose,
  scopeKey: string,
  now: string | undefined,
  limit: number,
): Promise<number[]> {
  const { results } = await database
    .prepare(
      `SELECT drawn_value FROM ${NUMBER_RESERVATION_TABLE} WHERE purpose = ?1 AND scope_key = ?2 AND (token IS NULL OR expires_at < ?3) ORDER BY drawn_value LIMIT ?4`,
    )
    .bind(purpose, scopeKey, now ?? "", limit)
    .all<{ drawn_value: number }>();
  return results.map((row) => row.drawn_value);
}

// Whether a value has already been taken by a record. A hold pointing at a taken value is stale —
// reachable only through the millisecond race described in ./reservation.ts — and is skipped rather
// than handed out, because the sequence's allocation primary key would refuse it anyway.
export async function isValueAllocated(
  database: SqlDatabase,
  tables: SequenceNumberingTables,
  scopeKey: string,
  drawnValue: number,
  renderedNumber: string,
): Promise<boolean> {
  const { results } =
    tables.renderedNumberColumn === undefined
      ? await database
          .prepare(
            `SELECT 1 AS taken FROM ${tables.allocationTable} WHERE scope_key = ?1 AND drawn_value = ?2`,
          )
          .bind(scopeKey, drawnValue)
          .all<{ taken: number }>()
      : await database
          .prepare(
            `SELECT 1 AS taken FROM ${tables.allocationTable} WHERE ${tables.renderedNumberColumn} = ?1`,
          )
          .bind(renderedNumber)
          .all<{ taken: number }>();
  return results.length > 0;
}

// Removes the row for a value a record is taking. Composed into the record's own batch in place of
// the counter advance, so the hold and the record never both exist.
// fitness:unguarded-write — a zero means another record already took the row; the allocation key (or the rendered-number index) refuses the duplicate value
export function claimReservedValueStatement(
  database: SqlDatabase,
  purpose: SchemeNumberingPurpose,
  scopeKey: string,
  drawnValue: number,
): SqlStatement {
  return database
    .prepare(
      `DELETE FROM ${NUMBER_RESERVATION_TABLE} WHERE purpose = ?1 AND scope_key = ?2 AND drawn_value = ?3`,
    )
    .bind(purpose, scopeKey, drawnValue);
}
