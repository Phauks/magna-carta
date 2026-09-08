import {
  DEFAULT_PAGE_SIZE,
  decodeCursor,
  encodeCursor,
  keysetClause,
  type Page,
} from "@magna-carta/data-access/cursor-pagination";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  BillingArrangementId,
  ClientCreditId,
  CreditNoteId,
  CreditNoteLineId,
  InvoiceApplicationId,
  InvoiceDeliveryId,
  InvoiceId,
  InvoiceLineId,
  InvoiceTrustApplicationLineId,
  InvoiceWipClaimId,
  LedgerEntryId,
  LocationId,
  MatterId,
  TrustDisbursementRequestId,
  TrustTransferId,
  UserId,
} from "@magna-carta/identifiers/types";
import { MAX_BOUND_PARAMETERS } from "@magna-carta/ledger/statements";
import type {
  InvoiceApplicationKind,
  InvoiceApplicationSnapshot,
  InvoiceClaimSnapshot,
  InvoiceDeliveryChannel,
  InvoiceDeliveryOutcome,
  InvoiceLineKind,
  InvoiceLineSnapshot,
  InvoiceMatterBalanceSnapshot,
  InvoiceRenderShape,
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
  fee_entry: "fee_entry",
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
  // How a bill spanning several matters is presented — SNAPSHOT here like the letterhead, so a
  // later change to the firm's default never re-shapes a document already given to a client.
  readonly renderShape: InvoiceRenderShape;
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
              render_shape = ?14,
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
      input.renderShape,
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
  // The fee-agreement version that composed this line, for the lines an arrangement produces (a
  // flat fee, a contingency fee); null on hourly and cost lines.
  readonly billingArrangementId?: BillingArrangementId | null;
  readonly now: string;
}

export function insertInvoiceLineStatement(
  database: SqlDatabase,
  input: InsertInvoiceLineInput,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO invoice_line (id, invoice_id, line_index, matter_id, kind, description, quantity_e4, rate_e4, amount_minor, currency, utbms_task_code, utbms_activity_code, utbms_expense_code, tax_treatment, billing_arrangement_id, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)`,
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
      input.billingArrangementId ?? null,
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

export interface InsertInvoiceApplicationInput {
  readonly id: InvoiceApplicationId;
  readonly invoiceId: InvoiceId;
  readonly matterId: MatterId;
  readonly kind: InvoiceApplicationKind;
  readonly amountMinor: number;
  readonly currency: string;
  readonly trustTransferId: TrustTransferId | null;
  readonly reversesApplicationId: InvoiceApplicationId | null;
  readonly creditNoteId: CreditNoteId | null;
  readonly clientCreditId: ClientCreditId | null;
  readonly entryId: LedgerEntryId | null;
  readonly reason: string | null;
  readonly effectiveDate: string;
  readonly appliedBy: UserId | null;
  readonly now: string;
}

// One unit of value reaching an invoice. Append-only by trigger: an application that could be edited
// would let money that reached a bill be quietly un-reached, because the balance delta it rode with
// has already moved and an edit here would desynchronize the subledger from the control account with
// no record of having done so. A mistaken application is corrected by a reversal row.
export function insertInvoiceApplicationStatement(
  database: SqlDatabase,
  input: InsertInvoiceApplicationInput,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO invoice_application (id, invoice_id, matter_id, kind, amount_minor, currency, trust_transfer_id, reverses_application_id, credit_note_id, client_credit_id, entry_id, reason, effective_date, applied_by, applied_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)`,
    )
    .bind(
      input.id,
      input.invoiceId,
      input.matterId,
      input.kind,
      input.amountMinor,
      input.currency,
      input.trustTransferId,
      input.reversesApplicationId,
      input.creditNoteId,
      input.clientCreditId,
      input.entryId,
      input.reason,
      input.effectiveDate,
      input.appliedBy,
      input.now,
    );
}

