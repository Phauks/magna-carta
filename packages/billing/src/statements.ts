import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  InvoiceId,
  InvoiceLineId,
  InvoiceWipClaimId,
  LocationId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import { MAX_BOUND_PARAMETERS } from "@magna-carta/ledger/statements";
import type {
  InvoiceClaimSnapshot,
  InvoiceLineKind,
  InvoiceLineSnapshot,
  InvoiceMatterBalanceSnapshot,
  InvoiceSnapshot,
  InvoiceStatus,
  InvoiceTaxTreatment,
  WorkInProgressKind,
} from "./types.ts";

// The work-in-progress table each claim kind mirrors into. Both carry an invoice_id column that
// nothing set before this package existed.
const WORK_IN_PROGRESS_TABLES: Record<WorkInProgressKind, string> = {
  time_entry: "time_entry",
  cost_entry: "cost_entry",
};

export interface InsertInvoiceInput {
  readonly id: InvoiceId;
  readonly clientEntityId: string;
  readonly currency: string;
  readonly billingPeriodStart: string | null;
  readonly billingPeriodEnd: string | null;
  readonly notes: string | null;
  readonly locationId: LocationId | null;
  readonly createdBy: UserId | null;
  readonly now: string;
}

export function insertInvoiceStatement(
  database: SqlDatabase,
  input: InsertInvoiceInput,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO invoice (id, client_entity_id, currency, status, billing_period_start, billing_period_end, notes, location_id, created_at, updated_at, created_by)
       VALUES (?1, ?2, ?3, 'draft', ?4, ?5, ?6, ?7, ?8, ?8, ?9)`,
    )
    .bind(
      input.id,
      input.clientEntityId,
      input.currency,
      input.billingPeriodStart,
      input.billingPeriodEnd,
      input.notes,
      input.locationId,
      input.now,
      input.createdBy,
    );
}

export interface FinalizeInvoiceInput {
  readonly id: InvoiceId;
  readonly invoiceNumber: string;
  readonly numberScopeKey: string;
  readonly numberDrawnValue: number;
  readonly issueDate: string;
  readonly dueDate: string;
  readonly locationId: LocationId | null;
  readonly letterheadAddressBlock: string | null;
  readonly letterheadFooter: string | null;
  readonly remitTo: string | null;
  readonly clientBillingName: string | null;
  readonly finalizedBy: UserId | null;
  readonly now: string;
}

// The one UPDATE that moves an invoice into evidence, and the last one the row will ever take: the
// freeze trigger reads OLD.status, so this passes and everything after it aborts.
//
// `AND status = 'draft'` is a mirror of the trigger rather than the guarantee — a zero-row UPDATE
// aborts nothing in SQLite. The real guarantee is the allocation row this batch also carries, which
// is unique per invoice: a second finalize of the same invoice loses on
// invoice_number_allocation_invoice_unique_index and its whole batch rolls back.
export function finalizeInvoiceStatement(
  database: SqlDatabase,
  input: FinalizeInvoiceInput,
): SqlStatement {
  return database
    .prepare(
      `UPDATE invoice
          SET status = 'final',
              invoice_number = ?2,
              number_scope_key = ?3,
              number_drawn_value = ?4,
              issue_date = ?5,
              due_date = ?6,
              location_id = COALESCE(?7, location_id),
              letterhead_address_block = ?8,
              letterhead_footer = ?9,
              remit_to = ?10,
              client_billing_name = ?11,
              finalized_at = ?12,
              finalized_by = ?13,
              updated_at = ?12
        WHERE id = ?1 AND status = 'draft'`,
    )
    .bind(
      input.id,
      input.invoiceNumber,
      input.numberScopeKey,
      input.numberDrawnValue,
      input.issueDate,
      input.dueDate,
      input.locationId,
      input.letterheadAddressBlock,
      input.letterheadFooter,
      input.remitTo,
      input.clientBillingName,
      input.now,
      input.finalizedBy,
    );
}

export function voidInvoiceStatement(
  database: SqlDatabase,
  id: InvoiceId,
  reason: string,
  voidedBy: UserId | null,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE invoice SET status = 'void', voided_at = ?4, voided_by = ?3, void_reason = ?2, updated_at = ?4
        WHERE id = ?1 AND status = 'draft'`,
    )
    .bind(id, reason, voidedBy, now);
}

