import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import { guarded } from "@magna-carta/data-access/effect-batch";
import type { EffectStatement } from "@magna-carta/data-access/effect-batch";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  CustodyItemId,
  MatterAssetId,
  MatterAssetTypeId,
  MatterId,
} from "@magna-carta/identifiers/types";
import {
  insertMatterAssetBusinessInterestStatement,
  insertMatterAssetDigitalAssetStatement,
  insertMatterAssetFinancialAccountStatement,
  insertMatterAssetFirearmStatement,
  insertMatterAssetInsurancePolicyStatement,
  insertMatterAssetRealPropertyStatement,
  insertMatterAssetReceivableStatement,
  insertMatterAssetStatement,
  insertMatterAssetVehicleStatement,
  readMatterAsset,
  softDeleteMatterAssetStatement,
  updateMatterAssetStatement,
} from "./asset-statements.ts";
import { custodyItemExists } from "./custody-link-statements.ts";
import { readMatterAssetType } from "./asset-type-statements.ts";
import { appendMatterAssetValuationStatement } from "./valuation-statements.ts";
import type { MatterAssetServiceOptions } from "./valuation-service.ts";
import type {
  MatterAssetClass,
  MatterAssetDigitalCustodyModel,
  MatterAssetDisposition,
  MatterAssetEstateTreatment,
  MatterAssetValuationBasis,
} from "./types.ts";
import {
  MatterAssetValidationError,
  assertAmountShape,
  assertAvailableClass,
  assertBasis,
  assertBatchSize,
  assertCivilDate,
  assertNonEmptyDescription,
  assertOptionalCivilDate,
  assertTypeMatchesClass,
} from "./validation.ts";

// The asset row itself: recording one thing a client or an estate owns, editing it, and taking it
// off the register. The service validates in memory, composes statements into an effect batch, and
// holds no binding and no clock of its own — the caller supplies the firm-scoped database, the real
// clock, a random source, and the authenticated actor, none of which is ever client input.
//
// Two fields make a row: the class and a description. Everything else is optional, deliberately —
// the failure this register exists to prevent is a firm keeping its estate inventory in a
// spreadsheet, and every required attribute is a reason to do exactly that. There is NO completeness
// gate anywhere: no required-attribute matrix per class, no completeness score, no "this house needs
// a parcel number". The schedule surfaces what is missing; the write path never blocks on it.

export interface RealPropertyAttributesInput {
  readonly street?: string | null;
  readonly city?: string | null;
  readonly region?: string | null;
  readonly postal?: string | null;
  readonly county?: string | null;
  // Public record, so plaintext and indexed. The account number of a bank account is not, and does
  // not appear on any attribute row.
  readonly parcelNumber?: string | null;
  readonly legalDescription?: string | null;
  readonly recordingReference?: string | null;
}

export interface FinancialAccountAttributesInput {
  readonly institutionName?: string | null;
  // An optional directoryOrganization_ handle, carried by value.
  readonly institutionOrganizationId?: string | null;
}

export interface VehicleAttributesInput {
  readonly make?: string | null;
  readonly model?: string | null;
  readonly modelYear?: number | null;
  // On the title and etched in the windscreen, so plaintext and indexed — searching by it is the
  // point. Spelled out in full: never `vin`.
  readonly vehicleIdentificationNumber?: string | null;
  readonly plateNumber?: string | null;
  readonly plateRegion?: string | null;
}

export interface FirearmAttributesInput {
  readonly make?: string | null;
  readonly model?: string | null;
  readonly caliberOrGauge?: string | null;
  // On the bill of sale and on every piece of transfer paperwork, so plaintext and indexed.
  readonly serialNumber?: string | null;
  // Free text a person asserted. NOTHING reads it, nothing classifies an item under any regulatory
  // schedule, and nothing infers who may receive one.
  readonly regulatedCategory?: string | null;
}

export interface BusinessInterestAttributesInput {
  readonly entityName?: string | null;
  // An optional directoryOrganization_ handle, carried by value — the company the firm probably
  // already has as an entity.
  readonly entityOrganizationId?: string | null;
  readonly jurisdictionOfOrganization?: string | null;
  readonly entityForm?: string | null;
}

