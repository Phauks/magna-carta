import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  CustodyItemId,
  MatterAssetId,
  MatterAssetTypeId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import type {
  MatterAssetClass,
  MatterAssetDisposition,
  MatterAssetEstateTreatment,
} from "./types.ts";

// Table names tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test.
export const MATTER_ASSET_TABLE = "matter_asset";
export const MATTER_ASSET_REAL_PROPERTY_TABLE = "matter_asset_real_property";
export const MATTER_ASSET_FINANCIAL_ACCOUNT_TABLE = "matter_asset_financial_account";

export interface MatterAssetRow {
  readonly id: MatterAssetId;
  readonly matter_id: MatterId;
  readonly class: MatterAssetClass;
  readonly asset_type_id: MatterAssetTypeId | null;
  readonly description: string;
  readonly acquired_on: string | null;
  readonly estate_treatment: MatterAssetEstateTreatment;
  readonly disposition: MatterAssetDisposition;
  readonly disposition_on: string | null;
  readonly custody_item_id: CustodyItemId | null;
  readonly notes: string | null;
  readonly created_at: string;
  readonly created_by: UserId | null;
  readonly updated_at: string;
  readonly deleted_at: string | null;
}

export interface MatterAssetRealPropertyRow {
  readonly asset_id: MatterAssetId;
  readonly street: string | null;
  readonly city: string | null;
  readonly region: string | null;
  readonly postal: string | null;
  readonly county: string | null;
  readonly parcel_number: string | null;
  readonly legal_description: string | null;
  readonly recording_reference: string | null;
}

export interface MatterAssetFinancialAccountRow {
  readonly asset_id: MatterAssetId;
  readonly institution_name: string | null;
  readonly institution_organization_id: string | null;
}

const ASSET_COLUMNS =
  "id, matter_id, class, asset_type_id, description, acquired_on, estate_treatment, disposition, " +
  "disposition_on, custody_item_id, notes, created_at, created_by, updated_at, deleted_at";

export interface InsertMatterAssetInput {
  readonly id: MatterAssetId;
  readonly matterId: MatterId;
  readonly assetClass: MatterAssetClass;
  readonly assetTypeId: MatterAssetTypeId | null;
  readonly description: string;
  readonly acquiredOn: string | null;
  readonly estateTreatment: MatterAssetEstateTreatment;
  readonly disposition: MatterAssetDisposition;
  readonly dispositionOn: string | null;
  readonly notes: string | null;
  readonly createdBy: UserId | null;
  readonly now: string;
}

export function insertMatterAssetStatement(
  database: SqlDatabase,
  input: InsertMatterAssetInput,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MATTER_ASSET_TABLE} (id, matter_id, class, asset_type_id, description, acquired_on, ` +
        `estate_treatment, disposition, disposition_on, notes, created_at, created_by, updated_at) ` +
        `VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?11)`,
    )
    .bind(
      input.id,
      input.matterId,
      input.assetClass,
      input.assetTypeId,
      input.description,
      input.acquiredOn,
      input.estateTreatment,
      input.disposition,
      input.dispositionOn,
      input.notes,
      input.now,
      input.createdBy,
    );
}

// The patch. `class` is absent from the SET list on purpose and not by omission: the class is frozen
// at creation, and the service refuses a patch that names one before this statement is built.
export function updateMatterAssetStatement(
  database: SqlDatabase,
  id: MatterAssetId,
  patch: {
    readonly assetTypeId: MatterAssetTypeId | null;
    readonly description: string;
    readonly acquiredOn: string | null;
    readonly estateTreatment: MatterAssetEstateTreatment;
    readonly disposition: MatterAssetDisposition;
    readonly dispositionOn: string | null;
    readonly custodyItemId: CustodyItemId | null;
    readonly notes: string | null;
  },
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MATTER_ASSET_TABLE} SET asset_type_id = ?2, description = ?3, acquired_on = ?4, ` +
        `estate_treatment = ?5, disposition = ?6, disposition_on = ?7, custody_item_id = ?8, ` +
        `notes = ?9, updated_at = ?10 WHERE id = ?1 AND deleted_at IS NULL`,
    )
    .bind(
      id,
      patch.assetTypeId,
      patch.description,
      patch.acquiredOn,
      patch.estateTreatment,
      patch.disposition,
      patch.dispositionOn,
      patch.custodyItemId,
      patch.notes,
      updatedAt,
    );
}