export interface InsertInvoiceLineInput {
  readonly id: InvoiceLineId;
  readonly invoiceId: InvoiceId;
  readonly lineIndex: number;
  readonly matterId: MatterId;
  readonly kind: InvoiceLineKind;
  readonly description: string;
  readonly quantityE4: number | null;
  readonly rateE4: number | null;
  readonly amountMinor: number;
  readonly currency: string;
  readonly utbmsTaskCode: string | null;
  readonly utbmsActivityCode: string | null;
  readonly utbmsExpenseCode: string | null;
  readonly taxTreatment: InvoiceTaxTreatment;
  readonly now: string;
}

export function insertInvoiceLineStatement(
  database: SqlDatabase,
  input: InsertInvoiceLineInput,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO invoice_line (id, invoice_id, line_index, matter_id, kind, description, quantity_e4, rate_e4, amount_minor, currency, utbms_task_code, utbms_activity_code, utbms_expense_code, tax_treatment, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)`,
    )
    .bind(
      input.id,
      input.invoiceId,
      input.lineIndex,
      input.matterId,
      input.kind,
      input.description,
      input.quantityE4,
      input.rateE4,
      input.amountMinor,
      input.currency,
      input.utbmsTaskCode,
      input.utbmsActivityCode,
      input.utbmsExpenseCode,
      input.taxTreatment,
      input.now,
    );
}

// Bill review edits the LINE, never the time entry it was composed from: the entry is the
// timekeeper's contemporaneous record of what was done, and the line is what the client was told.
export function updateInvoiceLineStatement(
  database: SqlDatabase,
  id: InvoiceLineId,
  fields: {
    readonly description: string;
    readonly quantityE4: number | null;
    readonly rateE4: number | null;
    readonly amountMinor: number;
    readonly taxTreatment: InvoiceTaxTreatment;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE invoice_line SET description = ?2, quantity_e4 = ?3, rate_e4 = ?4, amount_minor = ?5, tax_treatment = ?6 WHERE id = ?1`,
    )
    .bind(
      id,
      fields.description,
      fields.quantityE4,
      fields.rateE4,
      fields.amountMinor,
      fields.taxTreatment,
    );
}

export function deleteInvoiceLineStatement(database: SqlDatabase, id: InvoiceLineId): SqlStatement {
  return database.prepare(`DELETE FROM invoice_line WHERE id = ?1`).bind(id);
}

export interface InsertInvoiceClaimInput {
  readonly id: InvoiceWipClaimId;
  readonly invoiceId: InvoiceId;
  readonly sourceKind: WorkInProgressKind;
  readonly sourceId: string;
  readonly invoiceLineId: InvoiceLineId | null;
  readonly claimedAmountMinor: number;
  readonly now: string;
}

// THE guard. Two drafts claiming one entry both reach here; the partial unique index on
// (source_kind, source_id) WHERE released_at IS NULL makes the loser's INSERT abort its whole batch,
// which is a real refusal the caller can retry or report.
export function insertInvoiceClaimStatement(
  database: SqlDatabase,
  input: InsertInvoiceClaimInput,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO invoice_wip_claim (id, invoice_id, source_kind, source_id, invoice_line_id, claimed_amount_minor, claimed_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
    .bind(
      input.id,
      input.invoiceId,
      input.sourceKind,
      input.sourceId,
      input.invoiceLineId,
      input.claimedAmountMinor,
      input.now,
    );
}

export function isClaimConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("UNIQUE constraint failed") &&
    error.message.includes("invoice_wip_claim.source_kind")
  );
}