export interface InsurancePolicyAttributesInput {
  readonly carrierName?: string | null;
  readonly carrierOrganizationId?: string | null;
  // A TERM OF THE CONTRACT, not a valuation: what the policy is worth is a dated valuation row like
  // any other. Collapsing the two would make every term-life policy look like a liquid asset.
  readonly faceAmountMinor?: number | null;
  readonly faceCurrency?: string | null;
  readonly insuredEntityId?: string | null;
}

export interface ReceivableAttributesInput {
  readonly debtorEntityId?: string | null;
  readonly principalAmountMinor?: number | null;
  readonly principalCurrency?: string | null;
  readonly rateE4?: number | null;
  readonly maturityOn?: string | null;
  readonly secured?: boolean | null;
}

export interface DigitalAssetAttributesInput {
  readonly platformName?: string | null;
  // The public handle on the platform. There is no field here a seed phrase, a recovery phrase, or a
  // private key could ride on, and the identifier write path refuses one by name.
  readonly accountHandle?: string | null;
  readonly custodyModel?: MatterAssetDigitalCustodyModel | null;
}

// Every class's attribute bag, keyed by the class it belongs to. One shape rather than eight optional
// properties spelled out on three interfaces, so adding a class touches the table below and nothing
// else.
export interface MatterAssetAttributesInput {
  readonly realProperty?: RealPropertyAttributesInput;
  readonly financialAccount?: FinancialAccountAttributesInput;
  readonly vehicle?: VehicleAttributesInput;
  readonly firearm?: FirearmAttributesInput;
  readonly businessInterest?: BusinessInterestAttributesInput;
  readonly insurancePolicy?: InsurancePolicyAttributesInput;
  readonly receivable?: ReceivableAttributesInput;
  readonly digitalAsset?: DigitalAssetAttributesInput;
}

// A valuation supplied in the same call that creates the asset, written in the same batch. The
// common intake gesture is "a house on Elm Street, about four hundred thousand", and making that two
// requests would be the register losing to a spreadsheet.
export interface InlineValuationInput {
  readonly asOfDate: string;
  readonly amountMinor?: number | null;
  readonly currency?: string | null;
  readonly basis: string;
  readonly sourceNote?: string | null;
}

export interface CreateMatterAssetInput extends MatterAssetAttributesInput {
  readonly matterId: MatterId;
  readonly assetClass: string;
  readonly description: string;
  readonly assetTypeId?: MatterAssetTypeId | null;
  readonly acquiredOn?: string | null;
  readonly estateTreatment?: MatterAssetEstateTreatment;
  readonly disposition?: MatterAssetDisposition;
  readonly dispositionOn?: string | null;
  readonly notes?: string | null;
  readonly valuation?: InlineValuationInput;
}

async function assertTypeBelongsToClass(
  database: SqlDatabase,
  assetClass: MatterAssetClass,
  assetTypeId: MatterAssetTypeId | null,
): Promise<void> {
  if (assetTypeId === null) return;
  const assetType = await readMatterAssetType(database, assetTypeId);
  if (assetType === undefined) {
    throw new MatterAssetValidationError(
      "matter-asset-unknown-asset-type",
      "no such asset type in this firm",
    );
  }
  assertTypeMatchesClass(assetClass, assetType.class);
}

