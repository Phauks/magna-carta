import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  FileId,
  MatterAssetId,
  MatterAssetValuationId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { MatterAssetValuationBasis } from "./types.ts";

// Table name tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test.
//
// THERE IS NO UPDATE AND NO DELETE STATEMENT IN THIS MODULE, and that absence is the point: the
// table carries BEFORE UPDATE / BEFORE DELETE / replace-guard triggers that RAISE(ABORT), so one
// written here would fail at runtime — test/purity.test.ts scans this package's source so it fails
// at review instead. A mistake is corrected by appending a row that names the row it corrects.
export const MATTER_ASSET_VALUATION_TABLE = "matter_asset_valuation";

export interface MatterAssetValuationRow {
  readonly id: MatterAssetValuationId;
  readonly asset_id: MatterAssetId;
  readonly encumbrance_id: string | null;
  readonly as_of_date: string;
  readonly amount_minor: number | null;
  readonly currency: string | null;
  readonly basis: MatterAssetValuationBasis;
  readonly source_note: string | null;
  readonly supporting_file_id: FileId | null;
  readonly corrects_valuation_id: MatterAssetValuationId | null;
  readonly recorded_by: UserId | null;
  readonly recorded_at: string;
}

const VALUATION_COLUMNS =
  "id, asset_id, encumbrance_id, as_of_date, amount_minor, currency, basis, source_note, " +
  "supporting_file_id, corrects_valuation_id, recorded_by, recorded_at";

export interface AppendMatterAssetValuationInput {
  readonly id: MatterAssetValuationId;
  readonly assetId: MatterAssetId;
  readonly asOfDate: string;
  readonly amountMinor: number | null;
  readonly currency: string | null;
  readonly basis: MatterAssetValuationBasis;
  readonly sourceNote: string | null;
  readonly supportingFileId: FileId | null;
  readonly correctsValuationId: MatterAssetValuationId | null;
  readonly recordedBy: UserId | null;
  readonly recordedAt: string;
}

// The one write. A plain INSERT and never an upsert: an ON CONFLICT clause here would be an
// in-place overwrite of an appended row wearing an insert, which is exactly what the replace-guard
// trigger exists to refuse.
export function appendMatterAssetValuationStatement(
  database: SqlDatabase,
  input: AppendMatterAssetValuationInput,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MATTER_ASSET_VALUATION_TABLE} (${VALUATION_COLUMNS}) ` +
        `VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
    )
    .bind(
      input.id,
      input.assetId,
      input.asOfDate,
      input.amountMinor,
      input.currency,
      input.basis,
      input.sourceNote,
      input.supportingFileId,
      input.correctsValuationId,
      input.recordedBy,
      input.recordedAt,
    );
}

export function selectMatterAssetValuationStatement(
  database: SqlDatabase,
  id: MatterAssetValuationId,
): SqlStatement {
  return database
    .prepare(`SELECT ${VALUATION_COLUMNS} FROM ${MATTER_ASSET_VALUATION_TABLE} WHERE id = ?1`)
    .bind(id);
}

export async function readMatterAssetValuation(
  database: SqlDatabase,
  id: MatterAssetValuationId,
): Promise<MatterAssetValuationRow | undefined> {
  const { results } = await selectMatterAssetValuationStatement(
    database,
    id,
  ).all<MatterAssetValuationRow>();
  return results[0];
}

// The full history for one asset, newest assertion first. Corrections are RETURNED, not hidden: a
// reader has to be able to see that a figure was corrected and what it was corrected from, which is
// the whole reason a correction is a row rather than an edit.
export function selectMatterAssetValuationsStatement(
  database: SqlDatabase,
  assetId: MatterAssetId,
  limit: number,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${VALUATION_COLUMNS} FROM ${MATTER_ASSET_VALUATION_TABLE} WHERE asset_id = ?1 ` +
        `ORDER BY as_of_date DESC, recorded_at DESC, id DESC LIMIT ?2`,
    )
    .bind(assetId, limit);
}

export async function readMatterAssetValuations(
  database: SqlDatabase,
  assetId: MatterAssetId,
  limit = 200,
): Promise<MatterAssetValuationRow[]> {
  const { results } = await selectMatterAssetValuationsStatement(
    database,
    assetId,
    limit,
  ).all<MatterAssetValuationRow>();
  return results;
}

// THE as-of resolution: for one asset, the valuation whose as_of_date is the latest at or before the
// requested date, excluding any row a correction supersedes. A date BEFORE the asset's first
// valuation matches nothing and returns nothing — never the earliest value — because an asset
// acquired after the date of death is not in the estate at the date of death, and extrapolating
// backwards would put a number on a schedule that no one asserted.
//
// The NOT EXISTS arm is what makes a correction supersede: a row somebody has corrected can never
// resolve again, and its correction resolves in its place because the correction carries its own
// as_of_date. The index (asset_id, as_of_date, recorded_at) serves the walk in reverse.
export function selectMatterAssetValuationAsOfStatement(
  database: SqlDatabase,
  assetId: MatterAssetId,
  asOfDate: string,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${VALUATION_COLUMNS.split(", ")
        .map((column) => `valuation.${column}`)
        .join(", ")} FROM ${MATTER_ASSET_VALUATION_TABLE} AS valuation ` +
        `WHERE valuation.asset_id = ?1 AND valuation.encumbrance_id IS NULL AND valuation.as_of_date <= ?2 ` +
        `AND NOT EXISTS (SELECT 1 FROM ${MATTER_ASSET_VALUATION_TABLE} AS correction ` +
        `WHERE correction.corrects_valuation_id = valuation.id) ` +
        `ORDER BY valuation.as_of_date DESC, valuation.recorded_at DESC, valuation.id DESC LIMIT 1`,
    )
    .bind(assetId, asOfDate);
}
