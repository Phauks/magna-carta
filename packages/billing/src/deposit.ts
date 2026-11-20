import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { isCivilDate } from "@magna-carta/civil-time/civil-date";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  InvoiceId,
  LedgerAccountId,
  MatterId,
  PaymentDepositFeeId,
  PaymentDepositFileId,
  PaymentDepositId,
  PaymentDepositNoteId,
  PaymentReceiptId,
  UserId,
} from "@magna-carta/identifiers/types";
import { postEntry } from "@magna-carta/ledger/post-entry";
import { currencyFromCode, money } from "@magna-carta/money/money";
import { readAccountRoleMap, resolveAccountRole } from "./account-roles.ts";
import { composeInvoiceApplication, issueDateOfFinalizedInvoice } from "./application.ts";
import { BillingValidationError } from "./billing-validation.ts";
import { readPaymentDepositFile } from "./deposit-reads.ts";
import { BILLING_AGGREGATE_KEY } from "./draft.ts";
import { aggregateMinor, differenceMinor } from "./line-amounts.ts";
import {
  checkPaymentDetails,
  METHODS_WITHOUT_REFERENCE,
  PAYMENT_METHODS,
  type PaymentMethod,
} from "./payment-methods.ts";
import {
  insertPaymentDepositFeeStatement,
  insertPaymentDepositFileStatement,
  insertPaymentDepositNoteStatement,
  insertPaymentDepositStatement,
  insertPaymentReceiptStatement,
  readInvoice,
  readInvoiceMatterBalances,
  readOpenOperatingAccountLedgerIds,
} from "./statements.ts";
import type { BillingServiceOptions } from "./types.ts";

export const INVOICE_PAID_TOPIC = "billing.invoice.payment_recorded";

/** The most lines one deposit may carry: each is a posting and an application in one batch. */
export const MAXIMUM_LINES_PER_DEPOSIT = 60;
export const MAXIMUM_FEES_PER_DEPOSIT = 10;
const MAX_TEXT = 200;
const MAX_NOTE = 4000;

export interface DepositLineInput {
  readonly invoiceId: InvoiceId;
  readonly matterId: MatterId;
  readonly amountMinor: number;
  readonly method: PaymentMethod;
  /** A check number, a trace number, an approval code. Required except for cash and other. */
  readonly reference?: string | null;
  readonly receivedFrom: string;
  /** The civil date the firm received this item. What the client owes comes down on this date. */
  readonly receivedOn: string;
  readonly memo?: string | null;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly note?: string | null;
}

export interface DepositFeeInput {
  readonly description: string;
  readonly amountMinor: number;
}

export interface RecordPaymentDepositInput {
  /** The operating bank account's own cash leaf in the ledger. */
  readonly depositToAccountId: LedgerAccountId;
  /** The civil date the money went into the bank. */
  readonly depositedOn: string;
  readonly slipNumber?: string | null;
  readonly lines: readonly DepositLineInput[];
  readonly fees?: readonly DepositFeeInput[];
  readonly note?: string | null;
  readonly recordedBy: UserId | null;
}

export interface ComposedPaymentDeposit {
  readonly depositId: PaymentDepositId;
  /** One per line, in line order. */
  readonly receiptIds: readonly PaymentReceiptId[];
  readonly entryId: string;
  readonly effect: EffectWrite;
}

function trimmed(value: string | null | undefined): string | null {
  const text = value?.trim() ?? "";
  return text === "" ? null : text;
}

function refuse(message: string): never {
  throw new BillingValidationError("payment-receipt-invalid", message);
}

