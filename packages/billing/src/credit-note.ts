import type { EffectWrite, EffectStatement } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { OutboxMessage } from "@magna-carta/data-access/outbox-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  ClientCreditId,
  CreditNoteId,
  InvoiceApplicationId,
  InvoiceId,
  InvoiceLineId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import { postEntry } from "@magna-carta/ledger/post-entry";
import { reverseEntry } from "@magna-carta/ledger/reverse-entry";
import type { EntryLineInput } from "@magna-carta/ledger/types";
import { currencyFromCode, money } from "@magna-carta/money/money";
import { readAccountRoleMap, resolveAccountRole } from "./account-roles.ts";
import { composeInvoiceApplication } from "./application.ts";
import { BillingValidationError } from "./billing-validation.ts";
import { BILLING_AGGREGATE_KEY } from "./draft.ts";
import { aggregateMinor } from "./line-amounts.ts";
import {
  dischargeClientCreditStatement,
  insertClientCreditStatement,
  insertCreditNoteLineStatement,
  insertCreditNoteStatement,
  readClientCredit,
  readInvoice,
  readInvoiceApplication,
  readInvoiceLines,
  readInvoiceMatterBalances,
} from "./statements.ts";
import type { BillingServiceOptions, InvoiceLineKind } from "./types.ts";

// CORRECTIONS AFTER FINALIZATION. A finalized invoice is frozen by database trigger and there is no
// un-finalize, so nothing in this module edits one. Every correction here is a SECOND permanent
// record standing beside the first — the same discipline the ledger's reversal rule and trust's
// "a release is a new linked row" carry, applied to the bill.
//
// Four shapes, and the differences between them are real rather than cosmetic:
//
//   credit note   the firm concedes it charged something it should not have. A document with lines
//                 and a reason, posting contra-revenue, reducing what the client owes and — where
//                 the bill is already paid — opening an obligation to give money back.
//   client credit what a credit note could not reduce, because the money is already the firm's.
//                 Recorded, un-loseable, and discharged only by a deliberate act.
//   write-off     the firm gives up collecting what it is still owed. A different management fact
//                 from a credit note (the charge was right; the money is not coming) and kept
//                 distinct so gross billings, adjustments, and bad debt stay separately readable.
//   reversal      an application posted in error — value recorded against the wrong bill or the
//                 wrong matter. Not a correction to the bill at all: a correction to a movement.
//
// WHAT THIS MODULE DOES NOT DO. It never discharges a client credit by paying anybody. Two of the
// three exits a firm has — a refund out of the operating account, and a return to the client's trust
// ledger — move real money out of a firm account, and the platform records the obligation rather
// than choosing among them: they differ in what the client is owed and when, and the operating
// disbursement path they would both go through is a later financial slice. The third exit, applying
// the credit against a later bill for the same client, moves nothing and is built here.

export const INVOICE_CREDITED_TOPIC = "billing.invoice.credited";
export const CLIENT_CREDIT_OPENED_TOPIC = "billing.client_credit.opened";
export const INVOICE_WRITTEN_OFF_TOPIC = "billing.invoice.written_off";

// The kinds of application a reversal may unwind, and the two it may not.
//
// A TRUST TRANSFER IS NOT REVERSIBLE FROM HERE, and the reason is structural rather than a missing
// feature: the money moved out of a client's trust ledger on two linked entries composed by
// @magna-carta/trust, and putting it back means composing a trust entry — which this package must
// never do, and which trust offers no composer for. A transfer recorded against the wrong bill is
// answered on trust's own terms.
//
// A CREDIT NOTE IS NOT REVERSIBLE EITHER. The note is a permanent document the client may already
// have seen, and unwinding the application it produced while the document stood would leave a
// correction asserting one thing and a balance asserting another — with any client credit it opened
// orphaned beside them. A credit note issued in error is answered by a further correction.
const KINDS_A_REVERSAL_MAY_UNWIND = new Set(["payment", "client_credit", "write_off"]);

export interface CreditNoteLineInput {
  readonly matterId: MatterId;
  readonly kind: InvoiceLineKind;
  readonly description: string;
  // Positive. A credit note's direction is the document's, so its lines carry magnitude only.
  readonly amountMinor: number;
  // Which charge on the corrected bill this line credits, where the firm is crediting a specific
  // one. Optional in general and LOAD-BEARING for a fee computed from a basis: a contingency fee is
  // billed as an offset against what earlier bills already charged, so "already charged" has to mean
  // charged and not since credited, and this link is what makes that answerable.
  readonly creditsInvoiceLineId?: InvoiceLineId | null;
}