// One builder per class that carries structure — the whole table of them, in one place, so that
// adding a class is a row here and not a ninth `if` somebody has to remember to write in the same
// shape as the eight before it. Each takes the bag its class declares and returns the upsert.
const ATTRIBUTE_BUILDERS: {
  readonly [Key in keyof MatterAssetAttributesInput]-?: (
    database: SqlDatabase,
    assetId: MatterAssetId,
    attributes: NonNullable<MatterAssetAttributesInput[Key]>,
  ) => SqlStatement;
} = {
  realProperty: (database, assetId, attributes) =>
    insertMatterAssetRealPropertyStatement(database, {
      assetId,
      street: attributes.street ?? null,
      city: attributes.city ?? null,
      region: attributes.region ?? null,
      postal: attributes.postal ?? null,
      county: attributes.county ?? null,
      parcelNumber: attributes.parcelNumber ?? null,
      legalDescription: attributes.legalDescription ?? null,
      recordingReference: attributes.recordingReference ?? null,
    }),
  financialAccount: (database, assetId, attributes) =>
    insertMatterAssetFinancialAccountStatement(database, {
      assetId,
      institutionName: attributes.institutionName ?? null,
      institutionOrganizationId: attributes.institutionOrganizationId ?? null,
    }),
  vehicle: (database, assetId, attributes) =>
    insertMatterAssetVehicleStatement(database, {
      assetId,
      make: attributes.make ?? null,
      model: attributes.model ?? null,
      modelYear: attributes.modelYear ?? null,
      vehicleIdentificationNumber: attributes.vehicleIdentificationNumber ?? null,
      plateNumber: attributes.plateNumber ?? null,
      plateRegion: attributes.plateRegion ?? null,
    }),
  firearm: (database, assetId, attributes) =>
    insertMatterAssetFirearmStatement(database, {
      assetId,
      make: attributes.make ?? null,
      model: attributes.model ?? null,
      caliberOrGauge: attributes.caliberOrGauge ?? null,
      serialNumber: attributes.serialNumber ?? null,
      regulatedCategory: attributes.regulatedCategory ?? null,
    }),
  businessInterest: (database, assetId, attributes) =>
    insertMatterAssetBusinessInterestStatement(database, {
      assetId,
      entityName: attributes.entityName ?? null,
      entityOrganizationId: attributes.entityOrganizationId ?? null,
      jurisdictionOfOrganization: attributes.jurisdictionOfOrganization ?? null,
      entityForm: attributes.entityForm ?? null,
    }),
  insurancePolicy: (database, assetId, attributes) =>
    insertMatterAssetInsurancePolicyStatement(database, {
      assetId,
      carrierName: attributes.carrierName ?? null,
      carrierOrganizationId: attributes.carrierOrganizationId ?? null,
      faceAmountMinor: attributes.faceAmountMinor ?? null,
      faceCurrency: attributes.faceCurrency ?? null,
      insuredEntityId: attributes.insuredEntityId ?? null,
    }),
  receivable: (database, assetId, attributes) =>
    insertMatterAssetReceivableStatement(database, {
      assetId,
      debtorEntityId: attributes.debtorEntityId ?? null,
      principalAmountMinor: attributes.principalAmountMinor ?? null,
      principalCurrency: attributes.principalCurrency ?? null,
      rateE4: attributes.rateE4 ?? null,
      maturityOn: attributes.maturityOn ?? null,
      secured: attributes.secured ?? null,
    }),
  digitalAsset: (database, assetId, attributes) =>
    insertMatterAssetDigitalAssetStatement(database, {
      assetId,
      platformName: attributes.platformName ?? null,
      accountHandle: attributes.accountHandle ?? null,
      custodyModel: attributes.custodyModel ?? null,
    }),
};

const ATTRIBUTE_CLASSES = Object.keys(ATTRIBUTE_BUILDERS) as (keyof MatterAssetAttributesInput)[];

// The attribute row for the class, where the class has one. A class declaring no attribute table
// takes no attributes at all, and NAMING ANOTHER CLASS'S ATTRIBUTES IS REFUSED rather than ignored —
// a vehicle field quietly dropped on a firearm is data a person believes they recorded, and they will
// not find out until the schedule is short a column on the one occasion it matters.
function attributeStatements(
  database: SqlDatabase,
  assetId: MatterAssetId,
  assetClass: MatterAssetClass,
  input: MatterAssetAttributesInput,
): EffectStatement[] {
  const statements: EffectStatement[] = [];
  for (const key of ATTRIBUTE_CLASSES) {
    const attributes = input[key];
    if (attributes === undefined) continue;
    if (key !== assetClass) {
      throw new MatterAssetValidationError(
        "matter-asset-type-class-mismatch",
        `${key} attributes cannot be recorded on an asset of class ${assetClass}`,
      );
    }
    const build = ATTRIBUTE_BUILDERS[key] as (
      database: SqlDatabase,
      assetId: MatterAssetId,
      attributes: unknown,
    ) => SqlStatement;
    statements.push(build(database, assetId, attributes));
  }
  return statements;
}

