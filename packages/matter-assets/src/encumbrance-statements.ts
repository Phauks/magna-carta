import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  MatterAssetEncumbranceId,
  MatterAssetId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { MatterAssetEncumbranceKind } from "./types.ts";
import { MATTER_ASSET_VALUATION_TABLE } from "./valuation-statements.ts";

// Table name tracked against @magna-carta/database's per-firm schema by the schema-name-sync fitness
// test.
//
// AN ENCUMBRANCE'S BALANCE IS NOT A COLUMN HERE. It is a row in the valuation history naming this
// encumbrance, so a mortgage that was four hundred thousand at the date of death and three hundred
// and ninety at the date of sale has both figures, dated, on the same append-only table with the same
// triggers and the same as-of resolution as the property it charges. A `balance_amount_minor` column
// would be a second, mutable, undated number answering the same question worse.
export const MATTER_ASSET_ENCUMBRANCE_TABLE = "matter_asset_encumbrance";

export interface MatterAssetEncumbranceRow {
  readonly id: MatterAssetEncumbranceId;
  readonly asset_id: MatterAssetId;
  readonly kind: MatterAssetEncumbranceKind;
  readonly holder_entity_id: string | null;
  readonly holder_name: string | null;
  readonly recorded_reference: string | null;
  readonly released_on: string | null;
  readonly notes: string | null;
  readonly created_at: string;
  readonly created_by: UserId | null;
  readonly updated_at: string;
}

const ENCUMBRANCE_COLUMNS =
  "id, asset_id, kind, holder_entity_id, holder_name, recorded_reference, released_on, notes, " +
  "created_at, created_by, updated_at";

export interface RecordMatterAssetEncumbranceInput {
  readonly id: MatterAssetEncumbranceId;
  readonly assetId: MatterAssetId;
  readonly kind: MatterAssetEncumbranceKind;
  readonly holderEntityId: string | null;
  // Free text where no Directory record exists — the custody borrower precedent, and for the same
  // reason: writing every lender a firm ever sees into the Directory pollutes the conflicts corpus.
  readonly holderName: string | null;
  readonly recordedReference: string | null;
  readonly notes: string | null;
  readonly createdBy: UserId | null;
  readonly now: string;
}

export function insertMatterAssetEncumbranceStatement(
  database: SqlDatabase,
  input: RecordMatterAssetEncumbranceInput,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MATTER_ASSET_ENCUMBRANCE_TABLE} (id, asset_id, kind, holder_entity_id, holder_name, ` +
        `recorded_reference, released_on, notes, created_at, created_by, updated_at) ` +
        `VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7, ?8, ?9, ?8)`,
    )
    .bind(
      input.id,
      input.assetId,
      input.kind,
      input.holderEntityId,
      input.holderName,
      input.recordedReference,
      input.notes,
      input.now,
      input.createdBy,
    );
}

// Releasing is a DATE, never a delete. "Was this property clear on the date of death" is a question a
// schedule has to answer years after the lien was discharged, and a removed row answers it wrongly
// and silently.
export function releaseMatterAssetEncumbranceStatement(
  database: SqlDatabase,
  id: MatterAssetEncumbranceId,
  releasedOn: string,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MATTER_ASSET_ENCUMBRANCE_TABLE} SET released_on = ?2, updated_at = ?3 WHERE id = ?1`,
    )
    .bind(id, releasedOn, now);
}

export function selectMatterAssetEncumbranceStatement(
  database: SqlDatabase,
  id: MatterAssetEncumbranceId,
): SqlStatement {
  return database
    .prepare(`SELECT ${ENCUMBRANCE_COLUMNS} FROM ${MATTER_ASSET_ENCUMBRANCE_TABLE} WHERE id = ?1`)
    .bind(id);
}

export async function readMatterAssetEncumbrance(
  database: SqlDatabase,
  id: MatterAssetEncumbranceId,
): Promise<MatterAssetEncumbranceRow | undefined> {
  const { results } = await selectMatterAssetEncumbranceStatement(
    database,
    id,
  ).all<MatterAssetEncumbranceRow>();
  return results[0];
}

// Every charge on one asset, released ones included and marked. `unreleasedOnly` narrows in SQL
// against the (asset_id, released_on) index rather than filtering a fetched list.
export async function readMatterAssetEncumbrances(
  database: SqlDatabase,
  assetId: MatterAssetId,
  options: { readonly unreleasedOnly?: boolean } = {},
): Promise<MatterAssetEncumbranceRow[]> {
  const releasedPredicate = options.unreleasedOnly === true ? "AND released_on IS NULL " : "";
  const { results } = await database
    .prepare(
      `SELECT ${ENCUMBRANCE_COLUMNS} FROM ${MATTER_ASSET_ENCUMBRANCE_TABLE} WHERE asset_id = ?1 ` +
        `${releasedPredicate}ORDER BY created_at ASC, id ASC`,
    )
    .bind(assetId)
    .all<MatterAssetEncumbranceRow>();
  return results;
}

