import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  InvoiceId,
  InvoiceLineId,
  InvoiceWipClaimId,
  LocationId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import { BillingValidationError } from "./billing-validation.ts";
import { invoiceLineAmountMinor, RATE_SCALE_DIVISOR } from "./line-amounts.ts";
import {
  clearWorkInProgressInvoiceMirrorForSourceStatement,
  clearWorkInProgressInvoiceMirrorStatement,
  deleteInvoiceLineStatement,
  insertInvoiceClaimStatement,
  insertInvoiceLineStatement,
  insertInvoiceStatement,
  readActiveInvoiceClaims,
  readInvoice,
  readInvoiceClaim,
  readInvoiceLine,
  readInvoiceLines,
  readMatterClientEntityId,
  releaseAllInvoiceClaimsStatement,
  releaseInvoiceClaimStatement,
  setWorkInProgressInvoiceMirrorStatement,
  updateInvoiceLineStatement,
  voidInvoiceStatement,
} from "./statements.ts";
import type {
  BillingServiceOptions,
  InvoiceLineKind,
  InvoiceTaxTreatment,
  WorkInProgressKind,
} from "./types.ts";

// The measured ceiling on how much work one invoice may claim. Statement count in the finalize batch
// scales with claims and lines — two writes per claimed entry plus one per line — while the ledger
// entry does not, so the batch is what bounds an invoice rather than the invoice bounding itself.
// The number is set by the load-profile harness (packages/fixtures/src/load-profile), not by a
// guess; the refusal below suggests the two remedies a firm actually has.
export const MAXIMUM_CLAIMS_PER_INVOICE = 400;

export const INVOICE_CREATED_TOPIC = "billing.invoice.created";
export const INVOICE_VOIDED_TOPIC = "billing.invoice.voided";
// One ordered outbox sequence per firm for billing, matching the ledger's arrangement: a total order
// for billing consumers, cheap at per-firm scale.
export const BILLING_AGGREGATE_KEY = "billing";

export interface CreateInvoiceDraftInput {
  readonly clientEntityId: string;
  readonly currency: string;
  readonly billingPeriodStart?: string | null;
  readonly billingPeriodEnd?: string | null;
  readonly notes?: string | null;
  readonly locationId?: LocationId | null;
  readonly createdBy: UserId | null;
}

export interface ComposedInvoiceDraft {
  readonly invoiceId: InvoiceId;
  readonly effect: EffectWrite;
}

export function createInvoiceDraft(
  database: SqlDatabase,
  input: CreateInvoiceDraftInput,
  options: BillingServiceOptions,
): ComposedInvoiceDraft {
  const invoiceId = newIdentifier("invoice", options.randomSource);
  const now = options.clock.now();
  return {
    invoiceId,
    effect: {
      statements: [
        insertInvoiceStatement(database, {
          id: invoiceId,
          clientEntityId: input.clientEntityId,
          currency: input.currency,
          billingPeriodStart: input.billingPeriodStart ?? null,
          billingPeriodEnd: input.billingPeriodEnd ?? null,
          notes: input.notes ?? null,
          locationId: input.locationId ?? null,
          createdBy: input.createdBy,
          now,
        }),
      ],
      outboxMessages: [
        {
          topic: INVOICE_CREATED_TOPIC,
          payload: { invoiceId, clientEntityId: input.clientEntityId },
          aggregateKey: BILLING_AGGREGATE_KEY,
        },
      ],
    },
  };
}

// What the caller names to pull one work-in-progress row onto a draft.
export interface ClaimRequest {
  readonly sourceKind: WorkInProgressKind;
  readonly sourceId: string;
}

interface TimeEntryRow {
  id: string;
  matter_id: string;
  narrative: string;
  duration_minutes: number;
  currency: string;
  rate_e4: number | null;
  amount_minor: number | null;
  status: string;
  invoice_id: string | null;
  utbms_task_code_id: string | null;
  utbms_activity_code_id: string | null;
}

interface CostEntryRow {
  id: string;
  matter_id: string;
  description: string;
  currency: string;
  amount_minor: number;
  status: string;
  invoice_id: string | null;
  utbms_expense_code_id: string | null;
}

const MINUTES_PER_HOUR = 60;

