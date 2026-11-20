import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import {
  addCalendarDays,
  civilDateParts,
  startOfCivilMonth,
} from "@magna-carta/civil-time/civil-date";
import type {
  LedgerAccountId,
  OperatingBankAccountId,
  VendorBillId,
  VendorBillPaymentId,
} from "@magna-carta/identifiers/types";
import { GeneralLedgerValidationError } from "./general-ledger-validation.ts";
import type { VendorBillPaymentMethod } from "./vendor-bills.ts";

// What the Vendor Bills screen reads: bills grouped by vendor, each vendor with its open total and
// how old the unpaid part is, plus the strip of totals above the list. A bill's state (unpaid, part
// paid, paid, reversed) is derived from its balance and reversal rows, never stored.

export type VendorBillState = "unpaid" | "partPaid" | "paid" | "reversed";
export type VendorBillFilter = "unpaid" | "paid" | "all";
export type AgingBucket = "current" | "days1To30" | "days31To60" | "days61To90" | "over90";

export interface VendorBillSummary {
  readonly vendorBillId: VendorBillId;
  readonly vendorId: string;
  readonly billReference: string | null;
  readonly billDate: string;
  readonly dueDate: string | null;
  readonly amountMinor: number;
  readonly paidMinor: number;
  readonly openMinor: number;
  readonly state: VendorBillState;
  readonly agingBucket: AgingBucket | null; // null once nothing is open
  readonly memo: string | null;
  readonly matterIds: readonly string[];
}

export interface VendorBillGroup {
  readonly vendorId: string;
  readonly vendorName: string | null;
  readonly openMinor: number;
  readonly aging: Readonly<Record<AgingBucket, number>>;
  readonly bills: readonly VendorBillSummary[];
}

export interface VendorBillTotals {
  readonly openMinor: number;
  readonly overdueMinor: number;
  readonly dueThisWeekMinor: number;
  readonly openBillCount: number;
  readonly paidThisMonthMinor: number;
  readonly paidThisMonthCount: number;
  // How many bills each tab holds, whatever tab is showing.
  readonly unpaidCount: number;
  readonly paidCount: number;
  readonly allCount: number;
}

export interface VendorBillBoard {
  readonly totals: VendorBillTotals;
  readonly vendors: readonly VendorBillGroup[];
}

interface BillRow {
  id: string;
  vendor_id: string;
  vendor_name: string | null;
  bill_reference: string | null;
  bill_date: string;
  due_date: string | null;
  amount_minor: number;
  paid_minor: number;
  memo: string | null;
  reversed: number;
  matter_ids: string | null;
}

const VENDOR_NAME_SQL = `COALESCE(directory_person.display_name, directory_organization.display_name,
                directory_organization.legal_name)`;
const VENDOR_JOINS = `LEFT JOIN directory_person
              ON directory_person.id = v.vendor_id AND directory_person.deleted_at IS NULL
            LEFT JOIN directory_organization
              ON directory_organization.id = v.vendor_id AND directory_organization.deleted_at IS NULL`;

// Plain day counting between two civil dates, both read at midnight UTC so no zone moves a day.
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function agingBucketOf(asOf: string, billDate: string, dueDate: string | null): AgingBucket {
  const pastDue = daysBetween(dueDate ?? billDate, asOf);
  if (pastDue <= 0) return "current";
  if (pastDue <= 30) return "days1To30";
  if (pastDue <= 60) return "days31To60";
  if (pastDue <= 90) return "days61To90";
  return "over90";
}

function stateOf(row: BillRow): VendorBillState {
  if (row.reversed === 1) return "reversed";
  if (row.paid_minor >= row.amount_minor) return "paid";
  if (row.paid_minor > 0) return "partPaid";
  return "unpaid";
}

function emptyAging(): Record<AgingBucket, number> {
  return { current: 0, days1To30: 0, days31To60: 0, days61To90: 0, over90: 0 };
}

function summaryOf(row: BillRow, asOf: string): VendorBillSummary {
  const state = stateOf(row);
  const openMinor = state === "reversed" ? 0 : row.amount_minor - row.paid_minor;
  return {
    vendorBillId: row.id as VendorBillId,
    vendorId: row.vendor_id,
    billReference: row.bill_reference,
    billDate: row.bill_date,
    dueDate: row.due_date,
    amountMinor: row.amount_minor,
    paidMinor: row.paid_minor,
    openMinor,
    state,
    agingBucket: openMinor > 0 ? agingBucketOf(asOf, row.bill_date, row.due_date) : null,
    memo: row.memo,
    matterIds: row.matter_ids ? [...new Set(row.matter_ids.split(","))] : [],
  };
}

export interface ReadVendorBillBoardInput {
  readonly asOf: string; // the reader's today, for aging
  readonly filter: VendorBillFilter;
  readonly vendorId?: string | null;
  readonly matterId?: string | null;
}

