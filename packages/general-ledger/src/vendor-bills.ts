import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { OutboxMessage } from "@magna-carta/data-access/outbox-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  CostEntryId,
  LedgerAccountId,
  LedgerEntryId,
  OperatingBankAccountId,
  VendorBillId,
  VendorBillPaymentId,
} from "@magna-carta/identifiers/types";
import { isCivilDate } from "@magna-carta/civil-time/civil-date";
import { captureCost, voidCost } from "@magna-carta/costs/cost-entry-service";
import { loadAccountSnapshots, postEntry } from "@magna-carta/ledger/post-entry";
import { reverseEntry } from "@magna-carta/ledger/reverse-entry";
import type { EntryLineInput } from "@magna-carta/ledger/types";
import { money, USD } from "@magna-carta/money/money";
import { readAccountRoleMap } from "@magna-carta/account-roles/account-roles";
import { GeneralLedgerValidationError } from "./general-ledger-validation.ts";
import { resolvePayingAccount } from "./operating-accounts.ts";
import { resolveRequiredRole } from "./role-configuration.ts";
import { readTrustRegistrations } from "./trust-refusal.ts";
import type { GeneralLedgerServiceOptions } from "./types.ts";

// VENDOR BILLS: what the firm owes the people it buys from, and paying them.
//
// Recording a bill posts Dr <each line's account> / Cr Accounts Payable in one entry. A line on a
// matter is a real cost on that matter: it creates the matter's cost entry, already approved,
// which the matter's next draft invoice picks up. A hard cost (money the firm fronted for the
// client) debits Client Costs Advanced, so the asset clears when the client pays it back; a soft
// cost, or a line with no matter, is the firm's own expense and debits the line's expense account.
//
// Paying posts Dr Accounts Payable / Cr the operating account paid from, one entry per bill so each
// payment row names its own entry. Any registered, open operating account may pay; trust never.

export type VendorBillPaymentMethod = "check" | "bank_transfer" | "card" | "cash";
export const VENDOR_BILL_PAYMENT_METHODS: readonly VendorBillPaymentMethod[] = [
  "check",
  "bank_transfer",
  "card",
  "cash",
];

export interface VendorBillLineInput {
  readonly description: string;
  readonly amountMinor: number;
  // A matter line is a cost on that matter and carries its class. A line with neither is the
  // firm's own expense.
  readonly matterId?: string | null;
  readonly disbursementClass?: "hard" | "soft" | null;
  // The expense account. Required for a soft cost and a non-matter line; a hard cost always lands
  // in Client Costs Advanced and ignores it.
  readonly ledgerAccountId?: LedgerAccountId | null;
  readonly billable?: boolean;
  readonly utbmsExpenseCodeId?: string | null;
}

export interface RecordVendorBillInput {
  readonly vendorId: string;
  readonly billReference?: string | null;
  readonly billDate: string;
  readonly dueDate?: string | null;
  readonly memo?: string | null;
  readonly lines: readonly VendorBillLineInput[];
}

function assertWholePositive(amountMinor: number, what: string): void {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new GeneralLedgerValidationError(
      "payment-amount-not-positive",
      `${what} must be more than zero`,
    );
  }
}

function assertDate(value: string, what: string): void {
  if (!isCivilDate(value)) {
    throw new GeneralLedgerValidationError("date-malformed", `${what} is not a date: ${value}`);
  }
}

function costOptions(options: GeneralLedgerServiceOptions) {
  return {
    clock: options.clock,
    actorUserId: options.actorUserId,
    randomSource: options.randomSource,
  };
}

function audit(
  database: SqlDatabase,
  options: GeneralLedgerServiceOptions,
  event: string,
  subjectId: string,
): SqlStatement {
  return domainAuditStatement(database, {
    event,
    subjectId,
    actorUserId: options.actorUserId,
    clock: options.clock,
    randomSource: options.randomSource,
  });
}

