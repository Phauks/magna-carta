import {
  appendCursorPredicateOnColumn,
  assemblePage,
  decodeCursor,
  DEFAULT_PAGE_SIZE,
  type Page,
} from "@magna-carta/data-access/cursor-pagination";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { InvoiceId, MatterId } from "@magna-carta/identifiers/types";
import { type InvoiceDeliveryState, readInvoiceDeliveryState } from "./statements.ts";
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
  /**
   * The client's name as the directory holds it, resolved by the listing. Null both where no
   * directory entry answers to the identifier and where the entry behind one is gone —
   * `clientEntityId` tells those two apart. Never the identifier standing in for a name: a register
   * that printed `entity_01J...` in its Client column would be unreadable, and one that resolved
   * the name a row at a time would be a lookup per bill to fill one column.
   */
  readonly clientName: string | null;
  readonly currency: string;
  readonly status: InvoiceStatus;
  readonly invoiceNumber: string | null;
  readonly issueDate: string | null;
  readonly dueDate: string | null;
  readonly totalMinor: number;
  readonly appliedMinor: number;
  readonly unpaidMinor: number;
  readonly createdAt: string;
  /**
   * ONE MATTER'S SHARE OF THIS BILL, present only when the listing was asked for one matter.
   *
   * An invoice belongs to a client and may bill several of that client's matters, so a matter's own
   * register needs each bill's share of it rather than the bill's whole total. These three carry it
   * so the register does not have to read every bill's detail to state one column — which is what
   * it did, and what made a matter with fifty bills fifty requests.
   *
   * They are three rather than one because a draft and a finalized bill hold the fact in different
   * places, and flattening that would state a figure the record does not have. `matterLinesMinor`
   * is the sum of the matter's own lines and exists from the moment a claim composes one, which is
   * a DRAFT's share. `matterTotalMinor` and `matterAppliedMinor` come from the matter's balance
   * row, which finalization creates — so both are null on a draft, and a null there means "not
   * owed yet", never zero.
   */
  readonly matterLinesMinor?: number;
  readonly matterTotalMinor?: number | null;
  readonly matterAppliedMinor?: number | null;
}

interface InvoiceListRow {
  id: string;
  client_entity_id: string;
  client_name: string | null;
  currency: string;
  status: InvoiceStatus;
  invoice_number: string | null;
  issue_date: string | null;
  due_date: string | null;
  total_minor: number | null;
  applied_minor: number | null;
  created_at: string;
  matter_lines_minor?: number | null;
  matter_total_minor?: number | null;
  matter_applied_minor?: number | null;
}

function toListItem(row: InvoiceListRow): InvoiceListItem {
  const totalMinor = row.total_minor ?? 0;
  const appliedMinor = row.applied_minor ?? 0;
  return {
    id: row.id,
    clientEntityId: row.client_entity_id,
    clientName: row.client_name ?? null,
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
    // Only when the listing was narrowed to a matter; the columns are absent from the statement
    // otherwise, and an absent field is how the caller tells "not asked for" from "none".
    ...(row.matter_lines_minor === undefined
      ? {}
      : {
          matterLinesMinor: row.matter_lines_minor ?? 0,
          matterTotalMinor: row.matter_total_minor ?? null,
          matterAppliedMinor: row.matter_applied_minor ?? null,
        }),
  };
}

export interface ListInvoicesOptions {
  readonly clientEntityId?: string;
  /**
   * Narrows to the bills that charge ONE matter, and adds that matter's share to every row.
   *
   * The predicate is over `invoice_line`, not over the matter's balance row, and that choice is
   * load-bearing: a balance row is created at finalization, so filtering on it would silently drop
   * every draft — and a draft is exactly the bill a matter's own register most needs to see. A
   * draft that charges this matter has a line the moment a claim composes one, which is the fact
   * this asks about. `invoice_line (matter_id, invoice_id)` is the index it rides.
   */
  readonly matterId?: string;
  readonly status?: InvoiceStatus;
  readonly cursor?: string;
  readonly pageSize?: number;
}