// A DEPOSIT OF PAYMENTS RECORDED BY HAND. The firm took a stack of items to the bank on one slip:
// checks, cash, a money order, perhaps from several clients for several matters' bills. Everything
// the books need is composed in one batch:
//
//   each line   Dr Undeposited Funds / Cr Accounts Receivable on the date it was received, and the
//               `payment` application naming that posting (through the one door value reaches a bill
//               by, under the balance row's bounds CHECK), and the receipt row saying how it arrived
//   the deposit Dr the bank account (what the bank credited) and Dr Bank Fees / Cr Undeposited Funds
//               on the date it was deposited, and the deposit row naming that posting
//
// so Undeposited Funds nets to zero for every deposit, the bank's book carries one line for the slip
// (the one line the bank statement shows), and a bill's balance comes down on the day the money came
// in. This is how QuickBooks books a deposit through Undeposited Funds.
//
// NO LINE CAN PAY MORE THAN ITS BILL STILL OWES ON THAT MATTER, summed across the deposit's lines. An
// over-payment has no home yet: a client credit exists only as the residue of a credit note. The
// bounds CHECK holds the ceiling under concurrency; the refusal here is the sentence in front of it.
//
// A TRUST DEPOSIT IS NOT THIS. Money to hold in trust goes onto the client's trust ledger through
// trust's own deposit; nothing here writes a trust statement, and the account deposited to must be a
// registered, open operating account.
export async function recordPaymentDeposit(
  database: SqlDatabase,
  input: RecordPaymentDepositInput,
  options: BillingServiceOptions,
): Promise<ComposedPaymentDeposit> {
  if (!isCivilDate(input.depositedOn)) refuse("the date deposited must be a date (YYYY-MM-DD)");
  if (input.lines.length === 0) refuse("a deposit needs at least one line");
  if (input.lines.length > MAXIMUM_LINES_PER_DEPOSIT) {
    refuse(
      `a deposit carries at most ${MAXIMUM_LINES_PER_DEPOSIT} lines; record the rest as a second deposit`,
    );
  }
  const fees = input.fees ?? [];
  if (fees.length > MAXIMUM_FEES_PER_DEPOSIT) {
    refuse(`a deposit carries at most ${MAXIMUM_FEES_PER_DEPOSIT} bank fees`);
  }
  const slipNumber = trimmed(input.slipNumber);
  if (slipNumber !== null && slipNumber.length > MAX_TEXT)
    refuse("the deposit slip number is too long");
  const depositNote = trimmed(input.note);
  if (depositNote !== null && depositNote.length > MAX_NOTE) refuse("the note is too long");

  const operatingAccounts = await readOpenOperatingAccountLedgerIds(database);
  if (!operatingAccounts.has(input.depositToAccountId)) {
    throw new BillingValidationError(
      "deposit-account-not-operating",
      `${input.depositToAccountId} is not an open operating bank account: a payment is deposited into one of the firm's own operating accounts, and money to hold in trust is a trust deposit`,
    );
  }

  // Each line checked on its own, then the bills read once each.
  interface CheckedLine {
    readonly number: number;
    readonly line: DepositLineInput;
    readonly reference: string | null;
    readonly receivedFrom: string;
    readonly memo: string | null;
    readonly note: string | null;
    readonly details: string;
  }
  const checked: CheckedLine[] = input.lines.map((line, index) => {
    const number = index + 1;
    if (!Number.isInteger(line.amountMinor) || line.amountMinor <= 0) {
      refuse(`line ${number}: the amount must be more than zero`);
    }
    if (!PAYMENT_METHODS.includes(line.method)) {
      refuse(`line ${number}: ${String(line.method)} is not a way a payment is recorded by hand`);
    }
    if (!isCivilDate(line.receivedOn)) refuse(`line ${number}: the date received must be a date`);
    if (line.receivedOn > input.depositedOn) {
      refuse(
        `line ${number}: it was received on ${line.receivedOn}, after the deposit date ${input.depositedOn}`,
      );
    }
    const reference = trimmed(line.reference);
    if (reference === null && !METHODS_WITHOUT_REFERENCE.has(line.method)) {
      refuse(`line ${number}: the reference number is required for this method`);
    }
    if (reference !== null && reference.length > MAX_TEXT)
      refuse(`line ${number}: the reference is too long`);
    const receivedFrom = trimmed(line.receivedFrom);
    if (receivedFrom === null) refuse(`line ${number}: say who it was received from`);
    if (receivedFrom.length > MAX_TEXT) refuse(`line ${number}: the name it came from is too long`);
    const memo = trimmed(line.memo);
    if (memo !== null && memo.length > MAX_TEXT) refuse(`line ${number}: the memo is too long`);
    const note = trimmed(line.note);
    if (note !== null && note.length > MAX_NOTE) refuse(`line ${number}: the note is too long`);
    const details = checkPaymentDetails(number, line.method, line.amountMinor, line.details ?? {});
    return { number, line, reference, receivedFrom, memo, note, details: JSON.stringify(details) };
  });
  fees.forEach((fee, index) => {
    if (!Number.isInteger(fee.amountMinor) || fee.amountMinor <= 0) {
      refuse(`bank fee ${index + 1}: the amount must be more than zero`);
    }
    const description = trimmed(fee.description);
    if (description === null) refuse(`bank fee ${index + 1}: say what the fee was`);
    if (description.length > MAX_TEXT) refuse(`bank fee ${index + 1}: the description is too long`);
  });

  const invoices = new Map<InvoiceId, NonNullable<Awaited<ReturnType<typeof readInvoice>>>>();
  const owedByShare = new Map<string, number>();
  const paidByShare = new Map<string, number>();
  let currency: string | null = null;
  for (const { number, line } of checked) {
    let invoice = invoices.get(line.invoiceId);
    if (!invoice) {
      invoice = await readInvoice(database, line.invoiceId);
      if (!invoice) {
        throw new BillingValidationError(
          "unknown-invoice",
          `line ${number}: no such bill: ${line.invoiceId}`,
        );
      }
      if (invoice.status !== "final") {
        throw new BillingValidationError(
          "invoice-not-final",
          `line ${number}: bill ${line.invoiceId} is ${invoice.status}, and a payment is recorded against a bill that was issued`,
        );
      }
      invoices.set(line.invoiceId, invoice);
      for (const balance of await readInvoiceMatterBalances(database, line.invoiceId)) {
        owedByShare.set(
          `${line.invoiceId}|${balance.matterId}`,
          differenceMinor(balance.totalMinor, balance.appliedMinor, invoice.currency),
        );
      }
    }
    currency ??= invoice.currency;
    if (invoice.currency !== currency) {
      refuse(`line ${number}: every line of one deposit is in one currency`);
    }
    const share = `${line.invoiceId}|${line.matterId}`;
    if (!owedByShare.has(share)) {
      throw new BillingValidationError(
        "credit-note-matter-not-billed",
        `line ${number}: bill ${invoice.invoiceNumber ?? line.invoiceId} does not bill matter ${line.matterId}`,
      );
    }
    paidByShare.set(
      share,
      aggregateMinor([paidByShare.get(share) ?? 0, line.amountMinor], invoice.currency),
    );
    if ((paidByShare.get(share) ?? 0) > (owedByShare.get(share) ?? 0)) {
      throw new BillingValidationError(
        "payment-exceeds-unpaid-balance",
        `line ${number}: bill ${invoice.invoiceNumber ?? line.invoiceId} still owes ${owedByShare.get(share)} on matter ${line.matterId} and this deposit pays ${paidByShare.get(share)} toward it: record what the bill is owed, and return or credit the rest`,
      );
    }
  }
  const currencyCode = currency as string;
  const currencyValue = currencyFromCode(currencyCode);
  const paymentsMinor = aggregateMinor(
    checked.map(({ line }) => line.amountMinor),
    currencyCode,
  );
  const feesMinor = aggregateMinor(
    fees.map((fee) => fee.amountMinor),
    currencyCode,
  );
  if (feesMinor >= paymentsMinor) {
    refuse("the bank fees are as much as the payments: a deposit puts money into the bank");
  }

  const roleMap = await readAccountRoleMap(database);
  const undepositedFunds = resolveAccountRole(roleMap, "undeposited_funds");
  const accountsReceivable = resolveAccountRole(roleMap, "accounts_receivable");
  const bankFees = feesMinor > 0 ? resolveAccountRole(roleMap, "bank_fees") : null;

  const depositId = newIdentifier("paymentDeposit", options.randomSource) as PaymentDepositId;
  const now = options.clock.now();
  const statements: EffectWrite["statements"][number][] = [];
  const outboxMessages: EffectWrite["outboxMessages"][number][] = [];

  // The deposit's own posting first: the receipts and notes below name the deposit row.
  const depositPosting = await postEntry(
    database,
    {
      description: slipNumber ? `Deposit, slip ${slipNumber}` : "Deposit",
      effectiveDate: input.depositedOn,
      lines: [
        {
          accountId: input.depositToAccountId,
          direction: "debit" as const,
          amount: money(differenceMinor(paymentsMinor, feesMinor, currencyCode), currencyValue),
        },
        ...(bankFees === null
          ? []
          : [
              {
                accountId: bankFees,
                direction: "debit" as const,
                amount: money(feesMinor, currencyValue),
              },
            ]),
        {
          accountId: undepositedFunds,
          direction: "credit" as const,
          amount: money(paymentsMinor, currencyValue),
        },
      ],
    },
    options,
  );
  statements.push(...depositPosting.effect.statements);
  outboxMessages.push(...depositPosting.effect.outboxMessages);
  statements.push(
    insertPaymentDepositStatement(database, {
      id: depositId,
      depositToAccountId: input.depositToAccountId,
      depositedOn: input.depositedOn,
      slipNumber,
      currency: currencyCode,
      entryId: depositPosting.entryId,
      recordedBy: input.recordedBy,
      now,
    }),
  );
  fees.forEach((fee, index) => {
    statements.push(
      insertPaymentDepositFeeStatement(database, {
        id: newIdentifier("paymentDepositFee", options.randomSource) as PaymentDepositFeeId,
        depositId,
        lineNumber: index + 1,
        description: trimmed(fee.description) as string,
        amountMinor: fee.amountMinor,
      }),
    );
  });
  if (depositNote !== null) {
    statements.push(
      insertPaymentDepositNoteStatement(database, {
        id: newIdentifier("paymentDepositNote", options.randomSource) as PaymentDepositNoteId,
        depositId,
        receiptId: null,
        body: depositNote,
        writtenBy: input.recordedBy,
        now,
      }),
    );
  }

  const receiptIds: PaymentReceiptId[] = [];
  for (const entry of checked) {
    const { line } = entry;
    const invoice = invoices.get(line.invoiceId)!;
    const label = invoice.invoiceNumber ?? line.invoiceId;
    const posting = await postEntry(
      database,
      {
        description: `Payment received, bill ${label}`,
        effectiveDate: line.receivedOn,
        lines: [
          {
            accountId: undepositedFunds,
            direction: "debit" as const,
            amount: money(line.amountMinor, currencyValue),
          },
          {
            accountId: accountsReceivable,
            direction: "credit" as const,
            amount: money(line.amountMinor, currencyValue),
          },
        ],
      },
      options,
    );
    const application = composeInvoiceApplication(
      database,
      {
        invoiceId: line.invoiceId,
        matterId: line.matterId,
        kind: "payment",
        amountMinor: line.amountMinor,
        currency: invoice.currency,
        effectiveDate: line.receivedOn,
        invoiceIssueDate: issueDateOfFinalizedInvoice(invoice),
        entryId: posting.entryId,
        appliedBy: input.recordedBy,
      },
      options,
    );
    const receiptId = newIdentifier("paymentReceipt", options.randomSource) as PaymentReceiptId;
    receiptIds.push(receiptId);
    statements.push(
      ...posting.effect.statements,
      ...application.effect.statements,
      insertPaymentReceiptStatement(database, {
        id: receiptId,
        depositId,
        lineNumber: entry.number,
        applicationId: application.applicationId,
        method: line.method,
        reference: entry.reference,
        receivedFrom: entry.receivedFrom,
        memo: entry.memo,
        details: entry.details,
        recordedBy: input.recordedBy,
        now,
      }),
    );
    if (entry.note !== null) {
      statements.push(
        insertPaymentDepositNoteStatement(database, {
          id: newIdentifier("paymentDepositNote", options.randomSource) as PaymentDepositNoteId,
          depositId,
          receiptId,
          body: entry.note,
          writtenBy: input.recordedBy,
          now,
        }),
      );
    }
    // Identifiers, the amount and the method: never the reference or who paid, which are the
    // client's own facts and would fan out to every subscriber's notification record.
    outboxMessages.push(...posting.effect.outboxMessages, ...application.effect.outboxMessages, {
      topic: INVOICE_PAID_TOPIC,
      payload: {
        invoiceId: line.invoiceId,
        matterId: line.matterId,
        amountMinor: line.amountMinor,
        currency: invoice.currency,
        method: line.method,
      },
      aggregateKey: BILLING_AGGREGATE_KEY,
    });
  }

  return {
    depositId,
    receiptIds,
    entryId: depositPosting.entryId,
    effect: { statements, outboxMessages },
  };
}