// The expense accounts a bill's own lines name: each must exist, be an active leaf, be an expense,
// and never be trust's. Returns nothing; throws the first refusal.
async function refuseUnusableExpenseAccounts(
  database: SqlDatabase,
  accountIds: readonly LedgerAccountId[],
): Promise<void> {
  if (accountIds.length === 0) return;
  const unique = [...new Set(accountIds)];
  const snapshots = await loadAccountSnapshots(database, unique);
  const registrations = await readTrustRegistrations(database, unique);
  for (const accountId of unique) {
    const snapshot = snapshots.get(accountId);
    if (!snapshot) {
      throw new GeneralLedgerValidationError("unknown-account", `no such account: ${accountId}`);
    }
    if (registrations.has(accountId)) {
      throw new GeneralLedgerValidationError(
        "account-is-trust-registered",
        "a vendor bill cannot post to a trust account",
      );
    }
    if (snapshot.type !== "expense") {
      throw new GeneralLedgerValidationError(
        "vendor-bill-line-account-not-expense",
        "a vendor bill line goes to an expense account",
      );
    }
    if (snapshot.hasChildren || !snapshot.active) {
      throw new GeneralLedgerValidationError(
        "vendor-bill-line-account-not-expense",
        "a vendor bill line goes to an active expense account with no accounts under it",
      );
    }
  }
}

export interface RecordedVendorBill {
  readonly vendorBillId: VendorBillId;
  readonly entryId: LedgerEntryId;
  readonly costEntryIds: readonly CostEntryId[];
  readonly effect: EffectWrite;
}

