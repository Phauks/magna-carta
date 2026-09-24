import { CIVIL_DATE_PATTERN } from "@magna-carta/civil-time/civil-date";
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { readCustomFieldValuesForScope } from "@magna-carta/custom-fields/reads";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import {
  commitEffectBatch,
  type BatchDatabase,
  type EffectWrite,
} from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { ProtectedReadForbiddenError } from "@magna-carta/data-access/protected-fields";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type {
  FileId,
  MatterAssetDocumentId,
  MatterAssetEncumbranceId,
  MatterAssetId,
  MatterAssetIdentifierId,
  MatterAssetInterestId,
  MatterAssetTypeId,
  MatterAssetValuationId,
  MatterId,
} from "@magna-carta/identifiers/types";
import { resolveMatterAssetValueAsOf } from "@magna-carta/matter-assets/as-of";
import {
  createMatterAsset,
  createMatterAssetBatch,
  deleteMatterAsset,
  updateMatterAsset,
} from "@magna-carta/matter-assets/asset-service";
import {
  readMatterAsset,
  readMatterAssetAttributes,
  type MatterAssetRow,
} from "@magna-carta/matter-assets/asset-statements";
import { createMatterAssetType } from "@magna-carta/matter-assets/asset-type-service";
import { readMatterAssetTypes } from "@magna-carta/matter-assets/asset-type-statements";
import { MATTER_ASSET_CLASS_REGISTRY } from "@magna-carta/matter-assets/classes";
import { readCustodyPlacementForAsset } from "@magna-carta/matter-assets/custody-link-statements";
import {
  recordMatterAssetEncumbrance,
  releaseMatterAssetEncumbrance,
} from "@magna-carta/matter-assets/encumbrance-service";
import {
  readEncumbranceBalancesAsOf,
  readMatterAssetEncumbrances,
} from "@magna-carta/matter-assets/encumbrance-statements";
import { encumbrancesInForceAsOf, matterAssetEquity } from "@magna-carta/matter-assets/equity";
import { readMatterAssetSchedule } from "@magna-carta/matter-assets/schedule";
import {
  linkMatterAssetDocument,
  unlinkMatterAssetDocument,
} from "@magna-carta/matter-assets/document-link-service";
import { readMatterAssetDocuments } from "@magna-carta/matter-assets/document-link-statements";
import {
  recordMatterAssetIdentifier,
  readMatterAssetIdentifierValue,
} from "@magna-carta/matter-assets/identifier-service";
import { readMatterAssetIdentifiers } from "@magna-carta/matter-assets/identifier-statements";
import {
  addMatterAssetInterest,
  endMatterAssetInterest,
} from "@magna-carta/matter-assets/interest-service";
import { readMatterAssetInterests } from "@magna-carta/matter-assets/interest-statements";
import { readMatterAssetPage } from "@magna-carta/matter-assets/queries";
import {
  MATTER_ASSET_CLASSES,
  MATTER_ASSET_DIGITAL_CUSTODY_MODELS,
  MATTER_ASSET_DISPOSITIONS,
  MATTER_ASSET_DOCUMENT_KINDS,
  MATTER_ASSET_ENCUMBRANCE_KINDS,
  MATTER_ASSET_ESTATE_TREATMENTS,
  MATTER_ASSET_VALUATION_BASES,
  MAX_MATTER_ASSET_BATCH,
} from "@magna-carta/matter-assets/types";
import { MatterAssetValidationError } from "@magna-carta/matter-assets/validation";
import { pageMatterAssetValuations } from "@magna-carta/matter-assets/valuation-statements";
import { appendMatterAssetValuation } from "@magna-carta/matter-assets/valuation-service";
import type { Context } from "hono";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import {
  idempotencyKeyHeader,
  identifierField,
  identifierPathParam,
} from "../../contracts/common.ts";
import { cursorQuery, paginated } from "../../contracts/pagination.ts";
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { firmKeyProviderForEnv } from "../../../firm-key-provider-wiring.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";
import { loadEffectivePermissions } from "../../../effective-permissions.ts";

// The matter asset register's HTTP surface over @magna-carta/matter-assets: what a client or an
// estate owns, what it was worth on a given date, who holds an interest in it, and which documents
// evidence it.
//
// Three things this surface never does, and they are the subsystem's whole position. It never
// returns a value without the date that value speaks to. It never edits or deletes a recorded
// valuation — there is no route that could, which is the API expression of the append-only history.
// And it never stores a credential: a request naming a password, a seed phrase, or a safe
// combination is refused with its own explainable problem rather than sealed away.

const READ = "matterAssets:read" as const;
const MANAGE = "matterAssets:manage" as const;

const CIVIL_DATE = CIVIL_DATE_PATTERN;
const DEFAULT_PAGE = 50;

// ---- request/response contracts ----

// The attribute shapes are declared once and registered under TWO component names — the request
// variant and the nullable detail variant — because a component name has to map to exactly one
// schema shape in the emitted contract, and `.nullable()` is a different shape.
const realPropertyAttributeShape = {
  street: z.string().max(200).nullable().optional(),
  city: z.string().max(120).nullable().optional(),
  region: z.string().max(120).nullable().optional(),
  postal: z.string().max(40).nullable().optional(),
  county: z.string().max(120).nullable().optional(),
  // On the assessor's public roll, so an ordinary searchable field. A full account number is not,
  // and has no place on any attribute row.
  parcelNumber: z.string().max(80).nullable().optional(),
  legalDescription: z.string().max(4000).nullable().optional(),
  recordingReference: z.string().max(120).nullable().optional(),
};

const RealPropertyAttributes = z
  .object(realPropertyAttributeShape)
  .openapi("MatterAssetRealPropertyAttributes");

const RealPropertyDetail = z
  .object(realPropertyAttributeShape)
  .openapi("MatterAssetRealPropertyDetail");

const financialAccountAttributeShape = {
  institutionName: z.string().max(200).nullable().optional(),
  // A directoryOrganization_ handle, carried by value.
  institutionOrganizationId: z.string().min(1).max(128).nullable().optional(),
};

const FinancialAccountAttributes = z
  .object(financialAccountAttributeShape)
  .openapi("MatterAssetFinancialAccountAttributes");

const FinancialAccountDetail = z
  .object(financialAccountAttributeShape)
  .openapi("MatterAssetFinancialAccountDetail");

const vehicleAttributeShape = {
  make: z.string().max(120).nullable().optional(),
  model: z.string().max(120).nullable().optional(),
  modelYear: z.number().int().min(1885).max(2200).nullable().optional(),
  // On the title and etched in the windscreen, so an ordinary searchable field. Spelled out in full.
  vehicleIdentificationNumber: z.string().max(40).nullable().optional(),
  plateNumber: z.string().max(20).nullable().optional(),
  plateRegion: z.string().max(120).nullable().optional(),
};
const VehicleAttributes = z.object(vehicleAttributeShape).openapi("MatterAssetVehicleAttributes");
const VehicleDetail = z.object(vehicleAttributeShape).openapi("MatterAssetVehicleDetail");

const firearmAttributeShape = {
  make: z.string().max(120).nullable().optional(),
  model: z.string().max(120).nullable().optional(),
  caliberOrGauge: z.string().max(60).nullable().optional(),
  // On the bill of sale and on transfer paperwork, so an ordinary searchable field.
  serialNumber: z.string().max(60).nullable().optional(),
  // Free text somebody asserted. Nothing reads it and nothing is inferred from it: this register
  // records what is held and encodes no transfer law.
  regulatedCategory: z.string().max(200).nullable().optional(),
};
const FirearmAttributes = z.object(firearmAttributeShape).openapi("MatterAssetFirearmAttributes");
const FirearmDetail = z.object(firearmAttributeShape).openapi("MatterAssetFirearmDetail");

const businessInterestAttributeShape = {
  entityName: z.string().max(200).nullable().optional(),
  entityOrganizationId: z.string().min(1).max(128).nullable().optional(),
  jurisdictionOfOrganization: z.string().max(120).nullable().optional(),
  entityForm: z.string().max(120).nullable().optional(),
};
const BusinessInterestAttributes = z
  .object(businessInterestAttributeShape)
  .openapi("MatterAssetBusinessInterestAttributes");
const BusinessInterestDetail = z
  .object(businessInterestAttributeShape)
  .openapi("MatterAssetBusinessInterestDetail");

const insurancePolicyAttributeShape = {
  carrierName: z.string().max(200).nullable().optional(),
  carrierOrganizationId: z.string().min(1).max(128).nullable().optional(),
  // A TERM OF THE POLICY, not what the policy is worth. What it is worth — its cash surrender value —
  // is a dated valuation like any other, and collapsing the two would make every term-life policy
  // look like a liquid asset worth its death benefit.
  faceAmountMinor: z.number().int().nullable().optional(),
  faceCurrency: z.string().length(3).nullable().optional(),
  insuredEntityId: z.string().min(1).max(128).nullable().optional(),
};
const InsurancePolicyAttributes = z
  .object(insurancePolicyAttributeShape)
  .openapi("MatterAssetInsurancePolicyAttributes");
const InsurancePolicyDetail = z
  .object(insurancePolicyAttributeShape)
  .openapi("MatterAssetInsurancePolicyDetail");

const receivableAttributeShape = {
  debtorEntityId: z.string().min(1).max(128).nullable().optional(),
  principalAmountMinor: z.number().int().nullable().optional(),
  principalCurrency: z.string().length(3).nullable().optional(),
  // A rate as ten-thousandths, never a float.
  rateE4: z.number().int().nullable().optional(),
  maturityOn: z.string().regex(CIVIL_DATE).nullable().optional(),
  // Asserted by a person. Nothing derives a priority, a remedy, or a redemption period from it.
  secured: z.boolean().nullable().optional(),
};
const ReceivableAttributes = z
  .object(receivableAttributeShape)
  .openapi("MatterAssetReceivableAttributes");
const ReceivableDetail = z.object(receivableAttributeShape).openapi("MatterAssetReceivableDetail");

