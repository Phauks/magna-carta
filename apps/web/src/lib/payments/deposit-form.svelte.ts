/*
 * The Record a Payment form, kept apart from the screen so its rules are tested without one.
 *
 * ONE DEPOSIT, MANY LINES. Every payment in the deposit is a line with its own matter and bill, how
 * it was paid, who paid it and the date it was received. The deposit itself has only where it went
 * and when. Bank fees taken out of the deposit are lines of their own, below the payments.
 *
 * THE DEPOSIT TOTAL IS WORKED OUT, NEVER TYPED (owner's ruling, 2026-11-20): payments less fees.
 *
 * A REFUSAL IS A FIELD'S, NOT A SENTENCE UNDER IT. `refusals` maps each field's id to the reason it
 * stands refused, so the screen can redden that field's edge and put the reason on its hover, and
 * the commit control can say the first reason in words.
 */
import type {
  BillingOpenBills,
  BillingRecordDepositRequest,
  OperatingBankAccount,
} from "@magna-carta/api-client";
import { readAmountMinor } from "$lib/billing/amount-entry.ts";
import {
  CASH_BILLS,
  CASH_COINS,
  detailRefusal,
  methodEntry,
  type PaymentMethod,
} from "./payment-methods.ts";
import { amountText, countedMinor, differenceMinor, totalMinor } from "./deposit-money.ts";

export { amountText } from "./deposit-money.ts";

export type OpenBill = BillingOpenBills["bills"][number];

/** An account money can be deposited into, as the Deposit To field shows it. */
export interface DepositAccount {
  readonly ledgerAccountId: string;
  readonly name: string;
  readonly bankName: string | null;
  readonly lastFour: string | null;
  /** The bank's logo as a PNG in base64, where a bank feed has given one. */
  readonly logo: string | null;
  readonly isDefault: boolean;
}

export function depositAccountsFrom(
  accounts: readonly OperatingBankAccount[],
  logos: ReadonlyMap<string, string> = new Map(),
): DepositAccount[] {
  return accounts
    .filter((account) => account.closedAt === null)
    .map((account) => ({
      ledgerAccountId: account.ledgerAccountId,
      name: account.name,
      bankName: account.bankName,
      lastFour: account.accountNumberLastFour,
      logo: logos.get(account.ledgerAccountId) ?? null,
      isDefault: account.isDefault,
    }));
}

/** A file chosen on the form, sent once the deposit is recorded. */
export interface PendingFile {
  readonly key: string;
  readonly file: File;
  readonly kind: "scan" | "file";
}

export const MAXIMUM_LINES = 60;
export const MAXIMUM_FEES = 10;
export const MAXIMUM_FILE_BYTES = 25 * 1024 * 1024;
export const FILE_TYPES = "application/pdf,image/png,image/jpeg";

const newKey = (): string => crypto.randomUUID();

export class DepositLine {
  readonly key: string;
  matterId = $state("");
  invoiceId = $state("");
  method = $state<PaymentMethod>("check");
  reference = $state("");
  receivedFrom = $state("");
  receivedOn = $state("");
  amountText = $state("");
  memo = $state("");
  /** Each detail as typed, by its key. */
  details = $state<Record<string, string>>({});
  /** The optional details the person has added with Add Detail; required ones always show. */
  shownDetails = $state<string[]>([]);
  memoShown = $state(false);
  /** How many of each bill and coin, as typed, by the server's denomination key. */
  cashCount = $state<Record<string, string>>({});
  note = $state("");
  noteShown = $state(false);
  files = $state<PendingFile[]>([]);
  expanded = $state(false);

  constructor(receivedOn: string, key: string = newKey()) {
    this.key = key;
    this.receivedOn = receivedOn;
  }

