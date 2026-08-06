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
  MatterAssetDigitalCustodyModel,
  MatterAssetDisposition,
  MatterAssetEstateTreatment,
} from "./types.ts";

// Table names tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test.
export const MATTER_ASSET_TABLE = "matter_asset";
export const MATTER_ASSET_REAL_PROPERTY_TABLE = "matter_asset_real_property";
export const MATTER_ASSET_FINANCIAL_ACCOUNT_TABLE = "matter_asset_financial_account";
export const MATTER_ASSET_VEHICLE_TABLE = "matter_asset_vehicle";
export const MATTER_ASSET_FIREARM_TABLE = "matter_asset_firearm";
export const MATTER_ASSET_BUSINESS_INTEREST_TABLE = "matter_asset_business_interest";
export const MATTER_ASSET_INSURANCE_POLICY_TABLE = "matter_asset_insurance_policy";
export const MATTER_ASSET_RECEIVABLE_TABLE = "matter_asset_receivable";
export const MATTER_ASSET_DIGITAL_ASSET_TABLE = "matter_asset_digital_asset";

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

export interface MatterAssetVehicleRow {
  readonly asset_id: MatterAssetId;
  readonly make: string | null;
  readonly model: string | null;
  readonly model_year: number | null;
  readonly vehicle_identification_number: string | null;
  readonly plate_number: string | null;
  readonly plate_region: string | null;
}

export interface MatterAssetFirearmRow {
  readonly asset_id: MatterAssetId;
  readonly make: string | null;
  readonly model: string | null;
  readonly caliber_or_gauge: string | null;
  readonly serial_number: string | null;
  readonly regulated_category: string | null;
}

export interface MatterAssetBusinessInterestRow {
  readonly asset_id: MatterAssetId;
  readonly entity_name: string | null;
  readonly entity_organization_id: string | null;
  readonly jurisdiction_of_organization: string | null;
  readonly entity_form: string | null;
}

export interface MatterAssetInsurancePolicyRow {
  readonly asset_id: MatterAssetId;
  readonly carrier_name: string | null;
  readonly carrier_organization_id: string | null;
  // The FACE AMOUNT is a term of the contract, not a valuation. What the policy is worth — its cash
  // surrender value — is a valuation row like any other, and a schedule reports the two separately.
  readonly face_amount_minor: number | null;
  readonly face_currency: string | null;
  readonly insured_entity_id: string | null;
}

export interface MatterAssetReceivableRow {
  readonly asset_id: MatterAssetId;
  readonly debtor_entity_id: string | null;
  readonly principal_amount_minor: number | null;
  readonly principal_currency: string | null;
  readonly rate_e4: number | null;
  readonly maturity_on: string | null;
  readonly secured: number | null;
}

export interface MatterAssetDigitalAssetRow {
  readonly asset_id: MatterAssetId;
  readonly platform_name: string | null;
  // The public handle on the platform. NOT a login, and there is no column here a credential could
  // ride on — see the table comment in @magna-carta/database's per-firm schema.
  readonly account_handle: string | null;
  readonly custody_model: MatterAssetDigitalCustodyModel | null;
}

// One upsert builder for every attribute table, because the six that follow differ only in their
// column list: a one-to-one row keyed on `asset_id`, inserted on first write and overwritten on a
// later patch. Written once rather than six times so a change to the shape (the conflict target, the
// parameter numbering) cannot land on five tables and miss the sixth.
function attributeUpsertStatement(
  database: SqlDatabase,
  table: string,
  assetId: MatterAssetId,
  columns: Readonly<Record<string, unknown>>,
): SqlStatement {
  const names = Object.keys(columns);
  const placeholders = names.map((_, index) => `?${index + 2}`);
  const assignments = names.map((name, index) => `${name} = ?${index + 2}`);
  return database
    .prepare(
      `INSERT INTO ${table} (asset_id, ${names.join(", ")}) VALUES (?1, ${placeholders.join(", ")}) ` +
        `ON CONFLICT(asset_id) DO UPDATE SET ${assignments.join(", ")}`,
    )
    .bind(assetId, ...names.map((name) => columns[name]));
}

export function insertMatterAssetVehicleStatement(
  database: SqlDatabase,
  row: {
    readonly assetId: MatterAssetId;
    readonly make: string | null;
    readonly model: string | null;
    readonly modelYear: number | null;
    readonly vehicleIdentificationNumber: string | null;
    readonly plateNumber: string | null;
    readonly plateRegion: string | null;
  },
): SqlStatement {
  return attributeUpsertStatement(database, MATTER_ASSET_VEHICLE_TABLE, row.assetId, {
    make: row.make,
    model: row.model,
    model_year: row.modelYear,
    vehicle_identification_number: row.vehicleIdentificationNumber,
    plate_number: row.plateNumber,
    plate_region: row.plateRegion,
  });
}