const digitalAssetAttributeShape = {
  platformName: z.string().max(200).nullable().optional(),
  // The PUBLIC handle on the platform, never a login. There is no field on this shape a seed phrase,
  // a recovery phrase, or a private key could ride on, and a request naming one is refused by name.
  accountHandle: z.string().max(200).nullable().optional(),
  custodyModel: z.enum(MATTER_ASSET_DIGITAL_CUSTODY_MODELS).nullable().optional(),
};
const DigitalAssetAttributes = z
  .object(digitalAssetAttributeShape)
  .openapi("MatterAssetDigitalAssetAttributes");
const DigitalAssetDetail = z
  .object(digitalAssetAttributeShape)
  .openapi("MatterAssetDigitalAssetDetail");

const InlineValuation = z
  .object({
    // The date the figure speaks to — never assumed to be today, and never defaulted.
    asOfDate: z.string().regex(CIVIL_DATE),
    amountMinor: z.number().int().nullable().optional(),
    currency: z.string().length(3).nullable().optional(),
    basis: z.enum(MATTER_ASSET_VALUATION_BASES),
    sourceNote: z.string().max(2000).nullable().optional(),
  })
  .openapi("MatterAssetInlineValuation");

const CreateAssetBody = z
  .object({
    assetClass: z.enum(MATTER_ASSET_CLASSES),
    description: z.string().min(1).max(2000),
    assetTypeId: identifierField("matterAssetType").nullable().optional(),
    acquiredOn: z.string().regex(CIVIL_DATE).nullable().optional(),
    estateTreatment: z.enum(MATTER_ASSET_ESTATE_TREATMENTS).optional(),
    disposition: z.enum(MATTER_ASSET_DISPOSITIONS).optional(),
    dispositionOn: z.string().regex(CIVIL_DATE).nullable().optional(),
    notes: z.string().max(4000).nullable().optional(),
    realProperty: RealPropertyAttributes.optional(),
    financialAccount: FinancialAccountAttributes.optional(),
    vehicle: VehicleAttributes.optional(),
    firearm: FirearmAttributes.optional(),
    businessInterest: BusinessInterestAttributes.optional(),
    insurancePolicy: InsurancePolicyAttributes.optional(),
    receivable: ReceivableAttributes.optional(),
    digitalAsset: DigitalAssetAttributes.optional(),
    // A value typed in the same breath as the thing, written in the same commit. The common intake
    // gesture is "a house on Elm Street, about four hundred thousand".
    valuation: InlineValuation.optional(),
  })
  .openapi("CreateMatterAssetRequest");

const BatchCreateAssetsRequest = z
  .object({ assets: z.array(CreateAssetBody).min(1).max(MAX_MATTER_ASSET_BATCH) })
  .openapi("CreateMatterAssetBatchRequest");

const UpdateAssetRequest = CreateAssetBody.omit({ valuation: true })
  .partial()
  .extend({
    custodyItemId: identifierField("custodyItem").nullable().optional(),
    // Accepted by the schema and always REFUSED by the write path, deliberately: a class silently
    // stripped from a request is a change a person believes they made. A mis-classed row is deleted
    // and recorded again.
    assetClass: z.enum(MATTER_ASSET_CLASSES).optional(),
  })
  .openapi("UpdateMatterAssetRequest");