async function composeAssetStatements(
  database: SqlDatabase,
  input: CreateMatterAssetInput,
  options: MatterAssetServiceOptions,
): Promise<{ assetId: MatterAssetId; statements: EffectStatement[] }> {
  const assetClass = assertAvailableClass(input.assetClass);
  assertNonEmptyDescription(input.description);
  assertOptionalCivilDate(input.acquiredOn, "acquiredOn");
  assertOptionalCivilDate(input.dispositionOn, "dispositionOn");
  const assetTypeId = input.assetTypeId ?? null;
  await assertTypeBelongsToClass(database, assetClass, assetTypeId);

  const now = options.clock.now();
  const assetId = newIdentifier("matterAsset", options.randomSource);
  const statements: EffectStatement[] = [
    insertMatterAssetStatement(database, {
      id: assetId,
      matterId: input.matterId,
      assetClass,
      assetTypeId,
      description: input.description,
      acquiredOn: input.acquiredOn ?? null,
      estateTreatment: input.estateTreatment ?? "undetermined",
      disposition: input.disposition ?? "retained",
      dispositionOn: input.dispositionOn ?? null,
      notes: input.notes ?? null,
      createdBy: options.actorUserId,
      now,
    }),
    ...attributeStatements(database, assetId, assetClass, input),
  ];

  if (input.valuation !== undefined) {
    assertCivilDate(input.valuation.asOfDate, "valuation.asOfDate");
    const basis: MatterAssetValuationBasis = assertBasis(input.valuation.basis);
    assertAmountShape(input.valuation.amountMinor, input.valuation.currency);
    statements.push(
      appendMatterAssetValuationStatement(database, {
        id: newIdentifier("matterAssetValuation", options.randomSource),
        assetId,
        // The asset's own value. An encumbrance cannot exist yet on an asset being created, so an
        // inline figure is never a balance.
        encumbranceId: null,
        asOfDate: input.valuation.asOfDate,
        amountMinor: input.valuation.amountMinor ?? null,
        currency: input.valuation.currency ?? null,
        basis,
        sourceNote: input.valuation.sourceNote ?? null,
        supportingFileId: null,
        correctsValuationId: null,
        recordedBy: options.actorUserId,
        recordedAt: now,
      }),
    );
  }

  // Identifiers and the class only. Never a description, an address, a parcel number, an entity
  // name, or an amount — the audit log is not a second place a matter's content lives.
  statements.push(
    domainAuditStatement(database, {
      event: "matterAsset.recorded",
      subjectId: assetId,
      actorUserId: options.actorUserId,
      clock: options.clock,
      randomSource: options.randomSource,
      metadata: { matterId: input.matterId, class: assetClass },
    }),
  );
  return { assetId, statements };
}

export async function createMatterAsset(
  database: SqlDatabase,
  input: CreateMatterAssetInput,
  options: MatterAssetServiceOptions,
): Promise<{ assetId: MatterAssetId; effect: EffectWrite }> {
  const { assetId, statements } = await composeAssetStatements(database, input, options);
  return { assetId, effect: { statements, outboxMessages: [] } };
}

// Bulk quick entry: a paralegal working from a client questionnaire enters twenty items in one
// submit rather than twenty round trips. ONE batch, one audit row per asset, and the whole call is
// idempotency-keyed at the route — deferring this would make the interface build a client-side loop
// that half-fails, and retrofitting idempotency onto that is worse than building the route now.
export async function createMatterAssetBatch(
  database: SqlDatabase,
  matterId: MatterId,
  rows: readonly Omit<CreateMatterAssetInput, "matterId">[],
  options: MatterAssetServiceOptions,
): Promise<{ assetIds: MatterAssetId[]; effect: EffectWrite }> {
  assertBatchSize(rows.length);
  const assetIds: MatterAssetId[] = [];
  const statements: EffectStatement[] = [];
  for (const row of rows) {
    const composed = await composeAssetStatements(database, { ...row, matterId }, options);
    assetIds.push(composed.assetId);
    statements.push(...composed.statements);
  }
  return { assetIds, effect: { statements, outboxMessages: [] } };
}

