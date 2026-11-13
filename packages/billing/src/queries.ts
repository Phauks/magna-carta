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
  /**
   * One status or several. The firm's Billing screen's Status column may hold more than one, and a
   * column filter that narrowed only the loaded page would report a draft missing from a register
   * it had never finished reading, so the whole selection reaches the statement.
   */
  readonly status?: InvoiceStatus | readonly InvoiceStatus[];
  /**
   * Matched against the invoice number and the client's name — the two things a bill is looked
   * for by. The screen's search, honoured here so it reads the whole register.
   */
  readonly search?: string;
  readonly cursor?: string;
  readonly pageSize?: number;
}

/**
 * The register's search, as one predicate over the joined statement. A LIKE scan bounded by the
 * page already asked for; the wildcards are the caller's text, not their instruction.
 */
function invoiceSearchCondition(
  search: string | undefined,
): { readonly condition: string; readonly bindings: readonly unknown[] } | undefined {
  const term = search?.trim();
  if (term === undefined || term.length === 0) return undefined;
  const escaped = term.replaceAll(/[\\%_]/gu, (character) => `\\${character}`);
  const pattern = `%${escaped}%`;
  return {
    condition:
      "(invoice.invoice_number LIKE ? ESCAPE '\\' " +
      "OR directory_person.display_name LIKE ? ESCAPE '\\' " +
      "OR directory_organization.display_name LIKE ? ESCAPE '\\' " +
      "OR directory_organization.legal_name LIKE ? ESCAPE '\\')",
    bindings: [pattern, pattern, pattern, pattern],
  };
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
  const statuses =
    options.status === undefined
      ? []
      : typeof options.status === "string"
        ? [options.status]
        : options.status;
  if (statuses.length > 0) {
    conditions.push(`invoice.status IN (${statuses.map(() => "?").join(", ")})`);
    bindings.push(...statuses);
  }
  if (options.matterId !== undefined) {
    conditions.push(
      `EXISTS (SELECT 1 FROM invoice_line WHERE invoice_id = invoice.id AND matter_id = ?)`,
    );
    bindings.push(options.matterId);
  }
  const search = invoiceSearchCondition(options.search);
  if (search !== undefined) {
    conditions.push(search.condition);
    bindings.push(...search.bindings);
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
    /**
     * The line's matter, named. Resolved here for the same reason the balances are, and needed on
     * the lines SEPARATELY because a DRAFT has lines and no balance rows at all — finalization
     * creates those — so the lines are the only place a draft says which matters it charges.
     */
    readonly matterNumber: string | null;
    readonly matterTitle: string | null;
    readonly kind: string;
    readonly description: string;
    readonly amountMinor: number;
  }[];
  readonly matterBalances: readonly {
    readonly matterId: string;
    /**
     * The matter's own name and number, resolved by this read.
     *
     * A bill belongs to a client and may charge several of that client's matters, so a surface
     * showing what it charges has to NAME them: a list of identifiers asks a reader to choose
     * between strings they cannot read, which is not a choice. Null where no matter row answers to
     * the identifier — an honest gap, never the handle standing in for a name.
     */
    readonly matterNumber: string | null;
    readonly matterTitle: string | null;
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
      `SELECT invoice_line.id, invoice_line.line_index, invoice_line.matter_id, invoice_line.kind,
              invoice_line.description, invoice_line.amount_minor,
              matter.matter_number AS matter_number, matter.title AS matter_title
         FROM invoice_line
         LEFT JOIN matter ON matter.id = invoice_line.matter_id
        WHERE invoice_line.invoice_id = ?1
        ORDER BY invoice_line.line_index`,
    )
    .bind(invoiceId)
    .all<{
      id: string;
      line_index: number;
      matter_id: string;
      kind: string;
      description: string;
      amount_minor: number;
      matter_number: string | null;
      matter_title: string | null;
    }>();
  const balances = await database
    .prepare(
      // The matter's name comes back with its balance rather than a lookup per matter: a bill that
      // charges several of a client's matters would otherwise be one read per row to print a list
      // somebody has to be able to read. An outer join, so a balance whose matter went missing
      // reads back as itself with an unnamed matter rather than vanishing from the bill.
      `SELECT invoice_matter_balance.matter_id, invoice_matter_balance.total_minor,
              invoice_matter_balance.applied_minor,
              matter.matter_number AS matter_number, matter.title AS matter_title
         FROM invoice_matter_balance
         LEFT JOIN matter ON matter.id = invoice_matter_balance.matter_id
        WHERE invoice_matter_balance.invoice_id = ?1
        ORDER BY invoice_matter_balance.matter_id`,
    )
    .bind(invoiceId)
    .all<{
      matter_id: string;
      total_minor: number;
      applied_minor: number;
      matter_number: string | null;
      matter_title: string | null;
    }>();

  const delivery = await readInvoiceDeliveryState(database, invoiceId);

  return {
    ...toListItem(row),
    delivery,
    lines: lines.results.map((line) => ({
      id: line.id,
      lineIndex: line.line_index,
      matterId: line.matter_id,
      matterNumber: line.matter_number,
      matterTitle: line.matter_title,
      kind: line.kind,
      description: line.description,
      amountMinor: line.amount_minor,
    })),
    matterBalances: balances.results.map((balance) => ({
      matterId: balance.matter_id,
      matterNumber: balance.matter_number,
      matterTitle: balance.matter_title,
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

// THE AGING AS AT A PAST DATE, as the firm knew it at a stated instant.
//
// `readAccountsReceivableAging` owns the live answer and stays untouched. This read answers the same
// question for a date the firm has moved past, on the two axes every report is taken over:
//
//   - the EFFECTIVE axis: a bill counts once its issue date is on or before the date — the same date
//     its receivable posting carries — and a payment, credit or write-off counts once its own
//     effective date is.
//   - the KNOWLEDGE axis: a bill counts only if it was finalized by the instant, and an application
//     only if it was recorded by it. A write-off entered next month with a backdated effective date
//     therefore does not change this month's answer re-run under this month's instant.
//
// It cannot read `invoice_matter_balance.applied_minor`, which is the balance NOW. It re-derives the
// applied figure from `invoice_application`, which is append-only: a `reversal` adds back and every
// other kind subtracts, exactly as the running column was moved. The agreement test
// (packages/billing/test/aging-as-of.test.ts) proves that at today's date and the present instant the
// buckets equal the live read's, integer for integer — two answers to one question is the failure this
// read exists to avoid, so the equality is proved rather than assumed.
//
// One difference is deliberate and stated: a bill finalized with an issue date AFTER the date asked
// about is not yet owed as at that date, so it is absent here; the live read, which takes no issue
// date, buckets it as current.
//
// The bucketing is in SQL for the reason the live read's comment gives. The breakdown comes back
// grouped by bucket, client, matter and office, so its size is the number of matters with something
// unpaid rather than the firm's billing history.
export const MAXIMUM_AGING_BREAKDOWN_ROWS = 5000;

export interface AgingAsOfQuery {
  // A civil date on the effective axis.
  readonly asOfDate: string;
  // A UTC instant on the knowledge axis, in the shape `finalized_at` and `applied_at` are written in.
  readonly knownAsOf: string;
}

export interface AgingBreakdownRow {
  // Index into the five buckets: current, 1-30, 31-60, 61-90, 90+.
  readonly bucketIndex: number;
  readonly clientEntityId: string;
  readonly clientName: string | null;
  readonly matterId: string;
  readonly matterTitle: string;
  readonly matterNumber: string | null;
  readonly locationId: string | null;
  readonly locationName: string | null;
  readonly invoiceCount: number;
  readonly unpaidMinor: number;
}

export interface AccountsReceivableAgingAsOf {
  // The firm-wide figure, one per bucket, in the live read's own labels and order.
  readonly buckets: readonly AgingBucket[];
  readonly breakdown: readonly AgingBreakdownRow[];
  // True when the breakdown hit its ceiling. The caller refuses rather than presenting a short list.
  readonly breakdownTruncated: boolean;
}

// The unpaid balance per (invoice, matter) on both axes, with the bucket it falls in. Shared by the
// two statements below so the firm-wide buckets and the breakdown are taken over one definition.
const OPEN_BALANCES_AS_OF = `
  open_balance AS (
    SELECT i.id AS invoice_id,
           i.client_entity_id AS client_entity_id,
           b.matter_id AS matter_id,
           CASE
             WHEN julianday(?1) - julianday(i.due_date) <= 0 THEN 0
             WHEN julianday(?1) - julianday(i.due_date) <= ${AGING_BUCKET_DAYS[0]} THEN 1
             WHEN julianday(?1) - julianday(i.due_date) <= ${AGING_BUCKET_DAYS[1]} THEN 2
             WHEN julianday(?1) - julianday(i.due_date) <= ${AGING_BUCKET_DAYS[2]} THEN 3
             ELSE 4
           END AS bucket_index,
           b.total_minor - COALESCE(
             (SELECT SUM(CASE WHEN a.kind = 'reversal' THEN -a.amount_minor ELSE a.amount_minor END)
                FROM invoice_application a
               WHERE a.invoice_id = b.invoice_id AND a.matter_id = b.matter_id
                 AND a.effective_date <= ?1 AND a.applied_at <= ?2), 0) AS unpaid_minor
      FROM invoice i
      JOIN invoice_matter_balance b ON b.invoice_id = i.id
     WHERE i.status = 'final' AND i.due_date IS NOT NULL
       AND i.issue_date <= ?1 AND i.finalized_at <= ?2
  )`;

export async function readAccountsReceivableAgingAsOf(
  database: SqlDatabase,
  query: AgingAsOfQuery,
): Promise<AccountsReceivableAgingAsOf> {
  const [bucketRows, breakdownRows] = await Promise.all([
    database
      .prepare(
        `WITH ${OPEN_BALANCES_AS_OF}
         SELECT bucket_index, COUNT(DISTINCT invoice_id) AS invoice_count, SUM(unpaid_minor) AS unpaid_minor
           FROM open_balance WHERE unpaid_minor > 0
          GROUP BY bucket_index`,
      )
      .bind(query.asOfDate, query.knownAsOf)
      .all<AgingBucketRow>(),
    database
      .prepare(
        `WITH ${OPEN_BALANCES_AS_OF}
         SELECT o.bucket_index AS bucket_index,
                o.client_entity_id AS client_entity_id,
                m.client_display_name AS client_name,
                o.matter_id AS matter_id,
                m.title AS matter_title,
                m.matter_number AS matter_number,
                m.location_id AS location_id,
                l.name AS location_name,
                COUNT(DISTINCT o.invoice_id) AS invoice_count,
                SUM(o.unpaid_minor) AS unpaid_minor
           FROM open_balance o
           JOIN matter m ON m.id = o.matter_id
           LEFT JOIN location l ON l.id = m.location_id
          WHERE o.unpaid_minor > 0
          GROUP BY o.bucket_index, o.client_entity_id, o.matter_id
          ORDER BY o.client_entity_id, o.matter_id, o.bucket_index
          LIMIT ?3`,
      )
      .bind(query.asOfDate, query.knownAsOf, MAXIMUM_AGING_BREAKDOWN_ROWS + 1)
      .all<{
        bucket_index: number;
        client_entity_id: string;
        client_name: string | null;
        matter_id: string;
        matter_title: string;
        matter_number: string | null;
        location_id: string | null;
        location_name: string | null;
        invoice_count: number;
        unpaid_minor: number;
      }>(),
  ]);

  const buckets = AGING_BUCKET_LABELS.map((label) => ({
    label,
    invoiceCount: 0,
    unpaidMinor: 0,
  }));
  for (const row of bucketRows.results) {
    const bucket = buckets[row.bucket_index];
    if (!bucket) continue;
    bucket.invoiceCount = row.invoice_count;
    bucket.unpaidMinor = row.unpaid_minor;
  }
  const truncated = breakdownRows.results.length > MAXIMUM_AGING_BREAKDOWN_ROWS;
  const breakdown = breakdownRows.results.slice(0, MAXIMUM_AGING_BREAKDOWN_ROWS).map((row) => ({
    bucketIndex: row.bucket_index,
    clientEntityId: row.client_entity_id,
    clientName: row.client_name,
    matterId: row.matter_id,
    matterTitle: row.matter_title,
    matterNumber: row.matter_number,
    locationId: row.location_id,
    locationName: row.location_name,
    invoiceCount: row.invoice_count,
    unpaidMinor: row.unpaid_minor,
  }));
  return { buckets, breakdown, breakdownTruncated: truncated };
}

// WORK IN PROGRESS ACROSS THE FIRM, broken down by matter and timekeeper — the firm-wide companion to
// `readUnbilledWorkInProgress`, over the same mirror columns and the same predicate, so that for every
// matter the "not on a draft" figures here equal that read's integer for integer
// (packages/billing/test/work-in-progress-breakdown.test.ts proves it).
//
// LIVE ONLY, and it takes no date at all. Both stores are mutable working stores — a narrative or a
// duration is fixed during bill review, a re-rate rewrites `amount_minor`, and an entry carries no
// `billed_at` or `voided_at` — so "unbilled as of 30 June" asked in August is not answerable from
// stored data, and accepting a date would answer it with today's figure.
//
// Work held by a draft bill is reported beside the rest rather than dropped: it is still unbilled until
// the draft is finalized, and a firm reading its work in progress wants to see both what is waiting to
// be billed and what is already on a bill being reviewed.
export const MAXIMUM_WORK_IN_PROGRESS_ROWS = 5000;

export interface WorkInProgressBreakdownRow {
  readonly kind: "time" | "cost";
  readonly matterId: string;
  readonly matterTitle: string;
  readonly matterNumber: string | null;
  // The matter's client, as the matter-party link names it, with the matter's own caption for it.
  readonly clientEntityId: string | null;
  readonly clientName: string | null;
  readonly locationId: string | null;
  readonly locationName: string | null;
  // Null on a cost row: a cost has no timekeeper.
  readonly timekeeperUserId: string | null;
  readonly timekeeperName: string | null;
  // Whether a draft bill holds these entries.
  readonly onDraft: boolean;
  readonly entryCount: number;
  // Zero on a cost row.
  readonly minutes: number;
  readonly amountMinor: number;
}

export interface WorkInProgressBreakdown {
  readonly rows: readonly WorkInProgressBreakdownRow[];
  readonly truncated: boolean;
}

interface WorkInProgressRow {
  kind: "time" | "cost";
  matter_id: string;
  matter_title: string;
  matter_number: string | null;
  client_entity_id: string | null;
  client_name: string | null;
  location_id: string | null;
  location_name: string | null;
  timekeeper_user_id: string | null;
  timekeeper_name: string | null;
  on_draft: number;
  entry_count: number;
  minutes: number;
  amount_minor: number;
}

export async function readWorkInProgressBreakdown(
  database: SqlDatabase,
): Promise<WorkInProgressBreakdown> {
  // The matter's client is read from `matter_party`, the one home for that link; a matter with two
  // client parties is attributed to the lower identifier so the attribution is stable run to run.
  const { results } = await database
    .prepare(
      `WITH work AS (
         SELECT 'time' AS kind, t.matter_id, t.timekeeper_user_id,
                CASE WHEN t.invoice_id IS NULL THEN 0 ELSE 1 END AS on_draft,
                COUNT(*) AS entry_count, SUM(t.duration_minutes) AS minutes,
                SUM(t.amount_minor) AS amount_minor
           FROM time_entry t
          WHERE t.status NOT IN ('billed', 'void') AND t.amount_minor IS NOT NULL
          GROUP BY t.matter_id, t.timekeeper_user_id, on_draft
         UNION ALL
         SELECT 'cost' AS kind, c.matter_id, NULL AS timekeeper_user_id,
                CASE WHEN c.invoice_id IS NULL THEN 0 ELSE 1 END AS on_draft,
                COUNT(*) AS entry_count, 0 AS minutes, SUM(c.amount_minor) AS amount_minor
           FROM cost_entry c
          WHERE c.status NOT IN ('billed', 'void')
          GROUP BY c.matter_id, on_draft
       )
       SELECT w.kind, w.matter_id, m.title AS matter_title, m.matter_number,
              (SELECT MIN(p.entity_id) FROM matter_party p
                WHERE p.matter_id = w.matter_id AND p.role = 'client') AS client_entity_id,
              m.client_display_name AS client_name,
              m.location_id, l.name AS location_name,
              w.timekeeper_user_id, mem.display_name AS timekeeper_name,
              w.on_draft, w.entry_count, w.minutes, w.amount_minor
         FROM work w
         JOIN matter m ON m.id = w.matter_id
         LEFT JOIN location l ON l.id = m.location_id
         LEFT JOIN member mem ON mem.user_id = w.timekeeper_user_id
        ORDER BY w.matter_id, w.kind, w.timekeeper_user_id, w.on_draft
        LIMIT ?1`,
    )
    .bind(MAXIMUM_WORK_IN_PROGRESS_ROWS + 1)
    .all<WorkInProgressRow>();
  const truncated = results.length > MAXIMUM_WORK_IN_PROGRESS_ROWS;
  return {
    truncated,
    rows: results.slice(0, MAXIMUM_WORK_IN_PROGRESS_ROWS).map((row) => ({
      kind: row.kind,
      matterId: row.matter_id,
      matterTitle: row.matter_title,
      matterNumber: row.matter_number,
      clientEntityId: row.client_entity_id,
      clientName: row.client_name,
      locationId: row.location_id,
      locationName: row.location_name,
      timekeeperUserId: row.timekeeper_user_id,
      timekeeperName: row.timekeeper_name,
      onDraft: row.on_draft === 1,
      entryCount: row.entry_count,
      minutes: row.minutes,
      amountMinor: row.amount_minor,
    })),
  };
}