export interface IssueCreditNoteInput {
  readonly invoiceId: InvoiceId;
  readonly reason: string;
  readonly effectiveDate: string; // civil PlainDate
  readonly lines: readonly CreditNoteLineInput[];
  readonly issuedBy: UserId | null;
}

export interface CreditNoteMatterOutcome {
  readonly matterId: MatterId;
  readonly creditedMinor: number;
  // What the note actually took off the bill, capped at what that matter still owed.
  readonly appliedMinor: number;
  // What it could not, because the money has already reached the firm. This opens a client credit.
  readonly residualMinor: number;
  readonly clientCreditId: ClientCreditId | null;
}

export interface IssuedCreditNote {
  readonly creditNoteId: CreditNoteId;
  readonly entryId: string;
  readonly totalMinor: number;
  readonly appliedMinor: number;
  readonly clientCreditMinor: number;
  readonly matters: readonly CreditNoteMatterOutcome[];
  readonly effect: EffectWrite;
}

function requirePositiveWholeMinor(amountMinor: number, subject: string): void {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new BillingValidationError(
      "credit-note-invalid",
      `${subject} of ${amountMinor} is not a positive whole number of minor units: a correction's direction is the record it is, never the sign of its amount`,
    );
  }
}

async function requireFinalizedInvoice(database: SqlDatabase, invoiceId: InvoiceId) {
  const invoice = await readInvoice(database, invoiceId);
  if (!invoice) {
    throw new BillingValidationError("unknown-invoice", `no such invoice: ${invoiceId}`);
  }
  if (invoice.status !== "final") {
    throw new BillingValidationError(
      "invoice-not-final",
      `invoice ${invoiceId} is ${invoice.status}: a correction stands beside a bill that was issued, and a ${invoice.status} invoice was never issued — edit the draft instead`,
    );
  }
  return invoice;
}

// The unpaid remainder per matter, read before the batch so a refusal is a sentence. It is NOT the
// guarantee: the bounds CHECK on invoice_matter_balance is, and a concurrent payment or transfer
// that consumed the balance between this read and the commit aborts the whole batch — posting
// included — rather than over-applying.
async function readUnpaidByMatter(
  database: SqlDatabase,
  invoiceId: InvoiceId,
): Promise<Map<string, number>> {
  const balances = await readInvoiceMatterBalances(database, invoiceId);
  return new Map(
    balances.map((balance) => [balance.matterId, balance.totalMinor - balance.appliedMinor]),
  );
}

// What earlier notes have already credited against one charge on a bill.
async function readCreditedAgainstInvoiceLineMinor(
  database: SqlDatabase,
  invoiceLineId: InvoiceLineId,
): Promise<number> {
  const { results } = await database
    .prepare(
      `SELECT COALESCE(SUM(amount_minor), 0) AS amount_minor
         FROM credit_note_line WHERE credits_invoice_line_id = ?1`,
    )
    .bind(invoiceLineId)
    .all<{ amount_minor: number }>();
  return results[0]?.amount_minor ?? 0;
}

