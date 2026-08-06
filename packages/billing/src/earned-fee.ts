import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { InvoiceId, MatterId, TrustLedgerNodeId } from "@magna-carta/identifiers/types";
import { BillingValidationError } from "./billing-validation.ts";
import { readInvoice, readInvoiceMatterBalances } from "./statements.ts";

// THE INVOICE-BACKED EARNED-FEE PRECONDITION — the satisfier for the port in
// packages/trust/src/transfer.ts, which until now has refused every transfer on the stated grounds
// that what evidence permits money to leave trust had not been settled.
//
// The evidence is a FINALIZED INVOICE with enough unpaid balance attributable to the specific matter
// whose client ledger is being drawn on. That is a hard requirement with no override path, and the
// friction is the point: this is the operation where real-world trust violations happen, and an
// override path is a path, which means it becomes the path. The cost is real and worth stating — a
// firm that bills out of band, in a spreadsheet or through an insurer's portal, cannot take its own
// earned fees until it has finalized an invoice here. Finalizing one here is cheap and does not
// require the platform to have generated the bill.
//
// THE DIRECTION OF THE DEPENDENCY. Trust owns the transfer and knows nothing about invoices; billing
// implements trust's port and merges the statements trust returns. No change to @magna-carta/trust
// was needed to close this, which is the test that the seam is in the right place. The port's
// existing context — node, matter, amount, currency — is exactly enough, because the precondition
// instance is constructed per request from applications billing has ALREADY resolved: the assertion
// is a re-check that what trust is about to compose is what billing authorized, not a fresh lookup.
// Widening the port with an invoice reference would have made trust know what an invoice is, for no
// gain.
//
// AND THE PRE-CHECK IS NOT THE GUARANTEE. Every condition below is read before the batch so that a
// refusal reads as a sentence a member can act on. The mechanism is the `invoice_matter_balance`
// bounds CHECK, which rides the same batch as the trust entries: a concurrent transfer, payment, or
// credit note that consumed the balance between these reads and the commit aborts the entire batch —
// the trust entries, the transfer link, the applications, and the idempotency record together. Both
// layers are needed and neither substitutes for the other, which is deliberately the same
// arrangement trust uses for its own no-negative floor.

// How many invoices one transfer may settle. The resolution below reads each named invoice and its
// balance rows, and the whole batch then carries two statements per application on top of trust's
// entries — so an unbounded list is both a read fan-out on a request handler and a batch that would
// eventually exceed what one commit can hold. The real shape is one invoice, occasionally a handful:
// a transfer draws on ONE matter's leaf, so the invoices it can settle are that matter's own. The
// bound is generous against that shape and exists so the failure is a named refusal rather than a
// slow request or an opaque commit error.
export const MAXIMUM_INVOICES_PER_TRUST_APPLICATION = 50;

export interface EarnedFeeApplicationRequest {
  readonly invoiceId: InvoiceId;
  readonly amountMinor: number;
}

// One application, resolved against stored rows and ready to be re-asserted at transfer time.
export interface ResolvedEarnedFeeApplication {
  readonly invoiceId: InvoiceId;
  readonly matterId: MatterId;
  readonly amountMinor: number;
  readonly currency: string;
  readonly unpaidMinor: number;
}

export interface ResolvedEarnedFeeApplications {
  readonly nodeId: TrustLedgerNodeId;
  readonly matterId: MatterId;
  readonly clientEntityId: string;
  readonly currency: string;
  readonly totalMinor: number;
  readonly applications: readonly ResolvedEarnedFeeApplication[];
}

export interface ResolveEarnedFeeApplicationsInput {
  // The trust leaf the money leaves, and the matter it is attributed to. Both are resolved by the
  // caller from the matter's own client party — the one home for "whose matter is this" — never
  // taken as a client handle from the request.
  readonly nodeId: TrustLedgerNodeId;
  readonly matterId: MatterId;
  readonly clientEntityId: string;
  readonly currency: string;
  readonly applications: readonly EarnedFeeApplicationRequest[];
}

