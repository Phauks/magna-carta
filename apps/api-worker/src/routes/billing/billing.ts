import { CIVIL_DATE_PATTERN, todayInUtc } from "@magna-carta/civil-time/civil-date";
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import {
  composeAccountRoleConfiguration,
  isAccountRole,
  readAccountRoleMap,
} from "@magna-carta/billing/account-roles";
import { BillingValidationError } from "@magna-carta/billing/billing-validation";
import {
  addClaimsToDraft,
  createInvoiceDraft,
  removeClaim,
  updateDraftLine,
  voidDraft,
} from "@magna-carta/billing/draft";
import {
  applyEarnedFeesUnderAuthorizationPolicy,
  composeTrustApplicationApproval,
} from "@magna-carta/billing/apply-authorization";
import { applyTrustFundsToInvoices } from "@magna-carta/billing/apply-trust-funds";
import { MAXIMUM_INVOICES_PER_TRUST_APPLICATION } from "@magna-carta/billing/earned-fee";
import { finalizeInvoice } from "@magna-carta/billing/finalize";
import {
  listInvoices,
  readAccountsReceivableAging,
  readInvoiceDetail,
  readMatterReceivable,
  readUnbilledWorkInProgress,
} from "@magna-carta/billing/queries";
import {
  readBillingArrangementHistory,
  readBillingArrangementInForce,
  setBillingArrangement,
  type BillingArrangementSnapshot,
} from "@magna-carta/billing/arrangements";
import {
  addContingencyFeeToDraft,
  readContingencyResidual,
  readMatterRecoveriesPage,
  recordMatterRecovery,
  voidMatterRecovery,
} from "@magna-carta/billing/contingency";
import {
  applyClientCreditToInvoice,
  composeApplicationReversal,
  composeInvoiceWriteOff,
  issueCreditNote,
} from "@magna-carta/billing/credit-note";
import { recordInvoiceDelivery } from "@magna-carta/billing/delivery";
import {
  readCreditNoteLinesForNotes,
  readCreditNotesForInvoicePage,
  readInvoiceDeliveries,
  readInvoiceDeliveryState,
  readOpenClientCreditsForClientPage,
} from "@magna-carta/billing/statements";
import { addFlatFeeToDraft } from "@magna-carta/billing/flat-fee";
import {
  readRetainerStatus,
  requestRetainerReplenishment,
  resolveRetainerReplenishmentRequest,
} from "@magna-carta/billing/retainer";
import {
  multiMatterRenderShapeDefinition,
  readInvoiceRenderModel,
} from "@magna-carta/billing/render-shape";
import { writeFirmSettingStatement } from "@magna-carta/data-access/setting-statements";
import {
  ACCOUNT_ROLES,
  INVOICE_DELIVERY_CHANNELS,
  INVOICE_DELIVERY_OUTCOMES,
} from "@magna-carta/billing/types";
import { approvalRequiredDefinition } from "@magna-carta/billing-core/review-gate";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { FileId, UserId } from "@magna-carta/identifiers/types";
import { isValidCalendarDate, LedgerValidationError } from "@magna-carta/ledger/validate";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { readFirmSetting } from "@magna-carta/data-access/setting-statements";
import { isNumberAllocationConflict } from "@magna-carta/sequence-numbering/counter-statements";
import { INVOICE_NUMBERING_TABLES } from "@magna-carta/billing/numbering";
import { TrustValidationError } from "@magna-carta/trust/trust-validation";
import type { Context } from "hono";
import type { Bindings } from "../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
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
import { cursorQuery } from "../../contracts/pagination.ts";
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";
import { problemResponseForLedgerRefusal } from "../../ledger-refusal-problems.ts";
import { problemResponseForTrustRefusal } from "../../trust-refusal-problems.ts";

// Billing: the firm's own bill. A DRAFT is a working document and everything on these routes is
// editable; FINALIZATION is the transition to evidence, and after it the invoice, its lines, and its
// claims are frozen by database trigger. There is deliberately no un-finalize endpoint and no edit
// endpoint that reaches a finalized invoice: a bill that should not have been issued is corrected by
// a credit note, which is a second permanent record rather than the erasure of the first.
//
// This module composes and commits; it decides nothing. The rules live one layer down in
// @magna-carta/billing, and one layer below that in the invoice_matter_balance bounds CHECK and the
// freeze triggers, which are what actually abort a batch. What belongs here is the mapping from a
// refusal to an HTTP status, the bounded retry around a lost number draw, and the resolution of
// names the domain will not invent for itself — which member is on the session, and what letterhead
// the bill is issued on.

const READ = "billing:read" as const;
const DRAFT = "billing:draft" as const;
const FINALIZE = "billing:finalize" as const;
// Moving client money to a bill. Deliberately not the same key as finalizing: finalizing turns a
// draft into evidence, applying takes somebody else's money against that evidence, and the migration
// that seeded these put `billing:apply` on the same roles `trust:manage` reaches for exactly that
// reason.
const APPLY = "billing:apply" as const;
// Correcting a bill that has already been issued. Separate from finalizing for the same reason
// applying is: issuing a credit note, giving up a receivable, or unwinding an application each
// change what a client owes on a document the firm has already handed over, and a billing clerk who
// may assemble drafts is not automatically somebody who may forgive a balance.
const CREDIT = "billing:credit" as const;
const CONFIGURE = "billing:configure" as const;

// A real calendar date, not a shape. The bare regex accepts 2026-02-30 and next week alike; both
// reach the ledger's own check at the finalize posting, and the aging read turns an unparseable
// as-of date into NaN, which fails every bucket comparison and reports the whole receivable as 90+.
const civilDate = z
  .string()
  .regex(CIVIL_DATE_PATTERN)
  .refine(isValidCalendarDate, { message: "not a calendar date" });

const CreateInvoiceRequest = z
  .object({
    // The Directory handle for the client this bill is for. One client per invoice: every line's
    // matter is validated against it, and a matter belonging to another client is refused by name.
    clientEntityId: z.string().min(1),
    currency: z.literal("USD"),
    billingPeriodStart: civilDate.nullable().optional(),
    billingPeriodEnd: civilDate.nullable().optional(),
    notes: z.string().nullable().optional(),
    locationId: identifierField("location").nullable().optional(),
  })
  .openapi("BillingCreateInvoiceRequest");

const ClaimRequest = z
  .object({
    sourceKind: z.enum(["time_entry", "cost_entry", "fee_entry"]),
    sourceId: z.string().min(1),
  })
  .openapi("BillingClaimRequest");

const AddClaimsRequest = z
  .object({ claims: z.array(ClaimRequest).min(1) })
  .openapi("BillingAddClaimsRequest");

const UpdateLineRequest = z
  .object({
    description: z.string().min(1).optional(),
    // Hours at the rate scale. Trimming a line is bill review; the time entry it was composed from
    // is the timekeeper's own record and is not touched.
    quantityE4: z.number().int().nullable().optional(),
    rateE4: z.number().int().nullable().optional(),
    amountMinor: z.number().int().optional(),
    taxTreatment: z.enum(["taxable", "exempt"]).optional(),
  })
  .openapi("BillingUpdateLineRequest");

const VoidDraftRequest = z.object({ reason: z.string().min(1) }).openapi("BillingVoidDraftRequest");

const FinalizeRequest = z
  .object({
    issueDate: civilDate,
    dueDate: civilDate,
    // Absent means the firm-wide sequence. A multi-office firm issuing on two letterheads passes its
    // office scope and gets an independent, gapless sequence per letterhead.
    numberScopeKey: z.string().min(1).optional(),
    // Deliberate consent to START a sequence under a scope key this firm has never used. Without it
    // an unrecognized key is refused, because the key is free text that selects which counter the
    // number is drawn from: `nyc` where the firm has always sent `NYC` would otherwise mint a second
    // sequence in silence, and the next bill out the door would be numbered `nyc-00001` while
    // `NYC-00042` was the real next number.
    createNumberScope: z.boolean().optional(),
    // The presentation snapshot. Copied onto the invoice at this moment and never read live again:
    // a later edit to an office address must not silently alter a document already given to a client.
    locationId: identifierField("location").nullable().optional(),
    letterheadAddressBlock: z.string().nullable().optional(),
    letterheadFooter: z.string().nullable().optional(),
    remitTo: z.string().nullable().optional(),
    clientBillingName: z.string().nullable().optional(),
    // How a bill spanning several matters is presented — per-matter pages plus a summary, or one
    // flowing document. Absent means the firm's configured default; either way the answer is
    // snapshot onto the invoice with the letterhead.
    renderShape: z.enum(["combined", "per_matter_pages"]).optional(),
  })
  .openapi("BillingFinalizeRequest");

const TrustApplicationTarget = z
  .object({
    invoiceId: identifierField("invoice"),
    // What to put against this bill. Partial is the normal case, not an edge case: a retainer
    // replenishment applies what it covers and leaves the rest owing.
    amountMinor: z.number().int().positive(),
  })
  .openapi("BillingTrustApplicationTarget");

const ApplyTrustFundsRequest = z
  .object({
    trustAccountId: identifierField("trustAccount"),
    // The matter whose client ledger the money leaves. Whose money it is follows from the matter's
    // own client party and is derived server-side — a caller-supplied client handle would be the
    // caller answering the question the check exists to ask.
    matterId: identifierField("matter"),
    currency: z.literal("USD"),
    effectiveDate: civilDate,
    // Bounded at the contract as well as in the domain: a transfer draws on ONE matter's leaf, so
    // the invoices it can settle are that matter's own, and the whole thing has to commit as one
    // batch. The domain refuses the same ceiling by name for any caller that does not come through
    // here.
    applications: z
      .array(TrustApplicationTarget)
      .min(1)
      .max(MAXIMUM_INVOICES_PER_TRUST_APPLICATION),
    trustDescription: z.string().min(1),
    operatingDescription: z.string().min(1),
  })
  .openapi("BillingApplyTrustFundsRequest");

const ApplyTrustFundsAck = z
  .object({
    transferId: z.string(),
    trustEntryId: z.string(),
    operatingEntryId: z.string(),
    applicationIds: z.array(z.string()),
    totalMinor: z.number().int(),
    currency: z.string(),
  })
  .openapi("BillingApplyTrustFundsAck");

const TrustApplicationRequestSubmission = z
  .object({
    trustAccountId: identifierField("trustAccount"),
    matterId: identifierField("matter"),
    currency: z.literal("USD"),
    effectiveDate: civilDate,
    applications: z
      .array(TrustApplicationTarget)
      .min(1)
      .max(MAXIMUM_INVOICES_PER_TRUST_APPLICATION),
    trustDescription: z.string().min(1),
    operatingDescription: z.string().min(1),
    // How the money will physically move to the firm, and how the client ledger will name it — the
    // same particulars a disbursement request records, because the approving member is approving
    // facts somebody wrote down, not an amount in the abstract.
    method: z.enum(["check", "cash", "wire", "electronic_transfer", "card"]),
    reference: z.string().min(1).nullable().optional(),
    payee: z.string().min(1),
    purpose: z.string().min(1),
  })
  .openapi("BillingTrustApplicationRequestSubmission");

// A member the firm has given the authority to act on client money, named so a pending application
// can say who is able to release it rather than only that somebody must.
const AuthorizedMember = z
  .object({ userId: z.string(), displayName: z.string() })
  .openapi("BillingAuthorizedMember");

// What became of a proposed earned-fee application. `applied` means the submitting member held the
// authority the firm requires and the amount needed no second person, so the fees moved in the same
// atomic write and no queue row exists at all. `pending` means somebody else has to release it, and
// `eligibleApprovers` says who; nothing has reached the ledger.
const TrustApplicationRequestAck = z
  .object({
    trustDisbursementRequestId: z.string().nullable(),
    totalMinor: z.number().int(),
    currency: z.string(),
    status: z.enum(["pending", "applied"]),
    transferId: z.string().nullable(),
    trustEntryId: z.string().nullable(),
    operatingEntryId: z.string().nullable(),
    applicationIds: z.array(z.string()),
    eligibleApprovers: z.array(AuthorizedMember),
  })
  .openapi("BillingTrustApplicationRequestAck");

const TrustApplicationApprovalAck = z
  .object({
    trustDisbursementRequestId: z.string(),
    authorizationBasis: z.enum(["second_person", "sole_trust_manager", "policy_exempt"]),
    transferId: z.string(),
    trustEntryId: z.string(),
    operatingEntryId: z.string(),
    applicationIds: z.array(z.string()),
    totalMinor: z.number().int(),
    currency: z.string(),
  })
  .openapi("BillingTrustApplicationApprovalAck");

const applicationRequestParam = z.object({
  requestId: identifierPathParam("trustDisbursementRequest", "requestId"),
});

const AccountRoleAssignment = z
  .object({
    role: z.enum(ACCOUNT_ROLES),
    ledgerAccountId: identifierField("ledgerAccount"),
  })
  .openapi("BillingAccountRoleAssignment");

const AccountRoleRequest = z
  .object({ assignments: z.array(AccountRoleAssignment).min(1) })
  .openapi("BillingAccountRoleRequest");