export async function listInvoices(
  database: SqlDatabase,
  options: ListInvoicesOptions = {},
): Promise<Page<InvoiceListItem>> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;

  /*
   * The matter's own share, as three correlated reads rather than joins. A join to invoice_line
   * would multiply the invoice row by its lines and need a GROUP BY over every selected column to
   * put it back; correlated subqueries state the same three figures without changing the shape of
   * the result, and each one rides an index whose leading column is the matter.
   *
   * Its bindings are kept apart from the WHERE's because every placeholder in this statement is
   * POSITIONAL, and these sit ahead of the conditions in the SQL text. Numbering them instead (`?4`
   * repeated) reads more cheaply and is wrong here: the cursor predicate and the LIMIT that follow
   * are anonymous, and a statement that mixes the two forms binds by a count the two conventions
   * disagree about.
   */
  const selectBindings: unknown[] = [];
  const matterColumns =
    options.matterId === undefined
      ? ""
      : `,
              COALESCE((SELECT SUM(amount_minor) FROM invoice_line
                         WHERE invoice_id = invoice.id AND matter_id = ?), 0) AS matter_lines_minor,
              (SELECT total_minor FROM invoice_matter_balance
                WHERE invoice_id = invoice.id AND matter_id = ?) AS matter_total_minor,
              (SELECT applied_minor FROM invoice_matter_balance
                WHERE invoice_id = invoice.id AND matter_id = ?) AS matter_applied_minor`;
  if (options.matterId !== undefined) {
    selectBindings.push(options.matterId, options.matterId, options.matterId);
  }

  const conditions: string[] = [];
  const bindings: unknown[] = [];
  if (options.clientEntityId) {
    conditions.push(`invoice.client_entity_id = ?`);
    bindings.push(options.clientEntityId);
  }
  if (options.status) {
    conditions.push(`invoice.status = ?`);
    bindings.push(options.status);
  }
  if (options.matterId !== undefined) {
    conditions.push(
      `EXISTS (SELECT 1 FROM invoice_line WHERE invoice_id = invoice.id AND matter_id = ?)`,
    );
    bindings.push(options.matterId);
  }

  // Qualified, because the statement now joins the directory: `directory_person` carries its own
  // created_at and id, and the bare predicate this read used before would be ambiguous over them.
  appendCursorPredicateOnColumn(conditions, bindings, decodeCursor(options.cursor), {
    sortColumn: "invoice.created_at",
    idColumn: "invoice.id",
    ascending: false,
  });
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const { results } = await database
    .prepare(
      `SELECT invoice.id, invoice.client_entity_id, invoice.currency, invoice.status, invoice.invoice_number,
              invoice.issue_date, invoice.due_date, invoice.created_at,
              COALESCE(directory_person.display_name, directory_organization.display_name,
                       directory_organization.legal_name) AS client_name,
              (SELECT SUM(total_minor) FROM invoice_matter_balance WHERE invoice_id = invoice.id) AS total_minor,
              (SELECT SUM(applied_minor) FROM invoice_matter_balance WHERE invoice_id = invoice.id) AS applied_minor${matterColumns}
         FROM invoice
         LEFT JOIN directory_person
                ON directory_person.id = invoice.client_entity_id AND directory_person.deleted_at IS NULL
         LEFT JOIN directory_organization
                ON directory_organization.id = invoice.client_entity_id AND directory_organization.deleted_at IS NULL
         ${where}
        ORDER BY invoice.created_at DESC, invoice.id DESC
        LIMIT ?`,
    )
    .bind(...selectBindings, ...bindings, pageSize + 1)
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
  // WHETHER THERE IS ANY RECORD OF THIS BILL REACHING THE CLIENT. It rides the detail read rather
  // than waiting to be asked for separately, because the surface that has to show it is the one where
  // a firm decides to take fees out of a client's trust ledger — several jurisdictions expect the
  // client to have been given a bill first — and a fact that has to be fetched on purpose is a fact a
  // surface forgets to show. It is shown, never a gate: finalization gates, and a firm proceeds
  // knowingly, because a hard gate would be satisfied by firms recording deliveries that never
  // happened.
  readonly delivery: InvoiceDeliveryState;
}