// A claimable work-in-progress row, normalized to what a line needs. The status a claim may be taken
// from is deliberately anything not yet frozen: bill review is exactly when a firm fixes a narrative
// or a duration, so a claimed entry stays editable and its lock happens at finalize.
interface ClaimableEntry {
  readonly sourceKind: WorkInProgressKind;
  readonly sourceId: string;
  readonly matterId: MatterId;
  readonly description: string;
  readonly quantityE4: number | null;
  readonly rateE4: number | null;
  readonly amountMinor: number;
  readonly currency: string;
  readonly lineKind: InvoiceLineKind;
  readonly utbmsTaskCode: string | null;
  readonly utbmsActivityCode: string | null;
  readonly utbmsExpenseCode: string | null;
}

async function loadClaimableEntry(
  database: SqlDatabase,
  request: ClaimRequest,
): Promise<ClaimableEntry> {
  if (request.sourceKind === "time_entry") {
    const { results } = await database
      .prepare(
        `SELECT id, matter_id, narrative, duration_minutes, currency, rate_e4, amount_minor, status, invoice_id, utbms_task_code_id, utbms_activity_code_id
           FROM time_entry WHERE id = ?1`,
      )
      .bind(request.sourceId)
      .all<TimeEntryRow>();
    const row = results[0];
    if (!row) {
      throw new BillingValidationError(
        "work-in-progress-not-billable",
        `no such time entry: ${request.sourceId}`,
      );
    }
    if (row.status === "billed" || row.status === "void") {
      throw new BillingValidationError(
        "work-in-progress-not-billable",
        `time entry ${row.id} is ${row.status} and cannot be billed again`,
      );
    }
    // Billing consumes the rate the entry snapshot on its work date and NEVER re-resolves one —
    // that is the whole point of the effective-dated rate engine, and re-resolving at invoice time
    // would silently re-rate historical work.
    if (row.rate_e4 === null || row.amount_minor === null) {
      throw new BillingValidationError(
        "work-in-progress-not-billable",
        `time entry ${row.id} carries no rate: non-billable time is tracked for realization and is never charged`,
      );
    }
    return {
      sourceKind: "time_entry",
      sourceId: row.id,
      matterId: row.matter_id as MatterId,
      description: row.narrative,
      quantityE4: Math.round((row.duration_minutes / MINUTES_PER_HOUR) * RATE_SCALE_DIVISOR),
      rateE4: row.rate_e4,
      amountMinor: row.amount_minor,
      currency: row.currency,
      lineKind: "fee",
      utbmsTaskCode: row.utbms_task_code_id,
      utbmsActivityCode: row.utbms_activity_code_id,
      utbmsExpenseCode: null,
    };
  }
  const { results } = await database
    .prepare(
      `SELECT id, matter_id, description, currency, amount_minor, status, invoice_id, utbms_expense_code_id
         FROM cost_entry WHERE id = ?1`,
    )
    .bind(request.sourceId)
    .all<CostEntryRow>();
  const row = results[0];
  if (!row) {
    throw new BillingValidationError(
      "work-in-progress-not-billable",
      `no such cost entry: ${request.sourceId}`,
    );
  }
  if (row.status === "billed" || row.status === "void") {
    throw new BillingValidationError(
      "work-in-progress-not-billable",
      `cost entry ${row.id} is ${row.status} and cannot be billed again`,
    );
  }
  return {
    sourceKind: "cost_entry",
    sourceId: row.id,
    matterId: row.matter_id as MatterId,
    description: row.description,
    quantityE4: null,
    rateE4: null,
    amountMinor: row.amount_minor,
    currency: row.currency,
    lineKind: "cost",
    utbmsTaskCode: null,
    utbmsActivityCode: null,
    utbmsExpenseCode: row.utbms_expense_code_id,
  };
}

export interface AddClaimsResult {
  readonly claimIds: readonly InvoiceWipClaimId[];
  readonly lineIds: readonly InvoiceLineId[];
  readonly effect: EffectWrite;
}