// THE CREDIT NOTE. Its lines say what is being credited and on which matter; its application says
// how much of that the bill could absorb; and the difference is money the firm is holding that it
// has conceded is not its own.
//
// The split is forced by the balance CHECK and is the right answer independently of it. Reducing a
// matter's `total_minor` below what has already been applied to it would be a negative unpaid
// receivable, which is not a thing a receivable can be — and in the ordinary case the money in
// question has already left the client's trust ledger and become the firm's, so un-writing it is not
// a correction to an invoice at all. It is a decision about firm funds, and the platform records the
// obligation rather than making it.
export async function issueCreditNote(
  database: SqlDatabase,
  input: IssueCreditNoteInput,
  options: BillingServiceOptions,
): Promise<IssuedCreditNote> {
  if (input.reason.trim().length === 0) {
    throw new BillingValidationError(
      "credit-note-invalid",
      "a credit note states why the bill was wrong: it is read years later by somebody reconstructing a fee dispute",
    );
  }
  if (input.lines.length === 0) {
    throw new BillingValidationError(
      "credit-note-invalid",
      "a credit note with no lines credits nothing: say what is being taken off the bill",
    );
  }

  const invoice = await requireFinalizedInvoice(database, input.invoiceId);
  const currency = invoice.currency;
  const unpaidByMatter = await readUnpaidByMatter(database, input.invoiceId);
  const invoiceLines = await readInvoiceLines(database, input.invoiceId);
  const invoiceLineById = new Map(invoiceLines.map((line) => [line.id, line]));

  const creditedByMatter = new Map<MatterId, number[]>();
  const attributed = new Map<InvoiceLineId, number>();
  for (const line of input.lines) {
    requirePositiveWholeMinor(line.amountMinor, "a credit note line");
    if (line.description.trim().length === 0) {
      throw new BillingValidationError(
        "credit-note-invalid",
        "every credit note line says what it credits: the client reads this one, not the reason on the note",
      );
    }
    if (!unpaidByMatter.has(line.matterId)) {
      throw new BillingValidationError(
        "credit-note-matter-not-billed",
        `invoice ${input.invoiceId} does not bill matter ${line.matterId}, so there is nothing on it to credit: a correction lands on the balance of a matter the bill actually charged`,
      );
    }
    if (line.creditsInvoiceLineId) {
      const credited = invoiceLineById.get(line.creditsInvoiceLineId);
      if (!credited || credited.matterId !== line.matterId) {
        throw new BillingValidationError(
          "credit-note-invalid",
          `line ${line.creditsInvoiceLineId} is not a charge on invoice ${input.invoiceId} for matter ${line.matterId}: a credit is attributed to a charge on the bill it corrects, on the same matter, or to no charge at all`,
        );
      }
      if (credited.amountMinor <= 0) {
        throw new BillingValidationError(
          "credit-note-invalid",
          `line ${line.creditsInvoiceLineId} charges ${credited.amountMinor}, so there is nothing on it to credit: a discount or a write-down on the bill already reduced what the client owes`,
        );
      }
      attributed.set(
        line.creditsInvoiceLineId,
        (attributed.get(line.creditsInvoiceLineId) ?? 0) + line.amountMinor,
      );
    }
    const bucket = creditedByMatter.get(line.matterId) ?? [];
    bucket.push(line.amountMinor);
    creditedByMatter.set(line.matterId, bucket);
  }

  // A CHARGE CANNOT BE CREDITED FOR MORE THAN IT CHARGED, counting what earlier notes already
  // credited against it. This is a guard on the ATTRIBUTION rather than on the note: a note as a
  // whole may exceed the bill (the excess opens a client credit), but an attributed credit is a
  // statement about one line, and letting it run past that line's amount would drive
  // "already charged, net of credits" NEGATIVE — which for a fee derived from a basis would make
  // the next bill charge more than the entitlement, the exact failure the attribution exists to
  // prevent. A firm giving back more than it charged for a piece of work is doing something else
  // and should say so on a line of its own.
  for (const [invoiceLineId, attributedMinor] of attributed) {
    const charged = invoiceLineById.get(invoiceLineId)?.amountMinor ?? 0;
    const alreadyCreditedMinor = await readCreditedAgainstInvoiceLineMinor(database, invoiceLineId);
    if (alreadyCreditedMinor + attributedMinor > charged) {
      throw new BillingValidationError(
        "credit-note-invalid",
        `line ${invoiceLineId} charged ${charged} and credits already attributed to it total ${alreadyCreditedMinor}; this note adds ${attributedMinor}, which is more than the charge: credit the balance of the bill on an unattributed line instead`,
      );
    }
  }

  // Per matter: what the bill can still absorb, and what it cannot. Both figures are differences of
  // integers already at minor-unit scale — there is no rounding boundary anywhere on this path, and
  // introducing one would be inventing a decision nobody made.
  const matters: CreditNoteMatterOutcome[] = [];
  for (const [matterId, amounts] of creditedByMatter) {
    const creditedMinor = aggregateMinor(amounts, currency);
    const unpaidMinor = unpaidByMatter.get(matterId) ?? 0;
    const appliedMinor = Math.min(creditedMinor, unpaidMinor);
    matters.push({
      matterId,
      creditedMinor,
      appliedMinor,
      residualMinor: creditedMinor - appliedMinor,
      clientCreditId: null,
    });
  }
  const totalMinor = aggregateMinor(
    matters.map((matter) => matter.creditedMinor),
    currency,
  );
  const appliedTotalMinor = aggregateMinor(
    matters.map((matter) => matter.appliedMinor),
    currency,
  );
  const residualTotalMinor = totalMinor - appliedTotalMinor;

  // THE POSTING. Contra-revenue is debited by the whole correction; the part the bill absorbs
  // credits the receivable, and the part it cannot credits the client-credit liability. Contra
  // revenue rather than a debit straight to fee income, so gross billings and the adjustments
  // against them stay separately readable on the firm's own books.
  const roleMap = await readAccountRoleMap(database);
  const currencyValue = currencyFromCode(currency);
  const postingLines: EntryLineInput[] = [
    {
      accountId: resolveAccountRole(roleMap, "fee_adjustments"),
      direction: "debit" as const,
      amount: money(totalMinor, currencyValue),
    },
  ];
  if (appliedTotalMinor > 0) {
    postingLines.push({
      accountId: resolveAccountRole(roleMap, "accounts_receivable"),
      direction: "credit" as const,
      amount: money(appliedTotalMinor, currencyValue),
    });
  }
  if (residualTotalMinor > 0) {
    postingLines.push({
      accountId: resolveAccountRole(roleMap, "client_credit_liability"),
      direction: "credit" as const,
      amount: money(residualTotalMinor, currencyValue),
    });
  }
  const posting = await postEntry(
    database,
    {
      description: `Credit note — ${invoice.invoiceNumber ?? input.invoiceId}`,
      effectiveDate: input.effectiveDate,
      lines: postingLines,
    },
    options,
  );

  const now = options.clock.now();
  const creditNoteId = newIdentifier("creditNote", options.randomSource);
  // The ledger statements lead, because the note's `entry_id` references the entry they create.
  const statements: EffectStatement[] = [...posting.effect.statements];
  statements.push(
    insertCreditNoteStatement(database, {
      id: creditNoteId,
      invoiceId: input.invoiceId,
      currency,
      reason: input.reason,
      effectiveDate: input.effectiveDate,
      entryId: posting.entryId,
      issuedBy: input.issuedBy,
      now,
    }),
  );
  input.lines.forEach((line, lineIndex) => {
    statements.push(
      insertCreditNoteLineStatement(database, {
        id: newIdentifier("creditNoteLine", options.randomSource),
        creditNoteId,
        lineIndex,
        matterId: line.matterId,
        kind: line.kind,
        description: line.description,
        amountMinor: line.amountMinor,
        currency,
        creditsInvoiceLineId: line.creditsInvoiceLineId ?? null,
        now,
      }),
    );
  });

  const outboxMessages: OutboxMessage[] = [...posting.effect.outboxMessages];
  const outcomes: CreditNoteMatterOutcome[] = [];
  for (const matter of matters) {
    let clientCreditId: ClientCreditId | null = null;
    if (matter.residualMinor > 0) {
      clientCreditId = newIdentifier("clientCredit", options.randomSource);
      statements.push(
        insertClientCreditStatement(database, {
          id: clientCreditId,
          clientEntityId: invoice.clientEntityId,
          matterId: matter.matterId,
          creditNoteId,
          amountMinor: matter.residualMinor,
          currency,
          openedBy: input.issuedBy,
          now,
        }),
      );
      outboxMessages.push({
        topic: CLIENT_CREDIT_OPENED_TOPIC,
        payload: {
          clientCreditId,
          creditNoteId,
          invoiceId: input.invoiceId,
          matterId: matter.matterId,
          clientEntityId: invoice.clientEntityId,
          amountMinor: matter.residualMinor,
          currency,
        },
        aggregateKey: BILLING_AGGREGATE_KEY,
      });
    }
    if (matter.appliedMinor > 0) {
      // Through the one door, exactly as a trust transfer is. The note carries the posting for every
      // matter it reaches, so no entry is named here — the pairing trigger holds that shape.
      const application = composeInvoiceApplication(
        database,
        {
          invoiceId: input.invoiceId,
          matterId: matter.matterId,
          kind: "credit_note",
          amountMinor: matter.appliedMinor,
          currency,
          effectiveDate: input.effectiveDate,
          creditNoteId,
          appliedBy: input.issuedBy,
        },
        options,
      );
      statements.push(...application.effect.statements);
      outboxMessages.push(...application.effect.outboxMessages);
    }
    outcomes.push({ ...matter, clientCreditId });
  }

  outboxMessages.push({
    topic: INVOICE_CREDITED_TOPIC,
    payload: {
      creditNoteId,
      invoiceId: input.invoiceId,
      clientEntityId: invoice.clientEntityId,
      totalMinor,
      appliedMinor: appliedTotalMinor,
      clientCreditMinor: residualTotalMinor,
      currency,
    },
    aggregateKey: BILLING_AGGREGATE_KEY,
  });

  return {
    creditNoteId,
    entryId: posting.entryId,
    totalMinor,
    appliedMinor: appliedTotalMinor,
    clientCreditMinor: residualTotalMinor,
    matters: outcomes,
    effect: { statements, outboxMessages },
  };
}