// Reads every named invoice and its balance row for this matter, refusing by name on each of the
// conditions that can be settled from stored data. What is left for `assertTransferPermitted` is the
// agreement between this resolution and the transfer trust is actually about to compose.
export async function resolveEarnedFeeApplications(
  database: SqlDatabase,
  input: ResolveEarnedFeeApplicationsInput,
): Promise<ResolvedEarnedFeeApplications> {
  if (input.applications.length === 0) {
    throw new BillingValidationError(
      "earned-fee-no-applications",
      "a transfer out of a client's trust ledger has to name the invoice it pays: money may leave trust for the firm only against a finalized bill, and an unnamed transfer is exactly the movement that rule exists to refuse",
    );
  }
  if (input.applications.length > MAXIMUM_INVOICES_PER_TRUST_APPLICATION) {
    throw new BillingValidationError(
      "earned-fee-too-many-invoices",
      `this transfer names ${input.applications.length} invoices and at most ${MAXIMUM_INVOICES_PER_TRUST_APPLICATION} can be settled in one movement: split it, so that each transfer commits as one batch and a failure leaves nothing half-applied`,
    );
  }

  const resolved: ResolvedEarnedFeeApplication[] = [];
  for (const requested of input.applications) {
    if (!Number.isInteger(requested.amountMinor) || requested.amountMinor <= 0) {
      throw new BillingValidationError(
        "application-amount-not-positive",
        `the amount named against invoice ${requested.invoiceId} is ${requested.amountMinor}: an application is a positive whole number of minor units`,
      );
    }

    const invoice = await readInvoice(database, requested.invoiceId);
    if (!invoice) {
      throw new BillingValidationError(
        "unknown-invoice",
        `no such invoice: ${requested.invoiceId}`,
      );
    }

    // 1. FINALIZED. A draft is a working document that asserts nothing to anybody, has no number,
    //    and locks no work; taking a fee against one would be taking a fee against a bill the client
    //    has not been charged. A voided draft is worse.
    if (invoice.status !== "final") {
      throw new BillingValidationError(
        "earned-fee-invoice-not-final",
        `invoice ${requested.invoiceId} is ${invoice.status}, not finalized: money leaves a client's trust ledger for the firm only against a bill that has become an evidentiary record, so finalize it first`,
      );
    }

    // 2. THE INVOICE'S CLIENT IS THE CLIENT WHOSE MONEY THIS IS. One client per invoice is a hard
    //    rule, and this is one of the reasons for it: paying client A's bill out of client B's trust
    //    ledger is the classic misappropriation pattern, and it must be unrepresentable rather than
    //    discouraged.
    if (invoice.clientEntityId !== input.clientEntityId) {
      throw new BillingValidationError(
        "earned-fee-invoice-client-mismatch",
        `invoice ${requested.invoiceId} bills client ${invoice.clientEntityId}, but the trust ledger being drawn on holds money belonging to client ${input.clientEntityId}: one client's funds can never pay another client's bill`,
      );
    }

    if (invoice.currency !== input.currency) {
      throw new BillingValidationError(
        "application-currency-mismatch",
        `invoice ${requested.invoiceId} is denominated in ${invoice.currency} and the trust ledger in ${input.currency}: an application compares two amounts, and comparing them across currencies is a comparison of different things that happens to typecheck`,
      );
    }

    // 3. THE INVOICE ACTUALLY BILLS THIS MATTER. The balance rows are created at finalize, one per
    //    matter the bill charges; an absent row means this invoice charges nothing on this matter,
    //    and there is nothing here for the matter's money to pay.
    const balances = await readInvoiceMatterBalances(database, requested.invoiceId);
    const balance = balances.find((row) => row.matterId === input.matterId);
    if (!balance) {
      throw new BillingValidationError(
        "earned-fee-invoice-does-not-bill-matter",
        `invoice ${requested.invoiceId} does not bill matter ${input.matterId}: a transfer draws on that matter's client ledger, so it can only pay down that matter's own share of a bill`,
      );
    }

    // 4. AT MOST THE MATTER'S UNPAID BALANCE — that matter's share, not the invoice's total, even
    //    when the invoice as a whole is owed more. The bounds CHECK is what actually holds this; the
    //    named refusal is so a member sees a number rather than a constraint violation.
    const unpaidMinor = balance.totalMinor - balance.appliedMinor;
    if (requested.amountMinor > unpaidMinor) {
      throw new BillingValidationError(
        "earned-fee-exceeds-unpaid-balance",
        `invoice ${requested.invoiceId} has ${unpaidMinor} unpaid on matter ${input.matterId} and the transfer names ${requested.amountMinor}: a fee may be taken only up to what that matter still owes on that bill`,
      );
    }

    resolved.push({
      invoiceId: requested.invoiceId,
      matterId: input.matterId,
      amountMinor: requested.amountMinor,
      currency: invoice.currency,
      unpaidMinor,
    });
  }

  // Integer arithmetic throughout: minor units are whole numbers and this sum is exact, so a partial
  // application leaves exactly the remainder and never a rounded approximation of it.
  const totalMinor = resolved.reduce((sum, application) => sum + application.amountMinor, 0);

  return {
    nodeId: input.nodeId,
    matterId: input.matterId,
    clientEntityId: input.clientEntityId,
    currency: input.currency,
    totalMinor,
    applications: resolved,
  };
}

