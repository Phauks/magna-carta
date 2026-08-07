import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  InvoiceId,
  InvoiceLineId,
  InvoiceWipClaimId,
  MatterId,
  TimeEntryId,
} from "@magna-carta/identifiers/types";
import { MAX_BOUND_PARAMETERS } from "@magna-carta/ledger/statements";
import { readMatterClientEntityIds } from "@magna-carta/matters/matter-party";
import { requireArrangementOfKind } from "./arrangements.ts";
import { BillingValidationError } from "./billing-validation.ts";
import { MAXIMUM_CLAIMS_PER_INVOICE } from "./draft.ts";
import {
  insertInvoiceClaimStatement,
  insertInvoiceLineStatement,
  readActiveInvoiceClaims,
  readInvoice,
  readInvoiceLines,
  setWorkInProgressInvoiceMirrorStatement,
} from "./statements.ts";
import type { BillingServiceOptions } from "./types.ts";

// THE FLAT FEE. The client sees one line carrying the agreement's amount (or an instalment of it);
// the work is still tracked — time is captured on every matter for profitability and realization —
// so every contributing time entry is CLAIMED with a null invoice_line_id and a ZERO claimed amount.
// The entries lock as billed in the finalize batch exactly as hourly claims do, realization
// reporting can attribute exactly which work the fee covered, and none of it is what the client is
// charged. This falls out of the claim/line split with no special case, which is why the two are
// separate tables.
//
// A fee paid IN ADVANCE sits wherever the agreement's advance-deposit destination says — in trust
// until earned, in the ordinary deposit-and-withdraw-as-earned posture — and EARNING it is nothing
// new: finalize the flat-fee invoice, then take the money through the one earned-fee application
// path. No trust write shape exists here, and none is needed.

export interface AddFlatFeeToDraftInput {
  readonly invoiceId: InvoiceId;
  readonly matterId: MatterId;
  // An instalment of the agreed fee, for a milestone-billed agreement — several flat-fee lines
  // across several invoices against one arrangement, with a fitness query reporting over-billing
  // against the agreed total. Absent means the whole agreed amount. No milestone scheduler exists;
  // the instalment is a deliberate figure the biller states.
  readonly amountMinor?: number;
  readonly description?: string;
  // The time entries the fee covered, claimed at zero so realization can attribute them.
  readonly contributingTimeEntryIds?: readonly TimeEntryId[];
}

export interface ComposedFlatFee {
  readonly lineId: InvoiceLineId;
  readonly claimIds: readonly InvoiceWipClaimId[];
  readonly effect: EffectWrite;
}

interface ContributingTimeEntryRow {
  id: string;
  matter_id: string;
  status: string;
  invoice_id: string | null;
}