export async function readVendorBillBoard(
  database: SqlDatabase,
  input: ReadVendorBillBoardInput,
): Promise<VendorBillBoard> {
  const conditions: string[] = [];
  const bindings: unknown[] = [];
  if (input.vendorId) {
    bindings.push(input.vendorId);
    conditions.push(`v.vendor_id = ?${bindings.length}`);
  }
  if (input.matterId) {
    bindings.push(input.matterId);
    conditions.push(
      `EXISTS (SELECT 1 FROM vendor_bill_line ml WHERE ml.vendor_bill_id = v.id AND ml.matter_id = ?${bindings.length})`,
    );
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const { results } = await database
    .prepare(
      `SELECT v.id, v.vendor_id, ${VENDOR_NAME_SQL} AS vendor_name, v.bill_reference, v.bill_date,
              v.due_date, v.amount_minor, b.paid_minor, v.memo,
              EXISTS(SELECT 1 FROM vendor_bill_reversal r WHERE r.vendor_bill_id = v.id) AS reversed,
              (SELECT group_concat(l.matter_id) FROM vendor_bill_line l
                WHERE l.vendor_bill_id = v.id AND l.matter_id IS NOT NULL) AS matter_ids
         FROM vendor_bill v
         JOIN vendor_bill_balance b ON b.vendor_bill_id = v.id
         ${VENDOR_JOINS}
         ${where}
        ORDER BY vendor_name COLLATE NOCASE, v.vendor_id, COALESCE(v.due_date, v.bill_date), v.id`,
    )
    .bind(...bindings)
    .all<BillRow>();

  const weekEnd = addCalendarDays(input.asOf, 7);
  let openMinor = 0;
  let overdueMinor = 0;
  let dueThisWeekMinor = 0;
  let openBillCount = 0;
  let unpaidCount = 0;
  let paidCount = 0;
  const groups = new Map<
    string,
    {
      vendorName: string | null;
      openMinor: number;
      aging: Record<AgingBucket, number>;
      bills: VendorBillSummary[];
    }
  >();
  for (const row of results) {
    const bill = summaryOf(row, input.asOf);
    if (bill.openMinor > 0) {
      openMinor += bill.openMinor;
      openBillCount += 1;
      const due = bill.dueDate ?? bill.billDate;
      if (due < input.asOf) overdueMinor += bill.openMinor;
      else if (due <= weekEnd) dueThisWeekMinor += bill.openMinor;
    }
    if (bill.state === "unpaid" || bill.state === "partPaid") unpaidCount += 1;
    if (bill.state === "paid") paidCount += 1;
    const shown =
      input.filter === "all" ||
      (input.filter === "unpaid" && (bill.state === "unpaid" || bill.state === "partPaid")) ||
      (input.filter === "paid" && bill.state === "paid");
    if (!shown) continue;
    const group = groups.get(row.vendor_id) ?? {
      vendorName: row.vendor_name,
      openMinor: 0,
      aging: emptyAging(),
      bills: [],
    };
    group.bills.push(bill);
    group.openMinor += bill.openMinor;
    if (bill.agingBucket) group.aging[bill.agingBucket] += bill.openMinor;
    groups.set(row.vendor_id, group);
  }
  const { year, month } = civilDateParts(input.asOf);
  const { results: paidRows } = await database
    .prepare(
      `SELECT COALESCE(SUM(p.amount_minor), 0) AS paid_minor, COUNT(DISTINCT p.vendor_bill_id) AS bill_count
         FROM vendor_bill_payment p
        WHERE p.paid_on >= ?1 AND p.paid_on <= ?2`,
    )
    .bind(startOfCivilMonth(year, month), input.asOf)
    .all<{ paid_minor: number; bill_count: number }>();
  return {
    totals: {
      openMinor,
      overdueMinor,
      dueThisWeekMinor,
      openBillCount,
      paidThisMonthMinor: paidRows[0]?.paid_minor ?? 0,
      paidThisMonthCount: paidRows[0]?.bill_count ?? 0,
      unpaidCount,
      paidCount,
      allCount: results.length,
    },
    vendors: [...groups].map(([vendorId, group]) => ({ vendorId, ...group })),
  };
}

export interface VendorBillLineDetail {
  readonly lineIndex: number;
  readonly description: string;
  readonly amountMinor: number;
  readonly matterId: string | null;
  readonly matterTitle: string | null;
  readonly disbursementClass: "hard" | "soft" | null;
  readonly costEntryId: string | null;
  readonly ledgerAccountId: LedgerAccountId;
  readonly ledgerAccountName: string;
}

export interface VendorBillPaymentDetail {
  readonly vendorBillPaymentId: VendorBillPaymentId;
  readonly operatingBankAccountId: OperatingBankAccountId;
  readonly operatingBankAccountName: string;
  readonly amountMinor: number;
  readonly paidOn: string;
  readonly method: VendorBillPaymentMethod;
  readonly checkNumber: number | null;
  readonly reference: string | null;
}

export interface VendorBillDetail extends VendorBillSummary {
  readonly vendorName: string | null;
  readonly lines: readonly VendorBillLineDetail[];
  readonly payments: readonly VendorBillPaymentDetail[];
  readonly reversal: { readonly reason: string; readonly reversedAt: string } | null;
}

export async function readVendorBill(
  database: SqlDatabase,
  vendorBillId: VendorBillId,
  asOf: string,
): Promise<VendorBillDetail> {
  const { results } = await database
    .prepare(
      `SELECT v.id, v.vendor_id, ${VENDOR_NAME_SQL} AS vendor_name, v.bill_reference, v.bill_date,
              v.due_date, v.amount_minor, b.paid_minor, v.memo,
              EXISTS(SELECT 1 FROM vendor_bill_reversal r WHERE r.vendor_bill_id = v.id) AS reversed,
              (SELECT group_concat(l.matter_id) FROM vendor_bill_line l
                WHERE l.vendor_bill_id = v.id AND l.matter_id IS NOT NULL) AS matter_ids
         FROM vendor_bill v
         JOIN vendor_bill_balance b ON b.vendor_bill_id = v.id
         ${VENDOR_JOINS}
        WHERE v.id = ?1`,
    )
    .bind(vendorBillId)
    .all<BillRow>();
  const row = results[0];
  if (!row) {
    throw new GeneralLedgerValidationError(
      "unknown-vendor-bill",
      `no such vendor bill: ${vendorBillId}`,
    );
  }
  const { results: lines } = await database
    .prepare(
      `SELECT l.line_index, l.description, l.amount_minor, l.matter_id, m.title AS matter_title,
              l.disbursement_class, l.disbursement_entry_id, l.ledger_account_id, a.name AS account_name
         FROM vendor_bill_line l
         JOIN ledger_account a ON a.id = l.ledger_account_id
         LEFT JOIN matter m ON m.id = l.matter_id
        WHERE l.vendor_bill_id = ?1
        ORDER BY l.line_index`,
    )
    .bind(vendorBillId)
    .all<{
      line_index: number;
      description: string;
      amount_minor: number;
      matter_id: string | null;
      matter_title: string | null;
      disbursement_class: "hard" | "soft" | null;
      disbursement_entry_id: string | null;
      ledger_account_id: string;
      account_name: string;
    }>();
  const { results: payments } = await database
    .prepare(
      `SELECT p.id, p.operating_bank_account_id, o.name AS account_name, p.amount_minor, p.paid_on,
              p.method, p.check_number, p.reference
         FROM vendor_bill_payment p
         JOIN operating_bank_account o ON o.id = p.operating_bank_account_id
        WHERE p.vendor_bill_id = ?1
        ORDER BY p.paid_on, p.recorded_at`,
    )
    .bind(vendorBillId)
    .all<{
      id: string;
      operating_bank_account_id: string;
      account_name: string;
      amount_minor: number;
      paid_on: string;
      method: VendorBillPaymentMethod;
      check_number: number | null;
      reference: string | null;
    }>();
  const { results: reversals } = await database
    .prepare(`SELECT reason, reversed_at FROM vendor_bill_reversal WHERE vendor_bill_id = ?1`)
    .bind(vendorBillId)
    .all<{ reason: string; reversed_at: string }>();
  const reversal = reversals[0];
  return {
    ...summaryOf(row, asOf),
    vendorName: row.vendor_name,
    lines: lines.map((line) => ({
      lineIndex: line.line_index,
      description: line.description,
      amountMinor: line.amount_minor,
      matterId: line.matter_id,
      matterTitle: line.matter_title,
      disbursementClass: line.disbursement_class,
      costEntryId: line.disbursement_entry_id,
      ledgerAccountId: line.ledger_account_id as LedgerAccountId,
      ledgerAccountName: line.account_name,
    })),
    payments: payments.map((payment) => ({
      vendorBillPaymentId: payment.id as VendorBillPaymentId,
      operatingBankAccountId: payment.operating_bank_account_id as OperatingBankAccountId,
      operatingBankAccountName: payment.account_name,
      amountMinor: payment.amount_minor,
      paidOn: payment.paid_on,
      method: payment.method,
      checkNumber: payment.check_number,
      reference: payment.reference,
    })),
    reversal: reversal ? { reason: reversal.reason, reversedAt: reversal.reversed_at } : null,
  };
}

export async function readVendorDefaultAccount(
  database: SqlDatabase,
  vendorId: string,
): Promise<LedgerAccountId | null> {
  const { results } = await database
    .prepare(`SELECT ledger_account_id FROM vendor_default_account WHERE vendor_id = ?1`)
    .bind(vendorId)
    .all<{ ledger_account_id: string }>();
  return (results[0]?.ledger_account_id as LedgerAccountId | undefined) ?? null;
}
