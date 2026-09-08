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
import { MAX_BOUND_PARAMETERS } from "@magna-carta/ledger/statements";
import { readMatterClientEntityIds } from "@magna-carta/matters/matter-party";
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
  releaseAllInvoiceClaimsStatement,
  releaseInvoiceClaimStatement,
  setWorkInProgressInvoiceMirrorStatement,
  updateInvoiceLineStatement,
  voidInvoiceStatement,
} from "./statements.ts";
import { WORK_IN_PROGRESS_KINDS } from "./types.ts";
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

interface FeeEntryRow {
  id: string;
  matter_id: string;
  description: string;
  currency: string;
  amount_minor: number;
  status: string;
  invoice_id: string | null;
  billable: number;
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

function timeEntryToClaimable(row: TimeEntryRow): ClaimableEntry {
  if (row.status === "billed" || row.status === "void") {
    throw new BillingValidationError(
      "work-in-progress-not-billable",
      `time entry ${row.id} is ${row.status} and cannot be billed again`,
    );
  }
  // Billing consumes the rate the entry snapshot on its work date and NEVER re-resolves one — that
  // is the whole point of the effective-dated rate engine, and re-resolving at invoice time would
  // silently re-rate historical work.
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

function costEntryToClaimable(row: CostEntryRow): ClaimableEntry {
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

/*
 * A recorded fee composes a `flat_fee` line: an amount with no quantity and no rate, which is what
 * that line kind already means. It is NOT a `fee` line — that kind carries hours times a rate and
 * consolidates claimed time, and putting a typed charge on one would state a quantity nobody
 * entered.
 *
 * A NON-BILLABLE FEE IS REFUSED HERE RATHER THAN SILENTLY BILLED. Absorbing a charge is a decision
 * the ledger keeps visible, and a claim that quietly overrode it would put the client's name on
 * money the firm had decided to eat. Time's equivalent guard is its null rate; a fee's is this
 * flag, because a fee has no rate to be missing.
 */
function feeEntryToClaimable(row: FeeEntryRow): ClaimableEntry {
  if (row.status === "billed" || row.status === "void") {
    throw new BillingValidationError(
      "work-in-progress-not-billable",
      `fee entry ${row.id} is ${row.status} and cannot be billed again`,
    );
  }
  if (row.billable !== 1) {
    throw new BillingValidationError(
      "work-in-progress-not-billable",
      `fee entry ${row.id} is recorded as absorbed by the firm and is never charged to the client`,
    );
  }
  return {
    sourceKind: "fee_entry",
    sourceId: row.id,
    matterId: row.matter_id as MatterId,
    description: row.description,
    quantityE4: null,
    rateE4: null,
    amountMinor: row.amount_minor,
    currency: row.currency,
    lineKind: "flat_fee",
    utbmsTaskCode: null,
    utbmsActivityCode: null,
    utbmsExpenseCode: null,
  };
}

// Every entry a claim batch names, in ONE read per store per chunk. A per-entry lookup would put two
// round-trips on every claimed hour, and a bill covering a month of a busy matter claims hundreds —
// which is the draft-assembly path the load profile measures. Chunked at D1's bound-parameter cap.
async function loadClaimableEntries(
  database: SqlDatabase,
  requests: readonly ClaimRequest[],
): Promise<Map<string, ClaimableEntry>> {
  const byRequestKey = new Map<string, ClaimableEntry>();
  const timeEntryIds = requests
    .filter((request) => request.sourceKind === "time_entry")
    .map((request) => request.sourceId);
  const costEntryIds = requests
    .filter((request) => request.sourceKind === "cost_entry")
    .map((request) => request.sourceId);
  const feeEntryIds = requests
    .filter((request) => request.sourceKind === "fee_entry")
    .map((request) => request.sourceId);

  for (let start = 0; start < timeEntryIds.length; start += MAX_BOUND_PARAMETERS) {
    const chunk = timeEntryIds.slice(start, start + MAX_BOUND_PARAMETERS);
    const placeholders = chunk.map((_, index) => `?${index + 1}`).join(", ");
    const { results } = await database
      .prepare(
        `SELECT id, matter_id, narrative, duration_minutes, currency, rate_e4, amount_minor, status, invoice_id, utbms_task_code_id, utbms_activity_code_id
           FROM time_entry WHERE id IN (${placeholders})`,
      )
      .bind(...chunk)
      .all<TimeEntryRow>();
    for (const row of results) {
      byRequestKey.set(claimKey("time_entry", row.id), timeEntryToClaimable(row));
    }
  }

  for (let start = 0; start < costEntryIds.length; start += MAX_BOUND_PARAMETERS) {
    const chunk = costEntryIds.slice(start, start + MAX_BOUND_PARAMETERS);
    const placeholders = chunk.map((_, index) => `?${index + 1}`).join(", ");
    const { results } = await database
      .prepare(
        `SELECT id, matter_id, description, currency, amount_minor, status, invoice_id, utbms_expense_code_id
           FROM cost_entry WHERE id IN (${placeholders})`,
      )
      .bind(...chunk)
      .all<CostEntryRow>();
    for (const row of results) {
      byRequestKey.set(claimKey("cost_entry", row.id), costEntryToClaimable(row));
    }
  }

  for (let start = 0; start < feeEntryIds.length; start += MAX_BOUND_PARAMETERS) {
    const chunk = feeEntryIds.slice(start, start + MAX_BOUND_PARAMETERS);
    const placeholders = chunk.map((_, index) => `?${index + 1}`).join(", ");
    const { results } = await database
      .prepare(
        `SELECT id, matter_id, description, currency, amount_minor, status, invoice_id, billable
           FROM fee_entry WHERE id IN (${placeholders})`,
      )
      .bind(...chunk)
      .all<FeeEntryRow>();
    for (const row of results) {
      byRequestKey.set(claimKey("fee_entry", row.id), feeEntryToClaimable(row));
    }
  }
  return byRequestKey;
}

/*
 * What each store is called when a refusal names it. A Record rather than a ternary, so adding a
 * fourth kind is a compile error here rather than a message that quietly calls it by the wrong
 * name — which is exactly what the two-way ternary this replaced did the moment a third kind
 * existed: a missing fee entry was reported as a missing cost entry.
 */
const WORK_IN_PROGRESS_NOUNS: Record<WorkInProgressKind, string> = {
  time_entry: "time",
  cost_entry: "cost",
  fee_entry: "fee",
};

// The three stores are separate id spaces, so a claim is keyed by the pair rather than the id alone.
function claimKey(sourceKind: WorkInProgressKind, sourceId: string): string {
  return `${sourceKind}:${sourceId}`;
}

interface NonHourlyArrangement {
  readonly kind: "flat_fee" | "contingency";
  readonly version: number;
}

// The in-force fee agreement for each matter that is NOT billed by the hour. One chunked read over
// the open rows; hourly-by-arrangement and hourly-by-absence both come back absent, because they
// bill identically. Retainer matters are absent too — a retainer funds hourly work, it does not
// price it.
async function readNonHourlyArrangementKinds(
  database: SqlDatabase,
  matterIds: readonly MatterId[],
): Promise<Map<string, NonHourlyArrangement>> {
  const byMatter = new Map<string, NonHourlyArrangement>();
  for (let start = 0; start < matterIds.length; start += MAX_BOUND_PARAMETERS) {
    const chunk = matterIds.slice(start, start + MAX_BOUND_PARAMETERS);
    const placeholders = chunk.map((_, index) => `?${index + 1}`).join(", ");
    const { results } = await database
      .prepare(
        `SELECT matter_id, kind, version FROM matter_billing_arrangement
          WHERE matter_id IN (${placeholders}) AND valid_to IS NULL AND kind IN ('flat_fee', 'contingency')`,
      )
      .bind(...chunk)
      .all<{ matter_id: string; kind: "flat_fee" | "contingency"; version: number }>();
    for (const row of results) {
      byMatter.set(row.matter_id, { kind: row.kind, version: row.version });
    }
  }
  return byMatter;
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

  const claimableEntries = await loadClaimableEntries(database, requests);
  const matterIds = [...new Set([...claimableEntries.values()].map((entry) => entry.matterId))];
  const clientByMatter = await readMatterClientEntityIds(database, matterIds);
  // Which of these matters is NOT billed by the hour. A flat-fee matter's time contributes to the
  // fee at a zero claimed amount through the flat-fee path, and a contingency matter's fee is a
  // share of the recovery — composing an hourly fee line on either would charge the client twice
  // for the same agreement. Costs stay claimable on every matter: advancing a filing fee is not a
  // fee model. A retainer is a FUNDING arrangement, not a fee computation, so its time still bills
  // hourly against the replenishing balance.
  const nonHourlyKindByMatter = await readNonHourlyArrangementKinds(database, matterIds);

  for (const request of requests) {
    const entry = claimableEntries.get(claimKey(request.sourceKind, request.sourceId));
    if (!entry) {
      throw new BillingValidationError(
        "work-in-progress-not-billable",
        `no such ${WORK_IN_PROGRESS_NOUNS[request.sourceKind]} entry: ${request.sourceId}`,
      );
    }
    const clientEntityId = clientByMatter.get(entry.matterId);
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
    /*
     * TIME ONLY, AND DELIBERATELY SO — do not widen this to every kind.
     *
     * The guard exists because a non-hourly arrangement ALREADY PRICES the work: billing the hours
     * as well would charge twice for one thing. A cost is money advanced rather than work, and a
     * recorded fee is a charge somebody decided on explicitly — neither is priced by the
     * arrangement, so neither double-charges, and refusing them would stop a firm billing an
     * agreed out-of-scope charge on a flat-fee matter.
     */
    const nonHourly = nonHourlyKindByMatter.get(entry.matterId);
    if (entry.sourceKind === "time_entry" && nonHourly) {
      const remedy =
        nonHourly.kind === "flat_fee"
          ? "add the flat fee to the draft and name this entry as contributing work instead"
          : "the fee is a share of the recovery, composed from the recorded recovery instead";
      throw new BillingValidationError(
        "matter-not-billed-hourly",
        `matter ${entry.matterId} is billed under a ${nonHourly.kind.replace("_", " ")} agreement (version ${nonHourly.version}), so its time is not charged by the hour: ${remedy}`,
      );
    }
    // ONE CURRENCY PER INVOICE, refused here rather than absorbed later. The line is written with
    // the entry's own currency, but `finalizeInvoice` aggregates every line under the INVOICE's
    // currency — so a line that disagreed would be silently re-labelled at finalize and billed as if
    // it had always been in the invoice's money. Unreachable while the work-in-progress stores are
    // pinned to USD by their own CHECK constraints, which means the guard today is those constraints
    // rather than any code: the first second currency added to the registry would remove it without
    // a line of this package changing.
    if (entry.currency !== invoice.currency) {
      throw new BillingValidationError(
        "invoice-line-currency-mismatch",
        `${request.sourceKind} ${request.sourceId} is recorded in ${entry.currency}, but this invoice bills in ${invoice.currency}: a bill states one currency, and converting one here would invent an exchange rate nobody approved`,
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
      // EVERY store, derived from the union rather than listed by hand. Two of these were spelled
      // out when there were two stores, so adding a third left its mirror pointing at a voided
      // invoice — a billed-looking fee on a bill that no longer exists. Mapping over the kinds
      // makes a fourth store impossible to forget.
      ...WORK_IN_PROGRESS_KINDS.map((kind) =>
        clearWorkInProgressInvoiceMirrorStatement(database, kind, invoiceId, now),
      ),
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
