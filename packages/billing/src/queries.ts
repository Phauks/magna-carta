import {
  appendCursorPredicate,
  assemblePage,
  decodeCursor,
  DEFAULT_PAGE_SIZE,
  type Page,
} from "@magna-carta/data-access/cursor-pagination";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { InvoiceId, MatterId } from "@magna-carta/identifiers/types";
import type { InvoiceStatus } from "./types.ts";

// THE HOT READ: what is still unbilled on this matter. Served entirely from the mirror column on
// each work-in-progress store with NO join to the claim table — which is the whole reason the mirror
// exists. The claim row is the truth about who holds an entry; this read only needs to know that
// nobody does.
export interface UnbilledWorkInProgress {
  readonly matterId: string;
  readonly timeEntryCount: number;
  readonly timeAmountMinor: number;
  readonly costEntryCount: number;
  readonly costAmountMinor: number;
}

interface UnbilledTotalsRow {
  entry_count: number;
  amount_minor: number | null;
}

export async function readUnbilledWorkInProgress(
  database: SqlDatabase,
  matterId: MatterId,
): Promise<UnbilledWorkInProgress> {
  // matter_status is the leading index on both stores, and `invoice_id IS NULL` narrows within it —
  // an entry that is neither billed nor void and that no draft holds.
  const time = await database
    .prepare(
      `SELECT COUNT(*) AS entry_count, SUM(amount_minor) AS amount_minor
         FROM time_entry
        WHERE matter_id = ?1 AND status NOT IN ('billed', 'void') AND invoice_id IS NULL AND amount_minor IS NOT NULL`,
    )
    .bind(matterId)
    .all<UnbilledTotalsRow>();
  const cost = await database
    .prepare(
      `SELECT COUNT(*) AS entry_count, SUM(amount_minor) AS amount_minor
         FROM cost_entry
        WHERE matter_id = ?1 AND status NOT IN ('billed', 'void') AND invoice_id IS NULL`,
    )
    .bind(matterId)
    .all<UnbilledTotalsRow>();
  return {
    matterId,
    timeEntryCount: time.results[0]?.entry_count ?? 0,
    timeAmountMinor: time.results[0]?.amount_minor ?? 0,
    costEntryCount: cost.results[0]?.entry_count ?? 0,
    costAmountMinor: cost.results[0]?.amount_minor ?? 0,
  };
}

export interface InvoiceListItem {
  readonly id: string;
  readonly clientEntityId: string;
  readonly currency: string;
  readonly status: InvoiceStatus;
  readonly invoiceNumber: string | null;
  readonly issueDate: string | null;
  readonly dueDate: string | null;
  readonly totalMinor: number;
  readonly appliedMinor: number;
  readonly unpaidMinor: number;
  readonly createdAt: string;
}

interface InvoiceListRow {
  id: string;
  client_entity_id: string;
  currency: string;
  status: InvoiceStatus;
  invoice_number: string | null;
  issue_date: string | null;
  due_date: string | null;
  total_minor: number | null;
  applied_minor: number | null;
  created_at: string;
}

function toListItem(row: InvoiceListRow): InvoiceListItem {
  const totalMinor = row.total_minor ?? 0;
  const appliedMinor = row.applied_minor ?? 0;
  return {
    id: row.id,
    clientEntityId: row.client_entity_id,
    currency: row.currency,
    status: row.status,
    invoiceNumber: row.invoice_number,
    issueDate: row.issue_date,
    dueDate: row.due_date,
    totalMinor,
    appliedMinor,
    // Derived, never stored: an unpaid balance in a column would need a sweep to maintain what a
    // subtraction gives for free, and could drift from the rows it summarizes.
    unpaidMinor: totalMinor - appliedMinor,
    createdAt: row.created_at,
  };
}

export interface ListInvoicesOptions {
  readonly clientEntityId?: string;
  readonly status?: InvoiceStatus;
  readonly cursor?: string;
  readonly pageSize?: number;
}

export async function listInvoices(
  database: SqlDatabase,
  options: ListInvoicesOptions = {},
): Promise<Page<InvoiceListItem>> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const conditions: string[] = [];
  const bindings: unknown[] = [];
  if (options.clientEntityId) {
    conditions.push(`client_entity_id = ?`);
    bindings.push(options.clientEntityId);
  }
  if (options.status) {
    conditions.push(`status = ?`);
    bindings.push(options.status);
  }
  appendCursorPredicate(conditions, bindings, decodeCursor(options.cursor));
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const { results } = await database
    .prepare(
      `SELECT invoice.id, invoice.client_entity_id, invoice.currency, invoice.status, invoice.invoice_number,
              invoice.issue_date, invoice.due_date, invoice.created_at,
              (SELECT SUM(total_minor) FROM invoice_matter_balance WHERE invoice_id = invoice.id) AS total_minor,
              (SELECT SUM(applied_minor) FROM invoice_matter_balance WHERE invoice_id = invoice.id) AS applied_minor
         FROM invoice ${where}
        ORDER BY created_at DESC, id DESC
        LIMIT ?`,
    )
    .bind(...bindings, pageSize + 1)
    .all<InvoiceListRow>();
  return assemblePage(results, pageSize, toListItem);
}