  /** The total of the cash count in cents, or null when nothing has been counted. */
  get countedMinor(): number | null {
    const counted: number[] = [];
    for (const denomination of [...CASH_BILLS, ...CASH_COINS]) {
      const pieces = Number(this.cashCount[denomination.key] ?? "");
      if (Number.isInteger(pieces) && pieces > 0)
        counted.push(countedMinor(denomination.valueMinor, pieces));
    }
    return counted.length > 0 ? totalMinor(counted) : null;
  }

  /** The line's amount: the cash count where there is one, otherwise what was typed. */
  get amountMinor(): number | null {
    if (this.method === "cash" && this.countedMinor !== null) return this.countedMinor;
    const reading = readAmountMinor(this.amountText);
    return reading.kind === "amount" ? reading.minor : null;
  }

  /** Whether anything has been entered on the line beyond its starting date. */
  get started(): boolean {
    return (
      this.matterId !== "" ||
      this.reference.trim() !== "" ||
      this.receivedFrom.trim() !== "" ||
      this.amountText.trim() !== "" ||
      this.files.length > 0
    );
  }

  copy(): DepositLine {
    const twin = new DepositLine(this.receivedOn);
    twin.matterId = this.matterId;
    twin.invoiceId = this.invoiceId;
    twin.method = this.method;
    twin.reference = this.reference;
    twin.receivedFrom = this.receivedFrom;
    twin.amountText = this.amountText;
    twin.memo = this.memo;
    twin.memoShown = this.memoShown;
    twin.details = { ...this.details };
    twin.shownDetails = [...this.shownDetails];
    twin.cashCount = { ...this.cashCount };
    return twin;
  }
}

export interface DepositFee {
  readonly key: string;
  description: string;
  amountText: string;
}

/** One bill this deposit pays, with what it owed and what is left. */
export interface BillPaid {
  readonly invoiceId: string;
  readonly matterId: string;
  readonly matterLabel: string;
  readonly invoiceNumber: string | null;
  readonly owedMinor: number;
  readonly thisDepositMinor: number;
  readonly leftMinor: number;
}

export function matterLabel(bill: Pick<OpenBill, "matterNumber" | "matterTitle">): string {
  return bill.matterNumber === null ? bill.matterTitle : `${bill.matterNumber} ${bill.matterTitle}`;
}

export function billLabel(bill: Pick<OpenBill, "invoiceNumber">): string {
  return bill.invoiceNumber ?? "Unnumbered";
}

/** Field ids, so the screen and the refusals agree on what each field is called. */
export const fieldId = {
  depositTo: "deposit-to",
  depositedOn: "deposit-date",
  slip: "deposit-slip",
  line: (key: string, field: string) => `line-${key}-${field}`,
  fee: (key: string, field: string) => `fee-${key}-${field}`,
} as const;

export class DepositForm {
  depositToAccountId = $state("");
  depositedOn = $state("");
  slipNumber = $state("");
  slipShown = $state(false);
  lines = $state<DepositLine[]>([]);
  fees = $state<DepositFee[]>([]);
  note = $state("");
  noteShown = $state(false);
  files = $state<PendingFile[]>([]);
  /** Whether Record has been pressed once: refusals show on the fields only after that. */
  attempted = $state(false);

  readonly #bills: () => readonly OpenBill[];
  readonly #today: string;

  constructor(options: {
    bills: () => readonly OpenBill[];
    today: string;
    depositToAccountId?: string;
  }) {
    this.#bills = options.bills;
    this.#today = options.today;
    this.depositedOn = options.today;
    this.depositToAccountId = options.depositToAccountId ?? "";
    this.lines = [new DepositLine(options.today)];
  }

  get today(): string {
    return this.#today;
  }

  // ---- What can be picked ------------------------------------------------------------------

  billFor(invoiceId: string, matterId: string): OpenBill | undefined {
    return this.#bills().find((bill) => bill.invoiceId === invoiceId && bill.matterId === matterId);
  }