const AccountRoleMapResponse = z
  .object({ assignments: z.array(AccountRoleAssignment) })
  .openapi("BillingAccountRoleMapResponse");

const InvoiceAck = z
  .object({ invoiceId: z.string(), status: z.enum(["draft", "final", "void"]) })
  .openapi("BillingInvoiceAck");

const ClaimAck = z
  .object({ invoiceId: z.string(), claimIds: z.array(z.string()), lineIds: z.array(z.string()) })
  .openapi("BillingClaimAck");

const FinalizeAck = z
  .object({
    invoiceId: z.string(),
    invoiceNumber: z.string(),
    totalMinor: z.number().int(),
    currency: z.string(),
    ledgerEntryId: z.string(),
  })
  .openapi("BillingFinalizeAck");

const InvoiceListItem = z
  .object({
    id: z.string(),
    clientEntityId: z.string(),
    // The client's name as the directory holds it, resolved by the listing. Null both where no
    // directory entry answers to the identifier and where the entry behind one is gone;
    // clientEntityId tells those two apart. Never the identifier standing in for a name.
    clientName: z.string().nullable(),
    currency: z.string(),
    status: z.enum(["draft", "final", "void"]),
    invoiceNumber: z.string().nullable(),
    issueDate: z.string().nullable(),
    dueDate: z.string().nullable(),
    totalMinor: z.number().int(),
    appliedMinor: z.number().int(),
    unpaidMinor: z.number().int(),
    createdAt: z.string(),
    // One matter's share of this bill, present only when the listing named a matter. Three fields
    // rather than one because a draft and a finalized bill hold the fact in different places:
    // matterLinesMinor is the sum of the matter's own lines and exists from the moment a claim
    // composes one, while the other two come from the matter's balance row, which finalization
    // creates — so both are null on a draft, and a null there means "not owed yet", never zero.
    matterLinesMinor: z.number().int().optional(),
    matterTotalMinor: z.number().int().nullable().optional(),
    matterAppliedMinor: z.number().int().nullable().optional(),
  })
  .openapi("BillingInvoiceListItem");

const InvoiceListResponse = z
  .object({ data: z.array(InvoiceListItem), nextCursor: z.string().nullable() })
  .openapi("BillingInvoiceListResponse");

// Whether there is any record of a bill having reached the client, and what the attempts were. It
// rides the invoice detail rather than waiting to be asked for separately, because the surface that
// has to show it is the one where a firm decides to take fees out of a client's trust ledger — a fact
// that must be fetched on purpose is a fact a surface forgets to show.
const InvoiceDeliveryState = z
  .object({
    // False with `attemptCount` at zero means the bill has never been sent. False with attempts
    // behind it means it has been chased and has not landed. They are different situations and a
    // surface that showed one message for both would tell a firm nothing it needs.
    delivered: z.boolean(),
    // The date of the FIRST recorded success, not the most recent one: the question is when the client
    // was first given the bill, and a courtesy re-send later does not move that date.
    deliveredOn: z.string().nullable(),
    attemptCount: z.number().int(),
    failedAttemptCount: z.number().int(),
    lastAttemptOn: z.string().nullable(),
  })
  .openapi("BillingInvoiceDeliveryState");

const InvoiceDetailResponse = InvoiceListItem.extend({
  delivery: InvoiceDeliveryState,
  lines: z.array(
    z.object({
      id: z.string(),
      lineIndex: z.number().int(),
      matterId: z.string(),
      // The line's matter, named. A bill belongs to a client and may charge several of that
      // client's matters, so a surface showing what it charges has to name them — a list of
      // identifiers asks a reader to choose between strings they cannot read. Null where no matter
      // answers to the identifier: an honest gap, never the handle standing in for a name. Carried
      // on the LINES as well as the balances because a draft has lines and no balance rows.
      matterNumber: z.string().nullable(),
      matterTitle: z.string().nullable(),
      kind: z.string(),
      description: z.string(),
      amountMinor: z.number().int(),
    }),
  ),
  matterBalances: z.array(
    z.object({
      matterId: z.string(),
      matterNumber: z.string().nullable(),
      matterTitle: z.string().nullable(),
      totalMinor: z.number().int(),
      appliedMinor: z.number().int(),
      unpaidMinor: z.number().int(),
    }),
  ),
}).openapi("BillingInvoiceDetailResponse");

const UnbilledResponse = z
  .object({
    matterId: z.string(),
    timeEntryCount: z.number().int(),
    timeAmountMinor: z.number().int(),
    costEntryCount: z.number().int(),
    costAmountMinor: z.number().int(),
    // What this matter still owes across every finalized invoice that bills it.
    receivableTotalMinor: z.number().int(),
    receivableAppliedMinor: z.number().int(),
    receivableUnpaidMinor: z.number().int(),
  })
  .openapi("BillingUnbilledResponse");

const AgingResponse = z
  .object({
    asOfDate: z.string(),
    buckets: z.array(
      z.object({
        label: z.string(),
        invoiceCount: z.number().int(),
        unpaidMinor: z.number().int(),
      }),
    ),
  })
  .openapi("BillingAgingResponse");

// The fee agreement. One in-force arrangement per matter; an amendment is a new version and the old
// one stays, because invoice lines record the version that composed them.
const ArrangementRequest = z
  .object({
    kind: z.enum(["hourly", "flat_fee", "contingency", "retainer"]),
    flatFeeAmountMinor: z.number().int().positive().optional(),
    // The share as a fraction of the recovery at the rate scale: 3333 is 33.33%.
    contingencyShareE4: z.number().int().min(1).max(10_000).optional(),
    contingencyBasis: z.enum(["gross_recovery", "net_after_costs"]).optional(),
    retainerTargetMinor: z.number().int().positive().optional(),
    retainerThresholdMinor: z.number().int().min(0).optional(),
    // Where an advance fee sits until earned. Recorded, never defaulted: jurisdictions genuinely
    // differ, and the platform does not answer this for a firm.
    advanceDepositDestination: z.enum(["trust", "operating"]).nullable().optional(),
    currency: z.literal("USD"),
    validFrom: civilDate,
    // The signed agreement this version rests on — the intake agreement signed at opening, or the
    // amendment signed later — as one of the matter's own files. Optional: the paper may follow.
    agreementFileId: z.string().nullable().optional(),
  })
  .openapi("BillingArrangementRequest");

const ArrangementVersion = z
  .object({
    id: z.string(),
    matterId: z.string(),
    version: z.number().int(),
    kind: z.enum(["hourly", "flat_fee", "contingency", "retainer"]),
    flatFeeAmountMinor: z.number().int().nullable(),
    contingencyShareE4: z.number().int().nullable(),
    contingencyBasis: z.enum(["gross_recovery", "net_after_costs"]).nullable(),
    retainerTargetMinor: z.number().int().nullable(),
    retainerThresholdMinor: z.number().int().nullable(),
    advanceDepositDestination: z.enum(["trust", "operating"]).nullable(),
    currency: z.string(),
    validFrom: z.string(),
    validTo: z.string().nullable(),
    // The signed agreement behind this version, and what it is called; both null where none was
    // recorded, the name alone null where the file has since been deleted.
    agreementFileId: z.string().nullable(),
    agreementFileName: z.string().nullable(),
  })
  .openapi("BillingArrangementVersion");

const ArrangementResponse = z
  .object({
    // Null means the matter is billed hourly by absence — no agreement was ever recorded.
    inForce: ArrangementVersion.nullable(),
    history: z.array(ArrangementVersion),
  })
  .openapi("BillingArrangementResponse");

const RecoveryRequest = z
  .object({
    amountMinor: z.number().int().positive(),
    currency: z.literal("USD"),
    recoveredDate: civilDate,
    description: z.string().min(1),
  })
  .openapi("BillingRecoveryRequest");

const RecoveryAck = z
  .object({ recoveryId: z.string(), matterId: z.string() })
  .openapi("BillingRecoveryAck");

const RecoveryListResponse = z
  .object({
    data: z.array(
      z.object({
        id: z.string(),
        amountMinor: z.number().int(),
        currency: z.string(),
        recoveredDate: z.string(),
        description: z.string(),
        voidedAt: z.string().nullable(),
        voidReason: z.string().nullable(),
      }),
    ),
    nextCursor: z.string().nullable(),
  })
  .openapi("BillingRecoveryListResponse");

const VoidRecoveryRequest = z
  .object({ reason: z.string().min(1) })
  .openapi("BillingVoidRecoveryRequest");

const FlatFeeRequest = z
  .object({
    matterId: identifierField("matter"),
    // An instalment of the agreed fee; absent means the whole agreed amount.
    amountMinor: z.number().int().positive().optional(),
    description: z.string().min(1).optional(),
    contributingTimeEntryIds: z.array(identifierField("timeEntry")).optional(),
  })
  .openapi("BillingFlatFeeRequest");

const FlatFeeAck = z
  .object({ invoiceId: z.string(), lineId: z.string(), claimIds: z.array(z.string()) })
  .openapi("BillingFlatFeeAck");

const ContingencyFeeRequest = z
  .object({ matterId: identifierField("matter") })
  .openapi("BillingContingencyFeeRequest");

// The whole derivation is echoed back so the biller sees the arithmetic that produced the line —
// the number is computed at composition, never stored anywhere but the reviewable line. feeMinor is
// what THIS line charges: the entitlement under the agreement, net of what earlier finalized bills
// already took of it.
const ContingencyFeeAck = z
  .object({
    invoiceId: z.string(),
    lineId: z.string(),
    feeMinor: z.number().int(),
    entitlementMinor: z.number().int(),
    previouslyBilledMinor: z.number().int(),
    baseMinor: z.number().int(),
    shareE4: z.number().int(),
    basis: z.enum(["gross_recovery", "net_after_costs"]),
    recoveriesMinor: z.number().int(),
    advancedCostsMinor: z.number().int(),
  })
  .openapi("BillingContingencyFeeAck");

const RetainerStatusResponse = z
  .object({
    matterId: z.string(),
    targetMinor: z.number().int(),
    thresholdMinor: z.number().int(),
    availableMinor: z.number().int(),
    belowFloor: z.boolean(),
    shortfallMinor: z.number().int(),
    openRequestId: z.string().nullable(),
  })
  .openapi("BillingRetainerStatusResponse");

const ReplenishmentRequestBody = z
  .object({ trustAccountId: identifierField("trustAccount") })
  .openapi("BillingReplenishmentRequestBody");

const ReplenishmentAck = z
  .object({
    requestId: z.string(),
    matterId: z.string(),
    observedBalanceMinor: z.number().int(),
    requestedAmountMinor: z.number().int(),
  })
  .openapi("BillingReplenishmentAck");

const RenderShapeSetting = z
  .object({ renderShape: z.enum(["combined", "per_matter_pages"]) })
  .openapi("BillingRenderShapeSetting");

const RenderModelResponse = z
  .object({
    invoiceId: z.string(),
    status: z.enum(["draft", "final", "void"]),
    invoiceNumber: z.string().nullable(),
    currency: z.string(),
    renderShape: z.enum(["combined", "per_matter_pages"]),
    totalMinor: z.number().int(),
    pages: z.array(
      z.object({
        matterId: z.string().nullable(),
        matterTitle: z.string().nullable(),
        subtotalMinor: z.number().int(),
        lines: z.array(
          z.object({
            id: z.string(),
            lineIndex: z.number().int(),
            matterId: z.string(),
            kind: z.string(),
            description: z.string(),
            quantityE4: z.number().int().nullable(),
            rateE4: z.number().int().nullable(),
            amountMinor: z.number().int(),
          }),
        ),
      }),
    ),
    summary: z
      .object({
        matters: z.array(z.object({ matterId: z.string(), totalMinor: z.number().int() })),
        totalMinor: z.number().int(),
      })
      .nullable(),
  })
  .openapi("BillingRenderModelResponse");

// --- Corrections after finalization ---------------------------------------------------------

const CreditNoteLineRequest = z
  .object({
    matterId: identifierField("matter"),
    kind: z.enum(["fee", "cost", "flat_fee", "discount", "adjustment", "interest", "tax"]),
    description: z.string().min(1),
    // Positive. A credit note's direction is the document it is, so its lines carry the magnitude
    // only — the same rule a ledger line follows.
    amountMinor: z.number().int().positive(),
    // The charge on the corrected bill this line credits, where the firm is crediting a specific
    // one rather than the bill in general. Required to make a credit count against a fee that was
    // computed from a basis, because such a fee is billed as the increment over what earlier bills
    // already charged.
    creditsInvoiceLineId: identifierField("invoiceLine").nullable().optional(),
  })
  .openapi("BillingCreditNoteLineRequest");

const CreditNoteRequest = z
  .object({
    reason: z.string().min(1),
    effectiveDate: civilDate,
    lines: z.array(CreditNoteLineRequest).min(1),
  })
  .openapi("BillingCreditNoteRequest");

const CreditNoteAck = z
  .object({
    creditNoteId: z.string(),
    invoiceId: z.string(),
    totalMinor: z.number().int(),
    appliedMinor: z.number().int(),
    clientCreditMinor: z.number().int(),
    matters: z.array(
      z.object({
        matterId: z.string(),
        creditedMinor: z.number().int(),
        appliedMinor: z.number().int(),
        residualMinor: z.number().int(),
        clientCreditId: z.string().nullable(),
      }),
    ),
  })
  .openapi("BillingCreditNoteAck");