export async function recordVendorBill(
  database: SqlDatabase,
  input: RecordVendorBillInput,
  options: GeneralLedgerServiceOptions,
): Promise<RecordedVendorBill> {
  if (input.vendorId.trim().length === 0) {
    throw new GeneralLedgerValidationError("vendor-bill-missing-vendor", "a bill needs a vendor");
  }
  assertDate(input.billDate, "the bill date");
  if (input.dueDate) {
    assertDate(input.dueDate, "the due date");
    if (input.dueDate < input.billDate) {
      throw new GeneralLedgerValidationError(
        "date-malformed",
        "the due date cannot be before the bill date",
      );
    }
  }
  if (input.lines.length === 0) {
    throw new GeneralLedgerValidationError("vendor-bill-has-no-lines", "a bill needs a line");
  }

  const roles = await readAccountRoleMap(database);
  const payableAccountId = resolveRequiredRole(roles, "accounts_payable");
  const hasHardCost = input.lines.some(
    (line) => line.matterId && line.disbursementClass === "hard",
  );
  const costsAdvancedAccountId = hasHardCost
    ? resolveRequiredRole(roles, "client_costs_advanced")
    : null;

  const expenseAccountIds: LedgerAccountId[] = [];
  const resolvedLines = input.lines.map((line, lineIndex) => {
    const description = line.description.trim();
    if (description.length === 0) {
      throw new GeneralLedgerValidationError(
        "vendor-bill-line-malformed",
        `line ${lineIndex + 1} needs a description`,
      );
    }
    assertWholePositive(line.amountMinor, `line ${lineIndex + 1}`);
    const matterId = line.matterId || null;
    const disbursementClass = matterId ? (line.disbursementClass ?? null) : null;
    if (matterId && disbursementClass === null) {
      throw new GeneralLedgerValidationError(
        "vendor-bill-line-malformed",
        `line ${lineIndex + 1} is on a matter and needs to say hard or soft cost`,
      );
    }
    if (!matterId && line.disbursementClass) {
      throw new GeneralLedgerValidationError(
        "vendor-bill-line-malformed",
        `line ${lineIndex + 1} is a hard or soft cost and needs a matter`,
      );
    }
    let ledgerAccountId: LedgerAccountId;
    if (disbursementClass === "hard") {
      ledgerAccountId = costsAdvancedAccountId as LedgerAccountId;
    } else {
      if (!line.ledgerAccountId) {
        throw new GeneralLedgerValidationError(
          "vendor-bill-line-needs-expense-account",
          `line ${lineIndex + 1} needs an expense account`,
        );
      }
      ledgerAccountId = line.ledgerAccountId;
      expenseAccountIds.push(ledgerAccountId);
    }
    return {
      lineIndex,
      description,
      amountMinor: line.amountMinor,
      matterId,
      disbursementClass,
      ledgerAccountId,
      billable: line.billable ?? true,
      utbmsExpenseCodeId: line.utbmsExpenseCodeId ?? undefined,
    };
  });
  await refuseUnusableExpenseAccounts(database, expenseAccountIds);

  const totalMinor = resolvedLines.reduce((total, line) => total + line.amountMinor, 0);
  assertWholePositive(totalMinor, "the bill total");

  const reference = input.billReference?.trim() || null;
  const entryLines: EntryLineInput[] = [
    ...resolvedLines.map((line) => ({
      accountId: line.ledgerAccountId,
      direction: "debit" as const,
      amount: money(line.amountMinor, USD),
    })),
    { accountId: payableAccountId, direction: "credit" as const, amount: money(totalMinor, USD) },
  ];
  const posted = await postEntry(
    database,
    {
      description: reference ? `Vendor bill ${reference}` : "Vendor bill",
      effectiveDate: input.billDate,
      lines: entryLines,
    },
    { clock: options.clock, randomSource: options.randomSource },
  );

  const vendorBillId = newIdentifier("vendorBill", options.randomSource);
  const now = options.clock.now();
  const costStatements: SqlStatement[] = [];
  const costOutbox: OutboxMessage[] = [];
  const costEntryIds: CostEntryId[] = [];
  const lineStatements: SqlStatement[] = [];
  for (const line of resolvedLines) {
    let costEntryId: CostEntryId | null = null;
    if (line.matterId && line.disbursementClass) {
      const captured = await captureCost(
        database,
        {
          matterId: line.matterId,
          vendorId: input.vendorId,
          incurredDate: input.billDate,
          amountMinor: line.amountMinor,
          currency: "USD",
          disbursementClass: line.disbursementClass,
          billable: line.billable,
          utbmsExpenseCodeId: line.utbmsExpenseCodeId,
          description: line.description,
          // A person entered the bill; the line below names the cost it made.
          source: "manual",
          initialStatus: "approved",
        },
        costOptions(options),
      );
      costEntryId = captured.costEntryId;
      costEntryIds.push(costEntryId);
      costStatements.push(...captured.effect.statements);
      costOutbox.push(...captured.effect.outboxMessages);
    }
    lineStatements.push(
      database
        .prepare(
          `INSERT INTO vendor_bill_line (id, vendor_bill_id, line_index, description, amount_minor, disbursement_class, matter_id, disbursement_entry_id, ledger_account_id)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
        )
        .bind(
          newIdentifier("vendorBillLine", options.randomSource),
          vendorBillId,
          line.lineIndex,
          line.description,
          line.amountMinor,
          line.disbursementClass,
          line.matterId,
          costEntryId,
          line.ledgerAccountId,
        ),
    );
  }

  return {
    vendorBillId,
    entryId: posted.entryId,
    costEntryIds,
    effect: {
      statements: [
        ...posted.effect.statements,
        ...costStatements,
        database
          .prepare(
            `INSERT INTO vendor_bill (id, vendor_id, bill_reference, bill_date, due_date, amount_minor, currency, memo, entry_id, created_by, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'USD', ?7, ?8, ?9, ?10)`,
          )
          .bind(
            vendorBillId,
            input.vendorId,
            reference,
            input.billDate,
            input.dueDate || null,
            totalMinor,
            input.memo?.trim() || null,
            posted.entryId,
            options.actorUserId,
            now,
          ),
        ...lineStatements,
        database
          .prepare(
            `INSERT INTO vendor_bill_balance (vendor_bill_id, amount_minor, paid_minor, updated_at) VALUES (?1, ?2, 0, ?3)`,
          )
          .bind(vendorBillId, totalMinor, now),
        audit(database, options, "vendor_bill.recorded", vendorBillId),
      ],
      outboxMessages: [...posted.effect.outboxMessages, ...costOutbox],
    },
  };
}

interface BillStateRow {
  id: string;
  vendor_id: string;
  amount_minor: number;
  paid_minor: number;
  reversed: number;
  bill_reference: string | null;
}

async function readBillStates(
  database: SqlDatabase,
  vendorBillIds: readonly string[],
): Promise<Map<string, BillStateRow>> {
  const states = new Map<string, BillStateRow>();
  for (let start = 0; start < vendorBillIds.length; start += 100) {
    const chunk = vendorBillIds.slice(start, start + 100);
    const placeholders = chunk.map((_, index) => `?${index + 1}`).join(", ");
    const { results } = await database
      .prepare(
        `SELECT v.id, v.vendor_id, v.bill_reference, b.amount_minor, b.paid_minor,
                EXISTS(SELECT 1 FROM vendor_bill_reversal r WHERE r.vendor_bill_id = v.id) AS reversed
           FROM vendor_bill v JOIN vendor_bill_balance b ON b.vendor_bill_id = v.id
          WHERE v.id IN (${placeholders})`,
      )
      .bind(...chunk)
      .all<BillStateRow>();
    for (const row of results) states.set(row.id, row);
  }
  return states;
}

export interface PayVendorBillsInput {
  readonly operatingBankAccountId: OperatingBankAccountId;
  readonly paidOn: string;
  readonly method: VendorBillPaymentMethod;
  readonly reference?: string | null;
  readonly payments: readonly VendorBillPaymentItem[];
}

export interface VendorBillPaymentItem {
  readonly vendorBillId: VendorBillId;
  readonly amountMinor: number;
  // One check pays one vendor, so the number travels with the bill. A check written by hand
  // carries its number; a check left blank waits to be printed.
  readonly checkNumber?: number | null;
}

function normalizeCheckNumber(
  method: VendorBillPaymentMethod,
  checkNumber: number | null | undefined,
): number | null {
  if (checkNumber === undefined || checkNumber === null) return null;
  if (method !== "check") {
    throw new GeneralLedgerValidationError(
      "check-number-malformed",
      "only a check payment carries a check number",
    );
  }
  if (!Number.isSafeInteger(checkNumber) || checkNumber <= 0) {
    throw new GeneralLedgerValidationError(
      "check-number-malformed",
      "a check number is a whole number above zero",
    );
  }
  return checkNumber;
}

export interface RecordedVendorBillPayments {
  readonly paymentIds: readonly VendorBillPaymentId[];
  readonly effect: EffectWrite;
}

// Pays several bills from one operating account in one batch, which is what Pay Selected sends.
// Each bill gets its own payment row and its own entry. The open-balance check here is the polite
// refusal; the bounds CHECK on vendor_bill_balance is what stops two racing payments overpaying.
export async function payVendorBills(
  database: SqlDatabase,
  input: PayVendorBillsInput,
  options: GeneralLedgerServiceOptions,
): Promise<RecordedVendorBillPayments> {
  assertDate(input.paidOn, "the payment date");
  if (!VENDOR_BILL_PAYMENT_METHODS.includes(input.method)) {
    throw new GeneralLedgerValidationError(
      "payment-method-malformed",
      `not a payment method: ${String(input.method)}`,
    );
  }
  if (input.payments.length === 0) {
    throw new GeneralLedgerValidationError(
      "payment-amount-not-positive",
      "pick at least one bill to pay",
    );
  }
  const paying = await resolvePayingAccount(database, input.operatingBankAccountId);
  const roles = await readAccountRoleMap(database);
  const payableAccountId = resolveRequiredRole(roles, "accounts_payable");

  // One bill appears once per batch: a second amount for the same bill is refused rather than
  // guessed at, so the open-balance check sees exactly what the batch will do.
  const amounts = new Map<string, number>();
  const checkNumbers = new Map<string, number | null>();
  for (const payment of input.payments) {
    assertWholePositive(payment.amountMinor, "a payment");
    if (amounts.has(payment.vendorBillId)) {
      throw new GeneralLedgerValidationError(
        "payment-amount-not-positive",
        "a bill is paid once in a batch",
      );
    }
    amounts.set(payment.vendorBillId, payment.amountMinor);
    checkNumbers.set(payment.vendorBillId, normalizeCheckNumber(input.method, payment.checkNumber));
  }
  const states = await readBillStates(database, [...amounts.keys()]);
  for (const [vendorBillId, amountMinor] of amounts) {
    const state = states.get(vendorBillId);
    if (!state) {
      throw new GeneralLedgerValidationError(
        "unknown-vendor-bill",
        `no such vendor bill: ${vendorBillId}`,
      );
    }
    if (state.reversed === 1) {
      throw new GeneralLedgerValidationError(
        "vendor-bill-reversed",
        "this bill was reversed and is not paid",
      );
    }
    if (amountMinor > state.amount_minor - state.paid_minor) {
      throw new GeneralLedgerValidationError(
        "payment-exceeds-open-balance",
        "a payment cannot be more than what is left to pay on the bill",
      );
    }
  }

  const now = options.clock.now();
  const reference = input.reference?.trim() || null;
  const statements: SqlStatement[] = [];
  const outboxMessages: OutboxMessage[] = [];
  const paymentIds: VendorBillPaymentId[] = [];
  for (const [vendorBillId, amountMinor] of amounts) {
    const state = states.get(vendorBillId) as BillStateRow;
    const posted = await postEntry(
      database,
      {
        description: state.bill_reference
          ? `Payment of vendor bill ${state.bill_reference}`
          : "Payment of vendor bill",
        effectiveDate: input.paidOn,
        lines: [
          { accountId: payableAccountId, direction: "debit", amount: money(amountMinor, USD) },
          { accountId: paying.ledgerAccountId, direction: "credit", amount: money(amountMinor, USD) },
        ],
      },
      { clock: options.clock, randomSource: options.randomSource },
    );
    const paymentId = newIdentifier("vendorBillPayment", options.randomSource);
    paymentIds.push(paymentId);
    statements.push(
      ...posted.effect.statements,
      database
        .prepare(
          `INSERT INTO vendor_bill_payment (id, vendor_bill_id, operating_bank_account_id, entry_id, amount_minor, paid_on, method, check_number, reference, recorded_by, recorded_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
        )
        .bind(
          paymentId,
          vendorBillId,
          input.operatingBankAccountId,
          posted.entryId,
          amountMinor,
          input.paidOn,
          input.method,
          checkNumbers.get(vendorBillId) ?? null,
          reference,
          options.actorUserId,
          now,
        ),
      // Unguarded on purpose: the bounds CHECK aborts the batch on an overpayment.
      database
        .prepare(
          `UPDATE vendor_bill_balance SET paid_minor = paid_minor + ?2, updated_at = ?3 WHERE vendor_bill_id = ?1`,
        )
        .bind(vendorBillId, amountMinor, now),
      audit(database, options, "vendor_bill.paid", paymentId),
    );
    outboxMessages.push(...posted.effect.outboxMessages);
  }
  return { paymentIds, effect: { statements, outboxMessages } };
}

export interface ReverseVendorBillInput {
  readonly vendorBillId: VendorBillId;
  readonly reason: string;
  readonly reversedOn: string;
}

interface BillCostRow {
  disbursement_entry_id: string;
  status: string;
}

// A bill entered in error. Its entry is reversed, and each matter cost it made is voided, in the
// same batch. A bill with payments is not reversed (a trigger holds that too), and neither is a
// bill whose cost has already gone out on a finalized invoice: that cost is the client's now, and
// the correction is a credit on the matter, not a vanished bill.
export async function reverseVendorBill(
  database: SqlDatabase,
  input: ReverseVendorBillInput,
  options: GeneralLedgerServiceOptions,
): Promise<EffectWrite> {
  assertDate(input.reversedOn, "the reversal date");
  const reason = input.reason.trim();
  if (reason.length === 0) {
    throw new GeneralLedgerValidationError(
      "reversal-needs-reason",
      "say why the bill is being reversed",
    );
  }
  const states = await readBillStates(database, [input.vendorBillId]);
  const state = states.get(input.vendorBillId);
  if (!state) {
    throw new GeneralLedgerValidationError(
      "unknown-vendor-bill",
      `no such vendor bill: ${input.vendorBillId}`,
    );
  }
  if (state.reversed === 1) {
    throw new GeneralLedgerValidationError(
      "vendor-bill-already-reversed",
      "this bill is already reversed",
    );
  }
  if (state.paid_minor > 0) {
    throw new GeneralLedgerValidationError(
      "vendor-bill-has-payments",
      "this bill has payments and cannot be reversed",
    );
  }
  const { results: entryRows } = await database
    .prepare(`SELECT entry_id FROM vendor_bill WHERE id = ?1`)
    .bind(input.vendorBillId)
    .all<{ entry_id: string }>();
  const entryId = entryRows[0]?.entry_id as LedgerEntryId;
  const { results: costs } = await database
    .prepare(
      `SELECT l.disbursement_entry_id, c.status
         FROM vendor_bill_line l JOIN cost_entry c ON c.id = l.disbursement_entry_id
        WHERE l.vendor_bill_id = ?1`,
    )
    .bind(input.vendorBillId)
    .all<BillCostRow>();
  if (costs.some((cost) => cost.status === "billed")) {
    throw new GeneralLedgerValidationError(
      "vendor-bill-cost-billed",
      "a cost on this bill is already on a finalized invoice, so the bill cannot be reversed",
    );
  }
  const reversed = await reverseEntry(
    database,
    {
      entryId,
      description: `Reversal of vendor bill${state.bill_reference ? ` ${state.bill_reference}` : ""}`,
      effectiveDate: input.reversedOn,
    },
    { clock: options.clock, randomSource: options.randomSource },
  );
  const voidStatements: SqlStatement[] = [];
  for (const cost of costs) {
    if (cost.status === "void") continue;
    const voided = await voidCost(
      database,
      cost.disbursement_entry_id as CostEntryId,
      false,
      costOptions(options),
    );
    voidStatements.push(...voided.effect.statements);
  }
  const reversalId = newIdentifier("vendorBillReversal", options.randomSource);
  return {
    statements: [
      ...reversed.effect.statements,
      ...voidStatements,
      database
        .prepare(
          `INSERT INTO vendor_bill_reversal (id, vendor_bill_id, entry_id, reason, reversed_by, reversed_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
        )
        .bind(
          reversalId,
          input.vendorBillId,
          reversed.entryId,
          reason,
          options.actorUserId,
          options.clock.now(),
        ),
      audit(database, options, "vendor_bill.reversed", input.vendorBillId),
    ],
    outboxMessages: reversed.effect.outboxMessages,
  };
}

// Where a vendor's bills usually go. Setting it does not touch any bill already recorded; a new
// bill from the vendor fills it in first.
export async function setVendorDefaultAccount(
  database: SqlDatabase,
  input: { readonly vendorId: string; readonly ledgerAccountId: LedgerAccountId | null },
  options: GeneralLedgerServiceOptions,
): Promise<EffectWrite> {
  if (input.ledgerAccountId === null) {
    return {
      statements: [
        database
          .prepare(`DELETE FROM vendor_default_account WHERE vendor_id = ?1`)
          .bind(input.vendorId),
      ],
      outboxMessages: [],
    };
  }
  await refuseUnusableExpenseAccounts(database, [input.ledgerAccountId]);
  return {
    statements: [
      database
        .prepare(
          `INSERT INTO vendor_default_account (vendor_id, ledger_account_id, updated_by, updated_at)
           VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT (vendor_id) DO UPDATE SET ledger_account_id = excluded.ledger_account_id,
             updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
        )
        .bind(input.vendorId, input.ledgerAccountId, options.actorUserId, options.clock.now()),
    ],
    outboxMessages: [],
  };
}
