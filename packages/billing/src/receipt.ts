import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  InvoiceApplicationId,
  InvoiceId,
  MatterId,
  PaymentReceiptId,
  UserId,
} from "@magna-carta/identifiers/types";
import { postEntry } from "@magna-carta/ledger/post-entry";
import { greaterThan } from "@magna-carta/money/compare";
import { toMinor } from "@magna-carta/money/format";
import { currencyFromCode, money, subtract } from "@magna-carta/money/money";
import { readAccountRoleMap, resolveAccountRole } from "./account-roles.ts";
import { composeInvoiceApplication, issueDateOfFinalizedInvoice } from "./application.ts";
import { BillingValidationError } from "./billing-validation.ts";
import { BILLING_AGGREGATE_KEY } from "./draft.ts";
import {
  insertPaymentReceiptStatement,
  readInvoice,
  readInvoiceMatterBalances,
} from "./statements.ts";
import type { BillingServiceOptions } from "./types.ts";

export const INVOICE_PAID_TOPIC = "billing.invoice.payment_recorded";

/** How money the firm recorded by hand reached it. A closed list, held by the table's CHECK too. */
export const PAYMENT_RECEIPT_METHODS = ["check", "cash", "bank_transfer", "card_terminal"] as const;
export type PaymentReceiptMethod = (typeof PAYMENT_RECEIPT_METHODS)[number];

export interface RecordPaymentReceiptInput {
  readonly invoiceId: InvoiceId;
  readonly matterId: MatterId;
  readonly amountMinor: number;
  readonly method: PaymentReceiptMethod;
  /** A check number, a wire confirmation. Blank and absent are the same: none. */
  readonly reference?: string | null;
  /** The civil date the money arrived, which is the date the firm's books say it did. */
  readonly effectiveDate: string;
  readonly recordedBy: UserId | null;
}

export interface ComposedPaymentReceipt {
  readonly receiptId: PaymentReceiptId;
  readonly applicationId: InvoiceApplicationId;
  readonly entryId: string;
  readonly effect: EffectWrite;
}