// Pulling work onto a draft. Each claimed entry gets a claim row, a fee or cost line composed from
// its SNAPSHOT, and the mirror write on its invoice_id column.
//
// One client per invoice is validated here, for every line's matter, and re-proved over stored rows
// by the fitness query: an invoice spanning two clients cannot be applied from trust at all, cannot
// be sensibly aged, and is indistinguishable at the row level from a billing error.
export async function addClaimsToDraft(
  database: SqlDatabase,
  invoiceId: InvoiceId,
  requests: readonly ClaimRequest[],
  options: BillingServiceOptions,
): Promise<AddClaimsResult> {
  const invoice = await readInvoice(database, invoiceId);
  if (!invoice) {
    throw new BillingValidationError("unknown-invoice", `no such invoice: ${invoiceId}`);
  }
  if (invoice.status !== "draft") {
    throw new BillingValidationError(
      "invoice-not-draft",
      `invoice ${invoiceId} is ${invoice.status} and no longer accepts work: a finalized invoice is corrected by a credit note, never edited`,
    );
  }

  const existingClaims = await readActiveInvoiceClaims(database, invoiceId);
  if (existingClaims.length + requests.length > MAXIMUM_CLAIMS_PER_INVOICE) {
    throw new BillingValidationError(
      "claim-limit-exceeded",
      `an invoice may claim at most ${MAXIMUM_CLAIMS_PER_INVOICE} work-in-progress entries and this would make ${existingClaims.length + requests.length}: bill a shorter period, or split the work across two invoices`,
    );
  }

  const existingLines = await readInvoiceLines(database, invoiceId);
  let nextLineIndex = existingLines.length;
  const now = options.clock.now();
  const statements: SqlStatement[] = [];
  const claimIds: InvoiceWipClaimId[] = [];
  const lineIds: InvoiceLineId[] = [];

  for (const request of requests) {
    const entry = await loadClaimableEntry(database, request);
    const clientEntityId = await readMatterClientEntityId(database, entry.matterId);
    if (!clientEntityId) {
      throw new BillingValidationError(
        "matter-has-no-client",
        `matter ${entry.matterId} has no client party, so there is nobody to bill: record the client on the matter first`,
      );
    }
    if (clientEntityId !== invoice.clientEntityId) {
      throw new BillingValidationError(
        "invoice-client-mismatch",
        `matter ${entry.matterId} belongs to client ${clientEntityId}, but this invoice bills ${invoice.clientEntityId}: one invoice bills one client`,
      );
    }

    const lineId = newIdentifier("invoiceLine", options.randomSource);
    const claimId = newIdentifier("invoiceWipClaim", options.randomSource);
    lineIds.push(lineId);
    claimIds.push(claimId);
    statements.push(
      insertInvoiceLineStatement(database, {
        id: lineId,
        invoiceId,
        lineIndex: nextLineIndex,
        matterId: entry.matterId,
        kind: entry.lineKind,
        // A SNAPSHOT. Editing the entry's narrative later does not change what the client was told.
        description: entry.description,
        quantityE4: entry.quantityE4,
        rateE4: entry.rateE4,
        amountMinor: entry.amountMinor,
        currency: entry.currency,
        utbmsTaskCode: entry.utbmsTaskCode,
        utbmsActivityCode: entry.utbmsActivityCode,
        utbmsExpenseCode: entry.utbmsExpenseCode,
        taxTreatment: "exempt",
        now,
      }),
      insertInvoiceClaimStatement(database, {
        id: claimId,
        invoiceId,
        sourceKind: entry.sourceKind,
        sourceId: entry.sourceId,
        invoiceLineId: lineId,
        claimedAmountMinor: entry.amountMinor,
        now,
      }),
      setWorkInProgressInvoiceMirrorStatement(
        database,
        entry.sourceKind,
        entry.sourceId,
        invoiceId,
        now,
      ),
    );
    nextLineIndex += 1;
  }

  return { claimIds, lineIds, effect: { statements, outboxMessages: [] } };
}

// Removing one claimed entry from a draft. The released claim row REMAINS, so "this entry was on a
// draft that was abandoned on the 3rd" stays answerable, and the partial unique index makes the
// released row invisible to uniqueness so the entry can be claimed again. After finalization the
// freeze trigger refuses this outright, which is the honest consequence of the entry having become
// evidence.
export async function removeClaim(
  database: SqlDatabase,
  claimId: InvoiceWipClaimId,
  options: BillingServiceOptions,
): Promise<EffectWrite> {
  const claim = await readInvoiceClaim(database, claimId);
  if (!claim || claim.releasedAt !== null) {
    throw new BillingValidationError(
      "unknown-invoice-claim",
      `no active work-in-progress claim: ${claimId}`,
    );
  }
  const invoice = await readInvoice(database, claim.invoiceId as InvoiceId);
  if (!invoice || invoice.status !== "draft") {
    throw new BillingValidationError(
      "invoice-not-draft",
      `invoice ${claim.invoiceId} is not a draft, so its claims are frozen`,
    );
  }
  const now = options.clock.now();
  const statements: SqlStatement[] = [
    releaseInvoiceClaimStatement(database, claimId, now),
    clearWorkInProgressInvoiceMirrorForSourceStatement(
      database,
      claim.sourceKind,
      claim.sourceId,
      claim.invoiceId as InvoiceId,
      now,
    ),
  ];
  if (claim.invoiceLineId) {
    statements.push(deleteInvoiceLineStatement(database, claim.invoiceLineId as InvoiceLineId));
  }
  return { statements, outboxMessages: [] };
}