const AssetSummary = z
  .object({
    id: z.string(),
    matterId: z.string(),
    assetClass: z.enum(MATTER_ASSET_CLASSES),
    assetTypeId: z.string().nullable(),
    description: z.string(),
    acquiredOn: z.string().nullable(),
    estateTreatment: z.enum(MATTER_ASSET_ESTATE_TREATMENTS),
    disposition: z.enum(MATTER_ASSET_DISPOSITIONS),
    dispositionOn: z.string().nullable(),
    custodyItemId: z.string().nullable(),
    notes: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("MatterAssetSummary");

// A resolved value ALWAYS travels with the date it speaks to and the footing it rests on. The three
// are one object rather than three optional fields precisely so a caller cannot render one without
// the others.
const ResolvedValue = z
  .object({
    valuationId: z.string(),
    // At or before the date asked for, and frequently earlier — how stale the answer is, stated.
    asOfDate: z.string(),
    amountMinor: z.number().int().nullable(),
    currency: z.string().nullable(),
    basis: z.enum(MATTER_ASSET_VALUATION_BASES),
    sourceNote: z.string().nullable(),
    supportingFileId: z.string().nullable(),
    recordedAt: z.string(),
  })
  .openapi("MatterAssetResolvedValue");

const ValuationDetail = z
  .object({
    id: z.string(),
    assetId: z.string(),
    asOfDate: z.string(),
    amountMinor: z.number().int().nullable(),
    currency: z.string().nullable(),
    basis: z.enum(MATTER_ASSET_VALUATION_BASES),
    sourceNote: z.string().nullable(),
    supportingFileId: z.string().nullable(),
    correctsValuationId: z.string().nullable(),
    recordedBy: z.string().nullable(),
    recordedAt: z.string(),
  })
  .openapi("MatterAssetValuationDetail");

const InterestDetail = z
  .object({
    id: z.string(),
    entityId: z.string(),
    interestRole: z.string().nullable(),
    shareNumerator: z.number().int().nullable(),
    shareDenominator: z.number().int().nullable(),
    effectiveFrom: z.string(),
    effectiveTo: z.string().nullable(),
  })
  .openapi("MatterAssetInterestDetail");

const DocumentLinkDetail = z
  .object({
    id: z.string(),
    fileId: z.string(),
    kind: z.enum(MATTER_ASSET_DOCUMENT_KINDS),
    note: z.string().nullable(),
    linkedAt: z.string(),
    linkedBy: z.string().nullable(),
  })
  .openapi("MatterAssetDocumentLinkDetail");

// The identifier as every ordinary read returns it: the kind and the last four characters. There is
// no field on this shape that could carry a full number, which is what makes a list, a detail, and a
// schedule structurally incapable of leaking one.
const IdentifierSummary = z
  .object({
    id: z.string(),
    kind: z.string(),
    displaySuffix: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("MatterAssetIdentifierSummary");

const IdentifierValueResponse = z
  .object({ value: z.string().nullable() })
  .openapi("MatterAssetIdentifierValueResponse");

// A charge secured against the asset. Its BALANCE is not here: a balance is a dated valuation row
// naming the encumbrance, so it arrives with the equity below, carrying the date it speaks to.
const EncumbranceDetail = z
  .object({
    id: z.string(),
    kind: z.enum(MATTER_ASSET_ENCUMBRANCE_KINDS),
    holderEntityId: z.string().nullable(),
    holderName: z.string().nullable(),
    recordedReference: z.string().nullable(),
    releasedOn: z.string().nullable(),
    notes: z.string().nullable(),
  })
  .openapi("MatterAssetEncumbranceDetail");

const EncumbranceBalance = z
  .object({
    encumbranceId: z.string(),
    kind: z.enum(MATTER_ASSET_ENCUMBRANCE_KINDS),
    holderName: z.string().nullable(),
    // Null where no balance was recorded at or before the date. Unstated, never zero — a charge whose
    // size nobody has written down would otherwise overstate the equity of exactly the assets a firm
    // most needs to be careful about.
    amountMinor: z.number().int().nullable(),
    currency: z.string().nullable(),
    // The date the balance actually speaks to, which may be earlier than the date asked for.
    asOfDate: z.string().nullable(),
  })
  .openapi("MatterAssetEncumbranceBalance");

// Value minus what is secured against it, as of the requested date, per currency. COMPUTED AND NEVER
// STORED, and withheld rather than approximated: an amount is present only when the value and every
// charge in force resolve in the same currency, and `unavailableReason` says which of the three ways
// it could not.
// Registered under TWO component names — the nullable variant the asset detail carries and the
// always-present variant a schedule row carries — because a component name has to map to exactly one
// schema shape in the emitted contract, and `.nullable()` is a different shape.
const equityShape = {
  amountMinor: z.number().int().nullable(),
  currency: z.string().nullable(),
  unavailableReason: z.string().nullable(),
  balances: z.array(EncumbranceBalance),
};
const EquityDetail = z.object(equityShape).openapi("MatterAssetEquityDetail");
const ScheduleRowEquity = z.object(equityShape).openapi("MatterAssetScheduleRowEquity");

// What the safekeeping register says about the linked object RIGHT NOW. Composed by READING
// Custodian at the moment of this request and stored on no asset column, so it can never be stale —
// where the thing is, and whether it may be released, are Custodian's facts and stay Custodian's.
const CustodyPlacementDetail = z
  .object({
    custodyItemId: z.string(),
    description: z.string(),
    status: z.string(),
    custodyNumber: z.string(),
    packetStatus: z.string(),
    locationName: z.string().nullable(),
    // Whether a hold is in force. A boolean and not the hold's kind or reason: whether the thing may
    // leave the building is a decision the safekeeping register makes on its own surface.
    held: z.boolean(),
  })
  .openapi("MatterAssetCustodyPlacement");

// One of the firm's own fields as it stands on this asset. The definition travels with the value
// because the value alone cannot be read: the same stored 500 is five hundred on a number field and
// five dollars on a currency field, and which value column carries the answer follows from the kind.
//
// Every value column is null when the field is defined for this asset's class and nobody has filled
// it in — which is a different state from the field not applying here at all, and the row's presence
// is what distinguishes them. A picklist reports its chosen option's handle and a reference its
// referenced record's handle; resolving either to a label is the caller's read, exactly as it is on
// the record-values route this shape follows.
const AssetCustomFieldValue = z
  .object({
    fieldId: z.string(),
    name: z.string(),
    kind: z.string(),
    numberScale: z.number().int().nullable(),
    required: z.boolean(),
    position: z.number().int(),
    valueId: z.string().nullable(),
    valueText: z.string().nullable(),
    valueNumber: z.number().nullable(),
    valueDate: z.string().nullable(),
    valueOptionId: z.string().nullable(),
    valueReferenceId: z.string().nullable(),
    validFrom: z.string().nullable(),
  })
  .openapi("MatterAssetCustomFieldValue");

const AssetDetail = z
  .object({
    asset: AssetSummary,
    realProperty: RealPropertyDetail.nullable(),
    financialAccount: FinancialAccountDetail.nullable(),
    vehicle: VehicleDetail.nullable(),
    firearm: FirearmDetail.nullable(),
    businessInterest: BusinessInterestDetail.nullable(),
    insurancePolicy: InsurancePolicyDetail.nullable(),
    receivable: ReceivableDetail.nullable(),
    digitalAsset: DigitalAssetDetail.nullable(),
    interests: z.array(InterestDetail),
    encumbrances: z.array(EncumbranceDetail),
    // Present only when the caller asked as of a date: equity is a function of two dated assertions
    // and has no meaning without one.
    equity: EquityDetail.nullable(),
    documents: z.array(DocumentLinkDetail),
    identifiers: z.array(IdentifierSummary),
    // Null when the asset is not linked, or when the linked item has since gone from the safekeeping
    // register. Nothing here is copied onto the asset row.
    custody: CustodyPlacementDetail.nullable(),
    // Present only when the caller asked as of a date AND a figure resolves at or before it. Null is
    // a correct and common answer: an unvalued asset reports as unvalued rather than as zero.
    valueAsOf: ResolvedValue.nullable(),
    // The standing, non-jurisdictional notice for this asset's class, where its class carries one.
    // Rendered and never acted on — nothing in the platform branches on it.
    classHandlingNote: z.string().nullable(),
    // The firm's own fields for this asset's class, with whatever this asset holds for each. Written
    // through the custom-fields value routes like every other record's — this register mints no
    // second way to store a firm's own field, and the engine's lifecycle, caps, value history, and
    // handle-not-name binding all apply here unchanged.
    customFields: z.array(AssetCustomFieldValue),
  })
  .openapi("MatterAssetDetail");

const AssetTypeDetail = z
  .object({
    id: z.string(),
    name: z.string(),
    assetClass: z.enum(MATTER_ASSET_CLASSES),
    code: z.string().nullable(),
    active: z.boolean(),
    position: z.number().int(),
  })
  .openapi("MatterAssetTypeDetail");

const CreateAssetTypeRequest = z
  .object({
    name: z.string().min(1).max(120),
    assetClass: z.enum(MATTER_ASSET_CLASSES),
    code: z.string().min(1).max(40).nullable().optional(),
    position: z.number().int().min(0).max(999).optional(),
  })
  .openapi("CreateMatterAssetTypeRequest");

const AssetClassDetail = z
  .object({
    key: z.enum(MATTER_ASSET_CLASSES),
    label: z.string(),
    handlingNote: z.string().nullable(),
    available: z.boolean(),
  })
  .openapi("MatterAssetClassDetail");

const AppendValuationRequest = InlineValuation.extend({
  supportingFileId: identifierField("file").nullable().optional(),
  // Set to record an ENCUMBRANCE's balance rather than the asset's own value — the same append-only
  // table, the same correction discipline, and the same as-of read. Must name a charge on this asset.
  encumbranceId: identifierField("matterAssetEncumbrance").nullable().optional(),
  // A correction names the row it replaces. It never edits it: both stay on the record, and the
  // named row stops resolving in every as-of read.
  correctsValuationId: identifierField("matterAssetValuation").nullable().optional(),
}).openapi("AppendMatterAssetValuationRequest");

const AddInterestRequest = z
  .object({
    // A directoryPerson_/directoryOrganization_ handle, carried by value.
    entityId: z.string().min(1).max(128),
    // Validated against the firm's own catalog, never a platform vocabulary.
    interestRole: z.string().max(120).nullable().optional(),
    // A rational number, because one third is not a decimal.
    shareNumerator: z.number().int().min(0).nullable().optional(),
    shareDenominator: z.number().int().min(1).nullable().optional(),
    effectiveFrom: z.string().regex(CIVIL_DATE),
  })
  .openapi("AddMatterAssetInterestRequest");

const EndInterestRequest = z
  .object({ effectiveTo: z.string().regex(CIVIL_DATE) })
  .openapi("EndMatterAssetInterestRequest");

const RecordEncumbranceRequest = z
  .object({
    kind: z.enum(MATTER_ASSET_ENCUMBRANCE_KINDS),
    // A directoryPerson_/directoryOrganization_ handle, carried by value.
    holderEntityId: z.string().min(1).max(128).nullable().optional(),
    // Free text where no Directory record exists — writing every lender a firm ever sees into the
    // Directory would pollute the conflicts corpus with counterparties nobody is conflicted against.
    holderName: z.string().max(200).nullable().optional(),
    recordedReference: z.string().max(200).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .openapi("RecordMatterAssetEncumbranceRequest");

const ReleaseEncumbranceRequest = z
  .object({ releasedOn: z.string().regex(CIVIL_DATE) })
  .openapi("ReleaseMatterAssetEncumbranceRequest");

const ScheduleRow = z
  .object({
    assetId: z.string(),
    description: z.string(),
    assetTypeName: z.string().nullable(),
    estateTreatment: z.enum(MATTER_ASSET_ESTATE_TREATMENTS),
    disposition: z.string(),
    acquiredOn: z.string().nullable(),
    custodyItemId: z.string().nullable(),
    value: ResolvedValue.nullable(),
    equity: ScheduleRowEquity,
  })
  .openapi("MatterAssetScheduleRow");

const ScheduleSubtotal = z
  .object({
    currency: z.string(),
    valueAmountMinor: z.number().int(),
    // Absent where one charge in force carries no balance: a subtotal computed over the rows that
    // happened to work looks complete and is not.
    equityAmountMinor: z.number().int().nullable(),
    countedAssets: z.number().int(),
  })
  .openapi("MatterAssetScheduleSubtotal");

const ScheduleGroup = z
  .object({
    assetClass: z.enum(MATTER_ASSET_CLASSES),
    label: z.string(),
    rows: z.array(ScheduleRow),
    subtotals: z.array(ScheduleSubtotal),
    unvaluedCount: z.number().int(),
  })
  .openapi("MatterAssetScheduleGroup");

const ScheduleResponse = z
  .object({
    matterId: z.string(),
    asOfDate: z.string(),
    groups: z.array(ScheduleGroup),
    totalAssets: z.number().int(),
    // Stated rather than hidden: "eleven of these forty have no number yet" is the actionable
    // statement, and a subtotal quietly computed over twenty-nine is not.
    unvaluedCount: z.number().int(),
    estateTreatmentCounts: z.object({
      probateEstate: z.number().int(),
      nonProbateTransfer: z.number().int(),
      undetermined: z.number().int(),
    }),
  })
  .openapi("MatterAssetSchedule");

const LinkDocumentRequest = z
  .object({
    // An ALREADY-INGESTED matter file. No bytes reach this surface: upload is the File Manager's
    // presigned-upload and quarantine chokepoint, and this route links the resulting handle.
    fileId: identifierField("file"),
    kind: z.enum(MATTER_ASSET_DOCUMENT_KINDS),
    note: z.string().max(2000).nullable().optional(),
  })
  .openapi("LinkMatterAssetDocumentRequest");

const RecordIdentifierRequest = z
  .object({
    // Deliberately a plain string rather than an enum: a request asking to store a "seedPhrase" gets
    // the credential refusal by name, with a message that says where such a secret belongs, instead
    // of an unexplained schema rejection.
    kind: z.string().min(1).max(60),
    // Sealed before it reaches storage, and readable in full only through the one audited read.
    value: z.string().min(1).max(200).nullable().optional(),
    // Supplied only where no full value is given.
    displaySuffix: z.string().max(4).nullable().optional(),
  })
  .openapi("RecordMatterAssetIdentifierRequest");

const CreatedResponse = z.object({ id: z.string() }).openapi("MatterAssetCreatedResponse");
const BatchCreatedResponse = z
  .object({ ids: z.array(z.string()) })
  .openapi("MatterAssetBatchCreatedResponse");
const AcknowledgedResponse = z.object({ ok: z.literal(true) }).openapi("MatterAssetAckResponse");

const matterIdParam = z.object({ matterId: identifierPathParam("matter", "matterId") });
const assetIdParam = z.object({ assetId: identifierPathParam("matterAsset", "assetId") });
const interestIdParam = assetIdParam.extend({
  interestId: identifierPathParam("matterAssetInterest", "interestId"),
});
const documentLinkIdParam = assetIdParam.extend({
  documentLinkId: identifierPathParam("matterAssetDocument", "documentLinkId"),
});
const identifierIdParam = assetIdParam.extend({
  identifierId: identifierPathParam("matterAssetIdentifier", "identifierId"),
});
const assetListQuery = cursorQuery.extend({
  assetClass: z.enum(MATTER_ASSET_CLASSES).optional(),
  assetTypeId: identifierField("matterAssetType").optional(),
  disposition: z.enum(MATTER_ASSET_DISPOSITIONS).optional(),
  estateTreatment: z.enum(MATTER_ASSET_ESTATE_TREATMENTS).optional(),
  // "Which of these has nobody put a number on yet" — narrowed in SQL, never trimmed after the fact.
  valued: z.enum(["true", "false"]).optional(),
});

const encumbranceIdParam = assetIdParam.extend({
  encumbranceId: identifierPathParam("matterAssetEncumbrance", "encumbranceId"),
});

const scheduleQuery = z.object({
  // REQUIRED, and no default. A schedule with an implied date is the failure this subsystem most
  // wants to avoid.
  asOf: z.string().regex(CIVIL_DATE),
});

const assetDetailQuery = z.object({
  // No default, deliberately: a value rendered against a date the caller did not choose is the
  // failure this subsystem most wants to avoid. Omit it and the detail carries no value at all.
  asOf: z.string().regex(CIVIL_DATE).optional(),
});

const assetTypeQuery = z.object({
  assetClass: z.enum(MATTER_ASSET_CLASSES).optional(),
  includeInactive: z.enum(["true", "false"]).optional(),
});

// ---- shared error responses ----

const authErrors = {
  400: {
    description: "Missing Idempotency-Key (this operation requires one)",
    content: { "application/problem+json": { schema: Problem } },
  },
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "The session member lacks the required permission",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description: "The firm is unreachable, the member is deactivated, or the resource is unknown",
    content: { "application/problem+json": { schema: Problem } },
  },
  409: {
    description:
      "A request with this Idempotency-Key is still in progress, or the record is settled",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description:
      "The request is invalid, or the Idempotency-Key was reused with a different payload",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;

// Maps a register refusal to its problem. Codes — never messages — drive it.
function assetErrorResponse(
  c: Context,
  caught: MatterAssetValidationError,
): ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> {
  switch (caught.code) {
    case "matter-asset-unknown-asset":
    case "matter-asset-unknown-asset-type":
    case "matter-asset-unknown-valuation":
    case "matter-asset-unknown-document-link":
    case "matter-asset-unknown-identifier":
      return problemJson(c, {
        type: "not-found",
        title: "Not found",
        status: 404,
        detail: caught.message,
      });
    case "matter-asset-type-class-mismatch":
      return problemJson(c, {
        type: "matter-asset-type-class-mismatch",
        title: "Type does not belong to this class",
        status: 422,
        detail: caught.message,
      });
    case "matter-asset-class-frozen":
      return problemJson(c, {
        type: "matter-asset-class-frozen",
        title: "An asset's class is fixed when it is recorded",
        status: 409,
        detail: caught.message,
      });
    case "matter-asset-valuation-append-only":
      return problemJson(c, {
        type: "matter-asset-valuation-append-only",
        title: "A recorded value is corrected, never edited",
        status: 409,
        detail: caught.message,
      });
    case "matter-asset-currency-mismatch":
      return problemJson(c, {
        type: "matter-asset-currency-mismatch",
        title: "Amount and currency do not agree",
        status: 422,
        detail: caught.message,
      });
    case "matter-asset-credential-storage-refused":
      return problemJson(c, {
        type: "matter-asset-credential-storage-refused",
        title: "This register stores no credentials",
        status: 422,
        detail: caught.message,
      });
    case "matter-asset-batch-too-large":
      return problemJson(c, {
        type: "matter-asset-batch-too-large",
        title: "Too many rows in one entry",
        status: 422,
        detail: caught.message,
      });
    case "matter-asset-document-matter-mismatch":
      return problemJson(c, {
        type: "matter-asset-document-matter-mismatch",
        title: "That file belongs to another matter",
        status: 422,
        detail: caught.message,
      });
    case "matter-asset-encumbrance-not-on-asset":
      return problemJson(c, {
        type: "matter-asset-encumbrance-not-on-asset",
        title: "That charge secures a different asset",
        status: 422,
        detail: caught.message,
      });
    case "matter-asset-schedule-too-large":
      return problemJson(c, {
        type: "matter-asset-schedule-too-large",
        title: "Too many assets for one schedule",
        status: 422,
        detail: caught.message,
      });
    case "matter-asset-unknown-custody-item":
      return problemJson(c, {
        type: "matter-asset-unknown-custody-item",
        title: "No such item in the safekeeping register",
        status: 422,
        detail: caught.message,
      });
    case "matter-asset-unknown-encumbrance":
      return problemJson(c, {
        type: "not-found",
        title: "Not found",
        status: 404,
        detail: caught.message,
      });
    default:
      return problemJson(c, {
        type: "validation",
        title: "Asset request invalid",
        status: 422,
        detail: caught.message,
      });
  }
}

// A READ can only refuse two ways — the resource is unknown, or the request is malformed. Typed
// narrowly so a read route never declares a conflict response it cannot produce.
function assetReadErrorResponse(
  c: Context,
  caught: MatterAssetValidationError,
): ProblemResponse<404> | ProblemResponse<422> {
  const response = assetErrorResponse(c, caught);
  if (response.status === 409) {
    return problemJson(c, {
      type: "validation",
      title: "Asset request invalid",
      status: 422,
      detail: caught.message,
    });
  }
  return response as ProblemResponse<404> | ProblemResponse<422>;
}

// ---- route metas ----

function readMeta(action: string, resource: RouteMeta["resource"]): RouteMeta {
  return {
    operationId: `matterAssets.${action}`,
    surface: "app",
    authenticated: true,
    permission: READ,
    resource,
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  };
}

function mutationMeta(
  action: string,
  resource: RouteMeta["resource"],
  idempotency: RouteMeta["idempotency"] = "required",
): RouteMeta {
  return {
    operationId: `matterAssets.${action}`,
    surface: "app",
    authenticated: true,
    permission: MANAGE,
    resource,
    audited: true,
    // Required on every route that adds a row: a retried bulk entry must not put the estate's
    // twenty items on the register twice.
    idempotency,
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

const listAssetsRoute = defineOpenAPIRoute(readMeta("listAssets", "matter"), {
  method: "get",
  path: "/api/v1/matters/{matterId}/assets",
  description:
    "The matter's asset register, newest first: what the client or the estate owns, filterable by " +
    "class, type, disposition, estate treatment, and whether anybody has put a value on it yet. Each " +
    "row carries what the thing is and how it is being treated; a value is a separate read, because a " +
    "value only means anything with the date it speaks to.",
  request: { params: matterIdParam, query: assetListQuery },
  responses: {
    200: {
      description: "One page of the register",
      content: {
        "application/json": { schema: paginated(AssetSummary).openapi("MatterAssetPage") },
      },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const getAssetRoute = defineOpenAPIRoute(readMeta("getAsset", "matter"), {
  method: "get",
  path: "/api/v1/matter-assets/{assetId}",
  description:
    "One asset with everything the firm knows about it: its structured attributes, who holds an " +
    "interest in it, the documents that evidence it, and the last four characters of any account or " +
    "policy number recorded against it. Supply `asOf` to get what it was worth as of that date — the " +
    "answer carries the date it actually speaks to and what it rests on, and an asset with no figure " +
    "at or before that date reports as unvalued rather than as zero. There is no default date: a " +
    "value rendered against a date nobody chose is worse than no value.",
  request: { params: assetIdParam, query: assetDetailQuery },
  responses: {
    200: {
      description: "The asset and its relations",
      content: { "application/json": { schema: AssetDetail } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const readScheduleRoute = defineOpenAPIRoute(readMeta("readAssetSchedule", "matter"), {
  method: "get",
  path: "/api/v1/matters/{matterId}/asset-schedule",
  description:
    "The estate schedule as of a date: everything on the register grouped by kind of thing, each row " +
    "with what it was worth as of that date, what that figure rests on, the date it actually speaks " +
    "to, what is secured against it, and the equity left over — with subtotals per kind and per " +
    "currency, and the number of assets nobody has valued yet stated rather than hidden. " +
    "`asOf` is REQUIRED and has no default: the date of death and today give different answers over " +
    "the same rows, and a schedule with a date nobody chose is the mistake this most wants to avoid. " +
    "This is not a court form and not a stored document — it is a read, so it and the register cannot " +
    "drift apart, and it decides nothing about what is in the estate: it groups by what a person " +
    "recorded and reports what is undetermined as its own group.",
  request: { params: matterIdParam, query: scheduleQuery },
  responses: {
    200: {
      description: "The schedule as of the date",
      content: { "application/json": { schema: ScheduleResponse } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const listValuationsRoute = defineOpenAPIRoute(readMeta("listValuations", "matter"), {
  method: "get",
  path: "/api/v1/matter-assets/{assetId}/valuations",
  description:
    "The asset's whole value history, newest date first, a page at a time. Corrections are shown " +
    "AS corrections, naming the entry they replace — a figure somebody corrected stays visible, " +
    "because the record's worth in a dispute is that nothing could be quietly rewritten after the " +
    "fact. Two assertions about the same date read newest-recorded first, which is what makes a " +
    "correction the current figure.",
  request: { params: assetIdParam, query: cursorQuery },
  responses: {
    200: {
      description: "The value history",
      content: {
        "application/json": {
          schema: paginated(ValuationDetail).openapi("MatterAssetValuationList"),
        },
      },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const listAssetTypesRoute = defineOpenAPIRoute(readMeta("listAssetTypes", "firm"), {
  method: "get",
  path: "/api/v1/matter-asset-types",
  description:
    "The firm's asset-type catalog, grouped under the platform classes: single-family residence, " +
    "condominium, timeshare and mineral interest under property; checking, brokerage and retirement " +
    "accounts under financial accounts; plus whatever the firm has added. A type is deactivated and " +
    "never deleted, so every asset already filed under one keeps its meaning.",
  request: { query: assetTypeQuery },
  responses: {
    200: {
      description: "The catalog",
      content: {
        "application/json": {
          schema: z.object({ data: z.array(AssetTypeDetail) }).openapi("MatterAssetTypeList"),
        },
      },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const listAssetClassesRoute = defineOpenAPIRoute(readMeta("listAssetClasses", "firm"), {
  method: "get",
  path: "/api/v1/matter-asset-classes",
  description:
    "The platform's asset classes, their labels, and the standing handling notice a class carries " +
    "where one applies. A notice is shown to a person and acted on by nothing: for firearms it says " +
    "that transfers are regulated and that this register records what is held rather than who may " +
    "receive it. Nothing here determines eligibility, classifies an item, or produces a deadline.",
  request: {},
  responses: {
    200: {
      description: "The class registry",
      content: {
        "application/json": {
          schema: z.object({ data: z.array(AssetClassDetail) }).openapi("MatterAssetClassList"),
        },
      },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const readIdentifierValueRoute = defineOpenAPIRoute(readMeta("readIdentifierValue", "matter"), {
  method: "get",
  path: "/api/v1/matter-assets/{assetId}/identifiers/{identifierId}/value",
  description:
    "The ONE path that returns a full account, policy, certificate, or tax number. The decrypt is " +
    "gated by the same permission that opens a contact's sensitive identifiers and writes an audit " +
    "entry before any value is produced; a caller without it is refused by name and never handed a " +
    "blank. Every other read in this register returns the last four characters and nothing more.",
  request: { params: identifierIdParam },
  responses: {
    200: {
      description: "The full value, or null where only a suffix was recorded",
      content: { "application/json": { schema: IdentifierValueResponse } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const createAssetRoute = defineOpenAPIRoute(mutationMeta("createAsset", "matter"), {
  method: "post",
  path: "/api/v1/matters/{matterId}/assets",
  description:
    "Records one thing the client or the estate owns. Two fields make a row — what kind of thing it " +
    "is and a description — and a value may be typed in the same call, written in the same commit. " +
    "Nothing is blocked for being incomplete: a row that says 'contents of the garage, not yet " +
    "itemized' is a useful row, and the schedule states how many assets have no value rather than " +
    "refusing the ones that do not.",
  request: {
    headers: idempotencyKeyHeader,
    params: matterIdParam,
    body: { content: { "application/json": { schema: CreateAssetBody } }, required: true },
  },
  responses: {
    201: {
      description: "The recorded asset",
      content: { "application/json": { schema: CreatedResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const createAssetBatchRoute = defineOpenAPIRoute(mutationMeta("createAssetBatch", "matter"), {
  method: "post",
  path: "/api/v1/matters/{matterId}/assets/batch",
  description:
    `Records up to ${MAX_MATTER_ASSET_BATCH} assets in one call, so a client questionnaire goes in as ` +
    "one submission rather than twenty round trips. Every row is written in a single commit — either " +
    "all of them are recorded or none is — and a retry with the same key records each one exactly " +
    "once. A list longer than the limit is refused rather than partly written.",
  request: {
    headers: idempotencyKeyHeader,
    params: matterIdParam,
    body: { content: { "application/json": { schema: BatchCreateAssetsRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The recorded assets",
      content: { "application/json": { schema: BatchCreatedResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const updateAssetRoute = defineOpenAPIRoute(mutationMeta("updateAsset", "matter", "optional"), {
  method: "patch",
  path: "/api/v1/matter-assets/{assetId}",
  description:
    "Edits what an asset IS and how it is being treated. It never edits what it is worth — a value " +
    "is recorded by appending to the history — and it never changes an asset's class: a mis-classed " +
    "row is deleted and recorded again, which is cheap because it is minutes old.",
  request: {
    headers: idempotencyKeyHeader,
    params: assetIdParam,
    body: { content: { "application/json": { schema: UpdateAssetRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The asset was updated",
      content: { "application/json": { schema: AcknowledgedResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const deleteAssetRoute = defineOpenAPIRoute(
  {
    ...mutationMeta("deleteAsset", "matter", "optional"),
    reversal: {
      kind: "none",
      reason:
        "The row is kept, since its valuations and document links hang off it, but no route clears the flag: an asset taken off the register cannot be put back from the product.",
    },
  },
  {
    method: "delete",
    path: "/api/v1/matter-assets/{assetId}",
    description:
      "Takes an asset off the register. The row is kept rather than erased, because its value history " +
      "and its document links hang off it and a firm that removed a house by mistake this morning wants " +
      "it back this afternoon.",
    request: { headers: idempotencyKeyHeader, params: assetIdParam },
    responses: {
      200: {
        description: "The asset was removed from the register",
        content: { "application/json": { schema: AcknowledgedResponse } },
      },
      400: authErrors[400],
      401: authErrors[401],
      403: authErrors[403],
      404: authErrors[404],
      409: authErrors[409],
      422: authErrors[422],
      429: authErrors[429],
    },
  },
);

const appendValuationRoute = defineOpenAPIRoute(mutationMeta("appendValuation", "matter"), {
  method: "post",
  path: "/api/v1/matter-assets/{assetId}/valuations",
  description:
    "Records what the asset was worth as of a date, on a stated footing — an appraisal, a statement, " +
    "a broker's figure, the price it actually sold for. Entries are ADDED and never edited or " +
    "removed: a wrong figure is fixed by recording a correction that names the entry it replaces, so " +
    "a schedule filed in March and the register read in September can never quietly disagree. There " +
    "is no route that edits or deletes an entry.",
  request: {
    headers: idempotencyKeyHeader,
    params: assetIdParam,
    body: { content: { "application/json": { schema: AppendValuationRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The recorded value",
      content: { "application/json": { schema: CreatedResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const addInterestRoute = defineOpenAPIRoute(mutationMeta("addInterest", "matter"), {
  method: "post",
  path: "/api/v1/matter-assets/{assetId}/interests",
  description:
    "Records that a person or an organization from the directory holds an interest in the asset, " +
    "optionally as a fraction. The label comes from the firm's own list. Nothing is inferred from it: " +
    "how an asset is held and whether it forms part of a probate estate are two separate facts, and " +
    "the register records the one the firm concluded rather than deriving it from the other.",
  request: {
    headers: idempotencyKeyHeader,
    params: assetIdParam,
    body: { content: { "application/json": { schema: AddInterestRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The recorded interest",
      content: { "application/json": { schema: CreatedResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const endInterestRoute = defineOpenAPIRoute(mutationMeta("endInterest", "matter", "optional"), {
  method: "post",
  path: "/api/v1/matter-assets/{assetId}/interests/{interestId}/end",
  description:
    "Records the date an interest ended. The entry stays on the record: who held what, and until " +
    "when, is exactly the question a schedule read six months later has to answer.",
  request: {
    headers: idempotencyKeyHeader,
    params: interestIdParam,
    body: { content: { "application/json": { schema: EndInterestRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The interest was ended",
      content: { "application/json": { schema: AcknowledgedResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const recordEncumbranceRoute = defineOpenAPIRoute(mutationMeta("recordEncumbrance", "matter"), {
  method: "post",
  path: "/api/v1/matter-assets/{assetId}/encumbrances",
  description:
    "Records what is secured against the asset — a mortgage, a deed of trust, a lien, a judgment, a " +
    "security interest, a tax lien, a pledge. There is deliberately no balance field on this call: a " +
    "balance is a dated figure, so it is recorded through the value path naming this charge, which " +
    "means a mortgage that was one number at the date of death and another at the date of sale has " +
    "both, dated, with the same discipline that governs a property's own value.",
  request: {
    params: assetIdParam,
    headers: idempotencyKeyHeader,
    body: {
      required: true,
      content: { "application/json": { schema: RecordEncumbranceRequest } },
    },
  },
  responses: {
    201: {
      description: "The charge",
      content: { "application/json": { schema: CreatedResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const releaseEncumbranceRoute = defineOpenAPIRoute(
  mutationMeta("releaseEncumbrance", "matter", "optional"),
  {
    method: "post",
    path: "/api/v1/matter-assets/{assetId}/encumbrances/{encumbranceId}/release",
    description:
      "Records that a charge was discharged, by writing the date it was discharged on. The charge and " +
      "its balances stay on the record: a schedule read as of a date before the release still shows " +
      "it, which is the only way 'was this property clear at the date of death' can be answered years " +
      "after the lien was cleared.",
    request: {
      params: encumbranceIdParam,
      body: {
        required: true,
        content: { "application/json": { schema: ReleaseEncumbranceRequest } },
      },
    },
    responses: {
      200: {
        description: "The charge is recorded as discharged",
        content: { "application/json": { schema: AcknowledgedResponse } },
      },
      401: authErrors[401],
      403: authErrors[403],
      404: authErrors[404],
      409: authErrors[409],
      422: authErrors[422],
      429: authErrors[429],
    },
  },
);

const linkDocumentRoute = defineOpenAPIRoute(mutationMeta("linkDocument", "matter"), {
  method: "post",
  path: "/api/v1/matter-assets/{assetId}/documents",
  description:
    "Attaches a document already in the matter's files to the asset — the deed, the title, a " +
    "statement, an appraisal, a bill of sale. The document is not copied or moved: it stays in the " +
    "matter's file list, previewable, searchable, and under any hold, and it gains an association. " +
    "One document may evidence several assets, because one brokerage statement really does list four " +
    "accounts. Files are uploaded through the file surface; this route only links one.",
  request: {
    headers: idempotencyKeyHeader,
    params: assetIdParam,
    body: { content: { "application/json": { schema: LinkDocumentRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The document link",
      content: { "application/json": { schema: CreatedResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const unlinkDocumentRoute = defineOpenAPIRoute(
  {
    ...mutationMeta("unlinkDocument", "matter", "optional"),
    reversal: { kind: "inverse", by: "matterAssets.linkDocument" },
  },
  {
    method: "delete",
    path: "/api/v1/matter-assets/{assetId}/documents/{documentLinkId}",
    description:
      "Detaches a document from the asset. The document itself is untouched and stays in the matter's " +
      "file list — a filing decision reversed, not a deletion.",
    request: { headers: idempotencyKeyHeader, params: documentLinkIdParam },
    responses: {
      200: {
        description: "The document was detached",
        content: { "application/json": { schema: AcknowledgedResponse } },
      },
      400: authErrors[400],
      401: authErrors[401],
      403: authErrors[403],
      404: authErrors[404],
      409: authErrors[409],
      422: authErrors[422],
      429: authErrors[429],
    },
  },
);

const recordIdentifierRoute = defineOpenAPIRoute(mutationMeta("recordIdentifier", "matter"), {
  method: "post",
  path: "/api/v1/matter-assets/{assetId}/identifiers",
  description:
    "Records an account, policy, certificate, or tax number against the asset. The number is " +
    "encrypted at rest and only its last four characters appear anywhere else; recording the last " +
    "four alone is a complete record and is often the better one. Passwords, passphrases, seed and " +
    "recovery phrases, private keys, personal identification numbers, and safe combinations are " +
    "REFUSED: a value whose disclosure IS a transfer of the asset belongs in a sealed envelope in the " +
    "safekeeping register, where it has a location, a hold, and a record of every hand it has passed " +
    "through.",
  request: {
    headers: idempotencyKeyHeader,
    params: assetIdParam,
    body: { content: { "application/json": { schema: RecordIdentifierRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The recorded identifier",
      content: { "application/json": { schema: CreatedResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const createAssetTypeRoute = defineOpenAPIRoute(
  mutationMeta("createAssetType", "firm", "optional"),
  {
    method: "post",
    path: "/api/v1/matter-asset-types",
    description:
      "Adds a kind of thing to the firm's catalog under one of the platform classes. A type belongs " +
      "to exactly one class and cannot be moved between them, because every asset already filed under " +
      "it carries that class. Types are deactivated rather than deleted.",
    request: {
      headers: idempotencyKeyHeader,
      body: { content: { "application/json": { schema: CreateAssetTypeRequest } }, required: true },
    },
    responses: {
      201: {
        description: "The catalog entry",
        content: { "application/json": { schema: CreatedResponse } },
      },
      400: authErrors[400],
      401: authErrors[401],
      403: authErrors[403],
      404: authErrors[404],
      409: authErrors[409],
      422: authErrors[422],
      429: authErrors[429],
    },
  },
);

// ---- projections ----

function assetSummary(row: MatterAssetRow): z.infer<typeof AssetSummary> {
  return {
    id: row.id,
    matterId: row.matter_id,
    assetClass: row.class,
    assetTypeId: row.asset_type_id,
    description: row.description,
    acquiredOn: row.acquired_on,
    estateTreatment: row.estate_treatment,
    disposition: row.disposition,
    dispositionOn: row.disposition_on,
    custodyItemId: row.custody_item_id,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

type AssetEffectOutcome =
  | { ok: true; id: string; replayed: boolean }
  | {
      ok: false;
      problem: ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422>;
    };

// The shared idempotent commit for an asset mutation, mapping refusals to HTTP. The stored body IS
// the wire body: the idempotency gate replays it verbatim, so a shape that differed from what the
// handler returns would hand a retrying client a different payload than the original request got.
async function commitAssetEffect(
  c: Context,
  database: BatchDatabase,
  idempotency: { key: string | undefined; fingerprint: string },
  responseCode: number,
  call: () => Promise<{ id: string; effect: EffectWrite }>,
): Promise<AssetEffectOutcome> {
  const now = () => new Date().toISOString();
  let result;
  try {
    result = await runIdempotentEffect({
      database,
      key: idempotency.key,
      fingerprint: idempotency.fingerprint,
      now,
      effect: async () => {
        const { id, effect } = await call();
        return { write: effect, responseCode, responseBody: canonicalJsonStringify({ id }) };
      },
    });
  } catch (caught) {
    if (caught instanceof MatterAssetValidationError) {
      return { ok: false, problem: assetErrorResponse(c, caught) };
    }
    throw caught;
  }
  if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
    return { ok: false, problem: problemResponseForIdempotencyConflict(c, result) };
  }
  const body = JSON.parse(result.responseBody ?? "{}") as { id: string };
  return { ok: true, id: body.id, replayed: result.kind === "replayed" };
}

// The commit for a route whose idempotency is OPTIONAL — an edit, an end-date, an unlink, a
// deactivation. The chokepoint runs its gate only on required-idempotency routes, so these have no
// idempotency context to compose and commit the effect directly. They are all naturally repeatable:
// re-applying the same patch, ending an interest already ended, or unlinking an already-unlinked
// document leaves the register in the state the caller asked for.
async function commitOptionalAssetEffect(
  c: Context,
  database: BatchDatabase,
  call: () => Promise<{ effect: EffectWrite }>,
): Promise<ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> | undefined> {
  try {
    const { effect } = await call();
    await commitEffectBatch(database, effect, { now: () => new Date().toISOString() });
    return undefined;
  } catch (caught) {
    if (caught instanceof MatterAssetValidationError) return assetErrorResponse(c, caught);
    throw caught;
  }
}

// The attribute row, projected into the class's own detail shape. The class decides which shape, so
// there is one lookup and one mapping rather than eight nullable reads: an asset has at most one
// attribute row and it is the row its class names.
type AttributeColumns = Record<string, unknown>;

function text(columns: AttributeColumns | undefined, name: string): string | null {
  const value = columns?.[name];
  return typeof value === "string" ? value : null;
}

function integer(columns: AttributeColumns | undefined, name: string): number | null {
  const value = columns?.[name];
  return typeof value === "number" ? value : null;
}

async function assetDetailPayload(
  database: SqlDatabase,
  row: MatterAssetRow,
  asOf: string | undefined,
): Promise<z.infer<typeof AssetDetail>> {
  const declaration = MATTER_ASSET_CLASS_REGISTRY.find((entry) => entry.key === row.class);
  const attributes = await readMatterAssetAttributes(database, row.class, row.id);
  const interests = await readMatterAssetInterests(database, row.id);
  const encumbrances = await readMatterAssetEncumbrances(database, row.id);
  const documents = await readMatterAssetDocuments(database, row.id);
  // display_suffix and nothing else. The read shape carries no field a full number could ride on.
  const identifiers = await readMatterAssetIdentifiers(database, row.id);
  const valueAsOf =
    asOf === undefined ? undefined : await resolveMatterAssetValueAsOf(database, row.id, asOf);

  // Equity only where a date was asked for: it is a function of two DATED assertions and means
  // nothing without one.
  let equity: z.infer<typeof EquityDetail> | null = null;
  if (asOf !== undefined) {
    const inForce = encumbrancesInForceAsOf(encumbrances, asOf);
    const balances = await readEncumbranceBalancesAsOf(
      database,
      inForce.map((encumbrance) => encumbrance.id),
      asOf,
    );
    const computed = matterAssetEquity(valueAsOf, inForce, balances);
    equity = {
      amountMinor: computed.equityAmountMinor ?? null,
      currency: computed.equityCurrency ?? null,
      unavailableReason: computed.equityUnavailableReason ?? null,
      balances: computed.encumbrances.map((line) => ({
        encumbranceId: line.encumbranceId,
        kind: line.kind as (typeof MATTER_ASSET_ENCUMBRANCE_KINDS)[number],
        holderName: line.holderName,
        amountMinor: line.balance?.amountMinor ?? null,
        currency: line.balance?.currency ?? null,
        asOfDate: line.balance?.asOfDate ?? null,
      })),
    };
  }

  // The safekeeping link, composed by READING the safekeeping register at this moment. Nothing here
  // is stored on the asset, which is what makes a stale answer impossible rather than unlikely.
  const custody =
    row.custody_item_id === null
      ? undefined
      : await readCustodyPlacementForAsset(database, row.custody_item_id);

  // The firm's own fields, scoped by the asset's CLASS through the engine's existing attachment
  // column — a field naming a class appears on that class, a field naming none appears on every
  // asset. One read whatever the field count, and the composition happens here rather than in
  // @magna-carta/matter-assets, which depends on no other domain package and must not start.
  const customFields = await readCustomFieldValuesForScope(database, {
    target: "matterAsset",
    attachmentId: row.class,
    targetRowId: row.id,
  });

  return {
    asset: assetSummary(row),
    realProperty:
      row.class !== "realProperty"
        ? null
        : {
            street: text(attributes, "street"),
            city: text(attributes, "city"),
            region: text(attributes, "region"),
            postal: text(attributes, "postal"),
            county: text(attributes, "county"),
            parcelNumber: text(attributes, "parcel_number"),
            legalDescription: text(attributes, "legal_description"),
            recordingReference: text(attributes, "recording_reference"),
          },
    financialAccount:
      row.class !== "financialAccount"
        ? null
        : {
            institutionName: text(attributes, "institution_name"),
            institutionOrganizationId: text(attributes, "institution_organization_id"),
          },
    vehicle:
      row.class !== "vehicle"
        ? null
        : {
            make: text(attributes, "make"),
            model: text(attributes, "model"),
            modelYear: integer(attributes, "model_year"),
            vehicleIdentificationNumber: text(attributes, "vehicle_identification_number"),
            plateNumber: text(attributes, "plate_number"),
            plateRegion: text(attributes, "plate_region"),
          },
    firearm:
      row.class !== "firearm"
        ? null
        : {
            make: text(attributes, "make"),
            model: text(attributes, "model"),
            caliberOrGauge: text(attributes, "caliber_or_gauge"),
            serialNumber: text(attributes, "serial_number"),
            regulatedCategory: text(attributes, "regulated_category"),
          },
    businessInterest:
      row.class !== "businessInterest"
        ? null
        : {
            entityName: text(attributes, "entity_name"),
            entityOrganizationId: text(attributes, "entity_organization_id"),
            jurisdictionOfOrganization: text(attributes, "jurisdiction_of_organization"),
            entityForm: text(attributes, "entity_form"),
          },
    insurancePolicy:
      row.class !== "insurancePolicy"
        ? null
        : {
            carrierName: text(attributes, "carrier_name"),
            carrierOrganizationId: text(attributes, "carrier_organization_id"),
            faceAmountMinor: integer(attributes, "face_amount_minor"),
            faceCurrency: text(attributes, "face_currency"),
            insuredEntityId: text(attributes, "insured_entity_id"),
          },
    receivable:
      row.class !== "receivable"
        ? null
        : {
            debtorEntityId: text(attributes, "debtor_entity_id"),
            principalAmountMinor: integer(attributes, "principal_amount_minor"),
            principalCurrency: text(attributes, "principal_currency"),
            rateE4: integer(attributes, "rate_e4"),
            maturityOn: text(attributes, "maturity_on"),
            secured:
              integer(attributes, "secured") === null ? null : integer(attributes, "secured") === 1,
          },
    digitalAsset:
      row.class !== "digitalAsset"
        ? null
        : {
            platformName: text(attributes, "platform_name"),
            accountHandle: text(attributes, "account_handle"),
            custodyModel: (text(attributes, "custody_model") ?? null) as
              | (typeof MATTER_ASSET_DIGITAL_CUSTODY_MODELS)[number]
              | null,
          },
    encumbrances: encumbrances.map((encumbrance) => ({
      id: encumbrance.id,
      kind: encumbrance.kind,
      holderEntityId: encumbrance.holder_entity_id,
      holderName: encumbrance.holder_name,
      recordedReference: encumbrance.recorded_reference,
      releasedOn: encumbrance.released_on,
      notes: encumbrance.notes,
    })),
    equity,
    custody: custody ?? null,
    interests: interests.map((interest) => ({
      id: interest.id,
      entityId: interest.entity_id,
      interestRole: interest.interest_role,
      shareNumerator: interest.share_numerator,
      shareDenominator: interest.share_denominator,
      effectiveFrom: interest.effective_from,
      effectiveTo: interest.effective_to,
    })),
    documents: documents.map((document) => ({
      id: document.id,
      fileId: document.file_id,
      kind: document.kind,
      note: document.note,
      linkedAt: document.linked_at,
      linkedBy: document.linked_by,
    })),
    identifiers: identifiers.map((identifier) => ({
      id: identifier.id,
      kind: identifier.kind,
      displaySuffix: identifier.display_suffix,
      createdAt: identifier.created_at,
    })),
    valueAsOf: valueAsOf ?? null,
    classHandlingNote: declaration?.handlingNote ?? null,
    customFields: customFields.map((field) => ({
      fieldId: field.fieldId,
      name: field.name,
      kind: field.kind,
      numberScale: field.numberScale,
      required: field.required === 1,
      position: field.position,
      valueId: field.valueId,
      valueText: field.valueText,
      valueNumber: field.valueNumber,
      valueDate: field.valueDate,
      valueOptionId: field.valueOptionId,
      valueReferenceId: field.valueReferenceId,
      validFrom: field.validFrom,
    })),
  };
}

type MatterAssetsApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

function serviceOptions(c: Context<{ Bindings: Bindings; Variables: AppVariables }>) {
  return {
    clock: { now: () => new Date().toISOString() },
    actorUserId: requireChokepointUserId(c),
    randomSource: cryptoRandomSource,
  };
}

// ---- registration ----

export function registerMatterAssetRoutes(app: MatterAssetsApp, chokepoint: Chokepoint): void {
  // GET /api/v1/matters/{matterId}/assets
  app.openapi(
    { ...listAssetsRoute, middleware: chokepointMiddleware(chokepoint, listAssetsRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { matterId } = c.req.valid("param");
      const query = c.req.valid("query");
      const decoded = decodeAssetCursor(query.cursor);
      const rows = await readMatterAssetPage(firm.firmDatabase, matterId as MatterId, {
        assetClass: query.assetClass,
        assetTypeId: query.assetTypeId,
        disposition: query.disposition,
        estateTreatment: query.estateTreatment,
        valued: query.valued === undefined ? undefined : query.valued === "true",
        cursor: decoded,
        limit: DEFAULT_PAGE + 1,
      });
      const hasMore = rows.length > DEFAULT_PAGE;
      const page = hasMore ? rows.slice(0, DEFAULT_PAGE) : rows;
      const last = page.at(-1);
      return c.json(
        {
          data: page.map(assetSummary),
          nextCursor:
            hasMore && last !== undefined
              ? btoa(JSON.stringify({ c: last.created_at, i: last.id }))
              : null,
        },
        200,
      );
    },
  );

  // GET /api/v1/matter-assets/{assetId}
  app.openapi(
    { ...getAssetRoute, middleware: chokepointMiddleware(chokepoint, getAssetRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { assetId } = c.req.valid("param");
      const { asOf } = c.req.valid("query");
      const row = await readMatterAsset(firm.firmDatabase, assetId as MatterAssetId);
      if (row === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such asset in this firm.",
        });
      }
      try {
        return c.json(await assetDetailPayload(firm.firmDatabase, row, asOf), 200);
      } catch (caught) {
        if (caught instanceof MatterAssetValidationError) return assetReadErrorResponse(c, caught);
        throw caught;
      }
    },
  );

  // GET /api/v1/matters/{matterId}/asset-schedule
  app.openapi(
    { ...readScheduleRoute, middleware: chokepointMiddleware(chokepoint, readScheduleRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { matterId } = c.req.valid("param");
      const { asOf } = c.req.valid("query");
      try {
        const schedule = await readMatterAssetSchedule(
          firm.firmDatabase,
          matterId as MatterId,
          asOf,
        );
        return c.json(
          {
            matterId: schedule.matterId,
            asOfDate: schedule.asOfDate,
            groups: schedule.groups.map((group) => ({
              assetClass: group.assetClass,
              label: group.label,
              rows: group.rows.map((row) => ({
                assetId: row.assetId,
                description: row.description,
                assetTypeName: row.assetTypeName,
                estateTreatment: row.estateTreatment,
                disposition: row.disposition,
                acquiredOn: row.acquiredOn,
                custodyItemId: row.custodyItemId,
                value: row.value ?? null,
                equity: {
                  amountMinor: row.equity.equityAmountMinor ?? null,
                  currency: row.equity.equityCurrency ?? null,
                  unavailableReason: row.equity.equityUnavailableReason ?? null,
                  balances: row.equity.encumbrances.map((line) => ({
                    encumbranceId: line.encumbranceId,
                    kind: line.kind as (typeof MATTER_ASSET_ENCUMBRANCE_KINDS)[number],
                    holderName: line.holderName,
                    amountMinor: line.balance?.amountMinor ?? null,
                    currency: line.balance?.currency ?? null,
                    asOfDate: line.balance?.asOfDate ?? null,
                  })),
                },
              })),
              subtotals: group.subtotals.map((subtotal) => ({
                currency: subtotal.currency,
                valueAmountMinor: subtotal.valueAmountMinor,
                equityAmountMinor: subtotal.equityAmountMinor ?? null,
                countedAssets: subtotal.countedAssets,
              })),
              unvaluedCount: group.unvaluedCount,
            })),
            totalAssets: schedule.totalAssets,
            unvaluedCount: schedule.unvaluedCount,
            estateTreatmentCounts: schedule.estateTreatmentCounts,
          },
          200,
        );
      } catch (caught) {
        if (caught instanceof MatterAssetValidationError) return assetReadErrorResponse(c, caught);
        throw caught;
      }
    },
  );

  // GET /api/v1/matter-assets/{assetId}/valuations
  app.openapi(
    { ...listValuationsRoute, middleware: chokepointMiddleware(chokepoint, listValuationsRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { assetId } = c.req.valid("param");
      const { cursor } = c.req.valid("query");
      const page = await pageMatterAssetValuations(firm.firmDatabase, assetId as MatterAssetId, {
        cursor,
      });
      return c.json(
        {
          nextCursor: page.nextCursor,
          data: page.data.map((row) => ({
            id: row.id,
            assetId: row.asset_id,
            asOfDate: row.as_of_date,
            amountMinor: row.amount_minor,
            currency: row.currency,
            basis: row.basis,
            sourceNote: row.source_note,
            supportingFileId: row.supporting_file_id,
            correctsValuationId: row.corrects_valuation_id,
            recordedBy: row.recorded_by,
            recordedAt: row.recorded_at,
          })),
        },
        200,
      );
    },
  );

  // GET /api/v1/matter-asset-types
  app.openapi(
    { ...listAssetTypesRoute, middleware: chokepointMiddleware(chokepoint, listAssetTypesRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { assetClass, includeInactive } = c.req.valid("query");
      const rows = await readMatterAssetTypes(firm.firmDatabase, {
        assetClass,
        includeInactive: includeInactive === "true",
      });
      return c.json(
        {
          data: rows.map((row) => ({
            id: row.id,
            name: row.name,
            assetClass: row.class,
            code: row.code,
            active: row.active === 1,
            position: row.position,
          })),
        },
        200,
      );
    },
  );

  // GET /api/v1/matter-asset-classes
  app.openapi(
    {
      ...listAssetClassesRoute,
      middleware: chokepointMiddleware(chokepoint, listAssetClassesRoute),
    },
    (c) =>
      c.json(
        {
          data: MATTER_ASSET_CLASS_REGISTRY.map((declaration) => ({
            key: declaration.key,
            label: declaration.label,
            handlingNote: declaration.handlingNote,
            available: declaration.available,
          })),
        },
        200,
      ),
  );

  // GET /api/v1/matter-assets/{assetId}/identifiers/{identifierId}/value — the audited decrypt path
  app.openapi(
    {
      ...readIdentifierValueRoute,
      middleware: chokepointMiddleware(chokepoint, readIdentifierValueRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const firmId = requireChokepointFirmId(c);
      const actorUserId = requireChokepointUserId(c);
      const { identifierId } = c.req.valid("param");
      // Re-derived here rather than stashed by the chokepoint: the protected-field gate takes the
      // caller's effective permissions so IT can decide the decrypt, which is the one place that
      // decision is made.
      const effectivePermissions = await loadEffectivePermissions(firm.firmDatabase, actorUserId);
      try {
        const value = await readMatterAssetIdentifierValue(
          {
            firmId,
            firmKeyVersion: 1,
            firmKeyProvider: firmKeyProviderForEnv(c.env),
            database: firm.firmDatabase,
            effectivePermissions,
            actorUserId,
            clock: { now: () => new Date().toISOString() },
            randomSource: cryptoRandomSource,
          },
          identifierId as MatterAssetIdentifierId,
        );
        return c.json({ value }, 200);
      } catch (caught) {
        // A NAMED refusal and never a blank: an empty field would read as "there is no account
        // number", which is a different and wrong answer.
        if (caught instanceof ProtectedReadForbiddenError) {
          return problemJson(c, {
            type: "permission-denied",
            title: "Forbidden",
            status: 403,
            detail: caught.message,
          });
        }
        if (caught instanceof MatterAssetValidationError) {
          return problemJson(c, {
            type: "not-found",
            title: "Not found",
            status: 404,
            detail: caught.message,
          });
        }
        throw caught;
      }
    },
  );

  // POST /api/v1/matters/{matterId}/assets
  app.openapi(
    { ...createAssetRoute, middleware: chokepointMiddleware(chokepoint, createAssetRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const idempotency = requireChokepointIdempotency(c);
      const { matterId } = c.req.valid("param");
      const body = c.req.valid("json");
      const outcome = await commitAssetEffect(c, firm.firmDatabase, idempotency, 201, async () => {
        const created = await createMatterAsset(
          firm.firmDatabase,
          { ...body, matterId: matterId as MatterId },
          serviceOptions(c),
        );
        return { id: created.assetId, effect: created.effect };
      });
      if (!outcome.ok) return outcome.problem;
      return c.json({ id: outcome.id }, 201);
    },
  );

  // POST /api/v1/matters/{matterId}/assets/batch
  app.openapi(
    {
      ...createAssetBatchRoute,
      middleware: chokepointMiddleware(chokepoint, createAssetBatchRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const idempotency = requireChokepointIdempotency(c);
      const { matterId } = c.req.valid("param");
      const body = c.req.valid("json");
      const now = () => new Date().toISOString();
      let result;
      try {
        result = await runIdempotentEffect({
          database: firm.firmDatabase,
          key: idempotency.key,
          fingerprint: idempotency.fingerprint,
          now,
          effect: async () => {
            const batch = await createMatterAssetBatch(
              firm.firmDatabase,
              matterId as MatterId,
              body.assets,
              serviceOptions(c),
            );
            return {
              write: batch.effect,
              responseCode: 201,
              responseBody: canonicalJsonStringify({ ids: batch.assetIds }),
            };
          },
        });
      } catch (caught) {
        if (caught instanceof MatterAssetValidationError) return assetErrorResponse(c, caught);
        throw caught;
      }
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
        return problemResponseForIdempotencyConflict(c, result);
      }
      const parsed = JSON.parse(result.responseBody ?? "{}") as { ids: string[] };
      return c.json({ ids: parsed.ids }, 201);
    },
  );

  // PATCH /api/v1/matter-assets/{assetId}
  app.openapi(
    { ...updateAssetRoute, middleware: chokepointMiddleware(chokepoint, updateAssetRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { assetId } = c.req.valid("param");
      const body = c.req.valid("json");
      const problem = await commitOptionalAssetEffect(c, firm.firmDatabase, () =>
        updateMatterAsset(firm.firmDatabase, assetId as MatterAssetId, body, serviceOptions(c)),
      );
      if (problem !== undefined) return problem;
      return c.json({ ok: true } as const, 200);
    },
  );

  // DELETE /api/v1/matter-assets/{assetId}
  app.openapi(
    { ...deleteAssetRoute, middleware: chokepointMiddleware(chokepoint, deleteAssetRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { assetId } = c.req.valid("param");
      const problem = await commitOptionalAssetEffect(c, firm.firmDatabase, () =>
        deleteMatterAsset(firm.firmDatabase, assetId as MatterAssetId, serviceOptions(c)),
      );
      if (problem !== undefined) return problem;
      return c.json({ ok: true } as const, 200);
    },
  );

  // POST /api/v1/matter-assets/{assetId}/valuations
  app.openapi(
    { ...appendValuationRoute, middleware: chokepointMiddleware(chokepoint, appendValuationRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const idempotency = requireChokepointIdempotency(c);
      const { assetId } = c.req.valid("param");
      const body = c.req.valid("json");
      const outcome = await commitAssetEffect(c, firm.firmDatabase, idempotency, 201, async () => {
        const appended = await appendMatterAssetValuation(
          firm.firmDatabase,
          {
            ...body,
            assetId: assetId as MatterAssetId,
            supportingFileId: (body.supportingFileId ?? null) as FileId | null,
            encumbranceId: (body.encumbranceId ?? null) as MatterAssetEncumbranceId | null,
            correctsValuationId: (body.correctsValuationId ??
              null) as MatterAssetValuationId | null,
          },
          serviceOptions(c),
        );
        return { id: appended.valuationId, effect: appended.effect };
      });
      if (!outcome.ok) return outcome.problem;
      return c.json({ id: outcome.id }, 201);
    },
  );

  // POST /api/v1/matter-assets/{assetId}/interests
  app.openapi(
    { ...addInterestRoute, middleware: chokepointMiddleware(chokepoint, addInterestRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const idempotency = requireChokepointIdempotency(c);
      const { assetId } = c.req.valid("param");
      const body = c.req.valid("json");
      const outcome = await commitAssetEffect(c, firm.firmDatabase, idempotency, 201, async () => {
        const added = await addMatterAssetInterest(
          firm.firmDatabase,
          { ...body, assetId: assetId as MatterAssetId },
          serviceOptions(c),
        );
        return { id: added.interestId, effect: added.effect };
      });
      if (!outcome.ok) return outcome.problem;
      return c.json({ id: outcome.id }, 201);
    },
  );

  // POST /api/v1/matter-assets/{assetId}/interests/{interestId}/end
  app.openapi(
    { ...endInterestRoute, middleware: chokepointMiddleware(chokepoint, endInterestRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { interestId } = c.req.valid("param");
      const body = c.req.valid("json");
      const problem = await commitOptionalAssetEffect(c, firm.firmDatabase, () =>
        endMatterAssetInterest(
          firm.firmDatabase,
          interestId as MatterAssetInterestId,
          body.effectiveTo,
          serviceOptions(c),
        ),
      );
      if (problem !== undefined) return problem;
      return c.json({ ok: true } as const, 200);
    },
  );

  // POST /api/v1/matter-assets/{assetId}/encumbrances
  app.openapi(
    {
      ...recordEncumbranceRoute,
      middleware: chokepointMiddleware(chokepoint, recordEncumbranceRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const idempotency = requireChokepointIdempotency(c);
      const { assetId } = c.req.valid("param");
      const body = c.req.valid("json");
      const outcome = await commitAssetEffect(c, firm.firmDatabase, idempotency, 201, async () => {
        const recorded = await recordMatterAssetEncumbrance(
          firm.firmDatabase,
          { ...body, assetId: assetId as MatterAssetId },
          serviceOptions(c),
        );
        return { id: recorded.encumbranceId, effect: recorded.effect };
      });
      if (!outcome.ok) return outcome.problem;
      return c.json({ id: outcome.id }, 201);
    },
  );

  // POST /api/v1/matter-assets/{assetId}/encumbrances/{encumbranceId}/release
  app.openapi(
    {
      ...releaseEncumbranceRoute,
      middleware: chokepointMiddleware(chokepoint, releaseEncumbranceRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { encumbranceId } = c.req.valid("param");
      const body = c.req.valid("json");
      const problem = await commitOptionalAssetEffect(c, firm.firmDatabase, () =>
        releaseMatterAssetEncumbrance(
          firm.firmDatabase,
          encumbranceId as MatterAssetEncumbranceId,
          body.releasedOn,
          serviceOptions(c),
        ),
      );
      if (problem !== undefined) return problem;
      return c.json({ ok: true } as const, 200);
    },
  );

  // POST /api/v1/matter-assets/{assetId}/documents
  app.openapi(
    { ...linkDocumentRoute, middleware: chokepointMiddleware(chokepoint, linkDocumentRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const idempotency = requireChokepointIdempotency(c);
      const { assetId } = c.req.valid("param");
      const body = c.req.valid("json");
      const outcome = await commitAssetEffect(c, firm.firmDatabase, idempotency, 201, async () => {
        const linked = await linkMatterAssetDocument(
          firm.firmDatabase,
          {
            assetId: assetId as MatterAssetId,
            fileId: body.fileId as FileId,
            kind: body.kind,
            note: body.note,
          },
          serviceOptions(c),
        );
        return { id: linked.documentLinkId, effect: linked.effect };
      });
      if (!outcome.ok) return outcome.problem;
      return c.json({ id: outcome.id }, 201);
    },
  );

  // DELETE /api/v1/matter-assets/{assetId}/documents/{documentLinkId}
  app.openapi(
    { ...unlinkDocumentRoute, middleware: chokepointMiddleware(chokepoint, unlinkDocumentRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { documentLinkId } = c.req.valid("param");
      const problem = await commitOptionalAssetEffect(c, firm.firmDatabase, () =>
        unlinkMatterAssetDocument(
          firm.firmDatabase,
          documentLinkId as MatterAssetDocumentId,
          serviceOptions(c),
        ),
      );
      if (problem !== undefined) return problem;
      return c.json({ ok: true } as const, 200);
    },
  );

  // POST /api/v1/matter-assets/{assetId}/identifiers
  app.openapi(
    {
      ...recordIdentifierRoute,
      middleware: chokepointMiddleware(chokepoint, recordIdentifierRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const firmId = requireChokepointFirmId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { assetId } = c.req.valid("param");
      const body = c.req.valid("json");
      const outcome = await commitAssetEffect(c, firm.firmDatabase, idempotency, 201, async () => {
        const recorded = await recordMatterAssetIdentifier(
          firm.firmDatabase,
          {
            firmId,
            firmKeyVersion: 1,
            firmKeyProvider: firmKeyProviderForEnv(c.env),
          },
          { ...body, assetId: assetId as MatterAssetId },
          serviceOptions(c),
        );
        return { id: recorded.identifierId, effect: recorded.effect };
      });
      if (!outcome.ok) return outcome.problem;
      return c.json({ id: outcome.id }, 201);
    },
  );

  // POST /api/v1/matter-asset-types
  app.openapi(
    { ...createAssetTypeRoute, middleware: chokepointMiddleware(chokepoint, createAssetTypeRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const body = c.req.valid("json");
      let assetTypeId = "";
      const problem = await commitOptionalAssetEffect(c, firm.firmDatabase, async () => {
        const created = await createMatterAssetType(
          firm.firmDatabase,
          {
            name: body.name,
            assetClass: body.assetClass,
            code: body.code,
            position: body.position,
          },
          serviceOptions(c),
        );
        assetTypeId = created.assetTypeId;
        return { effect: created.effect };
      });
      if (problem !== undefined) return problem;
      return c.json({ id: assetTypeId }, 201);
    },
  );
}

// The platform's cursor shape, byte-identical to every other list read's — this register mints no
// wire contract of its own.
function decodeAssetCursor(
  cursor: string | undefined,
): { sortKey: string; id: string } | undefined {
  if (cursor === undefined) return undefined;
  try {
    const decoded = JSON.parse(atob(cursor)) as { c?: unknown; i?: unknown };
    if (typeof decoded.c !== "string" || typeof decoded.i !== "string") return undefined;
    return { sortKey: decoded.c, id: decoded.i };
  } catch {
    return undefined;
  }
}

export type { MatterAssetsApp };
