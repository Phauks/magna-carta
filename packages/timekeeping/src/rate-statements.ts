import type { RateCardId, RateId } from "@magna-carta/identifiers/types";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";

// Table names tracked against @magna-carta/database's per-firm schema by the schema-name-sync fitness
// test. Both tables exist only in the per-firm database — the caller supplies that handle.
export const RATE_CARD_TABLE = "rate_card";
export const RATE_TABLE = "rate";

export type RateTier = "matter" | "client" | "timekeeper" | "role";

export interface InsertRateCardRow {
  readonly id: RateCardId;
  readonly name: string;
  readonly createdAt: string;
}

export function insertRateCardStatement(
  database: SqlDatabase,
  row: InsertRateCardRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${RATE_CARD_TABLE} (id, name, archived_at, created_at, updated_at) VALUES (?1, ?2, NULL, ?3, ?3)`,
    )
    .bind(row.id, row.name, row.createdAt);
}

export interface InsertRateRow {
  readonly id: RateId;
  readonly rateCardId: RateCardId;
  readonly tier: RateTier;
  readonly scopedId: string | null;
  readonly rateE4: number;
  readonly currency: string;
  readonly validFrom: string;
  readonly createdAt: string;
}

// A new version is always inserted OPEN (valid_to NULL); a prior open row for the same scope is closed
// separately, in the same batch, by closePriorOpenRateStatement. Append-only: no existing row is ever
// edited except that close.
export function insertRateStatement(database: SqlDatabase, row: InsertRateRow): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${RATE_TABLE} (id, rate_card_id, tier, scoped_id, rate_e4, currency, valid_from, valid_to, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8)`,
    )
    .bind(
      row.id,
      row.rateCardId,
      row.tier,
      row.scopedId,
      row.rateE4,
      row.currency,
      row.validFrom,
      row.createdAt,
    );
}

// Reads the existing rows for one scope (any state), so the service can refuse an overlapping
// valid_from and find the open row to close. scoped_id NULL is the card-wide default for the tier and
// matches with `IS` so it is treated as a distinct scope from any concrete scoped_id.
export function selectRatesForScopeStatement(
  database: SqlDatabase,
  rateCardId: RateCardId,
  tier: RateTier,
  scopedId: string | null,
): SqlStatement {
  return database
    .prepare(
      `SELECT id, valid_from, valid_to FROM ${RATE_TABLE} WHERE rate_card_id = ?1 AND tier = ?2 AND scoped_id IS ?3 ORDER BY valid_from`,
    )
    .bind(rateCardId, tier, scopedId);
}

// Closes the prior open row's interval at the new version's valid_from (the partial UNIQUE index keeps
// at most one open row per scope, so this targets exactly that row).
export function closePriorOpenRateStatement(
  database: SqlDatabase,
  id: RateId,
  validTo: string,
): SqlStatement {
  return database
    .prepare(`UPDATE ${RATE_TABLE} SET valid_to = ?2 WHERE id = ?1`)
    .bind(id, validTo);
}
