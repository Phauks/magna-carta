import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  InvoiceApplicationId,
  InvoiceId,
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
// THE TRUST KIND COMPOSES NO LEDGER ENTRY. This is the most dangerous detail in the subsystem.
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
// So the rule is structural rather than remembered: the trust arm below composes the application and
// the delta and NOTHING else, and `fitness.ts` re-proves over stored rows that a trust application is
// never accompanied by a billing-composed receivable credit. The sibling rule lives in
// packages/trust/src/transfer.ts, which owns the two legs.
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
  readonly appliedBy: UserId | null;
}

export interface ComposedInvoiceApplication {
  readonly applicationId: InvoiceApplicationId;
  readonly effect: EffectWrite;
}

// The kinds whose money movement is composed by SOMEBODY ELSE, so that the application is the whole
// of billing's contribution. Today that is exactly one: the trust transfer, whose operating leg
// already credited the receivable.
const KINDS_ARRIVING_WITH_THEIR_OWN_POSTING: ReadonlySet<InvoiceApplicationKind> = new Set([
  "trust_transfer",
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

  if (!KINDS_ARRIVING_WITH_THEIR_OWN_POSTING.has(input.kind)) {
    // Refused by name rather than composed as an application with no posting behind it. A payment, a
    // credit note, a client credit, a write-off, and a reversal each move money on their own terms
    // and each owe the ledger an entry; letting one through here would reduce what a client owes
    // with nothing on the firm's books to match, which is the same subledger-versus-control-account
    // disagreement the trust arm exists to avoid, in the opposite direction. Their write paths land
    // with their own slices — the credit-note path next, payment rails in Phase 6.
    throw new BillingValidationError(
      "application-kind-not-built",
      `${input.kind} applications are not built yet: only a transfer out of a client's trust ledger can currently reach an invoice, because every other kind has to compose its own ledger entry and none of those write paths exist`,
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
      effectiveDate: input.effectiveDate,
      appliedBy: input.appliedBy,
      now,
    }),
    // The delta, unguarded, riding the same batch as the movement that caused it. The bounds CHECK
    // on invoice_matter_balance is the guarantee — see the statement's own comment for why a guarded
    // UPDATE here would be strictly worse than none.
    applyToInvoiceMatterBalanceStatement(
      database,
      input.invoiceId,
      input.matterId,
      input.amountMinor,
      now,
    ),
  ];

  return { applicationId, effect: { statements, outboxMessages: [] } };
}