export function insertMatterAssetFirearmStatement(
  database: SqlDatabase,
  row: {
    readonly assetId: MatterAssetId;
    readonly make: string | null;
    readonly model: string | null;
    readonly caliberOrGauge: string | null;
    readonly serialNumber: string | null;
    readonly regulatedCategory: string | null;
  },
): SqlStatement {
  return attributeUpsertStatement(database, MATTER_ASSET_FIREARM_TABLE, row.assetId, {
    make: row.make,
    model: row.model,
    caliber_or_gauge: row.caliberOrGauge,
    serial_number: row.serialNumber,
    // Free text a person asserted, read by nothing. No code classifies an item under any regulatory
    // schedule or infers anything at all from what is written here.
    regulated_category: row.regulatedCategory,
  });
}

export function insertMatterAssetBusinessInterestStatement(
  database: SqlDatabase,
  row: {
    readonly assetId: MatterAssetId;
    readonly entityName: string | null;
    readonly entityOrganizationId: string | null;
    readonly jurisdictionOfOrganization: string | null;
    readonly entityForm: string | null;
  },
): SqlStatement {
  return attributeUpsertStatement(database, MATTER_ASSET_BUSINESS_INTEREST_TABLE, row.assetId, {
    entity_name: row.entityName,
    entity_organization_id: row.entityOrganizationId,
    jurisdiction_of_organization: row.jurisdictionOfOrganization,
    entity_form: row.entityForm,
  });
}

export function insertMatterAssetInsurancePolicyStatement(
  database: SqlDatabase,
  row: {
    readonly assetId: MatterAssetId;
    readonly carrierName: string | null;
    readonly carrierOrganizationId: string | null;
    readonly faceAmountMinor: number | null;
    readonly faceCurrency: string | null;
    readonly insuredEntityId: string | null;
  },
): SqlStatement {
  return attributeUpsertStatement(database, MATTER_ASSET_INSURANCE_POLICY_TABLE, row.assetId, {
    carrier_name: row.carrierName,
    carrier_organization_id: row.carrierOrganizationId,
    face_amount_minor: row.faceAmountMinor,
    face_currency: row.faceCurrency,
    insured_entity_id: row.insuredEntityId,
  });
}

export function insertMatterAssetReceivableStatement(
  database: SqlDatabase,
  row: {
    readonly assetId: MatterAssetId;
    readonly debtorEntityId: string | null;
    readonly principalAmountMinor: number | null;
    readonly principalCurrency: string | null;
    readonly rateE4: number | null;
    readonly maturityOn: string | null;
    readonly secured: boolean | null;
  },
): SqlStatement {
  return attributeUpsertStatement(database, MATTER_ASSET_RECEIVABLE_TABLE, row.assetId, {
    debtor_entity_id: row.debtorEntityId,
    principal_amount_minor: row.principalAmountMinor,
    principal_currency: row.principalCurrency,
    rate_e4: row.rateE4,
    maturity_on: row.maturityOn,
    secured: row.secured === null ? null : row.secured ? 1 : 0,
  });
}

export function insertMatterAssetDigitalAssetStatement(
  database: SqlDatabase,
  row: {
    readonly assetId: MatterAssetId;
    readonly platformName: string | null;
    readonly accountHandle: string | null;
    readonly custodyModel: MatterAssetDigitalCustodyModel | null;
  },
): SqlStatement {
  return attributeUpsertStatement(database, MATTER_ASSET_DIGITAL_ASSET_TABLE, row.assetId, {
    platform_name: row.platformName,
    account_handle: row.accountHandle,
    custody_model: row.custodyModel,
  });
}

// The attribute table each class reads from, or undefined for a class with no structure. Derived from
// the class registry rather than restated, so a class that gains a table gains its read here too.
const ATTRIBUTE_TABLE_BY_CLASS: Partial<Record<MatterAssetClass, string>> = {
  realProperty: MATTER_ASSET_REAL_PROPERTY_TABLE,
  financialAccount: MATTER_ASSET_FINANCIAL_ACCOUNT_TABLE,
  vehicle: MATTER_ASSET_VEHICLE_TABLE,
  firearm: MATTER_ASSET_FIREARM_TABLE,
  businessInterest: MATTER_ASSET_BUSINESS_INTEREST_TABLE,
  insurancePolicy: MATTER_ASSET_INSURANCE_POLICY_TABLE,
  receivable: MATTER_ASSET_RECEIVABLE_TABLE,
  digitalAsset: MATTER_ASSET_DIGITAL_ASSET_TABLE,
};

export function matterAssetAttributeTable(assetClass: MatterAssetClass): string | undefined {
  return ATTRIBUTE_TABLE_BY_CLASS[assetClass];
}

// One attribute row, for whichever class the asset carries. Returns undefined for a class with no
// attribute table and for an asset whose attributes were never filled in — both are ordinary.
export async function readMatterAssetAttributes(
  database: SqlDatabase,
  assetClass: MatterAssetClass,
  assetId: MatterAssetId,
): Promise<Record<string, unknown> | undefined> {
  const table = matterAssetAttributeTable(assetClass);
  if (table === undefined) return undefined;
  const { results } = await database
    .prepare(`SELECT * FROM ${table} WHERE asset_id = ?1`)
    .bind(assetId)
    .all();
  return results[0];
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