export interface UpdateMatterAssetInput extends MatterAssetAttributesInput {
  // Present ONLY so a caller naming it gets an explainable refusal rather than a silently ignored
  // field. The class is frozen at creation; there is no path that changes it.
  readonly assetClass?: string;
  readonly assetTypeId?: MatterAssetTypeId | null;
  readonly description?: string;
  readonly acquiredOn?: string | null;
  readonly estateTreatment?: MatterAssetEstateTreatment;
  readonly disposition?: MatterAssetDisposition;
  readonly dispositionOn?: string | null;
  // The custody item that physically holds this thing, SET AND CLEARED HERE. The write path checks
  // the item exists in this firm; nothing else about it is copied onto the asset row — not its
  // location, not its status, not its declared value — and Custodian learns nothing about the estate.
  readonly custodyItemId?: CustodyItemId | null;
  readonly notes?: string | null;
}

export async function updateMatterAsset(
  database: SqlDatabase,
  assetId: MatterAssetId,
  patch: UpdateMatterAssetInput,
  options: MatterAssetServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const existing = await readMatterAsset(database, assetId);
  if (existing === undefined) {
    throw new MatterAssetValidationError(
      "matter-asset-unknown-asset",
      "no such asset in this firm",
    );
  }
  if (patch.assetClass !== undefined && patch.assetClass !== existing.class) {
    throw new MatterAssetValidationError(
      "matter-asset-class-frozen",
      "an asset's class is fixed when it is recorded: delete this row and record it under the right class",
    );
  }
  const merged = {
    assetTypeId: patch.assetTypeId === undefined ? existing.asset_type_id : patch.assetTypeId,
    description: patch.description ?? existing.description,
    acquiredOn: patch.acquiredOn === undefined ? existing.acquired_on : patch.acquiredOn,
    estateTreatment: patch.estateTreatment ?? existing.estate_treatment,
    disposition: patch.disposition ?? existing.disposition,
    dispositionOn:
      patch.dispositionOn === undefined ? existing.disposition_on : patch.dispositionOn,
    custodyItemId:
      patch.custodyItemId === undefined ? existing.custody_item_id : patch.custodyItemId,
    notes: patch.notes === undefined ? existing.notes : patch.notes,
  };
  assertNonEmptyDescription(merged.description);
  assertOptionalCivilDate(merged.acquiredOn, "acquiredOn");
  assertOptionalCivilDate(merged.dispositionOn, "dispositionOn");
  await assertTypeBelongsToClass(database, existing.class, merged.assetTypeId);
  // The custody link comes into use here. Checked only when the patch NAMES it: re-saving an asset
  // whose link was set long ago should not re-read Custodian, and clearing the link (an explicit
  // null) checks nothing because there is nothing to check.
  if (patch.custodyItemId !== undefined && patch.custodyItemId !== null) {
    if (!(await custodyItemExists(database, patch.custodyItemId))) {
      throw new MatterAssetValidationError(
        "matter-asset-unknown-custody-item",
        "no such custody item in this firm: the link says the firm holds the physical original, so a link to nothing would be worse than no link",
      );
    }
  }

  const now = options.clock.now();
  const statements: EffectStatement[] = [
    guarded(updateMatterAssetStatement(database, assetId, merged, now), "matter-asset.update"),
    ...attributeStatements(database, assetId, existing.class, patch),
    domainAuditStatement(database, {
      event: "matterAsset.updated",
      subjectId: assetId,
      actorUserId: options.actorUserId,
      clock: options.clock,
      randomSource: options.randomSource,
      metadata: { matterId: existing.matter_id, class: existing.class },
    }),
  ];
  return { effect: { statements, outboxMessages: [] } };
}

// Soft delete. The valuation history and the document links hang off the row and the history is
// append-only, so removing the row outright is not a shape this table has.
export async function deleteMatterAsset(
  database: SqlDatabase,
  assetId: MatterAssetId,
  options: MatterAssetServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const existing = await readMatterAsset(database, assetId);
  if (existing === undefined) {
    throw new MatterAssetValidationError(
      "matter-asset-unknown-asset",
      "no such asset in this firm",
    );
  }
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        softDeleteMatterAssetStatement(database, assetId, now),
        domainAuditStatement(database, {
          event: "matterAsset.deleted",
          subjectId: assetId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { matterId: existing.matter_id, class: existing.class },
        }),
      ],
      outboxMessages: [],
    },
  };
}