export interface UpdateDraftLineInput {
  readonly description?: string;
  readonly quantityE4?: number | null;
  readonly rateE4?: number | null;
  readonly amountMinor?: number;
  readonly taxTreatment?: InvoiceTaxTreatment;
}

// Bill review edits the LINE, not the underlying time entry. Two records, both true and both worth
// keeping: the entry is the timekeeper's contemporaneous record of what was done, and the line is
// what the client was told. It also makes a finalized invoice self-contained — re-renderable years
// later without reading a row from the work-in-progress stores.
export async function updateDraftLine(
  database: SqlDatabase,
  lineId: InvoiceLineId,
  input: UpdateDraftLineInput,
): Promise<EffectWrite> {
  const line = await readInvoiceLine(database, lineId);
  if (!line) {
    throw new BillingValidationError("unknown-invoice-line", `no such invoice line: ${lineId}`);
  }
  const invoice = await readInvoice(database, line.invoiceId as InvoiceId);
  if (!invoice || invoice.status !== "draft") {
    throw new BillingValidationError(
      "invoice-not-draft",
      `invoice ${line.invoiceId} is not a draft, so its lines are frozen`,
    );
  }

  const quantityE4 = input.quantityE4 !== undefined ? input.quantityE4 : line.quantityE4;
  const rateE4 = input.rateE4 !== undefined ? input.rateE4 : line.rateE4;
  // An explicit amount wins; otherwise a rate-and-quantity line recomputes through the invoice-line
  // rounding boundary, so a reviewer who trims half an hour gets the same cents the original
  // composition would have produced for that duration.
  const amountMinor =
    input.amountMinor !== undefined
      ? input.amountMinor
      : rateE4 !== null && quantityE4 !== null
        ? invoiceLineAmountMinor(rateE4, quantityE4, line.currency)
        : line.amountMinor;

  return {
    statements: [
      updateInvoiceLineStatement(database, lineId, {
        description: input.description ?? line.description,
        quantityE4,
        rateE4,
        amountMinor,
        taxTreatment: input.taxTreatment ?? line.taxTreatment,
      }),
    ],
    outboxMessages: [],
  };
}

// Throwing a draft away. Every claim is released and every mirror nulled, so all the work returns to
// unbilled work-in-progress — the entries were never locked, because the lock happens at finalize.
// `void` is reachable only from `draft`: a finalized invoice is corrected by a credit note.
export async function voidDraft(
  database: SqlDatabase,
  invoiceId: InvoiceId,
  reason: string,
  voidedBy: UserId | null,
  options: BillingServiceOptions,
): Promise<EffectWrite> {
  const invoice = await readInvoice(database, invoiceId);
  if (!invoice) {
    throw new BillingValidationError("unknown-invoice", `no such invoice: ${invoiceId}`);
  }
  if (invoice.status !== "draft") {
    throw new BillingValidationError(
      "invoice-not-draft",
      `invoice ${invoiceId} is ${invoice.status}: only a draft can be voided, and a finalized invoice is corrected by a credit note`,
    );
  }
  const now = options.clock.now();
  return {
    statements: [
      releaseAllInvoiceClaimsStatement(database, invoiceId, now),
      clearWorkInProgressInvoiceMirrorStatement(database, "time_entry", invoiceId, now),
      clearWorkInProgressInvoiceMirrorStatement(database, "cost_entry", invoiceId, now),
      voidInvoiceStatement(database, invoiceId, reason, voidedBy, now),
    ],
    outboxMessages: [
      {
        topic: INVOICE_VOIDED_TOPIC,
        payload: { invoiceId },
        aggregateKey: BILLING_AGGREGATE_KEY,
      },
    ],
  };
}