const CreditNoteListResponse = z
  .object({
    data: z.array(
      z.object({
        id: z.string(),
        reason: z.string(),
        effectiveDate: z.string(),
        currency: z.string(),
        issuedAt: z.string(),
        totalMinor: z.number().int(),
        lines: z.array(
          z.object({
            id: z.string(),
            matterId: z.string(),
            kind: z.string(),
            description: z.string(),
            amountMinor: z.number().int(),
            creditsInvoiceLineId: z.string().nullable(),
          }),
        ),
      }),
    ),
    nextCursor: z.string().nullable(),
  })
  .openapi("BillingCreditNoteListResponse");

const WriteOffRequest = z
  .object({
    matterId: identifierField("matter"),
    amountMinor: z.number().int().positive(),
    reason: z.string().min(1),
    effectiveDate: civilDate,
  })
  .openapi("BillingWriteOffRequest");

const ApplicationAck = z
  .object({ applicationId: z.string(), invoiceId: z.string(), matterId: z.string() })
  .openapi("BillingApplicationAck");

const ClientCreditListResponse = z
  .object({
    data: z.array(
      z.object({
        id: z.string(),
        matterId: z.string(),
        creditNoteId: z.string(),
        amountMinor: z.number().int(),
        dischargedMinor: z.number().int(),
        remainingMinor: z.number().int(),
        currency: z.string(),
        openedAt: z.string(),
      }),
    ),
    nextCursor: z.string().nullable(),
  })
  .openapi("BillingClientCreditListResponse");

const ApplyClientCreditRequest = z
  .object({
    invoiceId: identifierField("invoice"),
    matterId: identifierField("matter"),
    amountMinor: z.number().int().positive(),
    effectiveDate: civilDate,
  })
  .openapi("BillingApplyClientCreditRequest");

const ApplyClientCreditAck = z
  .object({
    applicationId: z.string(),
    clientCreditId: z.string(),
    remainingMinor: z.number().int(),
  })
  .openapi("BillingApplyClientCreditAck");

const ReverseApplicationRequest = z
  .object({ reason: z.string().min(1), effectiveDate: civilDate })
  .openapi("BillingReverseApplicationRequest");

const ReverseApplicationAck = z
  .object({
    applicationId: z.string(),
    reversesApplicationId: z.string(),
  })
  .openapi("BillingReverseApplicationAck");

const DeliveryRequest = z
  .object({
    // How the bill reached the client. Every one of these is a delivery the FIRM made and is telling
    // the platform about: the platform sends nothing itself.
    channel: z.enum(INVOICE_DELIVERY_CHANNELS),
    // Who received it, in the firm's own words — the address it was posted to, the mailbox it was
    // emailed to, the portal account it was submitted to, or the person it was handed to.
    recipientReference: z.string().min(1),
    // The date the bill reached the client, which is the firm's to state and is usually not today: a
    // bill posted last Tuesday and recorded this morning carries last Tuesday's date.
    deliveryDate: civilDate,
    // The handle of whatever carried it, where something did — a tracking number, a gateway submission
    // reference, the message id of a mail sent elsewhere.
    externalReference: z.string().min(1).nullable().optional(),
    // Whether it arrived. A returned letter or a rejected submission is recorded as a failed attempt
    // rather than left out, because a history that holds only successes reads as complete when it is
    // not.
    outcome: z.enum(INVOICE_DELIVERY_OUTCOMES).default("delivered"),
  })
  .openapi("BillingDeliveryRequest");

const DeliveryAck = z
  .object({ deliveryId: z.string(), invoiceId: z.string() })
  .openapi("BillingDeliveryAck");

const DeliveryListResponse = z
  .object({
    state: InvoiceDeliveryState,
    data: z.array(
      z.object({
        id: z.string(),
        channel: z.string(),
        recipientReference: z.string(),
        deliveryDate: z.string(),
        externalReference: z.string().nullable(),
        outcome: z.string(),
        recordedBy: z.string().nullable(),
        recordedAt: z.string(),
      }),
    ),
    // Capped, not paged: the attempt order is a three-column composite the platform's cursor cannot
    // carry. See readInvoiceDeliveries in packages/billing/src/statements.ts.
    capped: z.boolean(),
  })
  .openapi("BillingDeliveryListResponse");

const ContingencyResidualResponse = z
  .object({
    matterId: z.string(),
    entitlementMinor: z.number().int(),
    billedMinor: z.number().int(),
    residualMinor: z.number().int(),
    feeLines: z.array(
      z.object({
        invoiceId: z.string(),
        invoiceNumber: z.string().nullable(),
        invoiceLineId: z.string(),
        chargedMinor: z.number().int(),
        creditedMinor: z.number().int(),
        invoiceMatterUnpaidMinor: z.number().int(),
      }),
    ),
  })
  .openapi("BillingContingencyResidualResponse");

const invoiceParam = z.object({ invoiceId: identifierPathParam("invoice", "invoiceId") });
const lineParam = z.object({
  invoiceId: identifierPathParam("invoice", "invoiceId"),
  lineId: identifierPathParam("invoiceLine", "lineId"),
});
const claimParam = z.object({
  invoiceId: identifierPathParam("invoice", "invoiceId"),
  claimId: identifierPathParam("invoiceWipClaim", "claimId"),
});
const matterParam = z.object({ matterId: identifierPathParam("matter", "matterId") });
const recoveryParam = z.object({
  matterId: identifierPathParam("matter", "matterId"),
  recoveryId: identifierPathParam("matterRecovery", "recoveryId"),
});
const replenishmentParam = z.object({
  requestId: identifierPathParam("retainerReplenishmentRequest", "requestId"),
});
const clientCreditParam = z.object({
  clientCreditId: identifierPathParam("clientCredit", "clientCreditId"),
});
const applicationParam = z.object({
  applicationId: identifierPathParam("invoiceApplication", "applicationId"),
});
// The client is a Directory handle rather than a per-firm identifier, so it is an ordinary path
// string — the same shape the invoice list's clientEntityId filter takes.
const clientParam = z.object({ clientEntityId: z.string().min(1) });
const retainerStatusQuery = z.object({ trustAccountId: identifierField("trustAccount") });
const invoiceStatusField = z.enum(["draft", "final", "void"]);
const listQuery = z.object({
  clientEntityId: z.string().min(1).optional(),
  matterId: z.string().min(1).optional().openapi({
    description:
      "Narrows to the bills that charge this matter, drafts included, and adds that matter's own share to every row. Without it the listing answers for the whole firm, or for one client when clientEntityId is given.",
  }),
  status: z
    .union([invoiceStatusField, z.array(invoiceStatusField)])
    .optional()
    .openapi({
      description:
        "Narrows to one status, or to several given repeatedly (`status=draft&status=void`): " +
        "the firm's Billing screen's Status column filter, honoured here so it holds across " +
        "every page.",
    }),
  search: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .openapi({
      description:
        "Matched against the invoice number and the client's name. The screen's search, " +
        "honoured here so a client absent from the page in hand is looked for across the whole " +
        "register.",
    }),
  cursor: z.string().optional(),
});
const agingQuery = z.object({ asOfDate: civilDate.optional() });