// THE GUARANTEE, and the reason the balance table exists at all.
//
// This is an unguarded delta on purpose. D1 has no interactive transactions, so a bounds CHECK is the
// only mechanism that can abort a whole batch on a business condition — and
// `applied_minor >= 0 AND applied_minor <= total_minor` is that CHECK. A concurrent transfer,
// payment, or credit note that consumed the balance between the pre-check's read and this commit
// pushes the sum past `total_minor` and aborts the ENTIRE batch: the trust entries, the transfer
// link, this application, and the idempotency record together.
//
// Writing it as `... WHERE total_minor - applied_minor >= ?` instead would look safer and be
// strictly worse: a zero-row UPDATE is not an error in SQLite, so the losing batch would commit
// happily having moved no balance while its trust entries — real money out of a client's ledger —
// committed beside it. Same arrangement, for the same reason, as the trust leaf's account_balance
// floor: a domain pre-check that names a refusal a person can act on, standing in front of a
// database constraint that is the actual guarantee.
export function applyToInvoiceMatterBalanceStatement(
  database: SqlDatabase,
  invoiceId: InvoiceId,
  matterId: MatterId,
  deltaMinor: number,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE invoice_matter_balance SET applied_minor = applied_minor + ?3, updated_at = ?4
        WHERE invoice_id = ?1 AND matter_id = ?2`,
    )
    .bind(invoiceId, matterId, deltaMinor, now);
}

// --- Corrections after finalization -------------------------------------------------------------

export interface InsertCreditNoteInput {
  readonly id: CreditNoteId;
  readonly invoiceId: InvoiceId;
  readonly currency: string;
  readonly reason: string;
  readonly effectiveDate: string;
  readonly entryId: LedgerEntryId;
  readonly issuedBy: UserId | null;
  readonly now: string;
}

// The correction itself. Append-only by trigger, and refused outright against anything but a
// finalized invoice — a draft is edited, and a voided draft asserted nothing to anybody.
export function insertCreditNoteStatement(
  database: SqlDatabase,
  input: InsertCreditNoteInput,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO credit_note (id, invoice_id, currency, reason, effective_date, entry_id, issued_by, issued_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
    .bind(
      input.id,
      input.invoiceId,
      input.currency,
      input.reason,
      input.effectiveDate,
      input.entryId,
      input.issuedBy,
      input.now,
    );
}

export interface InsertCreditNoteLineInput {
  readonly id: CreditNoteLineId;
  readonly creditNoteId: CreditNoteId;
  readonly lineIndex: number;
  readonly matterId: MatterId;
  readonly kind: InvoiceLineKind;
  readonly description: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly creditsInvoiceLineId: InvoiceLineId | null;
  readonly now: string;
}

export function insertCreditNoteLineStatement(
  database: SqlDatabase,
  input: InsertCreditNoteLineInput,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO credit_note_line (id, credit_note_id, line_index, matter_id, kind, description, amount_minor, currency, credits_invoice_line_id, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    )
    .bind(
      input.id,
      input.creditNoteId,
      input.lineIndex,
      input.matterId,
      input.kind,
      input.description,
      input.amountMinor,
      input.currency,
      input.creditsInvoiceLineId,
      input.now,
    );
}

export interface InsertClientCreditInput {
  readonly id: ClientCreditId;
  readonly clientEntityId: string;
  readonly matterId: MatterId;
  readonly creditNoteId: CreditNoteId;
  readonly amountMinor: number;
  readonly currency: string;
  readonly openedBy: UserId | null;
  readonly now: string;
}

export function insertClientCreditStatement(
  database: SqlDatabase,
  input: InsertClientCreditInput,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO client_credit (id, client_entity_id, matter_id, credit_note_id, amount_minor, discharged_minor, currency, opened_by, opened_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7, ?8, ?8)`,
    )
    .bind(
      input.id,
      input.clientEntityId,
      input.matterId,
      input.creditNoteId,
      input.amountMinor,
      input.currency,
      input.openedBy,
      input.now,
    );
}