// Soft delete. The row stays because a valuation history and a document link hang off it, and a firm
// that removed a house by mistake at nine in the morning wants it back at ten.
export function softDeleteMatterAssetStatement(
  database: SqlDatabase,
  id: MatterAssetId,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MATTER_ASSET_TABLE} SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1 AND deleted_at IS NULL`,
    )
    .bind(id, now);
}

export function selectMatterAssetStatement(database: SqlDatabase, id: MatterAssetId): SqlStatement {
  return database
    .prepare(
      `SELECT ${ASSET_COLUMNS} FROM ${MATTER_ASSET_TABLE} WHERE id = ?1 AND deleted_at IS NULL`,
    )
    .bind(id);
}

export async function readMatterAsset(
  database: SqlDatabase,
  id: MatterAssetId,
): Promise<MatterAssetRow | undefined> {
  const { results } = await selectMatterAssetStatement(database, id).all<MatterAssetRow>();
  return results[0];
}

export function insertMatterAssetRealPropertyStatement(
  database: SqlDatabase,
  row: {
    readonly assetId: MatterAssetId;
    readonly street: string | null;
    readonly city: string | null;
    readonly region: string | null;
    readonly postal: string | null;
    readonly county: string | null;
    readonly parcelNumber: string | null;
    readonly legalDescription: string | null;
    readonly recordingReference: string | null;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MATTER_ASSET_REAL_PROPERTY_TABLE} (asset_id, street, city, region, postal, county, ` +
        `parcel_number, legal_description, recording_reference) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) ` +
        `ON CONFLICT(asset_id) DO UPDATE SET street = ?2, city = ?3, region = ?4, postal = ?5, county = ?6, ` +
        `parcel_number = ?7, legal_description = ?8, recording_reference = ?9`,
    )
    .bind(
      row.assetId,
      row.street,
      row.city,
      row.region,
      row.postal,
      row.county,
      row.parcelNumber,
      row.legalDescription,
      row.recordingReference,
    );
}

export function selectMatterAssetRealPropertyStatement(
  database: SqlDatabase,
  assetId: MatterAssetId,
): SqlStatement {
  return database
    .prepare(`SELECT * FROM ${MATTER_ASSET_REAL_PROPERTY_TABLE} WHERE asset_id = ?1`)
    .bind(assetId);
}

export function insertMatterAssetFinancialAccountStatement(
  database: SqlDatabase,
  row: {
    readonly assetId: MatterAssetId;
    readonly institutionName: string | null;
    readonly institutionOrganizationId: string | null;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MATTER_ASSET_FINANCIAL_ACCOUNT_TABLE} (asset_id, institution_name, institution_organization_id) ` +
        `VALUES (?1, ?2, ?3) ON CONFLICT(asset_id) DO UPDATE SET institution_name = ?2, institution_organization_id = ?3`,
    )
    .bind(row.assetId, row.institutionName, row.institutionOrganizationId);
}

export function selectMatterAssetFinancialAccountStatement(
  database: SqlDatabase,
  assetId: MatterAssetId,
): SqlStatement {
  return database
    .prepare(`SELECT * FROM ${MATTER_ASSET_FINANCIAL_ACCOUNT_TABLE} WHERE asset_id = ?1`)
    .bind(assetId);
}

export async function readMatterAssetRealProperty(
  database: SqlDatabase,
  assetId: MatterAssetId,
): Promise<MatterAssetRealPropertyRow | undefined> {
  const { results } = await selectMatterAssetRealPropertyStatement(
    database,
    assetId,
  ).all<MatterAssetRealPropertyRow>();
  return results[0];
}

export async function readMatterAssetFinancialAccount(
  database: SqlDatabase,
  assetId: MatterAssetId,
): Promise<MatterAssetFinancialAccountRow | undefined> {
  const { results } = await selectMatterAssetFinancialAccountStatement(
    database,
    assetId,
  ).all<MatterAssetFinancialAccountRow>();
  return results[0];
}

export { ASSET_COLUMNS };
