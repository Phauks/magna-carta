import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { MatterAssetId, MatterId } from "@magna-carta/identifiers/types";
import { ASSET_COLUMNS, MATTER_ASSET_TABLE, type MatterAssetRow } from "./asset-statements.ts";
import type {
  MatterAssetClass,
  MatterAssetDisposition,
  MatterAssetEstateTreatment,
} from "./types.ts";
import { MATTER_ASSET_VALUATION_TABLE } from "./valuation-statements.ts";

// The register list for one matter: a keyset walk over (created_at, id) newest first, with the
// filters composed into SQL before the LIMIT so a page is never trimmed after the fact. The
// composite index (matter_id, class, created_at, id) serves the filter, the sort, and the cursor
// predicate together.

export interface MatterAssetListFilters {
  readonly assetClass?: MatterAssetClass;
  readonly assetTypeId?: string;
  readonly disposition?: MatterAssetDisposition;
  readonly estateTreatment?: MatterAssetEstateTreatment;
  // "Which of these has nobody put a number on yet" — the question a schedule answers by stating an
  // unvalued count rather than hiding it. Resolved as an EXISTS over the valuation history, so it
  // narrows in SQL like every other filter.
  readonly valued?: boolean;
}

export interface MatterAssetListOptions extends MatterAssetListFilters {
  readonly cursor?: { readonly sortKey: string; readonly id: string };
  readonly limit: number;
}

export async function readMatterAssetPage(
  database: SqlDatabase,
  matterId: MatterId,
  options: MatterAssetListOptions,
): Promise<MatterAssetRow[]> {
  const conditions = ["matter_id = ?1", "deleted_at IS NULL"];
  const bindings: unknown[] = [matterId];
  const bind = (value: unknown): string => {
    bindings.push(value);
    return `?${bindings.length}`;
  };
  if (options.assetClass !== undefined) conditions.push(`class = ${bind(options.assetClass)}`);
  if (options.assetTypeId !== undefined) {
    conditions.push(`asset_type_id = ${bind(options.assetTypeId)}`);
  }
  if (options.disposition !== undefined) {
    conditions.push(`disposition = ${bind(options.disposition)}`);
  }
  if (options.estateTreatment !== undefined) {
    conditions.push(`estate_treatment = ${bind(options.estateTreatment)}`);
  }
  if (options.valued !== undefined) {
    const existence = options.valued ? "EXISTS" : "NOT EXISTS";
    conditions.push(
      `${existence} (SELECT 1 FROM ${MATTER_ASSET_VALUATION_TABLE} AS valuation ` +
        `WHERE valuation.asset_id = ${MATTER_ASSET_TABLE}.id AND valuation.encumbrance_id IS NULL)`,
    );
  }
  if (options.cursor !== undefined) {
    const sortKey = bind(options.cursor.sortKey);
    const cursorId = bind(options.cursor.id);
    conditions.push(`(created_at < ${sortKey} OR (created_at = ${sortKey} AND id < ${cursorId}))`);
  }
  const limitPlaceholder = bind(options.limit);
  const { results } = await database
    .prepare(
      `SELECT ${ASSET_COLUMNS} FROM ${MATTER_ASSET_TABLE} WHERE ${conditions.join(" AND ")} ` +
        `ORDER BY created_at DESC, id DESC LIMIT ${limitPlaceholder}`,
    )
    .bind(...bindings)
    .all<MatterAssetRow>();
  return results;
}

// "What does this person hold an interest in" — the one read that spans matters, served by the
// (entity_id, effective_to) index. Returns the asset handles; the caller resolves them under its own
// firm-scoped read, so no matter's detail leaks through this shape.
export async function readMatterAssetIdsForEntity(
  database: SqlDatabase,
  entityId: string,
  options: { readonly currentOnly?: boolean; readonly limit: number },
): Promise<MatterAssetId[]> {
  const currentOnly = options.currentOnly !== false;
  const { results } = await database
    .prepare(
      `SELECT DISTINCT asset_id FROM matter_asset_interest WHERE entity_id = ?1 ` +
        `${currentOnly ? "AND effective_to IS NULL " : ""}ORDER BY asset_id ASC LIMIT ?2`,
    )
    .bind(entityId, options.limit)
    .all<{ asset_id: MatterAssetId }>();
  return results.map((row) => row.asset_id);
}
