import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  ClientCreditId,
  CreditNoteId,
  InvoiceApplicationId,
  InvoiceId,
  LedgerEntryId,
  MatterId,
  TrustTransferId,
  UserId,
} from "@magna-carta/identifiers/types";
import { BillingValidationError } from "./billing-validation.ts";
import {
  applyToInvoiceMatterBalanceStatement,
  insertInvoiceApplicationStatement,
} from "./statements.ts";
import type { BillingServiceOptions, InvoiceApplicationKind } from "./types.ts";

// THE ONE DOOR. Every unit of value that reaches an invoice comes through here, whatever moved it:
// a transfer out of a client's trust ledger, a payment, a credit note, a client credit, a write-off,
// or the reversal of one of those. There is deliberately no second path, because the pairing this
// composes — an append-only application row and the delta on the matter's balance — is what keeps
// the invoice subledger and the accounts-receivable control account equal to each other. A caller
// that wrote one without the other would break that equality with nothing to notice.
//
// ------------------------------------------------------------------------------------------------
// THIS FUNCTION COMPOSES NO LEDGER ENTRY, EVER. It writes the application row and the balance delta
// and nothing else; the posting behind an application is the CALLER's, and the caller names it here
// so the row records which entry it rode with. That is what keeps the most dangerous detail in the
// subsystem structural rather than remembered.
//
// THE TRUST KIND COMPOSES NO LEDGER ENTRY AT ALL.
//
// A transfer out of trust is TWO linked ledger entries composed by the trust package: a trust
// disbursement (Dr the client's matter leaf / Cr the trust bank) and an operating receipt
// (Dr Operating Bank / Cr Accounts Receivable). That second leg has ALREADY credited accounts
// receivable by the time this function is reached. Composing a posting here as well would credit the
// receivable twice for one movement of money — the ledger would still balance, every entry would
// still be valid, and nothing would fail. What would happen instead is that the receivable control
// account would drift below the invoice subledger by the total of every trust-funded fee the firm
// has ever taken, growing quietly forever, and the first symptom would be a balance sheet nobody can
// reconcile years later.
//
// So the rule is structural rather than remembered, at three layers: this function composes no
// posting for anybody; the `invoice_application_entry_paired` trigger refuses a trust application
// that names one; and `fitness.ts` re-proves over stored rows that a trust application is never
// accompanied by a billing-composed receivable credit. The sibling rule lives in
// packages/trust/src/transfer.ts, which owns the two legs.
//
// The credit note is the other side of that pairing. One note is ONE posting across however many
// per-matter applications it produces — including none at all, when the bill it corrects is already
// paid in full — so the entry is recorded on the note and not repeated here. Every remaining kind is
// one posting per application and names it.
// ------------------------------------------------------------------------------------------------

export interface InvoiceApplicationInput {
  readonly invoiceId: InvoiceId;
  // Which matter's share of the invoice this pays down. Not derived from the invoice: a multi-matter
  // bill has a balance row per matter, and a trust transfer draws on exactly one matter's leaf, so
  // the ceiling it must respect is that matter's row rather than the invoice's total.
  readonly matterId: MatterId;
  readonly kind: InvoiceApplicationKind;
  readonly amountMinor: number;
  readonly currency: string;
  readonly effectiveDate: string; // YYYY-MM-DD civil date
  readonly trustTransferId?: TrustTransferId | null;
  readonly reversesApplicationId?: InvoiceApplicationId | null;
  readonly creditNoteId?: CreditNoteId | null;
  readonly clientCreditId?: ClientCreditId | null;
  // The posting the CALLER composed for this application, which this function never composes and
  // never inspects. Absent for a trust transfer (the posting is trust's) and for a credit note (one
  // posting sits on the note); required for everything else, held by trigger either way.
  readonly entryId?: LedgerEntryId | null;
  // Why the firm gave up a receivable or unwound an application. Required on a write-off and a
  // reversal, held by trigger.
  readonly reason?: string | null;
  readonly appliedBy: UserId | null;
}

export interface ComposedInvoiceApplication {
  readonly applicationId: InvoiceApplicationId;
  readonly effect: EffectWrite;
}

// The kinds that have a write path today. `payment` is the one still missing: cash and card rails
// are a later slice, and an application composed here with nothing on the firm's books to match it
// would reduce what a client owes with no posting behind it — the same subledger-versus-control
// disagreement the trust arm exists to avoid, in the opposite direction.
const KINDS_WITH_A_WRITE_PATH: ReadonlySet<InvoiceApplicationKind> = new Set([
  "trust_transfer",
  "credit_note",
  "client_credit",
  "write_off",
  "reversal",
]);

export function composeInvoiceApplication(
  database: SqlDatabase,
  input: InvoiceApplicationInput,
  options: BillingServiceOptions,
): ComposedInvoiceApplication {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new BillingValidationError(
      "application-amount-not-positive",
      `an application of ${input.amountMinor} is not a positive whole number of minor units: an application's direction is its KIND, never the sign of its amount, so a correction is a reversal rather than a negative application`,
    );
  }

  if (!KINDS_WITH_A_WRITE_PATH.has(input.kind)) {
    throw new BillingValidationError(
      "application-kind-not-built",
      `${input.kind} applications are not built yet: a payment has to record the money actually arriving and post it, and the payment rails that would do so are a later slice`,
    );
  }

  const now = options.clock.now();
  const applicationId = newIdentifier("invoiceApplication", options.randomSource);

  const statements: SqlStatement[] = [
    insertInvoiceApplicationStatement(database, {
      id: applicationId,
      invoiceId: input.invoiceId,
      matterId: input.matterId,
      kind: input.kind,
      amountMinor: input.amountMinor,
      currency: input.currency,
      trustTransferId: input.trustTransferId ?? null,
      reversesApplicationId: input.reversesApplicationId ?? null,
      creditNoteId: input.creditNoteId ?? null,
      clientCreditId: input.clientCreditId ?? null,
      entryId: input.entryId ?? null,
      reason: input.reason ?? null,
      effectiveDate: input.effectiveDate,
      appliedBy: input.appliedBy,
      now,
    }),
    // The delta, unguarded, riding the same batch as the movement that caused it. The bounds CHECK
    // on invoice_matter_balance is the guarantee — see the statement's own comment for why a guarded
    // UPDATE here would be strictly worse than none.
    //
    // A REVERSAL SUBTRACTS, and this is the one place the direction is read off the kind. The row's
    // amount stays positive — the ledger's rule, applied to the subledger — so the sign lives here
    // and nowhere else. The lower bound of the same CHECK is what makes reversing more than was ever
    // applied abort the batch rather than drive a balance negative.
    applyToInvoiceMatterBalanceStatement(
      database,
      input.invoiceId,
      input.matterId,
      input.kind === "reversal" ? -input.amountMinor : input.amountMinor,
      now,
    ),
  ];

  return { applicationId, effect: { statements, outboxMessages: [] } };
}