export interface WriteOffInput {
  readonly invoiceId: InvoiceId;
  readonly matterId: MatterId;
  readonly amountMinor: number;
  readonly reason: string;
  readonly effectiveDate: string;
  readonly writtenOffBy: UserId | null;
}

export interface ComposedWriteOff {
  readonly applicationId: InvoiceApplicationId;
  readonly entryId: string;
  readonly effect: EffectWrite;
}

// THE WRITE-OFF. The charge was right and the money is not coming: an uncollectable receivable, a
// courtesy the firm decided not to chase, a balance too small to bill for. It is a different
// management fact from a credit note — the firm is not conceding it over-charged — and it posts
// against its own account so bad debt never hides inside adjustments.
//
// A WRITE-OFF CANNOT EXCEED WHAT IS STILL OWED. There is nothing beyond the unpaid balance to give
// up: money already collected is not written off, it is refunded or credited, which is a different
// record with a different meaning. The bounds CHECK is what actually holds the ceiling under
// concurrency; the refusal here is the sentence in front of it.
export async function composeInvoiceWriteOff(
  database: SqlDatabase,
  input: WriteOffInput,
  options: BillingServiceOptions,
): Promise<ComposedWriteOff> {
  requirePositiveWholeMinor(input.amountMinor, "a write-off");
  if (input.reason.trim().length === 0) {
    throw new BillingValidationError(
      "write-off-invalid",
      "a write-off states why the firm gave up the receivable: an unexplained one is indistinguishable from a mistake",
    );
  }
  const invoice = await requireFinalizedInvoice(database, input.invoiceId);
  const unpaidByMatter = await readUnpaidByMatter(database, input.invoiceId);
  const unpaidMinor = unpaidByMatter.get(input.matterId);
  if (unpaidMinor === undefined) {
    throw new BillingValidationError(
      "credit-note-matter-not-billed",
      `invoice ${input.invoiceId} does not bill matter ${input.matterId}, so it carries no balance on that matter to write off`,
    );
  }
  if (input.amountMinor > unpaidMinor) {
    throw new BillingValidationError(
      "write-off-exceeds-unpaid-balance",
      `matter ${input.matterId} still owes ${unpaidMinor} on invoice ${input.invoiceId} and this writes off ${input.amountMinor}: a write-off gives up a receivable, and money already collected is refunded or credited instead`,
    );
  }

  const roleMap = await readAccountRoleMap(database);
  const currencyValue = currencyFromCode(invoice.currency);
  const posting = await postEntry(
    database,
    {
      description: `Write-off — ${invoice.invoiceNumber ?? input.invoiceId}`,
      effectiveDate: input.effectiveDate,
      lines: [
        {
          accountId: resolveAccountRole(roleMap, "fee_write_off"),
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
      kind: "write_off",
      amountMinor: input.amountMinor,
      currency: invoice.currency,
      effectiveDate: input.effectiveDate,
      entryId: posting.entryId,
      reason: input.reason,
      appliedBy: input.writtenOffBy,
    },
    options,
  );

  return {
    applicationId: application.applicationId,
    entryId: posting.entryId,
    effect: {
      statements: [...posting.effect.statements, ...application.effect.statements],
      outboxMessages: [
        ...posting.effect.outboxMessages,
        ...application.effect.outboxMessages,
        {
          topic: INVOICE_WRITTEN_OFF_TOPIC,
          payload: {
            invoiceId: input.invoiceId,
            matterId: input.matterId,
            amountMinor: input.amountMinor,
            currency: invoice.currency,
          },
          aggregateKey: BILLING_AGGREGATE_KEY,
        },
      ],
    },
  };
}

export interface ApplyClientCreditInput {
  readonly clientCreditId: ClientCreditId;
  readonly invoiceId: InvoiceId;
  readonly matterId: MatterId;
  readonly amountMinor: number;
  readonly effectiveDate: string;
  readonly appliedBy: UserId | null;
}

export interface AppliedClientCredit {
  readonly applicationId: InvoiceApplicationId;
  readonly entryId: string;
  readonly remainingMinor: number;
  readonly effect: EffectWrite;
}

// DISCHARGING A CLIENT CREDIT AGAINST A LATER BILL — the one of the three exits that moves no money.
// The firm owes the client an amount and the client owes the firm a later bill; setting one against
// the other discharges the obligation without a payment in either direction, and the posting says
// exactly that: the liability comes down, the receivable comes down.
//
// It may land on ANY matter of the same client. The credit arose on one matter because the bill that
// created it did, but what the firm owes it owes to the client — and refusing to set it against
// another of that client's bills would leave a firm holding money it has conceded is not its own
// with one fewer lawful way to give it back.
export async function applyClientCreditToInvoice(
  database: SqlDatabase,
  input: ApplyClientCreditInput,
  options: BillingServiceOptions,
): Promise<AppliedClientCredit> {
  requirePositiveWholeMinor(input.amountMinor, "a client-credit application");
  const credit = await readClientCredit(database, input.clientCreditId);
  if (!credit) {
    throw new BillingValidationError(
      "unknown-client-credit",
      `no such client credit: ${input.clientCreditId}`,
    );
  }
  if (input.amountMinor > credit.remainingMinor) {
    throw new BillingValidationError(
      "client-credit-exhausted",
      `client credit ${input.clientCreditId} has ${credit.remainingMinor} left and this applies ${input.amountMinor}: a credit cannot be given back twice`,
    );
  }
  const invoice = await requireFinalizedInvoice(database, input.invoiceId);
  if (invoice.clientEntityId !== credit.clientEntityId) {
    throw new BillingValidationError(
      "client-credit-client-mismatch",
      `client credit ${input.clientCreditId} belongs to ${credit.clientEntityId} and invoice ${input.invoiceId} bills ${invoice.clientEntityId}: money the firm owes one client is never set against another client's bill`,
    );
  }
  if (invoice.currency !== credit.currency) {
    throw new BillingValidationError(
      "application-currency-mismatch",
      `client credit ${input.clientCreditId} is held in ${credit.currency} and invoice ${input.invoiceId} bills in ${invoice.currency}: setting one against the other would invent an exchange rate nobody approved`,
    );
  }
  const unpaidByMatter = await readUnpaidByMatter(database, input.invoiceId);
  const unpaidMinor = unpaidByMatter.get(input.matterId);
  if (unpaidMinor === undefined) {
    throw new BillingValidationError(
      "credit-note-matter-not-billed",
      `invoice ${input.invoiceId} does not bill matter ${input.matterId}, so it carries no balance on that matter to set the credit against`,
    );
  }
  if (input.amountMinor > unpaidMinor) {
    throw new BillingValidationError(
      "earned-fee-exceeds-unpaid-balance",
      `matter ${input.matterId} still owes ${unpaidMinor} on invoice ${input.invoiceId} and this applies ${input.amountMinor}: apply the remainder to another of this client's bills, or leave it open`,
    );
  }

  const roleMap = await readAccountRoleMap(database);
  const currencyValue = currencyFromCode(invoice.currency);
  const posting = await postEntry(
    database,
    {
      description: `Client credit applied — ${invoice.invoiceNumber ?? input.invoiceId}`,
      effectiveDate: input.effectiveDate,
      lines: [
        {
          accountId: resolveAccountRole(roleMap, "client_credit_liability"),
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
      kind: "client_credit",
      amountMinor: input.amountMinor,
      currency: invoice.currency,
      effectiveDate: input.effectiveDate,
      clientCreditId: input.clientCreditId,
      entryId: posting.entryId,
      appliedBy: input.appliedBy,
    },
    options,
  );

  return {
    applicationId: application.applicationId,
    entryId: posting.entryId,
    remainingMinor: credit.remainingMinor - input.amountMinor,
    effect: {
      statements: [
        ...posting.effect.statements,
        ...application.effect.statements,
        dischargeClientCreditStatement(
          database,
          input.clientCreditId,
          input.amountMinor,
          options.clock.now(),
        ),
      ],
      outboxMessages: [...posting.effect.outboxMessages, ...application.effect.outboxMessages],
    },
  };
}

export interface ReverseApplicationInput {
  readonly applicationId: InvoiceApplicationId;
  readonly reason: string;
  readonly effectiveDate: string;
  readonly reversedBy: UserId | null;
}

export interface ComposedApplicationReversal {
  readonly applicationId: InvoiceApplicationId;
  readonly reversesApplicationId: InvoiceApplicationId;
  readonly entryId: string;
  readonly effect: EffectWrite;
}

// THE REVERSAL. Not a correction to a bill — a correction to a MOVEMENT: value recorded against the
// wrong invoice or the wrong matter. The row carries a positive amount and subtracts because it is a
// reversal, the ledger's own rule applied to the subledger, and its UNIQUE link to what it reverses
// makes a double reversal structurally impossible.
export async function composeApplicationReversal(
  database: SqlDatabase,
  input: ReverseApplicationInput,
  options: BillingServiceOptions,
): Promise<ComposedApplicationReversal> {
  if (input.reason.trim().length === 0) {
    throw new BillingValidationError(
      "application-reversal-invalid",
      "a reversal states why the application was wrong: it moves a balance whose money has already moved",
    );
  }
  const original = await readInvoiceApplication(database, input.applicationId);
  if (!original) {
    throw new BillingValidationError(
      "unknown-invoice-application",
      `no such application: ${input.applicationId}`,
    );
  }
  if (original.kind === "reversal") {
    throw new BillingValidationError(
      "application-reversal-refused",
      `application ${input.applicationId} is itself a reversal: reversing one would re-apply value under a kind whose whole meaning is that it subtracts, so record the value again on its own terms instead`,
    );
  }
  if (!KINDS_A_REVERSAL_MAY_UNWIND.has(original.kind)) {
    throw new BillingValidationError(
      "application-reversal-refused",
      original.kind === "trust_transfer"
        ? `application ${input.applicationId} came from a transfer out of a client's trust ledger: putting that money back is a movement in the trust ledger, composed there and authorized there, and billing does not reach into it`
        : `application ${input.applicationId} came from a credit note, which is a permanent document the client may already hold: a credit note issued in error is answered by a further correction, not by unwinding what it did while it still stands`,
    );
  }
  if (!original.entryId) {
    throw new Error(
      `unreachable: ${original.kind} application ${input.applicationId} has no posting to reverse`,
    );
  }

  const reversal = await reverseEntry(
    database,
    {
      entryId: original.entryId,
      description: `Reversal — ${original.kind} on invoice ${original.invoiceId}`,
      effectiveDate: input.effectiveDate,
    },
    options,
  );

  const application = composeInvoiceApplication(
    database,
    {
      invoiceId: original.invoiceId,
      matterId: original.matterId,
      kind: "reversal",
      amountMinor: original.amountMinor,
      currency: original.currency,
      effectiveDate: input.effectiveDate,
      reversesApplicationId: original.id,
      entryId: reversal.entryId,
      reason: input.reason,
      appliedBy: input.reversedBy,
    },
    options,
  );

  const statements: EffectStatement[] = [
    ...reversal.effect.statements,
    ...application.effect.statements,
  ];
  // Unwinding a discharge gives the credit back. Without this the client credit would stay recorded
  // as given back while the bill it was set against once again owes the money — the firm holding the
  // client's money twice over, with nothing saying so.
  if (original.kind === "client_credit" && original.clientCreditId) {
    statements.push(
      dischargeClientCreditStatement(
        database,
        original.clientCreditId,
        -original.amountMinor,
        options.clock.now(),
      ),
    );
  }

  return {
    applicationId: application.applicationId,
    reversesApplicationId: original.id,
    entryId: reversal.entryId,
    effect: {
      statements,
      outboxMessages: [...reversal.effect.outboxMessages, ...application.effect.outboxMessages],
    },
  };
}