// Releasing ONE claim off a draft. The line that presented it goes with it — removing a claimed
// entry from a working document removes what the client would have been shown — so the claim lets go
// of its invoice_line_id in the same statement, ahead of the line's DELETE in the same batch. The
// claim row itself REMAINS, released and readable: "this entry was on a draft that was abandoned on
// the 3rd" is the history the release is designed to keep.
export function releaseInvoiceClaimStatement(
  database: SqlDatabase,
  id: InvoiceWipClaimId,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE invoice_wip_claim SET released_at = ?2, invoice_line_id = NULL WHERE id = ?1 AND released_at IS NULL`,
    )
    .bind(id, now);
}

export function releaseAllInvoiceClaimsStatement(
  database: SqlDatabase,
  invoiceId: InvoiceId,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE invoice_wip_claim SET released_at = ?2 WHERE invoice_id = ?1 AND released_at IS NULL`,
    )
    .bind(invoiceId, now);
}

// The MIRROR, not the guard. The entry's invoice_id column exists so "what is still unbilled on this
// matter" is a single-table read with no join — the hot read. The claim row above is the truth, and
// the partial unique index on it is what actually stops a second draft taking the same entry. A
// guarded `UPDATE … WHERE invoice_id IS NULL` looks like it would, and does not: a zero-row UPDATE
// is not an error in SQLite, so the losing batch would commit happily having changed nothing.
export function setWorkInProgressInvoiceMirrorStatement(
  database: SqlDatabase,
  sourceKind: WorkInProgressKind,
  sourceId: string,
  invoiceId: InvoiceId,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${WORK_IN_PROGRESS_TABLES[sourceKind]} SET invoice_id = ?2, updated_at = ?3 WHERE id = ?1 AND invoice_id IS NULL`,
    )
    .bind(sourceId, invoiceId, now);
}

// Releasing one claim on a draft returns that entry to unbilled work-in-progress: the mirror is
// nulled alongside the claim's released_at, in the same batch. Guarded on the invoice it is being
// released from, so a mirror another draft has since taken is never cleared out from under it.
export function clearWorkInProgressInvoiceMirrorForSourceStatement(
  database: SqlDatabase,
  sourceKind: WorkInProgressKind,
  sourceId: string,
  invoiceId: InvoiceId,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${WORK_IN_PROGRESS_TABLES[sourceKind]} SET invoice_id = NULL, updated_at = ?3 WHERE id = ?1 AND invoice_id = ?2`,
    )
    .bind(sourceId, invoiceId, now);
}

// Voiding a draft releases everything it held at once, on both stores.
export function clearWorkInProgressInvoiceMirrorStatement(
  database: SqlDatabase,
  sourceKind: WorkInProgressKind,
  invoiceId: InvoiceId,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${WORK_IN_PROGRESS_TABLES[sourceKind]} SET invoice_id = NULL, updated_at = ?2 WHERE invoice_id = ?1`,
    )
    .bind(invoiceId, now);
}

// The lock, composed only inside the finalize batch. `AND status = ?3` mirrors the transition
// @magna-carta/billing-core already asserted in memory; it is not the guarantee, because a zero-row
// UPDATE aborts nothing. The guarantee against a concurrent void is
// refuseFinalizeOnFrozenWorkInProgressStatements below.
export function markWorkInProgressBilledStatement(
  database: SqlDatabase,
  sourceKind: WorkInProgressKind,
  sourceId: string,
  fromStatus: string,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${WORK_IN_PROGRESS_TABLES[sourceKind]} SET status = 'billed', updated_at = ?3 WHERE id = ?1 AND status = ?2`,
    )
    .bind(sourceId, fromStatus, now);
}

// The commit guard. `billed` and `void` are terminal in the shared freeze contract, so an entry that
// reached either between the finalize read and the commit must not be locked onto this invoice. This
// statement aims a status value the table's CHECK forbids at exactly those rows: it matches nothing
// when every claimed entry is still open, and aborts the WHOLE finalize batch when one is not. A
// guarded UPDATE matching zero rows would instead leave the invoice finalized, the number consumed,
// and the receivable posted against work that had been voided.
//
// Chunked at D1's bound-parameter cap: a wide invoice claims more entries than one IN-list can hold,
// and an over-long list commits fine locally but throws on production D1.
export function refuseFinalizeOnFrozenWorkInProgressStatements(
  database: SqlDatabase,
  sourceKind: WorkInProgressKind,
  sourceIds: readonly string[],
): SqlStatement[] {
  const statements: SqlStatement[] = [];
  for (let start = 0; start < sourceIds.length; start += MAX_BOUND_PARAMETERS) {
    const chunk = sourceIds.slice(start, start + MAX_BOUND_PARAMETERS);
    const placeholders = chunk.map((_, index) => `?${index + 1}`).join(", ");
    statements.push(
      database
        .prepare(
          `UPDATE ${WORK_IN_PROGRESS_TABLES[sourceKind]} SET status = 'billing-refused-frozen-entry'
            WHERE id IN (${placeholders}) AND status IN ('billed', 'void')`,
        )
        .bind(...chunk),
    );
  }
  return statements;
}