  /** Every matter with something owing, once each, in the order the bills arrive. */
  get matters(): readonly OpenBill[] {
    const seen = new Set<string>();
    const out: OpenBill[] = [];
    for (const bill of this.#bills()) {
      if (seen.has(bill.matterId)) continue;
      seen.add(bill.matterId);
      out.push(bill);
    }
    return out;
  }

  billsOf(matterId: string): readonly OpenBill[] {
    return this.#bills().filter((bill) => bill.matterId === matterId);
  }

  /** What is still owed on a bill once every OTHER line in this deposit is counted. */
  owedBeyondOtherLines(line: DepositLine): number {
    const bill = this.billFor(line.invoiceId, line.matterId);
    if (bill === undefined) return 0;
    const others = totalMinor(
      this.lines
        .filter(
          (other) =>
            other !== line &&
            other.invoiceId === line.invoiceId &&
            other.matterId === line.matterId,
        )
        .map((other) => other.amountMinor ?? 0),
      bill.currency,
    );
    const left = differenceMinor(bill.owedMinor, others, bill.currency);
    return left > 0 ? left : 0;
  }

  // ---- Changing a line ---------------------------------------------------------------------

  pickMatter(line: DepositLine, matterId: string): void {
    if (line.matterId === matterId) return;
    line.matterId = matterId;
    line.invoiceId = "";
    const bills = this.billsOf(matterId);
    const only = bills.length === 1 ? bills[0] : undefined;
    if (only !== undefined) this.pickBill(line, only.invoiceId);
    const first = bills[0];
    if (line.receivedFrom.trim() === "" && first?.clientName) line.receivedFrom = first.clientName;
  }

  /** Picking a bill fills the amount with what is left on it, as QuickBooks does. */
  pickBill(line: DepositLine, invoiceId: string): void {
    line.invoiceId = invoiceId;
    if (line.amountText.trim() === "" && line.countedMinor === null) {
      const owed = this.owedBeyondOtherLines(line);
      if (owed > 0) line.amountText = amountText(owed);
    }
  }

  pickMethod(line: DepositLine, method: PaymentMethod): void {
    if (line.method === method) return;
    const keep = new Set(methodEntry(method).details.map((field) => field.key));
    line.method = method;
    line.details = Object.fromEntries(
      Object.entries(line.details).filter(([key]) => keep.has(key)),
    );
    line.shownDetails = line.shownDetails.filter((key) => keep.has(key));
    if (method !== "cash") line.cashCount = {};
  }