export async function addFlatFeeToDraft(
  database: SqlDatabase,
  input: AddFlatFeeToDraftInput,
  options: BillingServiceOptions,
): Promise<ComposedFlatFee> {
  const invoice = await readInvoice(database, input.invoiceId);
  if (!invoice) {
    throw new BillingValidationError("unknown-invoice", `no such invoice: ${input.invoiceId}`);
  }
  if (invoice.status !== "draft") {
    throw new BillingValidationError(
      "invoice-not-draft",
      `invoice ${input.invoiceId} is ${invoice.status} and no longer accepts work: a finalized invoice is corrected by a credit note, never edited`,
    );
  }

  const arrangement = await requireArrangementOfKind(database, input.matterId, "flat_fee");
  if (arrangement.currency !== invoice.currency) {
    throw new BillingValidationError(
      "invoice-line-currency-mismatch",
      `the flat-fee agreement is recorded in ${arrangement.currency}, but this invoice bills in ${invoice.currency}: a bill states one currency, and converting one here would invent an exchange rate nobody approved`,
    );
  }

  const clientByMatter = await readMatterClientEntityIds(database, [input.matterId]);
  const clientEntityId = clientByMatter.get(input.matterId);
  if (!clientEntityId) {
    throw new BillingValidationError(
      "matter-has-no-client",
      `matter ${input.matterId} has no client party, so there is nobody to bill: record the client on the matter first`,
    );
  }
  if (clientEntityId !== invoice.clientEntityId) {
    throw new BillingValidationError(
      "invoice-client-mismatch",
      `matter ${input.matterId} belongs to client ${clientEntityId}, but this invoice bills ${invoice.clientEntityId}: one invoice bills one client`,
    );
  }

  // The agreed amount unless the biller states an instalment. Nothing here schedules instalments or
  // stops the sum of them exceeding the agreement — `flatFeeBilledBeyondArrangementStatement` in
  // fitness.ts reports over-billing against the agreed total over stored rows.
  const amountMinor = input.amountMinor ?? (arrangement.flatFeeAmountMinor as number);
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new BillingValidationError(
      "billing-arrangement-invalid",
      `a flat-fee line must charge a positive whole number of minor units, got ${amountMinor}`,
    );
  }

  const contributingIds = input.contributingTimeEntryIds ?? [];
  const existingClaims = await readActiveInvoiceClaims(database, input.invoiceId);
  if (existingClaims.length + contributingIds.length > MAXIMUM_CLAIMS_PER_INVOICE) {
    throw new BillingValidationError(
      "claim-limit-exceeded",
      `an invoice may claim at most ${MAXIMUM_CLAIMS_PER_INVOICE} work-in-progress entries and this would make ${existingClaims.length + contributingIds.length}: bill a shorter period, or split the work across two invoices`,
    );
  }

  // One read per CHUNK at D1's bound-parameter cap, the same discipline as the hourly claim path:
  // a fee can cover months of work, and an over-long IN-list commits fine locally and throws on
  // production D1.
  const contributing = new Map<string, ContributingTimeEntryRow>();
  for (let start = 0; start < contributingIds.length; start += MAX_BOUND_PARAMETERS) {
    const chunk = contributingIds.slice(start, start + MAX_BOUND_PARAMETERS);
    const placeholders = chunk.map((_, index) => `?${index + 1}`).join(", ");
    const { results } = await database
      .prepare(
        `SELECT id, matter_id, status, invoice_id FROM time_entry WHERE id IN (${placeholders})`,
      )
      .bind(...chunk)
      .all<ContributingTimeEntryRow>();
    for (const row of results) contributing.set(row.id, row);
  }
  for (const timeEntryId of contributingIds) {
    const row = contributing.get(timeEntryId);
    if (!row) {
      throw new BillingValidationError(
        "work-in-progress-not-billable",
        `no such time entry: ${timeEntryId}`,
      );
    }
    if (row.matter_id !== input.matterId) {
      throw new BillingValidationError(
        "work-in-progress-not-billable",
        `time entry ${timeEntryId} belongs to matter ${row.matter_id}, not the flat-fee matter ${input.matterId}: a fee covers its own matter's work`,
      );
    }
    if (row.status === "billed" || row.status === "void") {
      throw new BillingValidationError(
        "work-in-progress-not-billable",
        `time entry ${timeEntryId} is ${row.status} and cannot be billed again`,
      );
    }
  }

  const existingLines = await readInvoiceLines(database, input.invoiceId);
  const now = options.clock.now();
  const lineId = newIdentifier("invoiceLine", options.randomSource);
  const claimIds: InvoiceWipClaimId[] = [];
  const statements: SqlStatement[] = [
    insertInvoiceLineStatement(database, {
      id: lineId,
      invoiceId: input.invoiceId,
      lineIndex: existingLines.length,
      matterId: input.matterId,
      kind: "flat_fee",
      description: input.description ?? "Flat fee for professional services",
      quantityE4: null,
      rateE4: null,
      amountMinor,
      currency: invoice.currency,
      utbmsTaskCode: null,
      utbmsActivityCode: null,
      utbmsExpenseCode: null,
      taxTreatment: "exempt",
      // The agreement version in force when the fee was composed — what a finalized bill was
      // computed under, permanent because the arrangement history is append-only.
      billingArrangementId: arrangement.id,
      now,
    }),
  ];
  for (const timeEntryId of contributingIds) {
    const claimId = newIdentifier("invoiceWipClaim", options.randomSource);
    claimIds.push(claimId);
    statements.push(
      // ZERO claimed amount, NO line: the entry contributes to the fee without being what the
      // client is charged. The partial unique index still guards it — work a flat fee covered
      // cannot also be billed hourly on another draft.
      insertInvoiceClaimStatement(database, {
        id: claimId,
        invoiceId: input.invoiceId,
        sourceKind: "time_entry",
        sourceId: timeEntryId,
        invoiceLineId: null,
        claimedAmountMinor: 0,
        now,
      }),
      setWorkInProgressInvoiceMirrorStatement(
        database,
        "time_entry",
        timeEntryId,
        input.invoiceId,
        now,
      ),
    );
  }

  return { lineId, claimIds, effect: { statements, outboxMessages: [] } };
}