export interface AddDepositNoteInput {
  readonly depositId: PaymentDepositId;
  readonly receiptId: PaymentReceiptId | null;
  readonly body: string;
  readonly writtenBy: UserId | null;
}

/** A note added to a recorded deposit or one of its lines. Notes are never edited or removed. */
export function composeDepositNote(
  database: SqlDatabase,
  input: AddDepositNoteInput,
  options: BillingServiceOptions,
): { readonly noteId: PaymentDepositNoteId; readonly effect: EffectWrite } {
  const body = trimmed(input.body);
  if (body === null) refuse("a note needs some text");
  if (body.length > MAX_NOTE) refuse("the note is too long");
  const noteId = newIdentifier("paymentDepositNote", options.randomSource) as PaymentDepositNoteId;
  return {
    noteId,
    effect: {
      statements: [
        insertPaymentDepositNoteStatement(database, {
          id: noteId,
          depositId: input.depositId,
          receiptId: input.receiptId,
          body,
          writtenBy: input.writtenBy,
          now: options.clock.now(),
        }),
      ],
      outboxMessages: [],
    },
  };
}

export interface AttachDepositFileInput {
  readonly depositId: PaymentDepositId;
  readonly receiptId: PaymentReceiptId | null;
  readonly kind: "scan" | "file";
  readonly name: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly objectKey: string;
  readonly sha256: string;
  readonly recordedBy: UserId | null;
}