// THE SECOND UNGUARDED DELTA, and the same reasoning as the balance one above. Two discharges of one
// credit racing for the same remainder both read it as available; this drives `discharged_minor`
// past `amount_minor` and the bounds CHECK aborts the loser's WHOLE batch, ledger entry included.
// `... WHERE amount_minor - discharged_minor >= ?` would look safer and be strictly worse: a
// zero-row UPDATE is not an error in SQLite, so the loser would commit its posting beside a credit
// that never moved. A reversal passes a negative delta and the CHECK's lower bound catches giving
// back more than was ever taken.
export function dischargeClientCreditStatement(
  database: SqlDatabase,
  id: ClientCreditId,
  deltaMinor: number,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE client_credit SET discharged_minor = discharged_minor + ?2, updated_at = ?3 WHERE id = ?1`,
    )
    .bind(id, deltaMinor, now);
}

export interface CreditNoteSnapshot {
  readonly id: CreditNoteId;
  readonly invoiceId: InvoiceId;
  readonly currency: string;
  readonly reason: string;
  readonly effectiveDate: string;
  readonly entryId: LedgerEntryId;
  readonly issuedAt: string;
}

interface CreditNoteRow {
  id: string;
  invoice_id: string;
  currency: string;
  reason: string;
  effective_date: string;
  entry_id: string;
  issued_at: string;
}

function toCreditNoteSnapshot(row: CreditNoteRow): CreditNoteSnapshot {
  return {
    id: row.id as CreditNoteId,
    invoiceId: row.invoice_id as InvoiceId,
    currency: row.currency,
    reason: row.reason,
    effectiveDate: row.effective_date,
    entryId: row.entry_id as LedgerEntryId,
    issuedAt: row.issued_at,
  };
}

const CREDIT_NOTE_COLUMNS = "id, invoice_id, currency, reason, effective_date, entry_id, issued_at";

export async function readCreditNotesForInvoice(
  database: SqlDatabase,
  invoiceId: InvoiceId,
): Promise<CreditNoteSnapshot[]> {
  const { results } = await database
    .prepare(
      `SELECT ${CREDIT_NOTE_COLUMNS} FROM credit_note WHERE invoice_id = ?1 ORDER BY issued_at, id`,
    )
    .bind(invoiceId)
    .all<CreditNoteRow>();
  return results.map(toCreditNoteSnapshot);
}

/**
 * One page of a bill's credit notes, oldest first.
 *
 * Ascending, because this is the correction HISTORY of one bill and a history is read forwards. A
 * note is never edited or withdrawn once issued, so the order is stable and a cursor over it never
 * revisits a row whose sort key moved.
 */
export async function readCreditNotesForInvoicePage(
  database: SqlDatabase,
  invoiceId: InvoiceId,
  options: { readonly cursor?: string; readonly pageSize?: number } = {},
): Promise<Page<CreditNoteSnapshot>> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const bindings: unknown[] = [invoiceId];
  const cursorClause = keysetClause(
    bindings,
    decodeCursor(options.cursor),
    "issued_at",
    "id",
    true,
  );
  // One more than the page, as the has-more probe.
  bindings.push(pageSize + 1);
  const { results } = await database
    .prepare(
      `SELECT ${CREDIT_NOTE_COLUMNS} FROM credit_note WHERE invoice_id = ? ` +
        cursorClause +
        `ORDER BY issued_at, id LIMIT ?`,
    )
    .bind(...bindings)
    .all<CreditNoteRow>();
  const hasMore = results.length > pageSize;
  const rows = hasMore ? results.slice(0, pageSize) : results;
  const last = rows.at(-1);
  return {
    data: rows.map(toCreditNoteSnapshot),
    nextCursor: hasMore && last !== undefined ? encodeCursor(last.issued_at, last.id) : null,
  };
}

export interface CreditNoteLineSnapshot {
  readonly id: CreditNoteLineId;
  readonly creditNoteId: CreditNoteId;
  readonly lineIndex: number;
  readonly matterId: MatterId;
  readonly kind: InvoiceLineKind;
  readonly description: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly creditsInvoiceLineId: InvoiceLineId | null;
}

interface CreditNoteLineRow {
  id: string;
  credit_note_id: string;
  line_index: number;
  matter_id: string;
  kind: InvoiceLineKind;
  description: string;
  amount_minor: number;
  currency: string;
  credits_invoice_line_id: string | null;
}

export async function readCreditNoteLines(
  database: SqlDatabase,
  creditNoteId: CreditNoteId,
): Promise<CreditNoteLineSnapshot[]> {
  const { results } = await database
    .prepare(
      `SELECT id, credit_note_id, line_index, matter_id, kind, description, amount_minor, currency, credits_invoice_line_id
         FROM credit_note_line WHERE credit_note_id = ?1 ORDER BY line_index`,
    )
    .bind(creditNoteId)
    .all<CreditNoteLineRow>();
  return results.map(toCreditNoteLineSnapshot);
}

function toCreditNoteLineSnapshot(row: CreditNoteLineRow): CreditNoteLineSnapshot {
  return {
    id: row.id as CreditNoteLineId,
    creditNoteId: row.credit_note_id as CreditNoteId,
    lineIndex: row.line_index,
    matterId: row.matter_id as MatterId,
    kind: row.kind,
    description: row.description,
    amountMinor: row.amount_minor,
    currency: row.currency,
    creditsInvoiceLineId: (row.credits_invoice_line_id as InvoiceLineId | null) ?? null,
  };
}

/**
 * The lines of several credit notes in ONE read, grouped by the note they belong to.
 *
 * The list surface renders a note with its lines, and reading them note by note is an N+1 whose
 * length the caller does not control. The page bounds the identifier list, so a single `IN (...)`
 * answers the whole page — and the page size is far below `MAX_BOUND_PARAMETERS`, which is the
 * ceiling that would otherwise make a value list its own unbounded thing.
 */
export async function readCreditNoteLinesForNotes(
  database: SqlDatabase,
  creditNoteIds: readonly CreditNoteId[],
): Promise<Map<CreditNoteId, CreditNoteLineSnapshot[]>> {
  const grouped = new Map<CreditNoteId, CreditNoteLineSnapshot[]>();
  if (creditNoteIds.length === 0) return grouped;
  if (creditNoteIds.length > MAX_BOUND_PARAMETERS) {
    throw new Error(
      `readCreditNoteLinesForNotes was given ${String(creditNoteIds.length)} credit notes, past the ` +
        `${String(MAX_BOUND_PARAMETERS)} bound-parameter ceiling: call it with one page at a time`,
    );
  }
  const placeholders = creditNoteIds.map(() => "?").join(", ");
  const { results } = await database
    .prepare(
      `SELECT id, credit_note_id, line_index, matter_id, kind, description, amount_minor, currency, credits_invoice_line_id
         FROM credit_note_line WHERE credit_note_id IN (${placeholders}) ORDER BY credit_note_id, line_index`,
    )
    .bind(...creditNoteIds)
    .all<CreditNoteLineRow>();
  for (const row of results) {
    const noteId = row.credit_note_id as CreditNoteId;
    const lines = grouped.get(noteId) ?? [];
    lines.push(toCreditNoteLineSnapshot(row));
    grouped.set(noteId, lines);
  }
  return grouped;
}

export interface ClientCreditSnapshot {
  readonly id: ClientCreditId;
  readonly clientEntityId: string;
  readonly matterId: MatterId;
  readonly creditNoteId: CreditNoteId;
  readonly amountMinor: number;
  readonly dischargedMinor: number;
  // Derived, never stored: open is a comparison, on the same reasoning that keeps a status column
  // off trust_hold and off the disbursement request.
  readonly remainingMinor: number;
  readonly currency: string;
  readonly openedAt: string;
}

interface ClientCreditRow {
  id: string;
  client_entity_id: string;
  matter_id: string;
  credit_note_id: string;
  amount_minor: number;
  discharged_minor: number;
  currency: string;
  opened_at: string;
}

function toClientCreditSnapshot(row: ClientCreditRow): ClientCreditSnapshot {
  return {
    id: row.id as ClientCreditId,
    clientEntityId: row.client_entity_id,
    matterId: row.matter_id as MatterId,
    creditNoteId: row.credit_note_id as CreditNoteId,
    amountMinor: row.amount_minor,
    dischargedMinor: row.discharged_minor,
    remainingMinor: row.amount_minor - row.discharged_minor,
    currency: row.currency,
    openedAt: row.opened_at,
  };
}

const CLIENT_CREDIT_COLUMNS =
  "id, client_entity_id, matter_id, credit_note_id, amount_minor, discharged_minor, currency, opened_at";

export async function readClientCredit(
  database: SqlDatabase,
  id: ClientCreditId,
): Promise<ClientCreditSnapshot | undefined> {
  const { results } = await database
    .prepare(`SELECT ${CLIENT_CREDIT_COLUMNS} FROM client_credit WHERE id = ?1`)
    .bind(id)
    .all<ClientCreditRow>();
  const row = results[0];
  return row ? toClientCreditSnapshot(row) : undefined;
}

// Every credit still owed to a client, across every matter of theirs. The comparison is the
// definition: a fully discharged credit is history and does not appear.
export async function readOpenClientCreditsForClient(
  database: SqlDatabase,
  clientEntityId: string,
): Promise<ClientCreditSnapshot[]> {
  const { results } = await database
    .prepare(
      `SELECT ${CLIENT_CREDIT_COLUMNS} FROM client_credit
        WHERE client_entity_id = ?1 AND discharged_minor < amount_minor
        ORDER BY opened_at, id`,
    )
    .bind(clientEntityId)
    .all<ClientCreditRow>();
  return results.map(toClientCreditSnapshot);
}

/**
 * One page of what the firm still owes a client back, oldest first.
 *
 * Ascending, because a credit is discharged against later bills and the oldest open one is the one
 * a person reaches for first. Open is derived, not stored — `discharged_minor < amount_minor` — so
 * a credit leaves this list by being given back rather than by a flag somebody has to remember to
 * set, and the keyset rides `opened_at`, which never moves.
 */
export async function readOpenClientCreditsForClientPage(
  database: SqlDatabase,
  clientEntityId: string,
  options: { readonly cursor?: string; readonly pageSize?: number } = {},
): Promise<Page<ClientCreditSnapshot>> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const bindings: unknown[] = [clientEntityId];
  const cursorClause = keysetClause(
    bindings,
    decodeCursor(options.cursor),
    "opened_at",
    "id",
    true,
  );
  // One more than the page, as the has-more probe.
  bindings.push(pageSize + 1);
  const { results } = await database
    .prepare(
      `SELECT ${CLIENT_CREDIT_COLUMNS} FROM client_credit
        WHERE client_entity_id = ? AND discharged_minor < amount_minor ` +
        cursorClause +
        `ORDER BY opened_at, id LIMIT ?`,
    )
    .bind(...bindings)
    .all<ClientCreditRow>();
  const hasMore = results.length > pageSize;
  const rows = hasMore ? results.slice(0, pageSize) : results;
  const last = rows.at(-1);
  return {
    data: rows.map(toClientCreditSnapshot),
    nextCursor: hasMore && last !== undefined ? encodeCursor(last.opened_at, last.id) : null,
  };
}

export async function readOpenClientCreditsForMatter(
  database: SqlDatabase,
  matterId: MatterId,
): Promise<ClientCreditSnapshot[]> {
  const { results } = await database
    .prepare(
      `SELECT ${CLIENT_CREDIT_COLUMNS} FROM client_credit
        WHERE matter_id = ?1 AND discharged_minor < amount_minor
        ORDER BY opened_at, id`,
    )
    .bind(matterId)
    .all<ClientCreditRow>();
  return results.map(toClientCreditSnapshot);
}

// THE COMMIT GUARD behind the matter-close block on an open client credit. It aims a `currency`
// value the table's length CHECK forbids at exactly the credits that still owe the client something,
// so it matches nothing when every credit on the matter is discharged and aborts the WHOLE close
// batch when one is not. A guarded UPDATE matching zero rows would abort nothing and let the matter
// close over money the firm has conceded is not its own — which is the condition the block exists
// for. Same construction, for the same reason, as the trust close guard.
export function refuseMatterCloseWithOpenClientCreditStatement(
  database: SqlDatabase,
  matterId: MatterId,
): SqlStatement {
  return database
    .prepare(
      `UPDATE client_credit SET currency = 'matter-close-refused'
        WHERE matter_id = ?1 AND discharged_minor < amount_minor`,
    )
    .bind(matterId);
}

export async function readInvoiceApplication(
  database: SqlDatabase,
  id: InvoiceApplicationId,
): Promise<InvoiceApplicationDetail | undefined> {
  const { results } = await database
    .prepare(
      `SELECT id, invoice_id, matter_id, kind, amount_minor, currency, trust_transfer_id, reverses_application_id, credit_note_id, client_credit_id, entry_id, effective_date
         FROM invoice_application WHERE id = ?1`,
    )
    .bind(id)
    .all<InvoiceApplicationDetailRow>();
  const row = results[0];
  if (!row) return undefined;
  return {
    id: row.id as InvoiceApplicationId,
    invoiceId: row.invoice_id as InvoiceId,
    matterId: row.matter_id as MatterId,
    kind: row.kind,
    amountMinor: row.amount_minor,
    currency: row.currency,
    trustTransferId: row.trust_transfer_id,
    reversesApplicationId: row.reverses_application_id,
    creditNoteId: (row.credit_note_id as CreditNoteId | null) ?? null,
    clientCreditId: (row.client_credit_id as ClientCreditId | null) ?? null,
    entryId: (row.entry_id as LedgerEntryId | null) ?? null,
    effectiveDate: row.effective_date,
  };
}

// The snapshot above serves the invoice-detail read, where every identifier is on its way to JSON.
// This one serves the composers, which pass the values straight back into other statement builders,
// so its identifiers stay BRANDED — the compiler is what stops a matter handle reaching an invoice
// parameter, and widening to string here would spend that guarantee at exactly the call sites that
// move money.
export interface InvoiceApplicationDetail {
  readonly id: InvoiceApplicationId;
  readonly invoiceId: InvoiceId;
  readonly matterId: MatterId;
  readonly kind: InvoiceApplicationKind;
  readonly amountMinor: number;
  readonly currency: string;
  readonly trustTransferId: string | null;
  readonly reversesApplicationId: string | null;
  readonly creditNoteId: CreditNoteId | null;
  readonly clientCreditId: ClientCreditId | null;
  readonly entryId: LedgerEntryId | null;
  readonly effectiveDate: string;
}

interface InvoiceApplicationDetailRow extends InvoiceApplicationRow {
  credit_note_id: string | null;
  client_credit_id: string | null;
  entry_id: string | null;
}

interface InvoiceApplicationRow {
  id: string;
  invoice_id: string;
  matter_id: string;
  kind: InvoiceApplicationKind;
  amount_minor: number;
  currency: string;
  trust_transfer_id: string | null;
  reverses_application_id: string | null;
  effective_date: string;
}

export async function readInvoiceApplications(
  database: SqlDatabase,
  invoiceId: InvoiceId,
): Promise<InvoiceApplicationSnapshot[]> {
  const { results } = await database
    .prepare(
      `SELECT id, invoice_id, matter_id, kind, amount_minor, currency, trust_transfer_id, reverses_application_id, effective_date
         FROM invoice_application WHERE invoice_id = ?1 ORDER BY applied_at, id`,
    )
    .bind(invoiceId)
    .all<InvoiceApplicationRow>();
  return results.map((row) => ({
    id: row.id,
    invoiceId: row.invoice_id,
    matterId: row.matter_id,
    kind: row.kind,
    amountMinor: row.amount_minor,
    currency: row.currency,
    trustTransferId: row.trust_transfer_id,
    reversesApplicationId: row.reverses_application_id,
    effectiveDate: row.effective_date,
  }));
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

// `.all()` + `results[0]`, never `.first()` — the one-row read convention (one sentinel for
// "no row"), stated in packages/data-access/src/idempotency-statements.ts.
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

// An invoice's client is resolved by `readMatterClientEntityIds` in
// `packages/matters/src/matter-party.ts` — the matter shell owns `matter_party`, and billing, trust,
// and their fitness suites all read the link from that one place so they cannot drift into two
// answers about whose matter this is.

// The invoice-and-amount lines of a PENDING earned-fee application — billing's side of the shared
// authorization queue (the queue row itself is trust's trust_disbursement_request). Written in the
// same batch as the request, frozen with it by triggers, and re-resolved at approval against the
// invoices as they stand THEN.
export const INVOICE_TRUST_APPLICATION_LINE_TABLE = "invoice_trust_application_line";

export interface InsertInvoiceTrustApplicationLineRow {
  readonly id: InvoiceTrustApplicationLineId;
  readonly requestId: TrustDisbursementRequestId;
  readonly invoiceId: InvoiceId;
  readonly amountMinor: number;
  readonly currency: string;
}

export function insertInvoiceTrustApplicationLineStatement(
  database: SqlDatabase,
  row: InsertInvoiceTrustApplicationLineRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${INVOICE_TRUST_APPLICATION_LINE_TABLE} (id, request_id, invoice_id, amount_minor, currency) VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
    .bind(row.id, row.requestId, row.invoiceId, row.amountMinor, row.currency);
}

export interface InvoiceTrustApplicationLineSnapshot {
  readonly id: InvoiceTrustApplicationLineId;
  readonly requestId: TrustDisbursementRequestId;
  readonly invoiceId: InvoiceId;
  readonly amountMinor: number;
  readonly currency: string;
}

interface InvoiceTrustApplicationLineRow {
  id: string;
  request_id: string;
  invoice_id: string;
  amount_minor: number;
  currency: string;
}

export async function readInvoiceTrustApplicationLines(
  database: SqlDatabase,
  requestId: TrustDisbursementRequestId,
): Promise<InvoiceTrustApplicationLineSnapshot[]> {
  const { results } = await database
    .prepare(
      `SELECT id, request_id, invoice_id, amount_minor, currency FROM ${INVOICE_TRUST_APPLICATION_LINE_TABLE} WHERE request_id = ?1 ORDER BY invoice_id`,
    )
    .bind(requestId)
    .all<InvoiceTrustApplicationLineRow>();
  return results.map((row) => ({
    id: row.id as InvoiceTrustApplicationLineId,
    requestId: row.request_id as TrustDisbursementRequestId,
    invoiceId: row.invoice_id as InvoiceId,
    amountMinor: row.amount_minor,
    currency: row.currency,
  }));
}

// THE DELIVERY RECORD — one append-only row per attempt at giving a client a bill, and the reads that
// turn those rows into "has this bill been given to the client".
//
// A second delivery of the same bill is a new row, never an edit to an existing one: a bill posted and
// then emailed is two deliveries, and a bill posted twice after the first came back is also two, with
// the second being the one that matters. There is deliberately no unique constraint anywhere on this
// table — replay of one request is held off by the idempotency key on the route, which is the layer
// that can tell a retry from a genuine second attempt.

export interface InsertInvoiceDeliveryInput {
  readonly id: InvoiceDeliveryId;
  readonly invoiceId: InvoiceId;
  readonly channel: InvoiceDeliveryChannel;
  readonly recipientReference: string;
  readonly deliveryDate: string;
  readonly externalReference: string | null;
  readonly outcome: InvoiceDeliveryOutcome;
  readonly recordedBy: UserId | null;
  readonly now: string;
}

export function insertInvoiceDeliveryStatement(
  database: SqlDatabase,
  input: InsertInvoiceDeliveryInput,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO invoice_delivery (id, invoice_id, channel, recipient_reference, delivery_date, external_reference, outcome, recorded_by, recorded_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
    .bind(
      input.id,
      input.invoiceId,
      input.channel,
      input.recipientReference,
      input.deliveryDate,
      input.externalReference,
      input.outcome,
      input.recordedBy,
      input.now,
    );
}

export interface InvoiceDeliverySnapshot {
  readonly id: InvoiceDeliveryId;
  readonly invoiceId: InvoiceId;
  readonly channel: InvoiceDeliveryChannel;
  readonly recipientReference: string;
  readonly deliveryDate: string;
  readonly externalReference: string | null;
  readonly outcome: InvoiceDeliveryOutcome;
  readonly recordedBy: UserId | null;
  readonly recordedAt: string;
}

interface InvoiceDeliveryRow {
  id: string;
  invoice_id: string;
  channel: InvoiceDeliveryChannel;
  recipient_reference: string;
  delivery_date: string;
  external_reference: string | null;
  outcome: InvoiceDeliveryOutcome;
  recorded_by: string | null;
  recorded_at: string;
}

function toInvoiceDeliverySnapshot(row: InvoiceDeliveryRow): InvoiceDeliverySnapshot {
  return {
    id: row.id as InvoiceDeliveryId,
    invoiceId: row.invoice_id as InvoiceId,
    channel: row.channel,
    recipientReference: row.recipient_reference,
    deliveryDate: row.delivery_date,
    externalReference: row.external_reference,
    outcome: row.outcome,
    recordedBy: row.recorded_by as UserId | null,
    recordedAt: row.recorded_at,
  };
}

// Every attempt on one bill, oldest first — the complete delivery history, which is what it has to be
// because a failed attempt followed by a successful one is a different story from either alone.
export interface InvoiceDeliveryPage {
  readonly rows: InvoiceDeliverySnapshot[];
  /** True when the bill carries more attempts than the requested limit returned. */
  readonly capped: boolean;
}

/**
 * A bill's delivery attempts, oldest first, CAPPED with a signal rather than cursor-paged.
 *
 * The ordering is the reason. `delivery_date` is a civil date and two attempts on one day are
 * ordinary — an email in the morning and a posted copy in the afternoon — so `recorded_at` sits
 * between it and the identifier to keep same-day attempts in the order a person recorded them. That
 * is a THREE-column sort key, and the platform's cursor carries two: paging it would mean either
 * forking the opaque wire encoding or dropping `recorded_at` from the order, which would scramble
 * same-day attempts into identifier order and lose the fact a reader is looking for.
 *
 * The cap is safe here in a way it would not be on a growing ledger: the read is fronted by
 * `readInvoiceDeliveryState`, which answers "has this bill been given to the client" from three
 * aggregates without touching this list at all, so the list is the detail behind an answer already
 * given. What it was missing is the signal — a bill chased twenty times must not read like a bill
 * chased fifty and cut at twenty.
 */
export async function readInvoiceDeliveries(
  database: SqlDatabase,
  invoiceId: InvoiceId,
  limit: number = DEFAULT_PAGE_SIZE,
): Promise<InvoiceDeliveryPage> {
  const { results } = await database
    .prepare(
      `SELECT id, invoice_id, channel, recipient_reference, delivery_date, external_reference, outcome, recorded_by, recorded_at
         FROM invoice_delivery WHERE invoice_id = ?1 ORDER BY delivery_date, recorded_at, id LIMIT ?2`,
    )
    // One over the cap as the has-more probe; it is never returned.
    .bind(invoiceId, limit + 1)
    .all<InvoiceDeliveryRow>();
  const capped = results.length > limit;
  return {
    capped,
    rows: (capped ? results.slice(0, limit) : results).map(toInvoiceDeliverySnapshot),
  };
}

// THE ANSWER TO "HAS THIS BILL BEEN GIVEN TO THE CLIENT", reduced to the three facts a surface needs
// without reading the whole history: whether any delivery succeeded, when the earliest success was,
// and how many attempts there have been at all.
//
// `deliveredOn` is the EARLIEST success rather than the latest, because the question a jurisdiction
// asks is when the client was first given the bill — a courtesy re-send months later does not move
// the date the clock started running from.
//
// `attemptCount` is what stops "not delivered" being one sentence. A bill with no rows at all has
// never been sent; a bill with three failed attempts has been chased and has not landed. A surface
// that collapsed those into the same message would tell a firm nothing it needs.
export interface InvoiceDeliveryState {
  readonly invoiceId: InvoiceId;
  readonly delivered: boolean;
  readonly deliveredOn: string | null;
  readonly attemptCount: number;
  readonly failedAttemptCount: number;
  readonly lastAttemptOn: string | null;
}

interface InvoiceDeliveryStateRow {
  attempt_count: number;
  failed_attempt_count: number;
  delivered_on: string | null;
  last_attempt_on: string | null;
}

export async function readInvoiceDeliveryState(
  database: SqlDatabase,
  invoiceId: InvoiceId,
): Promise<InvoiceDeliveryState> {
  const { results } = await database
    .prepare(
      `SELECT COUNT(*) AS attempt_count,
              SUM(CASE WHEN outcome = 'failed' THEN 1 ELSE 0 END) AS failed_attempt_count,
              MIN(CASE WHEN outcome = 'delivered' THEN delivery_date END) AS delivered_on,
              MAX(delivery_date) AS last_attempt_on
         FROM invoice_delivery WHERE invoice_id = ?1`,
    )
    .bind(invoiceId)
    .all<InvoiceDeliveryStateRow>();
  const row = results[0];
  const deliveredOn = row?.delivered_on ?? null;
  return {
    invoiceId,
    delivered: deliveredOn !== null,
    deliveredOn,
    attemptCount: row?.attempt_count ?? 0,
    failedAttemptCount: row?.failed_attempt_count ?? 0,
    lastAttemptOn: row?.last_attempt_on ?? null,
  };
}

// The same state for a set of bills in ONE query. A pass over a firm's open receivables — the shape a
// reminder sweep takes — asking per invoice would be an N+1 against the table that grows with the
// firm's whole billing history rather than with its month.
//
// Bills with no delivery row at all come back with a zeroed state rather than being absent, because
// "no delivery has been recorded" is the answer the caller asked for, and a missing key would make
// every caller re-derive it.
export async function readInvoiceDeliveryStates(
  database: SqlDatabase,
  invoiceIds: readonly InvoiceId[],
): Promise<Map<InvoiceId, InvoiceDeliveryState>> {
  const states = new Map<InvoiceId, InvoiceDeliveryState>();
  for (const invoiceId of invoiceIds) {
    states.set(invoiceId, {
      invoiceId,
      delivered: false,
      deliveredOn: null,
      attemptCount: 0,
      failedAttemptCount: 0,
      lastAttemptOn: null,
    });
  }
  const unique = [...states.keys()];
  // Chunked against D1's bound-parameter ceiling, the same bound the claim reads take: one query per
  // chunk rather than one per invoice.
  for (let offset = 0; offset < unique.length; offset += MAX_BOUND_PARAMETERS) {
    const chunk = unique.slice(offset, offset + MAX_BOUND_PARAMETERS);
    const placeholders = chunk.map((_, index) => `?${index + 1}`).join(", ");
    const { results } = await database
      .prepare(
        `SELECT invoice_id,
                COUNT(*) AS attempt_count,
                SUM(CASE WHEN outcome = 'failed' THEN 1 ELSE 0 END) AS failed_attempt_count,
                MIN(CASE WHEN outcome = 'delivered' THEN delivery_date END) AS delivered_on,
                MAX(delivery_date) AS last_attempt_on
           FROM invoice_delivery
          WHERE invoice_id IN (${placeholders})
          GROUP BY invoice_id`,
      )
      .bind(...chunk)
      .all<InvoiceDeliveryStateRow & { invoice_id: string }>();
    for (const row of results) {
      const invoiceId = row.invoice_id as InvoiceId;
      states.set(invoiceId, {
        invoiceId,
        delivered: row.delivered_on !== null,
        deliveredOn: row.delivered_on,
        attemptCount: row.attempt_count,
        failedAttemptCount: row.failed_attempt_count,
        lastAttemptOn: row.last_attempt_on,
      });
    }
  }
  return states;
}
