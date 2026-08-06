import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { MatterAssetId, MatterAssetInterestId } from "@magna-carta/identifiers/types";

// Table name tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test.
export const MATTER_ASSET_INTEREST_TABLE = "matter_asset_interest";

export interface MatterAssetInterestRow {
  readonly id: MatterAssetInterestId;
  readonly asset_id: MatterAssetId;
  readonly entity_id: string;
  readonly interest_role: string | null;
  readonly share_numerator: number | null;
  readonly share_denominator: number | null;
  readonly effective_from: string;
  readonly effective_to: string | null;
}

const INTEREST_COLUMNS =
  "id, asset_id, entity_id, interest_role, share_numerator, share_denominator, effective_from, effective_to";

export function insertMatterAssetInterestStatement(
  database: SqlDatabase,
  row: {
    readonly id: MatterAssetInterestId;
    readonly assetId: MatterAssetId;
    readonly entityId: string;
    readonly interestRole: string | null;
    readonly shareNumerator: number | null;
    readonly shareDenominator: number | null;
    readonly effectiveFrom: string;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MATTER_ASSET_INTEREST_TABLE} (id, asset_id, entity_id, interest_role, share_numerator, ` +
        `share_denominator, effective_from, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)`,
    )
    .bind(
      row.id,
      row.assetId,
      row.entityId,
      row.interestRole,
      row.shareNumerator,
      row.shareDenominator,
      row.effectiveFrom,
      row.now,
    );
}

// Ending an interest is TEMPORAL and never a delete: who held what, and until when, is the record.
// The guard on effective_to keeps a second end from overwriting the first one's date.
export function endMatterAssetInterestStatement(
  database: SqlDatabase,
  id: MatterAssetInterestId,
  effectiveTo: string,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MATTER_ASSET_INTEREST_TABLE} SET effective_to = ?2, updated_at = ?3 ` +
        `WHERE id = ?1 AND effective_to IS NULL`,
    )
    .bind(id, effectiveTo, updatedAt);
}

export function selectMatterAssetInterestStatement(
  database: SqlDatabase,
  id: MatterAssetInterestId,
): SqlStatement {
  return database
    .prepare(`SELECT ${INTEREST_COLUMNS} FROM ${MATTER_ASSET_INTEREST_TABLE} WHERE id = ?1`)
    .bind(id);
}

export function selectMatterAssetInterestsStatement(
  database: SqlDatabase,
  assetId: MatterAssetId,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${INTEREST_COLUMNS} FROM ${MATTER_ASSET_INTEREST_TABLE} WHERE asset_id = ?1 ` +
        `ORDER BY effective_from ASC, id ASC`,
    )
    .bind(assetId);
}

export async function readMatterAssetInterest(
  database: SqlDatabase,
  id: MatterAssetInterestId,
): Promise<MatterAssetInterestRow | undefined> {
  const { results } = await selectMatterAssetInterestStatement(
    database,
    id,
  ).all<MatterAssetInterestRow>();
  return results[0];
}

export async function readMatterAssetInterests(
  database: SqlDatabase,
  assetId: MatterAssetId,
): Promise<MatterAssetInterestRow[]> {
  const { results } = await selectMatterAssetInterestsStatement(
    database,
    assetId,
  ).all<MatterAssetInterestRow>();
  return results;
}