export async function readInvoiceDetail(
  database: SqlDatabase,
  invoiceId: InvoiceId,
): Promise<InvoiceDetail | undefined> {
  const { results } = await database
    .prepare(
      // The client's name is resolved here too, so a bill opened straight from its address names
      // its client without the surface having to know how to look one up. The detail read and the
      // listing agree on the name because they resolve it the same way.
      `SELECT invoice.id, invoice.client_entity_id, invoice.currency, invoice.status, invoice.invoice_number,
              invoice.issue_date, invoice.due_date, invoice.created_at,
              COALESCE(directory_person.display_name, directory_organization.display_name,
                       directory_organization.legal_name) AS client_name,
              (SELECT SUM(total_minor) FROM invoice_matter_balance WHERE invoice_id = invoice.id) AS total_minor,
              (SELECT SUM(applied_minor) FROM invoice_matter_balance WHERE invoice_id = invoice.id) AS applied_minor
         FROM invoice
         LEFT JOIN directory_person
                ON directory_person.id = invoice.client_entity_id AND directory_person.deleted_at IS NULL
         LEFT JOIN directory_organization
                ON directory_organization.id = invoice.client_entity_id AND directory_organization.deleted_at IS NULL
        WHERE invoice.id = ?1`,
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

  const delivery = await readInvoiceDeliveryState(database, invoiceId);

  return {
    ...toListItem(row),
    delivery,
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

interface AgingBucketRow {
  bucket_index: number;
  invoice_count: number;
  unpaid_minor: number;
}

const AGING_BUCKET_LABELS = ["current", "1-30", "31-60", "61-90", "90+"] as const;

// THE BUCKETING HAPPENS IN SQL, and five rows come back. The report is five integers, and the
// obvious shape — select every finalized invoice, evaluate an unpaid-balance subquery per row,
// stream them all into the Worker, and add them up in JavaScript — reads the firm's entire billing
// history to produce them. A firm three years in with forty thousand finalized invoices, most of
// them long since paid, would read all forty thousand plus forty thousand correlated aggregates on
// every dashboard load, discarding the paid ones only after fetching them. There is no size at which
// that degrades gracefully; it just gets slower until the request times out.
//
// So: the balances are pre-aggregated once by invoice, joined to the invoice row, bucketed by a
// CASE over the day difference, and summed by the database. `invoice_status_due_date_index` already
// leads with the status. The unpaid > 0 test is applied against that pre-aggregated sum, inside the
// database, rather than as a post-filter in memory — so a paid invoice is never carried out of D1.
export async function readAccountsReceivableAging(
  database: SqlDatabase,
  asOfDate: string,
): Promise<readonly AgingBucket[]> {
  const { results } = await database
    .prepare(
      `SELECT bucket_index, COUNT(*) AS invoice_count, SUM(unpaid_minor) AS unpaid_minor
         FROM (SELECT CASE
                        WHEN julianday(?1) - julianday(i.due_date) <= 0 THEN 0
                        WHEN julianday(?1) - julianday(i.due_date) <= ${AGING_BUCKET_DAYS[0]} THEN 1
                        WHEN julianday(?1) - julianday(i.due_date) <= ${AGING_BUCKET_DAYS[1]} THEN 2
                        WHEN julianday(?1) - julianday(i.due_date) <= ${AGING_BUCKET_DAYS[2]} THEN 3
                        ELSE 4
                      END AS bucket_index,
                      b.unpaid_minor AS unpaid_minor
                 FROM invoice i
                 JOIN (SELECT invoice_id, SUM(total_minor - applied_minor) AS unpaid_minor
                         FROM invoice_matter_balance GROUP BY invoice_id) b
                   ON b.invoice_id = i.id
                WHERE i.status = 'final' AND i.due_date IS NOT NULL AND b.unpaid_minor > 0)
        GROUP BY bucket_index`,
    )
    .bind(asOfDate)
    .all<AgingBucketRow>();

  const buckets = AGING_BUCKET_LABELS.map((label) => ({
    label,
    invoiceCount: 0,
    unpaidMinor: 0,
  }));
  for (const row of results) {
    const bucket = buckets[row.bucket_index];
    if (!bucket) continue;
    bucket.invoiceCount = row.invoice_count;
    bucket.unpaidMinor = row.unpaid_minor;
  }
  return buckets;
}