// Every charge across a whole matter's register, in ONE read. The schedule needs every asset's
// encumbrances at once, and one read per asset is precisely the per-row query the schedule exists to
// avoid — it is the same batching discipline the merge engine states as a rule.
export async function readMatterAssetEncumbrancesForMatter(
  database: SqlDatabase,
  assetIds: readonly MatterAssetId[],
): Promise<MatterAssetEncumbranceRow[]> {
  if (assetIds.length === 0) return [];
  const placeholders = assetIds.map((_, index) => `?${index + 1}`).join(", ");
  const { results } = await database
    .prepare(
      `SELECT ${ENCUMBRANCE_COLUMNS} FROM ${MATTER_ASSET_ENCUMBRANCE_TABLE} ` +
        `WHERE asset_id IN (${placeholders}) ORDER BY asset_id ASC, created_at ASC, id ASC`,
    )
    .bind(...assetIds)
    .all<MatterAssetEncumbranceRow>();
  return results;
}

// Does this encumbrance belong to this asset? The one check the valuation write path runs before it
// writes a balance: a mortgage balance filed under a house the mortgage does not charge makes the
// equity of two assets wrong, and neither of them looks wrong on its own.
export async function encumbranceBelongsToAsset(
  database: SqlDatabase,
  encumbranceId: MatterAssetEncumbranceId,
  assetId: MatterAssetId,
): Promise<boolean> {
  const { results } = await database
    .prepare(
      `SELECT 1 AS present FROM ${MATTER_ASSET_ENCUMBRANCE_TABLE} WHERE id = ?1 AND asset_id = ?2`,
    )
    .bind(encumbranceId, assetId)
    .all<{ present: number }>();
  return results.length > 0;
}

// THE as-of resolution for a set of encumbrances, in one read: for each one, its latest balance at or
// before the requested date, excluding any row a correction supersedes. The same shape as the asset's
// own as-of read, over the same table, with `encumbrance_id` set rather than null — which is the whole
// dividend of having made a balance a valuation.
export async function readEncumbranceBalancesAsOf(
  database: SqlDatabase,
  encumbranceIds: readonly MatterAssetEncumbranceId[],
  asOfDate: string,
): Promise<Map<MatterAssetEncumbranceId, ResolvedEncumbranceBalance>> {
  const balances = new Map<MatterAssetEncumbranceId, ResolvedEncumbranceBalance>();
  if (encumbranceIds.length === 0) return balances;
  const placeholders = encumbranceIds.map((_, index) => `?${index + 1}`).join(", ");
  const datePlaceholder = `?${encumbranceIds.length + 1}`;
  const { results } = await database
    .prepare(
      `SELECT balance.encumbrance_id AS encumbrance_id, balance.as_of_date AS as_of_date, ` +
        `balance.amount_minor AS amount_minor, balance.currency AS currency ` +
        `FROM ${MATTER_ASSET_VALUATION_TABLE} AS balance ` +
        `WHERE balance.encumbrance_id IN (${placeholders}) AND balance.as_of_date <= ${datePlaceholder} ` +
        `AND NOT EXISTS (SELECT 1 FROM ${MATTER_ASSET_VALUATION_TABLE} AS correction ` +
        `WHERE correction.corrects_valuation_id = balance.id) ` +
        `ORDER BY balance.encumbrance_id ASC, balance.as_of_date DESC, balance.recorded_at DESC, balance.id DESC`,
    )
    .bind(...encumbranceIds, asOfDate)
    .all<{
      encumbrance_id: MatterAssetEncumbranceId;
      as_of_date: string;
      amount_minor: number | null;
      currency: string | null;
    }>();
  // The ordering puts each encumbrance's winning row first, so the first row seen per encumbrance IS
  // the resolution — no per-encumbrance query, and no sort in memory.
  for (const row of results) {
    if (balances.has(row.encumbrance_id)) continue;
    balances.set(row.encumbrance_id, {
      asOfDate: row.as_of_date,
      amountMinor: row.amount_minor,
      currency: row.currency,
    });
  }
  return balances;
}

// A balance ALWAYS travels with the date it speaks to, exactly as an asset's value does. An
// encumbrance with no balance at or before the date resolves to nothing, which is the honest answer:
// a lien recorded after the date of death did not charge the property at the date of death.
export interface ResolvedEncumbranceBalance {
  readonly asOfDate: string;
  readonly amountMinor: number | null;
  readonly currency: string | null;
}