/** A file kept with a deposit or one of its lines. The caller has put the bytes in the bucket. */
export function composeDepositFile(
  database: SqlDatabase,
  input: AttachDepositFileInput,
  options: BillingServiceOptions,
): { readonly fileId: PaymentDepositFileId; readonly effect: EffectWrite } {
  const name = trimmed(input.name);
  if (name === null) refuse("a file needs a name");
  const fileId = newIdentifier("paymentDepositFile", options.randomSource) as PaymentDepositFileId;
  return {
    fileId,
    effect: {
      statements: [
        insertPaymentDepositFileStatement(database, {
          id: fileId,
          depositId: input.depositId,
          receiptId: input.receiptId,
          kind: input.kind,
          name: name.slice(0, MAX_TEXT),
          contentType: input.contentType,
          sizeBytes: input.sizeBytes,
          objectKey: input.objectKey,
          sha256: input.sha256,
          removesFileId: null,
          recordedBy: input.recordedBy,
          now: options.clock.now(),
        }),
      ],
      outboxMessages: [],
    },
  };
}

/** Takes a file off a deposit: a new row naming it. The bytes stay, as payment records are kept. */
export async function composeDepositFileRemoval(
  database: SqlDatabase,
  depositId: PaymentDepositId,
  fileId: PaymentDepositFileId,
  removedBy: UserId | null,
  options: BillingServiceOptions,
): Promise<EffectWrite> {
  const file = await readPaymentDepositFile(database, depositId, fileId);
  if (!file) {
    throw new BillingValidationError(
      "unknown-deposit-file",
      `no such file on this deposit: ${fileId}`,
    );
  }
  return {
    statements: [
      insertPaymentDepositFileStatement(database, {
        id: newIdentifier("paymentDepositFile", options.randomSource) as PaymentDepositFileId,
        depositId,
        receiptId: file.receiptId,
        kind: file.kind,
        name: file.name,
        contentType: file.contentType,
        sizeBytes: file.sizeBytes,
        objectKey: file.objectKey,
        sha256: "removed",
        removesFileId: fileId,
        recordedBy: removedBy,
        now: options.clock.now(),
      }),
    ],
    outboxMessages: [],
  };
}