export interface InvoiceDetail extends InvoiceListItem {
  readonly lines: readonly {
    readonly id: string;
    readonly lineIndex: number;
    readonly matterId: string;
    readonly kind: string;
    readonly description: string;
    readonly amountMinor: number;
  }[];
  readonly matterBalances: readonly {
    readonly matterId: string;
    readonly totalMinor: number;
    readonly appliedMinor: number;
    readonly unpaidMinor: number;
  }[];
}

export async function readInvoiceDetail(
  database: SqlDatabase,
  invoiceId: InvoiceId,
): Promise<InvoiceDetail | undefined> {
  const { results } = await database
    .prepare(
      `SELECT invoice.id, invoice.client_entity_id, invoice.currency, invoice.status, invoice.invoice_number,
              invoice.issue_date, invoice.due_date, invoice.created_at,
              (SELECT SUM(total_minor) FROM invoice_matter_balance WHERE invoice_id = invoice.id) AS total_minor,
              (SELECT SUM(applied_minor) FROM invoice_matter_balance WHERE invoice_id = invoice.id) AS applied_minor
         FROM invoice WHERE invoice.id = ?1`,
    )
    .bind(invoiceId)
    .all<InvoiceListRow>();
  const row = results[0];
  if (!row) return undefined;

  const lines = await database
    .prepare(
      `SELECT id, line_index, matter_id, kind, description, amount_minor FROM invoice_line WHERE invoice_id = ?1 ORDER BY line_index`,
    )
    .bind(invoiceId)
    .all<{
      id: string;
      line_index: number;
      matter_id: string;
      kind: string;
      description: string;
      amount_minor: number;
    }>();
  const balances = await database
    .prepare(
      `SELECT matter_id, total_minor, applied_minor FROM invoice_matter_balance WHERE invoice_id = ?1 ORDER BY matter_id`,
    )
    .bind(invoiceId)
    .all<{ matter_id: string; total_minor: number; applied_minor: number }>();

  return {
    ...toListItem(row),
    lines: lines.results.map((line) => ({
      id: line.id,
      lineIndex: line.line_index,
      matterId: line.matter_id,
      kind: line.kind,
      description: line.description,
      amountMinor: line.amount_minor,
    })),
    matterBalances: balances.results.map((balance) => ({
      matterId: balance.matter_id,
      totalMinor: balance.total_minor,
      appliedMinor: balance.applied_minor,
      unpaidMinor: balance.total_minor - balance.applied_minor,
    })),
  };
}

export interface MatterReceivable {
  readonly matterId: string;
  readonly totalMinor: number;
  readonly appliedMinor: number;
  readonly unpaidMinor: number;
}

export async function readMatterReceivable(
  database: SqlDatabase,
  matterId: MatterId,
): Promise<MatterReceivable> {
  const { results } = await database
    .prepare(
      `SELECT SUM(total_minor) AS total_minor, SUM(applied_minor) AS applied_minor
         FROM invoice_matter_balance WHERE matter_id = ?1`,
    )
    .bind(matterId)
    .all<{ total_minor: number | null; applied_minor: number | null }>();
  const totalMinor = results[0]?.total_minor ?? 0;
  const appliedMinor = results[0]?.applied_minor ?? 0;
  return { matterId, totalMinor, appliedMinor, unpaidMinor: totalMinor - appliedMinor };
}

// The aging buckets, in days past due. OVERDUE IS DERIVED AT READ TIME AND NEVER WRITTEN: a stored
// flag would need a sweep to maintain what a comparison gives for free, and it would have the
// platform assert something about a client's conduct that may have been settled this morning.
export const AGING_BUCKET_DAYS = [30, 60, 90] as const;

export interface AgingBucket {
  readonly label: string;
  readonly invoiceCount: number;
  readonly unpaidMinor: number;
}

interface AgingRow {
  id: string;
  due_date: string;
  unpaid_minor: number;
}

const MILLISECONDS_PER_DAY = 86_400_000;

function daysPastDue(dueDate: string, asOfDate: string): number {
  return Math.floor(
    (Date.parse(`${asOfDate}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) /
      MILLISECONDS_PER_DAY,
  );
}

export async function readAccountsReceivableAging(
  database: SqlDatabase,
  asOfDate: string,
): Promise<readonly AgingBucket[]> {
  const { results } = await database
    .prepare(
      `SELECT invoice.id, invoice.due_date,
              (SELECT SUM(total_minor - applied_minor) FROM invoice_matter_balance WHERE invoice_id = invoice.id) AS unpaid_minor
         FROM invoice
        WHERE invoice.status = 'final' AND invoice.due_date IS NOT NULL
        ORDER BY invoice.due_date`,
    )
    .all<AgingRow>();

  const labels = ["current", "1-30", "31-60", "61-90", "90+"];
  const buckets = labels.map((label) => ({ label, invoiceCount: 0, unpaidMinor: 0 }));
  for (const row of results) {
    const unpaidMinor = row.unpaid_minor ?? 0;
    if (unpaidMinor <= 0) continue;
    const overdueDays = daysPastDue(row.due_date, asOfDate);
    const index =
      overdueDays <= 0
        ? 0
        : overdueDays <= AGING_BUCKET_DAYS[0]
          ? 1
          : overdueDays <= AGING_BUCKET_DAYS[1]
            ? 2
            : overdueDays <= AGING_BUCKET_DAYS[2]
              ? 3
              : 4;
    const bucket = buckets[index]!;
    bucket.invoiceCount += 1;
    bucket.unpaidMinor += unpaidMinor;
  }
  return buckets;
}