  addLine(): DepositLine | null {
    if (this.lines.length >= MAXIMUM_LINES) return null;
    const last = this.lines.at(-1);
    const line = new DepositLine(last?.receivedOn ?? this.#today);
    this.lines.push(line);
    return line;
  }

  duplicateLine(key: string): DepositLine | null {
    const index = this.lines.findIndex((line) => line.key === key);
    const source = this.lines[index];
    if (source === undefined || this.lines.length >= MAXIMUM_LINES) return null;
    const twin = source.copy();
    this.lines.splice(index + 1, 0, twin);
    return twin;
  }

  insertLineBelow(key: string): DepositLine | null {
    const index = this.lines.findIndex((line) => line.key === key);
    const source = this.lines[index];
    if (source === undefined || this.lines.length >= MAXIMUM_LINES) return null;
    const line = new DepositLine(source.receivedOn);
    this.lines.splice(index + 1, 0, line);
    return line;
  }

  moveLine(key: string, by: -1 | 1): void {
    const index = this.lines.findIndex((line) => line.key === key);
    const target = index + by;
    if (index < 0 || target < 0 || target >= this.lines.length) return;
    const [line] = this.lines.splice(index, 1);
    if (line !== undefined) this.lines.splice(target, 0, line);
  }

  clearLine(key: string): void {
    const index = this.lines.findIndex((line) => line.key === key);
    if (index < 0) return;
    this.lines[index] = new DepositLine(this.lines[index]?.receivedOn ?? this.#today, newKey());
  }

  /** Deleting the only line leaves one empty line, so the register is never empty. */
  removeLine(key: string): void {
    this.lines = this.lines.filter((line) => line.key !== key);
    if (this.lines.length === 0) this.lines = [new DepositLine(this.#today)];
  }

  addFee(): DepositFee | null {
    if (this.fees.length >= MAXIMUM_FEES) return null;
    const fee: DepositFee = { key: newKey(), description: "", amountText: "" };
    this.fees.push(fee);
    return fee;
  }

  removeFee(key: string): void {
    this.fees = this.fees.filter((fee) => fee.key !== key);
  }

  // ---- Totals ------------------------------------------------------------------------------

  get paymentsMinor(): number {
    return totalMinor(this.lines.map((line) => line.amountMinor ?? 0));
  }

  get feesMinor(): number {
    return totalMinor(
      this.fees.map((fee) => {
        const reading = readAmountMinor(fee.amountText);
        return reading.kind === "amount" ? reading.minor : 0;
      }),
    );
  }

  get depositMinor(): number {
    return differenceMinor(this.paymentsMinor, this.feesMinor);
  }

  /** Each bill the lines pay, in the order the lines first name it. */
  get billsPaid(): readonly BillPaid[] {
    const out = new Map<string, BillPaid>();
    for (const line of this.lines) {
      const bill = this.billFor(line.invoiceId, line.matterId);
      if (bill === undefined) continue;
      const key = `${bill.invoiceId}:${bill.matterId}`;
      const before = out.get(key);
      const thisDeposit = totalMinor(
        [before?.thisDepositMinor ?? 0, line.amountMinor ?? 0],
        bill.currency,
      );
      out.set(key, {
        invoiceId: bill.invoiceId,
        matterId: bill.matterId,
        matterLabel: matterLabel(bill),
        invoiceNumber: bill.invoiceNumber,
        owedMinor: bill.owedMinor,
        thisDepositMinor: thisDeposit,
        leftMinor: differenceMinor(bill.owedMinor, thisDeposit, bill.currency),
      });
    }
    return [...out.values()];
  }

  get started(): boolean {
    return (
      this.lines.some((line) => line.started) ||
      this.fees.length > 0 ||
      this.note.trim() !== "" ||
      this.files.length > 0
    );
  }

  // ---- Refusals ----------------------------------------------------------------------------

  /** Every field that would be refused, by its id, in the order the form reads. */
  get refusals(): ReadonlyMap<string, string> {
    const out = new Map<string, string>();
    if (this.depositToAccountId === "")
      out.set(fieldId.depositTo, "Choose the account the money went into.");
    if (this.depositedOn === "") out.set(fieldId.depositedOn, "Enter the date deposited.");
    else if (this.depositedOn > this.#today)
      out.set(fieldId.depositedOn, "The date deposited is in the future.");

    const currencies = new Set<string>();
    this.lines.forEach((line, index) => {
      const n = index + 1;
      const at = (field: string) => fieldId.line(line.key, field);
      const bill = this.billFor(line.invoiceId, line.matterId);
      if (line.matterId === "") out.set(at("matter"), `Line ${n}: choose the matter.`);
      else if (bill === undefined) out.set(at("bill"), `Line ${n}: choose the bill.`);
      if (bill !== undefined) currencies.add(bill.currency);
      const entry = methodEntry(line.method);
      if (entry.referenceRequired && line.reference.trim() === "") {
        out.set(at("reference"), `Line ${n}: enter the ${entry.reference}.`);
      } else if (line.reference.length > 100) {
        out.set(at("reference"), `Line ${n}: the ${entry.reference} is too long.`);
      }
      if (line.receivedFrom.trim() === "")
        out.set(at("from"), `Line ${n}: say who it was received from.`);
      if (line.receivedOn === "") out.set(at("received"), `Line ${n}: enter the date received.`);
      else if (this.depositedOn !== "" && line.receivedOn > this.depositedOn) {
        out.set(at("received"), `Line ${n}: received after the date deposited.`);
      } else if (bill?.issueDate && line.receivedOn < bill.issueDate) {
        out.set(at("received"), `Line ${n}: received before bill ${billLabel(bill)} was issued.`);
      }
      const amount = line.amountMinor;
      if (amount === null || amount <= 0) {
        out.set(at("amount"), `Line ${n}: enter the amount.`);
      } else if (bill !== undefined && amount > this.owedBeyondOtherLines(line)) {
        out.set(at("amount"), `Line ${n}: more than bill ${billLabel(bill)} still owes.`);
      }
      for (const field of entry.details) {
        const reason = detailRefusal(field, line.details[field.key] ?? "");
        if (reason !== null) out.set(at(`detail-${field.key}`), `Line ${n}: ${reason}`);
      }
      if (line.memo.length > 500) out.set(at("memo"), `Line ${n}: the memo is too long.`);
    });
    if (currencies.size > 1) {
      out.set(fieldId.depositTo, "One deposit holds one currency. Record the others separately.");
    }

    this.fees.forEach((fee, index) => {
      const n = index + 1;
      if (fee.description.trim() === "")
        out.set(fieldId.fee(fee.key, "description"), `Bank fee ${n}: say what it was for.`);
      const reading = readAmountMinor(fee.amountText);
      if (reading.kind !== "amount" || reading.minor <= 0) {
        out.set(fieldId.fee(fee.key, "amount"), `Bank fee ${n}: enter the amount.`);
      }
    });
    if (this.fees.length > 0 && this.feesMinor >= this.paymentsMinor && this.paymentsMinor > 0) {
      out.set(
        fieldId.fee(this.fees[0]?.key ?? "", "amount"),
        "The bank fees are more than the payments.",
      );
    }
    return out;
  }

  /** The first refusal in words, for the commit control. */
  get firstRefusal(): string | undefined {
    for (const reason of this.refusals.values()) return reason;
    return undefined;
  }

  // ---- What is sent ------------------------------------------------------------------------

  toRequest(): BillingRecordDepositRequest {
    const fees = this.fees.map((fee) => {
      const reading = readAmountMinor(fee.amountText);
      return {
        description: fee.description.trim(),
        amountMinor: reading.kind === "amount" ? reading.minor : 0,
      };
    });
    return {
      depositToAccountId: this.depositToAccountId,
      depositedOn: this.depositedOn,
      slipNumber: this.slipNumber.trim() || null,
      lines: this.lines.map((line) => {
        const details: Record<string, string | Record<string, number>> = {};
        for (const field of methodEntry(line.method).details) {
          const value = (line.details[field.key] ?? "").trim();
          if (value !== "") details[field.key] = value;
        }
        if (line.method === "cash" && line.countedMinor !== null) {
          const counted: Record<string, number> = {};
          for (const [key, text] of Object.entries(line.cashCount)) {
            const pieces = Number(text);
            if (Number.isInteger(pieces) && pieces > 0) counted[key] = pieces;
          }
          details["cashCount"] = counted;
        }
        return {
          invoiceId: line.invoiceId,
          matterId: line.matterId,
          amountMinor: line.amountMinor ?? 0,
          method: line.method,
          reference: line.reference.trim() || null,
          receivedFrom: line.receivedFrom.trim(),
          receivedOn: line.receivedOn,
          memo: line.memo.trim() || null,
          details,
          note: line.note.trim() || null,
        };
      }),
      fees,
      note: this.note.trim() || null,
    };
  }
}

/** Re-write a typed amount with its commas, leaving anything unreadable as it was typed. */
export function tidyAmount(text: string): string {
  const reading = readAmountMinor(text);
  return reading.kind === "amount" ? amountText(reading.minor) : text;
}
