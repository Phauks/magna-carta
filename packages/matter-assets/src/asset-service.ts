import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
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
  insertMatterAssetFinancialAccountStatement,
  insertMatterAssetRealPropertyStatement,
  insertMatterAssetStatement,
  readMatterAsset,
  softDeleteMatterAssetStatement,
  updateMatterAssetStatement,
} from "./asset-statements.ts";
import { readMatterAssetType } from "./asset-type-statements.ts";
import { appendMatterAssetValuationStatement } from "./valuation-statements.ts";
import type { MatterAssetServiceOptions } from "./valuation-service.ts";
import type {
  MatterAssetClass,
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

export interface CreateMatterAssetInput {
  readonly matterId: MatterId;
  readonly assetClass: string;
  readonly description: string;
  readonly assetTypeId?: MatterAssetTypeId | null;
  readonly acquiredOn?: string | null;
  readonly estateTreatment?: MatterAssetEstateTreatment;
  readonly disposition?: MatterAssetDisposition;
  readonly dispositionOn?: string | null;
  readonly notes?: string | null;
  readonly realProperty?: RealPropertyAttributesInput;
  readonly financialAccount?: FinancialAccountAttributesInput;
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

// The attribute row for the class, where the class has one. A class declaring no attribute table
// takes no attributes at all, and naming another class's attributes is refused rather than ignored —
// a vehicle field quietly dropped on a firearm is data a person believes they recorded.
function attributeStatements(
  database: SqlDatabase,
  assetId: MatterAssetId,
  assetClass: MatterAssetClass,
  input: Pick<CreateMatterAssetInput, "realProperty" | "financialAccount">,
): SqlStatement[] {
  const statements: SqlStatement[] = [];
  if (input.realProperty !== undefined) {
    if (assetClass !== "realProperty") {
      throw new MatterAssetValidationError(
        "matter-asset-type-class-mismatch",
        `real-property attributes cannot be recorded on an asset of class ${assetClass}`,
      );
    }
    statements.push(
      insertMatterAssetRealPropertyStatement(database, {
        assetId,
        street: input.realProperty.street ?? null,
        city: input.realProperty.city ?? null,
        region: input.realProperty.region ?? null,
        postal: input.realProperty.postal ?? null,
        county: input.realProperty.county ?? null,
        parcelNumber: input.realProperty.parcelNumber ?? null,
        legalDescription: input.realProperty.legalDescription ?? null,
        recordingReference: input.realProperty.recordingReference ?? null,
      }),
    );
  }
  if (input.financialAccount !== undefined) {
    if (assetClass !== "financialAccount") {
      throw new MatterAssetValidationError(
        "matter-asset-type-class-mismatch",
        `financial-account attributes cannot be recorded on an asset of class ${assetClass}`,
      );
    }
    statements.push(
      insertMatterAssetFinancialAccountStatement(database, {
        assetId,
        institutionName: input.financialAccount.institutionName ?? null,
        institutionOrganizationId: input.financialAccount.institutionOrganizationId ?? null,
      }),
    );
  }
  return statements;
}

async function composeAssetStatements(
  database: SqlDatabase,
  input: CreateMatterAssetInput,
  options: MatterAssetServiceOptions,
): Promise<{ assetId: MatterAssetId; statements: SqlStatement[] }> {
  const assetClass = assertAvailableClass(input.assetClass);
  assertNonEmptyDescription(input.description);
  assertOptionalCivilDate(input.acquiredOn, "acquiredOn");
  assertOptionalCivilDate(input.dispositionOn, "dispositionOn");
  const assetTypeId = input.assetTypeId ?? null;
  await assertTypeBelongsToClass(database, assetClass, assetTypeId);

  const now = options.clock.now();
  const assetId = newIdentifier("matterAsset", options.randomSource);
  const statements: SqlStatement[] = [
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
  const statements: SqlStatement[] = [];
  for (const row of rows) {
    const composed = await composeAssetStatements(database, { ...row, matterId }, options);
    assetIds.push(composed.assetId);
    statements.push(...composed.statements);
  }
  return { assetIds, effect: { statements, outboxMessages: [] } };
}

export interface UpdateMatterAssetInput {
  // Present ONLY so a caller naming it gets an explainable refusal rather than a silently ignored
  // field. The class is frozen at creation; there is no path that changes it.
  readonly assetClass?: string;
  readonly assetTypeId?: MatterAssetTypeId | null;
  readonly description?: string;
  readonly acquiredOn?: string | null;
  readonly estateTreatment?: MatterAssetEstateTreatment;
  readonly disposition?: MatterAssetDisposition;
  readonly dispositionOn?: string | null;
  readonly custodyItemId?: CustodyItemId | null;
  readonly notes?: string | null;
  readonly realProperty?: RealPropertyAttributesInput;
  readonly financialAccount?: FinancialAccountAttributesInput;
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

  const now = options.clock.now();
  const statements: SqlStatement[] = [
    updateMatterAssetStatement(database, assetId, merged, now),
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