export function insertInvoiceMatterBalanceStatement(
  database: SqlDatabase,
  invoiceId: InvoiceId,
  matterId: MatterId,
  totalMinor: number,
  currency: string,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO invoice_matter_balance (invoice_id, matter_id, total_minor, applied_minor, currency, created_at, updated_at)
       VALUES (?1, ?2, ?3, 0, ?4, ?5, ?5)`,
    )
    .bind(invoiceId, matterId, totalMinor, currency, now);
}

interface InvoiceRow {
  id: string;
  client_entity_id: string;
  currency: string;
  status: InvoiceStatus;
  invoice_number: string | null;
  issue_date: string | null;
  due_date: string | null;
}

// `.all()` + `results[0]`, never `.first()` — the node-sqlite test adapter has no `.first()`, so the
// whole platform reads this way.
export async function readInvoice(
  database: SqlDatabase,
  id: InvoiceId,
): Promise<InvoiceSnapshot | undefined> {
  const { results } = await database
    .prepare(
      `SELECT id, client_entity_id, currency, status, invoice_number, issue_date, due_date FROM invoice WHERE id = ?1`,
    )
    .bind(id)
    .all<InvoiceRow>();
  const row = results[0];
  if (!row) return undefined;
  return {
    id: row.id,
    clientEntityId: row.client_entity_id,
    currency: row.currency,
    status: row.status,
    invoiceNumber: row.invoice_number,
    issueDate: row.issue_date,
    dueDate: row.due_date,
  };
}

interface InvoiceLineRow {
  id: string;
  invoice_id: string;
  line_index: number;
  matter_id: string;
  kind: InvoiceLineKind;
  description: string;
  quantity_e4: number | null;
  rate_e4: number | null;
  amount_minor: number;
  currency: string;
  tax_treatment: InvoiceTaxTreatment;
}

export async function readInvoiceLines(
  database: SqlDatabase,
  invoiceId: InvoiceId,
): Promise<InvoiceLineSnapshot[]> {
  const { results } = await database
    .prepare(
      `SELECT id, invoice_id, line_index, matter_id, kind, description, quantity_e4, rate_e4, amount_minor, currency, tax_treatment
         FROM invoice_line WHERE invoice_id = ?1 ORDER BY line_index`,
    )
    .bind(invoiceId)
    .all<InvoiceLineRow>();
  return results.map((row) => ({
    id: row.id,
    invoiceId: row.invoice_id,
    lineIndex: row.line_index,
    matterId: row.matter_id,
    kind: row.kind,
    description: row.description,
    quantityE4: row.quantity_e4,
    rateE4: row.rate_e4,
    amountMinor: row.amount_minor,
    currency: row.currency,
    taxTreatment: row.tax_treatment,
  }));
}

export async function readInvoiceLine(
  database: SqlDatabase,
  id: InvoiceLineId,
): Promise<InvoiceLineSnapshot | undefined> {
  const { results } = await database
    .prepare(
      `SELECT id, invoice_id, line_index, matter_id, kind, description, quantity_e4, rate_e4, amount_minor, currency, tax_treatment
         FROM invoice_line WHERE id = ?1`,
    )
    .bind(id)
    .all<InvoiceLineRow>();
  const row = results[0];
  if (!row) return undefined;
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    lineIndex: row.line_index,
    matterId: row.matter_id,
    kind: row.kind,
    description: row.description,
    quantityE4: row.quantity_e4,
    rateE4: row.rate_e4,
    amountMinor: row.amount_minor,
    currency: row.currency,
    taxTreatment: row.tax_treatment,
  };
}

interface InvoiceClaimRow {
  id: string;
  invoice_id: string;
  source_kind: WorkInProgressKind;
  source_id: string;
  invoice_line_id: string | null;
  claimed_amount_minor: number;
  released_at: string | null;
}

export async function readActiveInvoiceClaims(
  database: SqlDatabase,
  invoiceId: InvoiceId,
): Promise<InvoiceClaimSnapshot[]> {
  const { results } = await database
    .prepare(
      `SELECT id, invoice_id, source_kind, source_id, invoice_line_id, claimed_amount_minor, released_at
         FROM invoice_wip_claim WHERE invoice_id = ?1 AND released_at IS NULL ORDER BY claimed_at, id`,
    )
    .bind(invoiceId)
    .all<InvoiceClaimRow>();
  return results.map((row) => ({
    id: row.id,
    invoiceId: row.invoice_id,
    sourceKind: row.source_kind,
    sourceId: row.source_id,
    invoiceLineId: row.invoice_line_id,
    claimedAmountMinor: row.claimed_amount_minor,
    releasedAt: row.released_at,
  }));
}

export async function readInvoiceClaim(
  database: SqlDatabase,
  id: InvoiceWipClaimId,
): Promise<InvoiceClaimSnapshot | undefined> {
  const { results } = await database
    .prepare(
      `SELECT id, invoice_id, source_kind, source_id, invoice_line_id, claimed_amount_minor, released_at
         FROM invoice_wip_claim WHERE id = ?1`,
    )
    .bind(id)
    .all<InvoiceClaimRow>();
  const row = results[0];
  if (!row) return undefined;
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    sourceKind: row.source_kind,
    sourceId: row.source_id,
    invoiceLineId: row.invoice_line_id,
    claimedAmountMinor: row.claimed_amount_minor,
    releasedAt: row.released_at,
  };
}

interface InvoiceMatterBalanceRow {
  invoice_id: string;
  matter_id: string;
  total_minor: number;
  applied_minor: number;
  currency: string;
}

export async function readInvoiceMatterBalances(
  database: SqlDatabase,
  invoiceId: InvoiceId,
): Promise<InvoiceMatterBalanceSnapshot[]> {
  const { results } = await database
    .prepare(
      `SELECT invoice_id, matter_id, total_minor, applied_minor, currency FROM invoice_matter_balance WHERE invoice_id = ?1 ORDER BY matter_id`,
    )
    .bind(invoiceId)
    .all<InvoiceMatterBalanceRow>();
  return results.map((row) => ({
    invoiceId: row.invoice_id,
    matterId: row.matter_id,
    totalMinor: row.total_minor,
    appliedMinor: row.applied_minor,
    currency: row.currency,
  }));
}

// The client link is `matter_party` where role = 'client'. `matter.client_display_name` is
// display-only and is deliberately NOT the link: an invoice attributed by a display string is an
// invoice that cannot be applied from the right client's trust ledger.
//
// Batched over every matter a claim request touches, in one read per chunk: a bill spanning several
// of a client's matters would otherwise resolve the same link once per claimed entry. The earliest
// client party wins per matter, which is what a single-row read would have returned.
export async function readMatterClientEntityIds(
  database: SqlDatabase,
  matterIds: readonly MatterId[],
): Promise<Map<string, string>> {
  const clientByMatter = new Map<string, string>();
  for (let start = 0; start < matterIds.length; start += MAX_BOUND_PARAMETERS) {
    const chunk = matterIds.slice(start, start + MAX_BOUND_PARAMETERS);
    if (chunk.length === 0) continue;
    const placeholders = chunk.map((_, index) => `?${index + 1}`).join(", ");
    const { results } = await database
      .prepare(
        `SELECT matter_id, entity_id FROM matter_party
          WHERE matter_id IN (${placeholders}) AND role = 'client' AND deleted_at IS NULL
          ORDER BY created_at, id`,
      )
      .bind(...chunk)
      .all<{ matter_id: string; entity_id: string }>();
    for (const row of results) {
      if (!clientByMatter.has(row.matter_id)) clientByMatter.set(row.matter_id, row.entity_id);
    }
  }
  return clientByMatter;
}
