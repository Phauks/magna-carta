import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  MatterAssetId,
  MatterAssetIdentifierId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { MatterAssetIdentifierKind } from "./types.ts";

// Table name tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test.
//
// value_ciphertext is a PROTECTED COLUMN. It is never selected by any read in this module except the
// one that feeds the data-access decrypt chokepoint, which is where the permission check and the
// audit row live — the ordinary reads project display_suffix and nothing else, so a list, a detail,
// a schedule, and a merge field are structurally incapable of carrying a full number.
export const MATTER_ASSET_IDENTIFIER_TABLE = "matter_asset_identifier";

// What every ordinary read returns: the kind and the last four characters. There is no ciphertext
// field on this row shape at all, which is the point — a caller cannot forget to strip it.
export interface MatterAssetIdentifierRow {
  readonly id: MatterAssetIdentifierId;
  readonly asset_id: MatterAssetId;
  readonly kind: MatterAssetIdentifierKind;
  readonly display_suffix: string | null;
  readonly created_at: string;
  readonly created_by: UserId | null;
}

const READABLE_COLUMNS = "id, asset_id, kind, display_suffix, created_at, created_by";

export function insertMatterAssetIdentifierStatement(
  database: SqlDatabase,
  row: {
    readonly id: MatterAssetIdentifierId;
    readonly assetId: MatterAssetId;
    readonly kind: MatterAssetIdentifierKind;
    readonly displaySuffix: string | null;
    // Already sealed by the data-access protected-write chokepoint before it reaches here. No
    // plaintext is ever bound into this statement.
    readonly valueCiphertext: string | null;
    readonly createdBy: UserId | null;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MATTER_ASSET_IDENTIFIER_TABLE} (id, asset_id, kind, display_suffix, value_ciphertext, created_at, created_by) ` +
        `VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
    .bind(
      row.id,
      row.assetId,
      row.kind,
      row.displaySuffix,
      row.valueCiphertext,
      row.now,
      row.createdBy,
    );
}

export function selectMatterAssetIdentifiersStatement(
  database: SqlDatabase,
  assetId: MatterAssetId,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${READABLE_COLUMNS} FROM ${MATTER_ASSET_IDENTIFIER_TABLE} WHERE asset_id = ?1 ` +
        `ORDER BY created_at ASC, id ASC`,
    )
    .bind(assetId);
}

export async function readMatterAssetIdentifiers(
  database: SqlDatabase,
  assetId: MatterAssetId,
): Promise<MatterAssetIdentifierRow[]> {
  const { results } = await selectMatterAssetIdentifiersStatement(
    database,
    assetId,
  ).all<MatterAssetIdentifierRow>();
  return results;
}

export async function readMatterAssetIdentifier(
  database: SqlDatabase,
  id: MatterAssetIdentifierId,
): Promise<MatterAssetIdentifierRow | undefined> {
  const { results } = await database
    .prepare(`SELECT ${READABLE_COLUMNS} FROM ${MATTER_ASSET_IDENTIFIER_TABLE} WHERE id = ?1`)
    .bind(id)
    .all<MatterAssetIdentifierRow>();
  return results[0];
}

// The ciphertext plus its row id — the ONE input the data-access decrypt chokepoint takes (the AAD
// binds the ciphertext to its row id). Declared beside its only caller, exactly as the Directory's
// equivalent read is, so the sealed column has one reader and it is the one that audits.
export async function readMatterAssetIdentifierSealedRow(
  database: SqlDatabase,
  id: MatterAssetIdentifierId,
): Promise<
  | { id: MatterAssetIdentifierId; asset_id: MatterAssetId; value_ciphertext: string | null }
  | undefined
> {
  const { results } = await database
    .prepare(
      `SELECT id, asset_id, value_ciphertext FROM ${MATTER_ASSET_IDENTIFIER_TABLE} WHERE id = ?1`,
    )
    .bind(id)
    .all<{
      id: MatterAssetIdentifierId;
      asset_id: MatterAssetId;
      value_ciphertext: string | null;
    }>();
  return results[0];
}