// The port instance handed to `composeTrustToOperatingTransfer`. It closes over the resolution above
// and asserts the two conditions that are about the TRANSFER rather than about any one invoice: that
// trust is composing against the same leaf billing resolved, and for exactly the amount the named
// applications sum to. Anything else would mean the transfer and the applications riding the same
// batch disagree about what is being paid, which is the one thing a re-check can still catch.
//
// Structurally typed against trust's `EarnedFeePrecondition` rather than importing it as a value:
// the port is an interface with one method, and billing depends on trust for types plus the transfer
// composer only.
export function invoiceBackedEarnedFeePrecondition(resolution: ResolvedEarnedFeeApplications): {
  assertTransferPermitted(context: {
    readonly nodeId: TrustLedgerNodeId;
    readonly matterId: MatterId | null;
    readonly amountMinor: number;
    readonly currency: string;
  }): Promise<void>;
} {
  return {
    assertTransferPermitted(context): Promise<void> {
      // 5a. The leaf trust is about to debit is the leaf billing resolved from the matter's own
      //     client party. Without this the applications could name one matter's invoices while the
      //     money came out of another's ledger.
      if (context.nodeId !== resolution.nodeId || context.matterId !== resolution.matterId) {
        return Promise.reject(
          new BillingValidationError(
            "earned-fee-node-mismatch",
            `this transfer draws on trust ledger ${context.nodeId} for matter ${context.matterId ?? "none"}, but the invoices named were checked against ledger ${resolution.nodeId} for matter ${resolution.matterId}: a fee must come out of the ledger belonging to the matter it was earned on`,
          ),
        );
      }
      if (context.currency !== resolution.currency) {
        return Promise.reject(
          new BillingValidationError(
            "application-currency-mismatch",
            `this transfer is denominated in ${context.currency} and the invoices named in ${resolution.currency}`,
          ),
        );
      }
      // 5b. The named amounts sum to the transfer exactly. A transfer larger than its applications
      //     would take money out of trust that no bill accounts for; a smaller one would apply more
      //     to the invoices than actually moved.
      if (context.amountMinor !== resolution.totalMinor) {
        return Promise.reject(
          new BillingValidationError(
            "earned-fee-amount-mismatch",
            `this transfer moves ${context.amountMinor} but the invoices named account for ${resolution.totalMinor}: every unit leaving a client's trust ledger has to be attributable to a bill`,
          ),
        );
      }
      return Promise.resolve();
    },
  };
}