const errorResponses = {
  400: {
    description: "Missing Idempotency-Key (this operation requires one)",
    content: { "application/problem+json": { schema: Problem } },
  },
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "The session member lacks the required capability",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description: "The firm is unreachable, the member is deactivated, or the invoice is unknown",
    content: { "application/problem+json": { schema: Problem } },
  },
  409: {
    description:
      "A request with this Idempotency-Key is in progress, the invoice is no longer a draft, or another draft already holds this work",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description:
      "The request is invalid, the Idempotency-Key was reused with a different payload, a ledger account role the posting needs is unmapped, or the billing rules refuse the change",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;

const readErrorResponses = {
  401: errorResponses[401],
  403: errorResponses[403],
  404: errorResponses[404],
  422: errorResponses[422],
  429: errorResponses[429],
};

// Plain objects, deliberately NOT `as const`: a const-asserted spread deep-freezes the
// content-schema literal in a way that breaks zod-openapi's match of the handler's typed problem
// responses to these status codes — the same note custom-fields.ts carries.
const mutationResponses = {
  400: errorResponses[400],
  401: errorResponses[401],
  403: errorResponses[403],
  404: errorResponses[404],
  409: errorResponses[409],
  422: errorResponses[422],
  429: errorResponses[429],
};

type BillingPermission =
  | typeof READ
  | typeof DRAFT
  | typeof FINALIZE
  | typeof APPLY
  | typeof CREDIT
  | typeof CONFIGURE;

function writeMeta(operationId: string, permission: BillingPermission): RouteMeta {
  return {
    operationId,
    surface: "app",
    authenticated: true,
    permission,
    // One invoice may bill several of a client's matters, so the matter is not its tenancy root.
    resource: "firm",
    audited: true,
    // Money mutations are never replayable: a retried finalize that drew a second number would
    // consume a number the sequence can never give back, and a retried claim would double-bill.
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

function readMeta(operationId: string): RouteMeta {
  return {
    operationId,
    surface: "app",
    authenticated: true,
    permission: READ,
    resource: "firm",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  };
}

const createInvoiceRoute = defineOpenAPIRoute(writeMeta("billing.createInvoice", DRAFT), {
  method: "post",
  path: "/api/v1/billing/invoices",
  description:
    "Opens a draft invoice for one client. A draft is a working document: nothing has been asserted to anybody, no number has been drawn, and no work is locked. It becomes a financial record only when it is finalized.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: CreateInvoiceRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The draft invoice was opened",
      content: { "application/json": { schema: InvoiceAck } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    422: errorResponses[422],
    429: errorResponses[429],
  },
});

const addClaimsRoute = defineOpenAPIRoute(writeMeta("billing.addClaims", DRAFT), {
  method: "post",
  path: "/api/v1/billing/invoices/{invoiceId}/claims",
  description:
    "Pulls unbilled time and cost entries onto a draft, composing a line from each entry's own snapshot. The entries are CLAIMED, not locked: they stay editable, and they become billed only when the invoice is finalized. An entry another draft already holds is refused, and so is a matter belonging to a different client.",
  request: {
    headers: idempotencyKeyHeader,
    params: invoiceParam,
    body: { content: { "application/json": { schema: AddClaimsRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The work was claimed and its lines composed",
      content: { "application/json": { schema: ClaimAck } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    422: errorResponses[422],
    429: errorResponses[429],
  },
});

const releaseClaimRoute = defineOpenAPIRoute(writeMeta("billing.releaseClaim", DRAFT), {
  method: "post",
  path: "/api/v1/billing/invoices/{invoiceId}/claims/{claimId}/release",
  description:
    "Takes one claimed entry back off a draft, returning it to unbilled work-in-progress and removing the line that presented it. The claim record itself remains, released, so that this entry was once on this draft stays answerable.",
  request: { headers: idempotencyKeyHeader, params: claimParam },
  responses: {
    201: {
      description: "The claim was released",
      content: { "application/json": { schema: InvoiceAck } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    422: errorResponses[422],
    429: errorResponses[429],
  },
});

const updateLineRoute = defineOpenAPIRoute(writeMeta("billing.updateLine", DRAFT), {
  method: "patch",
  path: "/api/v1/billing/invoices/{invoiceId}/lines/{lineId}",
  description:
    "Edits one line of a draft — its wording, its quantity, its rate, or its amount. This is bill review, and it changes what the CLIENT is told; the time entry the line was composed from is the timekeeper's contemporaneous record of what was done and is left exactly as it was.",
  request: {
    headers: idempotencyKeyHeader,
    params: lineParam,
    body: { content: { "application/json": { schema: UpdateLineRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The line was updated",
      content: { "application/json": { schema: InvoiceAck } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    422: errorResponses[422],
    429: errorResponses[429],
  },
});

const voidDraftRoute = defineOpenAPIRoute(writeMeta("billing.voidDraft", DRAFT), {
  method: "post",
  path: "/api/v1/billing/invoices/{invoiceId}/void",
  description:
    "Throws a draft away, releasing every entry it held back to unbilled work-in-progress. Only a draft can be voided: a finalized invoice is corrected by a credit note, never erased.",
  request: {
    headers: idempotencyKeyHeader,
    params: invoiceParam,
    body: { content: { "application/json": { schema: VoidDraftRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The draft was voided and its work released",
      content: { "application/json": { schema: InvoiceAck } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    422: errorResponses[422],
    429: errorResponses[429],
  },
});

const finalizeRoute = defineOpenAPIRoute(writeMeta("billing.finalizeInvoice", FINALIZE), {
  method: "post",
  path: "/api/v1/billing/invoices/{invoiceId}/finalization",
  description:
    "Turns a draft into an evidentiary financial record, in ONE atomic write: the next number in the sequence is drawn, the letterhead and client details are copied onto the invoice, every claimed entry locks as billed, the per-matter balances are created with the ceiling that makes over-application impossible, and the accounts-receivable entry posts. Nothing about the invoice can be edited afterwards. If any part fails, no number is consumed, no work is locked, and nothing is posted. A firm that has not told the platform which of its ledger accounts play the billing roles is refused here, by name, rather than posted somewhere plausible.",
  request: {
    headers: idempotencyKeyHeader,
    params: invoiceParam,
    body: { content: { "application/json": { schema: FinalizeRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The invoice was finalized and the receivable posted",
      content: { "application/json": { schema: FinalizeAck } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    422: errorResponses[422],
    429: errorResponses[429],
  },
});

const applyTrustFundsRoute = defineOpenAPIRoute(writeMeta("billing.applyTrustFunds", APPLY), {
  method: "post",
  path: "/api/v1/billing/trust-applications",
  description:
    "Takes earned fees out of a client's trust ledger and puts them against that client's finalized bills, in ONE atomic write: the money leaves the client ledger, arrives in the firm's operating account as two linked entries, and each bill's balance moves by exactly what was applied. A bill that is still a draft, a bill for a different client, a bill that does not charge this matter, or an amount above what this matter still owes on it are each refused by name — money leaves trust for the firm only against a bill that has become an evidentiary record, and there is no override. Applying part of what is owed is ordinary: the rest stays owing and can be applied later. If any part of this fails, no money moves at all.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: ApplyTrustFundsRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The funds were transferred and applied",
      content: { "application/json": { schema: ApplyTrustFundsAck } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    422: errorResponses[422],
    429: errorResponses[429],
  },
});

const submitTrustApplicationRoute = defineOpenAPIRoute(
  writeMeta("billing.submitTrustApplication", APPLY),
  {
    method: "post",
    path: "/api/v1/billing/trust-application-requests",
    description:
      "Takes earned fees out of a client's trust ledger against named finalized invoices, under the firm's own posture — which decides whether this member may take them now or has to ask. A member holding the authority to act on client money, for an amount that needs no second person, takes them in one atomic write and the response says `applied`. Anybody else leaves a pending request with its invoice lines beside it; the response says `pending`, names who can release it, and nothing reaches the ledger. A pending request is checked now so the submitter learns of a problem immediately and re-checked in full at approval, and it is decided under the policy version in force when it was submitted, however the posture changes while it is pending. Rejection and withdrawal use the trust disbursement-request endpoints — the queue is shared.",
    request: {
      headers: idempotencyKeyHeader,
      body: {
        content: { "application/json": { schema: TrustApplicationRequestSubmission } },
        required: true,
      },
    },
    responses: {
      201: {
        description:
          "The earned fees were applied by the submitting member, or the request is recorded and awaiting approval",
        content: { "application/json": { schema: TrustApplicationRequestAck } },
      },
      400: errorResponses[400],
      401: errorResponses[401],
      403: errorResponses[403],
      404: errorResponses[404],
      409: errorResponses[409],
      422: errorResponses[422],
      429: errorResponses[429],
    },
  },
);

const approveTrustApplicationRoute = defineOpenAPIRoute(
  writeMeta("billing.approveTrustApplication", APPLY),
  {
    method: "post",
    path: "/api/v1/billing/trust-application-requests/{requestId}/approval",
    description:
      "Approves a pending earned-fee application and posts it, in ONE atomic write: the money leaves the client ledger as two linked entries, each named invoice's balance moves by exactly what the request proposed, and the decision that settles the request records who approved and on what footing. Every check the direct application runs is run again HERE, against the invoices and the ledger as they stand now — a request overtaken by a payment, a credit note, or another transfer is refused rather than posted. Under a policy requiring a second person the approving member must be somebody other than the submitter; the recorded exceptions (a sole trust manager, or a policy that exempts the amount) are named on the decision's face.",
    request: {
      headers: idempotencyKeyHeader,
      params: applicationRequestParam,
    },
    responses: {
      201: {
        description: "The application was approved, transferred, and applied",
        content: { "application/json": { schema: TrustApplicationApprovalAck } },
      },
      400: errorResponses[400],
      401: errorResponses[401],
      403: errorResponses[403],
      404: errorResponses[404],
      409: errorResponses[409],
      422: errorResponses[422],
      429: errorResponses[429],
    },
  },
);

const setAccountRolesRoute = defineOpenAPIRoute(writeMeta("billing.setAccountRoles", CONFIGURE), {
  method: "put",
  path: "/api/v1/billing/account-roles",
  description:
    "Tells the platform which of the firm's ledger accounts plays each part in a billing posting — the receivable, fee income, advanced client costs, cost recovery, tax payable, and the rest. Until a role is mapped, any invoice whose lines need it refuses to finalize. Re-pointing a role changes where FUTURE postings land and never restates one already made.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: AccountRoleRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The account-role map was updated",
      content: { "application/json": { schema: AccountRoleMapResponse } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    422: errorResponses[422],
    429: errorResponses[429],
  },
});

const accountRolesRoute = defineOpenAPIRoute(
  { ...readMeta("billing.accountRoles"), permission: CONFIGURE },
  {
    method: "get",
    path: "/api/v1/billing/account-roles",
    description:
      "Returns which ledger account currently plays each billing posting role. A role that is absent is a role no invoice needing it can be finalized against.",
    responses: {
      200: {
        description: "The account-role map",
        content: { "application/json": { schema: AccountRoleMapResponse } },
      },
      401: readErrorResponses[401],
      403: readErrorResponses[403],
      404: readErrorResponses[404],
      422: readErrorResponses[422],
      429: readErrorResponses[429],
    },
  },
);

const listInvoicesRoute = defineOpenAPIRoute(readMeta("billing.listInvoices"), {
  method: "get",
  path: "/api/v1/billing/invoices",
  description:
    "Lists invoices newest first, with each one's total, what has been applied to it, what is still unpaid, and the client's name. The unpaid figure is derived from the per-matter balances rather than stored, so it can never drift from them. Unnarrowed it answers for the whole firm, which is what the firm's billing register reads; narrowed to a client it answers that client's bills, and narrowed to a matter it answers the bills that charge that matter and carries the matter's own share of each — the figure a matter's register states, which it used to reach by reading every bill's detail one at a time.",
  request: { query: listQuery },
  responses: {
    200: {
      description: "A page of invoices",
      content: { "application/json": { schema: InvoiceListResponse } },
    },
    401: readErrorResponses[401],
    403: readErrorResponses[403],
    404: readErrorResponses[404],
    422: readErrorResponses[422],
    429: readErrorResponses[429],
  },
});

const invoiceDetailRoute = defineOpenAPIRoute(readMeta("billing.invoiceDetail"), {
  method: "get",
  path: "/api/v1/billing/invoices/{invoiceId}",
  description:
    "Returns one invoice with its lines in presentation order and its balance per matter. A finalized invoice reads back entirely from its own rows — the letterhead, the client name, and every line's wording were copied at finalization, so it renders the same years later however much the underlying records have changed since.",
  request: { params: invoiceParam },
  responses: {
    200: {
      description: "The invoice",
      content: { "application/json": { schema: InvoiceDetailResponse } },
    },
    401: readErrorResponses[401],
    403: readErrorResponses[403],
    404: readErrorResponses[404],
    422: readErrorResponses[422],
    429: readErrorResponses[429],
  },
});

const unbilledRoute = defineOpenAPIRoute(readMeta("billing.matterUnbilled"), {
  method: "get",
  path: "/api/v1/billing/matters/{matterId}/unbilled",
  description:
    "What is still billable on one matter — the time and costs no draft holds and no invoice has billed — together with what the matter already owes across its finalized invoices.",
  request: { params: matterParam },
  responses: {
    200: {
      description: "The matter's unbilled work and its receivable",
      content: { "application/json": { schema: UnbilledResponse } },
    },
    401: readErrorResponses[401],
    403: readErrorResponses[403],
    404: readErrorResponses[404],
    422: readErrorResponses[422],
    429: readErrorResponses[429],
  },
});

const agingRoute = defineOpenAPIRoute(readMeta("billing.receivablesAging"), {
  method: "get",
  path: "/api/v1/billing/receivables/aging",
  description:
    "The firm's unpaid receivables bucketed by how far past due they are. Overdue is worked out at the moment you ask rather than stored, so a bill settled this morning is never reported as late.",
  request: { query: agingQuery },
  responses: {
    200: {
      description: "The aging buckets",
      content: { "application/json": { schema: AgingResponse } },
    },
    401: readErrorResponses[401],
    403: readErrorResponses[403],
    404: readErrorResponses[404],
    422: readErrorResponses[422],
    429: readErrorResponses[429],
  },
});

const setArrangementRoute = defineOpenAPIRoute(writeMeta("billing.setArrangement", CONFIGURE), {
  method: "put",
  path: "/api/v1/billing/matters/{matterId}/arrangement",
  description:
    "Records or amends how a matter is billed — hourly, a flat fee, a contingency share of any recovery, or an evergreen retainer with a target and a replenishment floor. An amendment is a NEW version of the agreement: the old version stays on the record with the dates it governed, because every bill composed under it says so. A matter with no recorded arrangement is billed hourly.",
  request: {
    headers: idempotencyKeyHeader,
    params: matterParam,
    body: { content: { "application/json": { schema: ArrangementRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The agreement was recorded as the version now in force",
      content: { "application/json": { schema: ArrangementResponse } },
    },
    ...mutationResponses,
  },
});

const arrangementRoute = defineOpenAPIRoute(readMeta("billing.arrangement"), {
  method: "get",
  path: "/api/v1/billing/matters/{matterId}/arrangement",
  description:
    "Returns the fee agreement in force on a matter and its whole amendment history. An empty answer means the matter is billed hourly because nothing else was ever agreed.",
  request: { params: matterParam },
  responses: {
    200: {
      description: "The agreement in force and its history",
      content: { "application/json": { schema: ArrangementResponse } },
    },
    ...readErrorResponses,
  },
});

const recordRecoveryRoute = defineOpenAPIRoute(writeMeta("billing.recordRecovery", DRAFT), {
  method: "post",
  path: "/api/v1/billing/matters/{matterId}/recoveries",
  description:
    "Records a recovery on a matter — a settlement, a judgment, an award. The contingency fee is never stored anywhere: it is computed from these records at the moment a bill is composed, so recording a recovery is recording a fact, not deciding a fee.",
  request: {
    headers: idempotencyKeyHeader,
    params: matterParam,
    body: { content: { "application/json": { schema: RecoveryRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The recovery was recorded",
      content: { "application/json": { schema: RecoveryAck } },
    },
    ...mutationResponses,
  },
});

const listRecoveriesRoute = defineOpenAPIRoute(readMeta("billing.listRecoveries"), {
  method: "get",
  path: "/api/v1/billing/matters/{matterId}/recoveries",
  description:
    "The recoveries recorded on a matter, oldest first, voided ones included — a voided recovery stays readable with the reason it was wrong. One page at a time; the contingency fee is derived from every recovery on the matter, never from a page of them.",
  request: { params: matterParam, query: cursorQuery },
  responses: {
    200: {
      description: "The matter's recoveries",
      content: { "application/json": { schema: RecoveryListResponse } },
    },
    ...readErrorResponses,
  },
});

const voidRecoveryRoute = defineOpenAPIRoute(writeMeta("billing.voidRecovery", DRAFT), {
  method: "post",
  path: "/api/v1/billing/matters/{matterId}/recoveries/{recoveryId}/void",
  description:
    "Voids a recovery recorded in error, with the reason. The record is never edited or erased — the wrong entry and its correction both stay readable, and a voided recovery leaves the fee computation.",
  request: {
    headers: idempotencyKeyHeader,
    params: recoveryParam,
    body: { content: { "application/json": { schema: VoidRecoveryRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The recovery was voided",
      content: { "application/json": { schema: RecoveryAck } },
    },
    ...mutationResponses,
  },
});

const addFlatFeeRoute = defineOpenAPIRoute(writeMeta("billing.addFlatFee", DRAFT), {
  method: "post",
  path: "/api/v1/billing/invoices/{invoiceId}/flat-fee",
  description:
    "Puts the matter's flat fee on a draft as ONE line carrying the agreed amount (or a stated instalment of it), and claims the contributing time entries at zero — the work is attributed for profitability reporting without being what the client is charged. The entries lock as billed when the invoice finalizes, exactly as hourly work does.",
  request: {
    headers: idempotencyKeyHeader,
    params: invoiceParam,
    body: { content: { "application/json": { schema: FlatFeeRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The flat fee was composed and the contributing work claimed",
      content: { "application/json": { schema: FlatFeeAck } },
    },
    ...mutationResponses,
  },
});

const addContingencyFeeRoute = defineOpenAPIRoute(writeMeta("billing.addContingencyFee", DRAFT), {
  method: "post",
  path: "/api/v1/billing/invoices/{invoiceId}/contingency-fee",
  description:
    "Computes the contingency fee from the recoveries recorded on the matter — the agreed share, applied to the gross recovery or to the recovery net of advanced costs as the agreement elects — and puts it on the draft as one line. The arithmetic is echoed back in full; the fee is derived at this moment from the records as they stand, never read from anywhere it was stored.",
  request: {
    headers: idempotencyKeyHeader,
    params: invoiceParam,
    body: { content: { "application/json": { schema: ContingencyFeeRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The contingency fee was computed and composed",
      content: { "application/json": { schema: ContingencyFeeAck } },
    },
    ...mutationResponses,
  },
});

const retainerStatusRoute = defineOpenAPIRoute(readMeta("billing.retainerStatus"), {
  method: "get",
  path: "/api/v1/billing/matters/{matterId}/retainer",
  description:
    "Where a retainer matter's trust balance stands against its agreement — the target, the replenishment floor, what is actually available (money under a hold does not count), and whether an ask to top up is already open.",
  request: { params: matterParam, query: retainerStatusQuery },
  responses: {
    200: {
      description: "The retainer position",
      content: { "application/json": { schema: RetainerStatusResponse } },
    },
    ...readErrorResponses,
    // The refusal maps this read shares with the write paths can answer 409 (trust's own refusals
    // arrive through the shared trust mapping), so the read declares it too.
    409: errorResponses[409],
  },
});

const requestReplenishmentRoute = defineOpenAPIRoute(
  writeMeta("billing.requestReplenishment", DRAFT),
  {
    method: "post",
    path: "/api/v1/billing/matters/{matterId}/retainer/replenishment-requests",
    description:
      "Records that the retainer has fallen below its floor and by how much — the observed balance and the shortfall against the target, stamped as the evidence of why. The request moves no money and sends nothing: the client's deposit arrives through the ordinary trust deposit, and one ask is open per matter at a time.",
    request: {
      headers: idempotencyKeyHeader,
      params: matterParam,
      body: {
        content: { "application/json": { schema: ReplenishmentRequestBody } },
        required: true,
      },
    },
    responses: {
      201: {
        description: "The replenishment request was recorded",
        content: { "application/json": { schema: ReplenishmentAck } },
      },
      ...mutationResponses,
    },
  },
);

const resolveReplenishmentRoute = defineOpenAPIRoute(
  writeMeta("billing.resolveReplenishment", DRAFT),
  {
    method: "post",
    path: "/api/v1/billing/replenishment-requests/{requestId}/resolution",
    description:
      "Closes an open replenishment request — the deposit arrived, or the ask was withdrawn. The request's observed figures never change; resolution is the one edit it ever takes.",
    request: { headers: idempotencyKeyHeader, params: replenishmentParam },
    responses: {
      201: {
        description: "The request was resolved",
        content: {
          "application/json": {
            schema: z
              .object({ requestId: z.string() })
              .openapi("BillingReplenishmentResolutionAck"),
          },
        },
      },
      ...mutationResponses,
    },
  },
);

const renderModelRoute = defineOpenAPIRoute(readMeta("billing.invoiceRenderModel"), {
  method: "get",
  path: "/api/v1/billing/invoices/{invoiceId}/render-model",
  description:
    "The invoice as it is presented: its pages and their subtotals under the shape the bill was finalized with — one page per matter plus a summary, or one flowing document. This is the model a renderer consumes; a finalized invoice derives it entirely from its own rows.",
  request: { params: invoiceParam },
  responses: {
    200: {
      description: "The render model",
      content: { "application/json": { schema: RenderModelResponse } },
    },
    ...readErrorResponses,
  },
});

const renderShapeRoute = defineOpenAPIRoute(
  { ...readMeta("billing.renderShapeDefault"), permission: CONFIGURE },
  {
    method: "get",
    path: "/api/v1/billing/render-shape",
    description:
      "The firm's default presentation for a bill spanning several matters. A finalize may override it per bill; the choice in force at finalization is snapshot onto the invoice.",
    responses: {
      200: {
        description: "The firm default",
        content: { "application/json": { schema: RenderShapeSetting } },
      },
      ...readErrorResponses,
    },
  },
);

const setRenderShapeRoute = defineOpenAPIRoute(
  writeMeta("billing.setRenderShapeDefault", CONFIGURE),
  {
    method: "put",
    path: "/api/v1/billing/render-shape",
    description:
      "Sets the firm's default presentation for multi-matter bills. Changing it governs future finalizations only — a bill already finalized keeps the shape it went out with.",
    request: {
      headers: idempotencyKeyHeader,
      body: { content: { "application/json": { schema: RenderShapeSetting } }, required: true },
    },
    responses: {
      200: {
        description: "The firm default was set",
        content: { "application/json": { schema: RenderShapeSetting } },
      },
      ...mutationResponses,
    },
  },
);

const issueCreditNoteRoute = defineOpenAPIRoute(writeMeta("billing.issueCreditNote", CREDIT), {
  method: "post",
  path: "/api/v1/billing/invoices/{invoiceId}/credit-notes",
  description:
    "Issues a credit note against a bill that has already gone out. The bill itself is never edited and never withdrawn: the note is a second permanent record standing beside it, with its own lines, its own reason, and its own date. What the note credits comes off what the client still owes; anything beyond that is money already in the firm's hands, so it becomes a recorded credit the firm owes the client back rather than a negative bill. Where the note is correcting a specific charge, name that charge on the line — a fee worked out from a settlement or a recovery is billed as the increment over what earlier bills already charged, and only an attributed credit changes that arithmetic.",
  request: {
    headers: idempotencyKeyHeader,
    params: invoiceParam,
    body: { content: { "application/json": { schema: CreditNoteRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The credit note was issued",
      content: { "application/json": { schema: CreditNoteAck } },
    },
    ...mutationResponses,
  },
});

const listCreditNotesRoute = defineOpenAPIRoute(readMeta("billing.listCreditNotes"), {
  method: "get",
  path: "/api/v1/billing/invoices/{invoiceId}/credit-notes",
  description:
    "Every credit note issued against one bill, with its lines, oldest first and one page at a time. A note is never edited or withdrawn once issued, so this is the complete correction history of that bill.",
  request: { params: invoiceParam, query: cursorQuery },
  responses: {
    200: {
      description: "The bill's credit notes",
      content: { "application/json": { schema: CreditNoteListResponse } },
    },
    ...readErrorResponses,
  },
});

const writeOffRoute = defineOpenAPIRoute(writeMeta("billing.writeOffBalance", CREDIT), {
  method: "post",
  path: "/api/v1/billing/invoices/{invoiceId}/write-offs",
  description:
    "Gives up part or all of what a matter still owes on a bill, with the reason. This is a different fact from a credit note and is kept separate on the firm's books: a credit note says the firm charged something it should not have, a write-off says the charge was right and the money is not coming. It cannot exceed what is still owed — money already collected is refunded or credited instead.",
  request: {
    headers: idempotencyKeyHeader,
    params: invoiceParam,
    body: { content: { "application/json": { schema: WriteOffRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The balance was written off",
      content: { "application/json": { schema: ApplicationAck } },
    },
    ...mutationResponses,
  },
});

const clientCreditsRoute = defineOpenAPIRoute(readMeta("billing.clientCredits"), {
  method: "get",
  path: "/api/v1/billing/clients/{clientEntityId}/credits",
  description:
    "What the firm still owes one client back, across all of their matters, oldest first and one page at a time. A credit is open until it has been given back in full; how much is left is worked out from what has been set against later bills rather than stored, so it can never disagree with those records.",
  request: { params: clientParam, query: cursorQuery },
  responses: {
    200: {
      description: "The client's open credits",
      content: { "application/json": { schema: ClientCreditListResponse } },
    },
    ...readErrorResponses,
  },
});

const applyClientCreditRoute = defineOpenAPIRoute(writeMeta("billing.applyClientCredit", APPLY), {
  method: "post",
  path: "/api/v1/billing/client-credits/{clientCreditId}/applications",
  description:
    "Sets money the firm owes a client against a later bill for that same client, discharging that much of the obligation. No money moves in either direction — the debt and the credit cancel. It may land on any matter of the same client, and never on another client's bill. The other two ways to give a credit back — a refund from the operating account, and a return to the client's trust ledger — move real money and are not performed here.",
  request: {
    headers: idempotencyKeyHeader,
    params: clientCreditParam,
    body: { content: { "application/json": { schema: ApplyClientCreditRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The credit was set against the bill",
      content: { "application/json": { schema: ApplyClientCreditAck } },
    },
    ...mutationResponses,
  },
});

const reverseApplicationRoute = defineOpenAPIRoute(
  writeMeta("billing.reverseApplication", CREDIT),
  {
    method: "post",
    path: "/api/v1/billing/applications/{applicationId}/reversal",
    description:
      "Unwinds value recorded against the wrong bill or the wrong matter, with the reason. The original record stays exactly as it is and the reversal is a new one linked to it, so both are readable afterwards. A transfer out of a client's trust ledger cannot be unwound here — putting that money back is a movement in the trust ledger, raised and authorized there — and neither can a credit note, which is a document the client may already hold and is answered by a further correction.",
    request: {
      headers: idempotencyKeyHeader,
      params: applicationParam,
      body: {
        content: { "application/json": { schema: ReverseApplicationRequest } },
        required: true,
      },
    },
    responses: {
      201: {
        description: "The application was reversed",
        content: { "application/json": { schema: ReverseApplicationAck } },
      },
      ...mutationResponses,
    },
  },
);

const recordDeliveryRoute = defineOpenAPIRoute(writeMeta("billing.recordDelivery", DRAFT), {
  method: "post",
  path: "/api/v1/billing/invoices/{invoiceId}/deliveries",
  description:
    "Records that a bill was given to a client: how it went, who received it, on what date, and whether it arrived. This records a delivery the firm made — it does not send anything. A bill handed over at a meeting, put in the post, emailed from the firm's own mailbox, or submitted to the client's e-billing portal is recorded here the same way, which is the point: what matters is being able to show that the client got the bill, and most bills go out by means the firm arranges itself. Each attempt is its own permanent record, so a bill sent twice has two, a returned letter followed by a successful re-send reads as exactly that, and nothing already recorded is edited or withdrawn. Only a finalized bill can be delivered. Recording a delivery does not permit or prevent anything: it is shown beside the decision to take fees from a client's trust money, where several jurisdictions expect the client to have been given the bill first, and the firm decides knowingly.",
  request: {
    headers: idempotencyKeyHeader,
    params: invoiceParam,
    body: { content: { "application/json": { schema: DeliveryRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The delivery was recorded",
      content: { "application/json": { schema: DeliveryAck } },
    },
    ...mutationResponses,
  },
});

const listDeliveriesRoute = defineOpenAPIRoute(readMeta("billing.listDeliveries"), {
  method: "get",
  path: "/api/v1/billing/invoices/{invoiceId}/deliveries",
  description:
    "Every recorded attempt at getting one bill to its client, oldest first, with the summary a surface needs: whether it ever arrived, the date it first arrived, and how many attempts there have been. A bill with no attempts at all and a bill chased three times without landing both come back as not delivered, and the attempt counts are what tell them apart. Nothing here is ever edited or removed, so this is the complete delivery history of that bill.",
  request: { params: invoiceParam },
  responses: {
    200: {
      description: "The bill's delivery history",
      content: { "application/json": { schema: DeliveryListResponse } },
    },
    ...readErrorResponses,
  },
});

const contingencyResidualRoute = defineOpenAPIRoute(readMeta("billing.contingencyResidual"), {
  method: "get",
  path: "/api/v1/billing/matters/{matterId}/contingency-residual",
  description:
    "Compares what a matter's contingency fee has actually been billed against what the surviving recovery now entitles the firm to, and reports the difference. It is not zero when a recovery is voided or reduced after a bill went out, or when an advanced cost arrives late under a net-of-costs agreement: the bill was true when it was issued and cannot be edited, so the difference sits there until the firm decides what to do about it. The answer names each finalized fee line and what its bill still owes, because a credit note larger than the unpaid balance leaves the firm owing money back. Nothing is issued here — what a client is owed after a settlement collapses is the firm's decision to make.",
  request: { params: matterParam },
  responses: {
    200: {
      description: "The matter's contingency position",
      content: { "application/json": { schema: ContingencyResidualResponse } },
    },
    ...readErrorResponses,
  },
});

// A refusal's HTTP status is a property of what the refusal MEANS, so the mapping lives in one place
// rather than at nine call sites that would drift.
function billingErrorResponse(
  c: Context,
  error: BillingValidationError,
): ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> {
  if (
    error.code === "unknown-invoice" ||
    error.code === "unknown-invoice-line" ||
    error.code === "unknown-invoice-claim" ||
    error.code === "unknown-matter-recovery" ||
    error.code === "unknown-client-credit" ||
    error.code === "unknown-invoice-application"
  ) {
    return problemJson(c, {
      type: "not-found",
      title: "Not found",
      status: 404,
      detail: error.message,
    });
  }
  if (error.code === "invoice-not-draft" || error.code === "invoice-not-final") {
    return problemJson(c, {
      type: "billing-invoice-not-editable",
      title: "This invoice is no longer a working document",
      status: 409,
      detail: error.message,
    });
  }
  // Retryable once the open ask is resolved, which is what makes it a conflict rather than a
  // request the rules refuse outright.
  if (error.code === "retainer-replenishment-already-open") {
    return problemJson(c, {
      type: "billing-replenishment-already-open",
      title: "An ask to replenish this retainer is already open",
      status: 409,
      detail: error.message,
    });
  }
  if (error.code === "work-in-progress-already-claimed") {
    return problemJson(c, {
      type: "billing-work-already-claimed",
      title: "Another draft already holds this work",
      status: 409,
      detail: error.message,
    });
  }
  // What that matter still owes on that bill is the ceiling, and it can move between the moment a
  // member looked and the moment they acted — a credit note or another payment consumes it. Retrying
  // against the balance as it now stands is the remedy, which is what makes this a 409 rather than a
  // 422, and the mirror of trust's own "the money is not there" on the other side of one operation.
  // Both ceilings move for the same reason and take the same remedy: retry against the balance as it
  // now stands, or aim the correction somewhere else. A conflict rather than a refusal on the merits.
  if (
    error.code === "earned-fee-exceeds-unpaid-balance" ||
    error.code === "write-off-exceeds-unpaid-balance" ||
    error.code === "client-credit-exhausted"
  ) {
    return problemJson(c, {
      type: "billing-exceeds-unpaid-balance",
      title: "That is more than is left to apply",
      status: 409,
      detail: error.message,
    });
  }
  // The invoice evidence does not permit money to leave trust. Not a permission failure: the member
  // holds the capability, and the bill is what is wrong.
  if (
    error.code === "earned-fee-invoice-not-final" ||
    error.code === "earned-fee-invoice-client-mismatch" ||
    error.code === "earned-fee-invoice-does-not-bill-matter" ||
    error.code === "earned-fee-amount-mismatch" ||
    error.code === "earned-fee-node-mismatch" ||
    error.code === "earned-fee-no-applications" ||
    error.code === "earned-fee-too-many-invoices" ||
    error.code === "application-kind-not-built" ||
    error.code === "application-amount-not-positive" ||
    error.code === "application-currency-mismatch"
  ) {
    return problemJson(c, {
      type: "billing-earned-fee-refused",
      title: "This transfer is not backed by a bill that permits it",
      status: 422,
      detail: error.message,
    });
  }
  // Not a permission failure and not a bad request: the firm has not told the platform where this
  // posting belongs, and inventing an account would put real money in the wrong place.
  if (error.code === "account-role-unmapped") {
    return problemJson(c, {
      type: "billing-account-role-unmapped",
      title: "A ledger account this posting needs has not been configured",
      status: 422,
      detail: error.message,
    });
  }
  return problemJson(c, {
    type: "billing-refused",
    title: "The billing rules refuse this change",
    status: 422,
    detail: error.message,
  });
}

type BillingApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

// The commit's outcome, kept separate from the HTTP reply so each route can name its own success
// status literal — a PATCH answers 200 and a create answers 201, and a helper that returned both
// would widen every handler's type past what its route contract declares.
type BillingRefusal = ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422>;

type BillingOutcome<Body> =
  | { readonly kind: "refused"; readonly response: BillingRefusal }
  | { readonly kind: "committed"; readonly body: Body };

// How many times a lost number draw is retried before the request gives up. A draw loses when a
// concurrent finalize consumed the value it read; the loser's whole batch rolls back, including its
// in-batch counter increment, so the counter is advanced out of band and the next attempt renders
// the next number.
const MAXIMUM_FINALIZE_ATTEMPTS = 5;

// The firm's review gate, read once per finalize: it decides which lifecycle moves into `billed` are
// legal for the entries this invoice claimed. The rule itself lives in @magna-carta/billing-core, so
// time, costs, and billing all run on one state machine.
async function readApprovalRequired(database: SqlDatabase): Promise<boolean> {
  return (await readFirmSetting(database, approvalRequiredDefinition)) ?? false;
}

export function registerBillingRoutes(app: BillingApp, chokepoint: Chokepoint): void {
  // The shared idempotent commit: one batch carrying the business statements, the idempotency
  // record, and the outbox messages. Everything a billing mutation does commits together or not at
  // all — which for finalization is the whole point.
  async function runBillingEffect<Body>(
    c: Context,
    responseCode: 200 | 201,
    compose: (actor: UserId) => Promise<{ write: EffectWrite; body: Body }>,
  ): Promise<BillingOutcome<Body>> {
    const firm = requireChokepointFirmContext(c);
    const userId = requireChokepointUserId(c);
    const idempotency = requireChokepointIdempotency(c);
    const now = () => new Date().toISOString();
    let result;
    try {
      result = await runIdempotentEffect({
        database: firm.firmDatabase,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        now,
        effect: async () => {
          const composed = await compose(userId);
          return {
            write: composed.write,
            responseCode,
            responseBody: canonicalJsonStringify(composed.body),
          };
        },
      });
    } catch (caught) {
      if (caught instanceof BillingValidationError) {
        return { kind: "refused", response: billingErrorResponse(c, caught) };
      }
      // The ledger refuses on its own terms too — a future or malformed issue date on a finalize
      // reaches validateEntry, not this package's rules. A different error class, so without this
      // arm it reaches the app error boundary and a member gets a 500 for a typo.
      if (caught instanceof LedgerValidationError) {
        return { kind: "refused", response: problemResponseForLedgerRefusal(c, caught) };
      }
      // The apply-funds path composes trust's transfer through trust's own composer, so the trust
      // rules refuse on their own terms here — money under a disputed-funds hold, a closed account,
      // an office with no jurisdiction recorded, a matter that holds no client ledger. Billing does
      // not restate any of them, and the mapping is the one trust's own routes use.
      if (caught instanceof TrustValidationError) {
        return { kind: "refused", response: problemResponseForTrustRefusal(c, caught) };
      }
      throw caught;
    }
    if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
      return { kind: "refused", response: problemResponseForIdempotencyConflict(c, result) };
    }
    if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
    return { kind: "committed", body: JSON.parse(result.responseBody ?? "{}") as Body };
  }

  // Wall-clock and randomness are ambient at the runtime edge and injected everywhere below it: the
  // domain package holds no clock, so this is where one is supplied.
  const clockOptions = () => ({
    clock: {
      now: () => new Date().toISOString(),
      today: () => todayInUtc(),
    },
  });

  // POST /api/v1/billing/invoices — open a working document
  app.openapi(
    { ...createInvoiceRoute, middleware: chokepointMiddleware(chokepoint, createInvoiceRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const request = c.req.valid("json");
      const outcome = await runBillingEffect<z.infer<typeof InvoiceAck>>(c, 201, (createdBy) => {
        const draft = createInvoiceDraft(
          firm.firmDatabase,
          {
            clientEntityId: request.clientEntityId,
            currency: request.currency,
            billingPeriodStart: request.billingPeriodStart ?? null,
            billingPeriodEnd: request.billingPeriodEnd ?? null,
            notes: request.notes ?? null,
            locationId: request.locationId ?? null,
            createdBy,
          },
          clockOptions(),
        );
        return Promise.resolve({
          write: draft.effect,
          body: { invoiceId: draft.invoiceId, status: "draft" as const },
        });
      });
      if (outcome.kind === "refused") return outcome.response;
      return c.json(outcome.body, 201);
    },
  );

  // POST /api/v1/billing/invoices/{invoiceId}/claims — pull work onto the draft
  app.openapi(
    { ...addClaimsRoute, middleware: chokepointMiddleware(chokepoint, addClaimsRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { invoiceId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await runBillingEffect<z.infer<typeof ClaimAck>>(c, 201, async () => {
        const claimed = await addClaimsToDraft(
          firm.firmDatabase,
          invoiceId,
          request.claims,
          clockOptions(),
        );
        return {
          write: claimed.effect,
          body: {
            invoiceId,
            claimIds: [...claimed.claimIds],
            lineIds: [...claimed.lineIds],
          },
        };
      });
      if (outcome.kind === "refused") return outcome.response;
      return c.json(outcome.body, 201);
    },
  );

  // POST /api/v1/billing/invoices/{invoiceId}/claims/{claimId}/release
  app.openapi(
    { ...releaseClaimRoute, middleware: chokepointMiddleware(chokepoint, releaseClaimRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { invoiceId, claimId } = c.req.valid("param");
      const outcome = await runBillingEffect<z.infer<typeof InvoiceAck>>(c, 201, async () => ({
        write: await removeClaim(firm.firmDatabase, claimId, clockOptions()),
        body: { invoiceId, status: "draft" as const },
      }));
      if (outcome.kind === "refused") return outcome.response;
      return c.json(outcome.body, 201);
    },
  );

  // PATCH /api/v1/billing/invoices/{invoiceId}/lines/{lineId} — bill review
  app.openapi(
    { ...updateLineRoute, middleware: chokepointMiddleware(chokepoint, updateLineRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { invoiceId, lineId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await runBillingEffect<z.infer<typeof InvoiceAck>>(c, 200, async () => ({
        write: await updateDraftLine(firm.firmDatabase, lineId, request),
        body: { invoiceId, status: "draft" as const },
      }));
      if (outcome.kind === "refused") return outcome.response;
      return c.json(outcome.body, 200);
    },
  );

  // POST /api/v1/billing/invoices/{invoiceId}/void
  app.openapi(
    { ...voidDraftRoute, middleware: chokepointMiddleware(chokepoint, voidDraftRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { invoiceId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await runBillingEffect<z.infer<typeof InvoiceAck>>(
        c,
        201,
        async (voidedBy) => ({
          write: await voidDraft(
            firm.firmDatabase,
            invoiceId,
            request.reason,
            voidedBy,
            clockOptions(),
          ),
          body: { invoiceId, status: "void" as const },
        }),
      );
      if (outcome.kind === "refused") return outcome.response;
      return c.json(outcome.body, 201);
    },
  );

  // POST /api/v1/billing/invoices/{invoiceId}/finalization — the one batch
  app.openapi(
    { ...finalizeRoute, middleware: chokepointMiddleware(chokepoint, finalizeRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { invoiceId } = c.req.valid("param");
      const request = c.req.valid("json");
      const approvalRequired = await readApprovalRequired(firm.firmDatabase);

      // The bounded retry wraps the WHOLE idempotent commit, not just the composition: a lost draw
      // rolls the batch back, so the retry has to re-read the counter and re-compose from scratch.
      let lastError: unknown;
      for (let attempt = 0; attempt < MAXIMUM_FINALIZE_ATTEMPTS; attempt += 1) {
        let outcome: BillingOutcome<z.infer<typeof FinalizeAck>>;
        try {
          outcome = await runBillingEffect<z.infer<typeof FinalizeAck>>(c, 201, async (actor) => {
            const finalized = await finalizeInvoice(
              firm.firmDatabase,
              {
                invoiceId,
                issueDate: request.issueDate,
                dueDate: request.dueDate,
                finalizedBy: actor,
                numberScopeKey: request.numberScopeKey,
                createNumberScope: request.createNumberScope ?? false,
                locationId: request.locationId ?? null,
                letterheadAddressBlock: request.letterheadAddressBlock ?? null,
                letterheadFooter: request.letterheadFooter ?? null,
                remitTo: request.remitTo ?? null,
                clientBillingName: request.clientBillingName ?? null,
              },
              { ...clockOptions(), approvalRequired },
            );
            return {
              write: finalized.effect,
              body: {
                invoiceId,
                invoiceNumber: finalized.invoiceNumber,
                totalMinor: finalized.totalMinor,
                currency: "USD",
                ledgerEntryId: finalized.ledgerEntryId,
              },
            };
          });
        } catch (caught) {
          if (!isNumberAllocationConflict(caught, INVOICE_NUMBERING_TABLES)) throw caught;
          lastError = caught;
          continue;
        }
        if (outcome.kind === "refused") return outcome.response;
        return c.json(outcome.body, 201);
      }
      throw new Error(
        `invoice number allocation did not converge after ${MAXIMUM_FINALIZE_ATTEMPTS} attempts: ${String(lastError)}`,
      );
    },
  );

  // POST /api/v1/billing/trust-applications — the one surface where a member takes client money
  app.openapi(
    { ...applyTrustFundsRoute, middleware: chokepointMiddleware(chokepoint, applyTrustFundsRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const request = c.req.valid("json");
      const outcome = await runBillingEffect<z.infer<typeof ApplyTrustFundsAck>>(
        c,
        201,
        async (appliedBy) => {
          const applied = await applyTrustFundsToInvoices(
            firm.firmDatabase,
            {
              trustAccountId: request.trustAccountId,
              matterId: request.matterId,
              applications: request.applications,
              currency: request.currency,
              effectiveDate: request.effectiveDate,
              trustDescription: request.trustDescription,
              operatingDescription: request.operatingDescription,
              // The member on the session, recorded on the transfer as the one who let the money go.
              appliedBy,
            },
            clockOptions(),
          );
          return {
            write: applied.effect,
            body: {
              transferId: applied.transferId,
              trustEntryId: applied.trustEntryId,
              operatingEntryId: applied.operatingEntryId,
              applicationIds: [...applied.applicationIds],
              totalMinor: applied.totalMinor,
              currency: request.currency,
            },
          };
        },
      );
      if (outcome.kind === "refused") return outcome.response;
      return c.json(outcome.body, 201);
    },
  );

  // POST /api/v1/billing/trust-application-requests — propose taking earned fees; NOTHING moves yet
  app.openapi(
    {
      ...submitTrustApplicationRoute,
      middleware: chokepointMiddleware(chokepoint, submitTrustApplicationRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const request = c.req.valid("json");
      const outcome = await runBillingEffect<z.infer<typeof TrustApplicationRequestAck>>(
        c,
        201,
        async (requestedBy) => {
          const outcome = await applyEarnedFeesUnderAuthorizationPolicy(
            firm.firmDatabase,
            {
              trustAccountId: request.trustAccountId,
              matterId: request.matterId,
              applications: request.applications,
              currency: request.currency,
              effectiveDate: request.effectiveDate,
              trustDescription: request.trustDescription,
              operatingDescription: request.operatingDescription,
              method: request.method,
              reference: request.reference ?? null,
              payee: request.payee,
              purpose: request.purpose,
              requestedBy,
            },
            clockOptions(),
          );
          // Who could release it if this member could not. Empty when the fees moved, because
          // nobody is waiting on anybody.
          const eligibleApprovers = outcome.disposition.eligibleApprovers.map((approver) => ({
            userId: approver.userId,
            displayName: approver.displayName,
          }));
          return {
            write: outcome.effect,
            body:
              outcome.outcome === "applied"
                ? {
                    trustDisbursementRequestId: null,
                    totalMinor: outcome.totalMinor,
                    currency: request.currency,
                    status: "applied" as const,
                    transferId: outcome.transferId,
                    trustEntryId: outcome.trustEntryId,
                    operatingEntryId: outcome.operatingEntryId,
                    applicationIds: [...outcome.applicationIds],
                    eligibleApprovers,
                  }
                : {
                    trustDisbursementRequestId: outcome.requestId,
                    totalMinor: outcome.totalMinor,
                    currency: request.currency,
                    status: "pending" as const,
                    transferId: null,
                    trustEntryId: null,
                    operatingEntryId: null,
                    applicationIds: [],
                    eligibleApprovers,
                  },
          };
        },
      );
      if (outcome.kind === "refused") return outcome.response;
      return c.json(outcome.body, 201);
    },
  );

  // POST /api/v1/billing/trust-application-requests/{requestId}/approval — the second person, and
  // the application flow's only path onto the ledger
  app.openapi(
    {
      ...approveTrustApplicationRoute,
      middleware: chokepointMiddleware(chokepoint, approveTrustApplicationRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { requestId } = c.req.valid("param");
      const outcome = await runBillingEffect<z.infer<typeof TrustApplicationApprovalAck>>(
        c,
        201,
        async (approvedBy) => {
          const approved = await composeTrustApplicationApproval(
            firm.firmDatabase,
            { requestId, approvedBy },
            clockOptions(),
          );
          return {
            write: approved.effect,
            body: {
              trustDisbursementRequestId: approved.requestId,
              authorizationBasis: approved.authorizationBasis,
              transferId: approved.transferId,
              trustEntryId: approved.trustEntryId,
              operatingEntryId: approved.operatingEntryId,
              applicationIds: [...approved.applicationIds],
              totalMinor: approved.totalMinor,
              currency: "USD",
            },
          };
        },
      );
      if (outcome.kind === "refused") return outcome.response;
      return c.json(outcome.body, 201);
    },
  );

  // PUT /api/v1/billing/account-roles — the chart-of-accounts seam
  app.openapi(
    { ...setAccountRolesRoute, middleware: chokepointMiddleware(chokepoint, setAccountRolesRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const request = c.req.valid("json");
      const outcome = await runBillingEffect<z.infer<typeof AccountRoleMapResponse>>(c, 200, () => {
        const assignments = request.assignments.filter((assignment) =>
          isAccountRole(assignment.role),
        );
        return Promise.resolve({
          write: composeAccountRoleConfiguration(firm.firmDatabase, assignments, clockOptions()),
          body: { assignments },
        });
      });
      if (outcome.kind === "refused") return outcome.response;
      return c.json(outcome.body, 200);
    },
  );

  app.openapi(
    { ...accountRolesRoute, middleware: chokepointMiddleware(chokepoint, accountRolesRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const map = await readAccountRoleMap(firm.firmDatabase);
      return c.json(
        {
          assignments: [...map].map(([role, ledgerAccountId]) => ({ role, ledgerAccountId })),
        } as never,
        200,
      );
    },
  );

  app.openapi(
    { ...listInvoicesRoute, middleware: chokepointMiddleware(chokepoint, listInvoicesRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const query = c.req.valid("query");
      const page = await listInvoices(firm.firmDatabase, query);
      return c.json({ data: page.data, nextCursor: page.nextCursor } as never, 200);
    },
  );

  app.openapi(
    { ...invoiceDetailRoute, middleware: chokepointMiddleware(chokepoint, invoiceDetailRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { invoiceId } = c.req.valid("param");
      const detail = await readInvoiceDetail(firm.firmDatabase, invoiceId);
      if (!detail) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: `no such invoice: ${invoiceId}`,
        });
      }
      return c.json(detail as never, 200);
    },
  );

  app.openapi(
    { ...unbilledRoute, middleware: chokepointMiddleware(chokepoint, unbilledRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { matterId } = c.req.valid("param");
      const unbilled = await readUnbilledWorkInProgress(firm.firmDatabase, matterId);
      const receivable = await readMatterReceivable(firm.firmDatabase, matterId);
      return c.json(
        {
          ...unbilled,
          receivableTotalMinor: receivable.totalMinor,
          receivableAppliedMinor: receivable.appliedMinor,
          receivableUnpaidMinor: receivable.unpaidMinor,
        } as never,
        200,
      );
    },
  );

  app.openapi(
    { ...agingRoute, middleware: chokepointMiddleware(chokepoint, agingRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { asOfDate } = c.req.valid("query");
      const resolvedAsOfDate = asOfDate ?? todayInUtc();
      const buckets = await readAccountsReceivableAging(firm.firmDatabase, resolvedAsOfDate);
      return c.json({ asOfDate: resolvedAsOfDate, buckets } as never, 200);
    },
  );

  const arrangementToResponse = (arrangement: BillingArrangementSnapshot) => ({
    id: arrangement.id,
    matterId: arrangement.matterId,
    version: arrangement.version,
    kind: arrangement.kind,
    flatFeeAmountMinor: arrangement.flatFeeAmountMinor,
    contingencyShareE4: arrangement.contingencyShareE4,
    contingencyBasis: arrangement.contingencyBasis,
    retainerTargetMinor: arrangement.retainerTargetMinor,
    retainerThresholdMinor: arrangement.retainerThresholdMinor,
    advanceDepositDestination: arrangement.advanceDepositDestination,
    currency: arrangement.currency,
    validFrom: arrangement.validFrom,
    validTo: arrangement.validTo,
    agreementFileId: arrangement.agreementFileId,
    agreementFileName: arrangement.agreementFileName,
  });

  // PUT /api/v1/billing/matters/{matterId}/arrangement — the fee agreement, versioned append-only
  app.openapi(
    { ...setArrangementRoute, middleware: chokepointMiddleware(chokepoint, setArrangementRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { matterId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await runBillingEffect<{ version: number }>(c, 200, async (createdBy) => {
        const set = await setBillingArrangement(
          firm.firmDatabase,
          {
            matterId,
            kind: request.kind,
            flatFeeAmountMinor: request.flatFeeAmountMinor ?? null,
            contingencyShareE4: request.contingencyShareE4 ?? null,
            contingencyBasis: request.contingencyBasis ?? null,
            retainerTargetMinor: request.retainerTargetMinor ?? null,
            retainerThresholdMinor: request.retainerThresholdMinor ?? null,
            advanceDepositDestination: request.advanceDepositDestination ?? null,
            currency: request.currency,
            validFrom: request.validFrom,
            agreementFileId: (request.agreementFileId ?? null) as FileId | null,
            createdBy,
          },
          clockOptions(),
        );
        return { write: set.effect, body: { version: set.version } };
      });
      if (outcome.kind === "refused") return outcome.response;
      const inForce = await readBillingArrangementInForce(firm.firmDatabase, matterId);
      const history = await readBillingArrangementHistory(firm.firmDatabase, matterId);
      return c.json(
        {
          inForce: inForce ? arrangementToResponse(inForce) : null,
          history: history.map(arrangementToResponse),
        } as never,
        200,
      );
    },
  );

  app.openapi(
    { ...arrangementRoute, middleware: chokepointMiddleware(chokepoint, arrangementRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { matterId } = c.req.valid("param");
      const inForce = await readBillingArrangementInForce(firm.firmDatabase, matterId);
      const history = await readBillingArrangementHistory(firm.firmDatabase, matterId);
      return c.json(
        {
          inForce: inForce ? arrangementToResponse(inForce) : null,
          history: history.map(arrangementToResponse),
        } as never,
        200,
      );
    },
  );

  // POST /api/v1/billing/matters/{matterId}/recoveries — the fact a contingency fee derives from
  app.openapi(
    { ...recordRecoveryRoute, middleware: chokepointMiddleware(chokepoint, recordRecoveryRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { matterId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await runBillingEffect<z.infer<typeof RecoveryAck>>(c, 201, (recordedBy) => {
        const composed = recordMatterRecovery(
          firm.firmDatabase,
          {
            matterId,
            amountMinor: request.amountMinor,
            currency: request.currency,
            recoveredDate: request.recoveredDate,
            description: request.description,
            recordedBy,
          },
          clockOptions(),
        );
        return Promise.resolve({
          write: composed.effect,
          body: { recoveryId: composed.recoveryId, matterId },
        });
      });
      if (outcome.kind === "refused") return outcome.response;
      return c.json(outcome.body, 201);
    },
  );

  app.openapi(
    { ...listRecoveriesRoute, middleware: chokepointMiddleware(chokepoint, listRecoveriesRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { matterId } = c.req.valid("param");
      const { cursor } = c.req.valid("query");
      const page = await readMatterRecoveriesPage(
        firm.firmDatabase,
        matterId,
        cursor === undefined ? {} : { cursor },
      );
      return c.json(
        {
          nextCursor: page.nextCursor,
          data: page.data.map((recovery) => ({
            id: recovery.id,
            amountMinor: recovery.amountMinor,
            currency: recovery.currency,
            recoveredDate: recovery.recoveredDate,
            description: recovery.description,
            voidedAt: recovery.voidedAt,
            voidReason: recovery.voidReason,
          })),
        } as never,
        200,
      );
    },
  );

  app.openapi(
    { ...voidRecoveryRoute, middleware: chokepointMiddleware(chokepoint, voidRecoveryRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { matterId, recoveryId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await runBillingEffect<z.infer<typeof RecoveryAck>>(
        c,
        201,
        async (voidedBy) => ({
          write: await voidMatterRecovery(
            firm.firmDatabase,
            matterId,
            recoveryId,
            request.reason,
            voidedBy,
            clockOptions(),
          ),
          body: { recoveryId, matterId },
        }),
      );
      if (outcome.kind === "refused") return outcome.response;
      return c.json(outcome.body, 201);
    },
  );

  // POST /api/v1/billing/invoices/{invoiceId}/flat-fee — one line, the work claimed at zero
  app.openapi(
    { ...addFlatFeeRoute, middleware: chokepointMiddleware(chokepoint, addFlatFeeRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { invoiceId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await runBillingEffect<z.infer<typeof FlatFeeAck>>(c, 201, async () => {
        const composed = await addFlatFeeToDraft(
          firm.firmDatabase,
          {
            invoiceId,
            matterId: request.matterId,
            amountMinor: request.amountMinor,
            description: request.description,
            contributingTimeEntryIds: request.contributingTimeEntryIds,
          },
          clockOptions(),
        );
        return {
          write: composed.effect,
          body: { invoiceId, lineId: composed.lineId, claimIds: [...composed.claimIds] },
        };
      });
      if (outcome.kind === "refused") return outcome.response;
      return c.json(outcome.body, 201);
    },
  );

  // POST /api/v1/billing/invoices/{invoiceId}/contingency-fee — derived at this moment, echoed back
  app.openapi(
    {
      ...addContingencyFeeRoute,
      middleware: chokepointMiddleware(chokepoint, addContingencyFeeRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { invoiceId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await runBillingEffect<z.infer<typeof ContingencyFeeAck>>(
        c,
        201,
        async () => {
          const composed = await addContingencyFeeToDraft(
            firm.firmDatabase,
            invoiceId,
            request.matterId,
            clockOptions(),
          );
          return {
            write: composed.effect,
            body: {
              invoiceId,
              lineId: composed.lineId,
              feeMinor: composed.lineAmountMinor,
              entitlementMinor: composed.entitlementMinor,
              previouslyBilledMinor: composed.previouslyBilledMinor,
              baseMinor: composed.derivation.baseMinor,
              shareE4: composed.derivation.shareE4,
              basis: composed.derivation.basis,
              recoveriesMinor: composed.derivation.recoveriesMinor,
              advancedCostsMinor: composed.derivation.advancedCostsMinor,
            },
          };
        },
      );
      if (outcome.kind === "refused") return outcome.response;
      return c.json(outcome.body, 201);
    },
  );

  // GET /api/v1/billing/matters/{matterId}/retainer — the floor status, on trust's available figure
  app.openapi(
    { ...retainerStatusRoute, middleware: chokepointMiddleware(chokepoint, retainerStatusRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { matterId } = c.req.valid("param");
      const { trustAccountId } = c.req.valid("query");
      try {
        const status = await readRetainerStatus(firm.firmDatabase, trustAccountId, matterId);
        return c.json(
          {
            matterId: status.matterId,
            targetMinor: status.targetMinor,
            thresholdMinor: status.thresholdMinor,
            availableMinor: status.availableMinor,
            belowFloor: status.belowFloor,
            shortfallMinor: status.shortfallMinor,
            openRequestId: status.openRequestId,
          } as never,
          200,
        );
      } catch (caught) {
        if (caught instanceof BillingValidationError) return billingErrorResponse(c, caught);
        if (caught instanceof TrustValidationError) {
          return problemResponseForTrustRefusal(c, caught);
        }
        throw caught;
      }
    },
  );

  app.openapi(
    {
      ...requestReplenishmentRoute,
      middleware: chokepointMiddleware(chokepoint, requestReplenishmentRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { matterId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await runBillingEffect<z.infer<typeof ReplenishmentAck>>(
        c,
        201,
        async (requestedBy) => {
          const composed = await requestRetainerReplenishment(
            firm.firmDatabase,
            { trustAccountId: request.trustAccountId, matterId, requestedBy },
            clockOptions(),
          );
          return {
            write: composed.effect,
            body: {
              requestId: composed.requestId,
              matterId,
              observedBalanceMinor: composed.observedBalanceMinor,
              requestedAmountMinor: composed.requestedAmountMinor,
            },
          };
        },
      );
      if (outcome.kind === "refused") return outcome.response;
      return c.json(outcome.body, 201);
    },
  );

  app.openapi(
    {
      ...resolveReplenishmentRoute,
      middleware: chokepointMiddleware(chokepoint, resolveReplenishmentRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { requestId } = c.req.valid("param");
      const outcome = await runBillingEffect<{ requestId: string }>(c, 201, async (resolvedBy) => ({
        write: await resolveRetainerReplenishmentRequest(
          firm.firmDatabase,
          requestId,
          resolvedBy,
          clockOptions(),
        ),
        body: { requestId },
      }));
      if (outcome.kind === "refused") return outcome.response;
      return c.json(outcome.body, 201);
    },
  );

  // GET /api/v1/billing/invoices/{invoiceId}/render-model — what a renderer consumes
  app.openapi(
    { ...renderModelRoute, middleware: chokepointMiddleware(chokepoint, renderModelRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { invoiceId } = c.req.valid("param");
      const model = await readInvoiceRenderModel(firm.firmDatabase, invoiceId);
      if (!model) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: `no such invoice: ${invoiceId}`,
        });
      }
      return c.json(model as never, 200);
    },
  );

  app.openapi(
    { ...renderShapeRoute, middleware: chokepointMiddleware(chokepoint, renderShapeRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const renderShape = await readFirmSetting(
        firm.firmDatabase,
        multiMatterRenderShapeDefinition,
      );
      return c.json({ renderShape } as never, 200);
    },
  );

  app.openapi(
    { ...setRenderShapeRoute, middleware: chokepointMiddleware(chokepoint, setRenderShapeRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const request = c.req.valid("json");
      const outcome = await runBillingEffect<z.infer<typeof RenderShapeSetting>>(c, 200, () =>
        Promise.resolve({
          write: {
            statements: [
              writeFirmSettingStatement(
                firm.firmDatabase,
                multiMatterRenderShapeDefinition,
                request.renderShape,
                clockOptions().clock.now(),
              ),
            ],
            outboxMessages: [],
          },
          body: { renderShape: request.renderShape },
        }),
      );
      if (outcome.kind === "refused") return outcome.response;
      return c.json(outcome.body, 200);
    },
  );

  // POST /api/v1/billing/invoices/{invoiceId}/credit-notes — correct a bill already issued
  app.openapi(
    { ...issueCreditNoteRoute, middleware: chokepointMiddleware(chokepoint, issueCreditNoteRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { invoiceId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await runBillingEffect<z.infer<typeof CreditNoteAck>>(
        c,
        201,
        async (issuedBy) => {
          const issued = await issueCreditNote(
            firm.firmDatabase,
            {
              invoiceId,
              reason: request.reason,
              effectiveDate: request.effectiveDate,
              lines: request.lines.map((line) => ({
                matterId: line.matterId,
                kind: line.kind,
                description: line.description,
                amountMinor: line.amountMinor,
                creditsInvoiceLineId: line.creditsInvoiceLineId ?? null,
              })),
              issuedBy,
            },
            clockOptions(),
          );
          return {
            write: issued.effect,
            body: {
              creditNoteId: issued.creditNoteId,
              invoiceId,
              totalMinor: issued.totalMinor,
              appliedMinor: issued.appliedMinor,
              clientCreditMinor: issued.clientCreditMinor,
              matters: issued.matters.map((matter) => ({
                matterId: matter.matterId,
                creditedMinor: matter.creditedMinor,
                appliedMinor: matter.appliedMinor,
                residualMinor: matter.residualMinor,
                clientCreditId: matter.clientCreditId,
              })),
            },
          };
        },
      );
      if (outcome.kind === "refused") return outcome.response;
      return c.json(outcome.body, 201);
    },
  );

  app.openapi(
    { ...listCreditNotesRoute, middleware: chokepointMiddleware(chokepoint, listCreditNotesRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { invoiceId } = c.req.valid("param");
      const { cursor } = c.req.valid("query");
      const page = await readCreditNotesForInvoicePage(
        firm.firmDatabase,
        invoiceId,
        cursor === undefined ? {} : { cursor },
      );
      // One read for the whole page's lines rather than one per note: the page bounds the
      // identifier list, so what was an N+1 whose length the bill chose is now two reads.
      const linesByNote = await readCreditNoteLinesForNotes(
        firm.firmDatabase,
        page.data.map((note) => note.id),
      );
      const data = [];
      for (const note of page.data) {
        const lines = linesByNote.get(note.id) ?? [];
        data.push({
          id: note.id,
          reason: note.reason,
          effectiveDate: note.effectiveDate,
          currency: note.currency,
          issuedAt: note.issuedAt,
          totalMinor: lines.reduce((total, line) => total + line.amountMinor, 0),
          lines: lines.map((line) => ({
            id: line.id,
            matterId: line.matterId,
            kind: line.kind,
            description: line.description,
            amountMinor: line.amountMinor,
            creditsInvoiceLineId: line.creditsInvoiceLineId,
          })),
        });
      }
      return c.json({ data } as never, 200);
    },
  );

  // POST /api/v1/billing/invoices/{invoiceId}/deliveries — record that a bill was given to a client
  app.openapi(
    { ...recordDeliveryRoute, middleware: chokepointMiddleware(chokepoint, recordDeliveryRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { invoiceId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await runBillingEffect<z.infer<typeof DeliveryAck>>(
        c,
        201,
        async (recordedBy) => {
          const recorded = await recordInvoiceDelivery(
            firm.firmDatabase,
            {
              invoiceId,
              channel: request.channel,
              recipientReference: request.recipientReference,
              deliveryDate: request.deliveryDate,
              externalReference: request.externalReference ?? null,
              outcome: request.outcome,
              recordedBy,
            },
            clockOptions(),
          );
          return {
            write: recorded.effect,
            body: { deliveryId: recorded.deliveryId, invoiceId },
          };
        },
      );
      if (outcome.kind === "refused") return outcome.response;
      return c.json(outcome.body, 201);
    },
  );

  app.openapi(
    { ...listDeliveriesRoute, middleware: chokepointMiddleware(chokepoint, listDeliveriesRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { invoiceId } = c.req.valid("param");
      const attempts = await readInvoiceDeliveries(firm.firmDatabase, invoiceId);
      // The cap's signal, beside the state summary rather than inside it: the state is derived from
      // every attempt the bill carries, the list is the ones this response could hold.
      const state = await readInvoiceDeliveryState(firm.firmDatabase, invoiceId);
      return c.json(
        {
          state: {
            delivered: state.delivered,
            deliveredOn: state.deliveredOn,
            attemptCount: state.attemptCount,
            failedAttemptCount: state.failedAttemptCount,
            lastAttemptOn: state.lastAttemptOn,
          },
          capped: attempts.capped,
          data: attempts.rows.map((attempt) => ({
            id: attempt.id,
            channel: attempt.channel,
            recipientReference: attempt.recipientReference,
            deliveryDate: attempt.deliveryDate,
            externalReference: attempt.externalReference,
            outcome: attempt.outcome,
            recordedBy: attempt.recordedBy,
            recordedAt: attempt.recordedAt,
          })),
        } as never,
        200,
      );
    },
  );

  app.openapi(
    { ...writeOffRoute, middleware: chokepointMiddleware(chokepoint, writeOffRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { invoiceId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await runBillingEffect<z.infer<typeof ApplicationAck>>(
        c,
        201,
        async (writtenOffBy) => {
          const composed = await composeInvoiceWriteOff(
            firm.firmDatabase,
            {
              invoiceId,
              matterId: request.matterId,
              amountMinor: request.amountMinor,
              reason: request.reason,
              effectiveDate: request.effectiveDate,
              writtenOffBy,
            },
            clockOptions(),
          );
          return {
            write: composed.effect,
            body: {
              applicationId: composed.applicationId,
              invoiceId,
              matterId: request.matterId,
            },
          };
        },
      );
      if (outcome.kind === "refused") return outcome.response;
      return c.json(outcome.body, 201);
    },
  );

  app.openapi(
    { ...clientCreditsRoute, middleware: chokepointMiddleware(chokepoint, clientCreditsRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { clientEntityId } = c.req.valid("param");
      const { cursor } = c.req.valid("query");
      const page = await readOpenClientCreditsForClientPage(
        firm.firmDatabase,
        clientEntityId,
        cursor === undefined ? {} : { cursor },
      );
      return c.json(
        {
          nextCursor: page.nextCursor,
          data: page.data.map((credit) => ({
            id: credit.id,
            matterId: credit.matterId,
            creditNoteId: credit.creditNoteId,
            amountMinor: credit.amountMinor,
            dischargedMinor: credit.dischargedMinor,
            remainingMinor: credit.remainingMinor,
            currency: credit.currency,
            openedAt: credit.openedAt,
          })),
        } as never,
        200,
      );
    },
  );

  app.openapi(
    {
      ...applyClientCreditRoute,
      middleware: chokepointMiddleware(chokepoint, applyClientCreditRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { clientCreditId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await runBillingEffect<z.infer<typeof ApplyClientCreditAck>>(
        c,
        201,
        async (appliedBy) => {
          const applied = await applyClientCreditToInvoice(
            firm.firmDatabase,
            {
              clientCreditId,
              invoiceId: request.invoiceId,
              matterId: request.matterId,
              amountMinor: request.amountMinor,
              effectiveDate: request.effectiveDate,
              appliedBy,
            },
            clockOptions(),
          );
          return {
            write: applied.effect,
            body: {
              applicationId: applied.applicationId,
              clientCreditId,
              remainingMinor: applied.remainingMinor,
            },
          };
        },
      );
      if (outcome.kind === "refused") return outcome.response;
      return c.json(outcome.body, 201);
    },
  );

  app.openapi(
    {
      ...reverseApplicationRoute,
      middleware: chokepointMiddleware(chokepoint, reverseApplicationRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { applicationId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await runBillingEffect<z.infer<typeof ReverseApplicationAck>>(
        c,
        201,
        async (reversedBy) => {
          const reversed = await composeApplicationReversal(
            firm.firmDatabase,
            {
              applicationId,
              reason: request.reason,
              effectiveDate: request.effectiveDate,
              reversedBy,
            },
            clockOptions(),
          );
          return {
            write: reversed.effect,
            body: {
              applicationId: reversed.applicationId,
              reversesApplicationId: reversed.reversesApplicationId,
            },
          };
        },
      );
      if (outcome.kind === "refused") return outcome.response;
      return c.json(outcome.body, 201);
    },
  );

  app.openapi(
    {
      ...contingencyResidualRoute,
      middleware: chokepointMiddleware(chokepoint, contingencyResidualRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { matterId } = c.req.valid("param");
      try {
        const residual = await readContingencyResidual(firm.firmDatabase, matterId);
        return c.json(residual as never, 200);
      } catch (caught) {
        // The one thing this read can refuse: the matter is not billed on contingency at all, so
        // there is no share to measure a residual against. Answered here rather than through the
        // shared mapping, which spans statuses a GET does not declare — and there is nothing to
        // gain by widening a read's contract to cover a conflict it cannot produce.
        if (caught instanceof BillingValidationError) {
          return problemJson(c, {
            type: "billing-refused",
            title: "This matter is not billed on contingency",
            status: 422,
            detail: caught.message,
          });
        }
        throw caught;
      }
    },
  );
}