// A PAYMENT THE FIRM RECORDS BY HAND. The client handed over a check, paid cash, sent a wire, or the
// firm ran a card on its own terminal: the money is already in the operating bank and no processor
// is involved, so this composes everything the firm's books need in one batch.
//
//   the posting      Dr Operating Bank / Cr Accounts Receivable, through the account-role map,
//                    refusing by name when either role is unmapped
//   the application  a `payment` application naming that posting, through the one door value
//                    reaches a bill by, under the balance row's bounds CHECK
//   the receipt      how the money arrived and the firm's reference for it
//
// IT CANNOT EXCEED WHAT THE MATTER STILL OWES ON THE BILL. An over-payment has no home yet: a client
// credit exists only as the residue of a credit note (its `credit_note_id` is NOT NULL and cannot be
// relaxed without a destructive rebuild), and crediting the receivable for money no bill is owed
// would part the receivable control account from the invoice subledger. So the firm records what
// the bill is owed, and returns or credits the rest. The bounds CHECK is what actually holds the
// ceiling under concurrency; the refusal here is the sentence in front of it.
//
// A TRUST DEPOSIT IS NOT A RECEIPT. Money a client sends to be held in trust goes onto their trust
// ledger through trust's own deposit, and reaches a bill later as a trust transfer. Nothing here
// writes a trust statement.
export async function recordPaymentReceipt(
  database: SqlDatabase,
  input: RecordPaymentReceiptInput,
  options: BillingServiceOptions,
): Promise<ComposedPaymentReceipt> {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new BillingValidationError(
      "payment-receipt-invalid",
      `a payment of ${input.amountMinor} is not a positive whole number of minor units`,
    );
  }
  if (!PAYMENT_RECEIPT_METHODS.includes(input.method)) {
    throw new BillingValidationError(
      "payment-receipt-invalid",
      `${String(input.method)} is not a way a payment is recorded by hand: use one of ${PAYMENT_RECEIPT_METHODS.join(", ")}`,
    );
  }
  const trimmedReference = input.reference?.trim() ?? "";
  const reference = trimmedReference === "" ? null : trimmedReference;

  const invoice = await readInvoice(database, input.invoiceId);
  if (!invoice) {
    throw new BillingValidationError("unknown-invoice", `no such invoice: ${input.invoiceId}`);
  }
  if (invoice.status !== "final") {
    throw new BillingValidationError(
      "invoice-not-final",
      `invoice ${input.invoiceId} is ${invoice.status}: a payment is recorded against a bill that was issued, and a ${invoice.status} invoice was never issued`,
    );
  }
  const issueDate = issueDateOfFinalizedInvoice(invoice);
  if (input.effectiveDate < issueDate) {
    throw new BillingValidationError(
      "application-before-invoice-issued",
      `invoice ${input.invoiceId} was issued on ${issueDate} and this payment is dated ${input.effectiveDate}: a payment against a bill cannot predate the bill, so date it on or after ${issueDate}`,
    );
  }

  const balances = await readInvoiceMatterBalances(database, input.invoiceId);
  const balance = balances.find((row) => row.matterId === input.matterId);
  if (balance === undefined) {
    throw new BillingValidationError(
      "credit-note-matter-not-billed",
      `invoice ${input.invoiceId} does not bill matter ${input.matterId}, so it carries no balance on that matter to pay`,
    );
  }
  const currencyValue = currencyFromCode(invoice.currency);
  const unpaid = subtract(
    money(balance.totalMinor, currencyValue),
    money(balance.appliedMinor, currencyValue),
  );
  const unpaidMinor = toMinor(unpaid);
  if (greaterThan(money(input.amountMinor, currencyValue), unpaid)) {
    throw new BillingValidationError(
      "payment-exceeds-unpaid-balance",
      `matter ${input.matterId} still owes ${unpaidMinor} on invoice ${input.invoiceId} and this records ${input.amountMinor}: record what the bill is owed, and return or credit the rest`,
    );
  }

  const roleMap = await readAccountRoleMap(database);
  const posting = await postEntry(
    database,
    {
      description: `Payment — ${invoice.invoiceNumber ?? input.invoiceId}`,
      effectiveDate: input.effectiveDate,
      lines: [
        {
          accountId: resolveAccountRole(roleMap, "operating_bank"),
          direction: "debit" as const,
          amount: money(input.amountMinor, currencyValue),
        },
        {
          accountId: resolveAccountRole(roleMap, "accounts_receivable"),
          direction: "credit" as const,
          amount: money(input.amountMinor, currencyValue),
        },
      ],
    },
    options,
  );

  const application = composeInvoiceApplication(
    database,
    {
      invoiceId: input.invoiceId,
      matterId: input.matterId,
      kind: "payment",
      amountMinor: input.amountMinor,
      currency: invoice.currency,
      effectiveDate: input.effectiveDate,
      invoiceIssueDate: issueDate,
      entryId: posting.entryId,
      appliedBy: input.recordedBy,
    },
    options,
  );

  const receiptId = newIdentifier("paymentReceipt", options.randomSource) as PaymentReceiptId;

  return {
    receiptId,
    applicationId: application.applicationId,
    entryId: posting.entryId,
    effect: {
      statements: [
        ...posting.effect.statements,
        ...application.effect.statements,
        insertPaymentReceiptStatement(database, {
          id: receiptId,
          applicationId: application.applicationId,
          method: input.method,
          reference,
          recordedBy: input.recordedBy,
          now: options.clock.now(),
        }),
      ],
      // Identifiers, the amount and the method — never the reference, which can be a client's own
      // bank detail and fans out to every subscriber's notification record.
      outboxMessages: [
        ...posting.effect.outboxMessages,
        ...application.effect.outboxMessages,
        {
          topic: INVOICE_PAID_TOPIC,
          payload: {
            invoiceId: input.invoiceId,
            matterId: input.matterId,
            amountMinor: input.amountMinor,
            currency: invoice.currency,
            method: input.method,
          },
          aggregateKey: BILLING_AGGREGATE_KEY,
        },
      ],
    },
  };
}
