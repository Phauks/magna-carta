import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { ACCOUNT_BALANCE_TABLE } from "@magna-carta/ledger/statements";
import { matterClientPartyExistsPredicate } from "@magna-carta/matters/matter-party";

// Fitness queries: re-prove the billing invariants over the WHOLE table. Zero rows = healthy.
//
// Every rule below is already enforced on the write path. These exist because a write-path guard
// reads before its batch commits and D1 has no interactive transaction to hold that read still, and
// because a future caller may find a door around the service. An invariant that cannot be re-proved
// against stored data is an invariant you are trusting rather than holding.

// THE SUBLEDGER TIES OUT TO THE CONTROL ACCOUNT. The sum of unpaid balances across every
// invoice-matter balance row must equal the accounts-receivable account's balance. When it does not,
// one of the two is wrong, and this is the query that says so — the relationship that makes "the
// invoice tables are the subledger" a testable claim rather than an intention.
//
// The comparison is against the balance of whichever ledger account the firm mapped to the
// accounts_receivable role; a firm that has mapped none has no finalized invoices either, because
// finalization refuses without it.
export function accountsReceivableTieOutStatement(database: SqlDatabase): SqlStatement {
  return database
    .prepare(
      `SELECT r.ledger_account_id AS account_id,
              COALESCE(b.balance_minor, 0) AS control_minor,
              COALESCE((SELECT SUM(total_minor - applied_minor) FROM invoice_matter_balance), 0) AS subledger_minor
         FROM firm_account_role r
         LEFT JOIN ${ACCOUNT_BALANCE_TABLE} b ON b.account_id = r.ledger_account_id
        WHERE r.role = 'accounts_receivable'
          AND COALESCE(b.balance_minor, 0) <> COALESCE((SELECT SUM(total_minor - applied_minor) FROM invoice_matter_balance), 0)`,
    )
    .bind();
}

// ONE CLIENT PER INVOICE. Every line names its matter, and every one of those matters must resolve
// to the invoice's own client through matter_party. An invoice spanning two clients cannot be
// applied from trust at all, cannot be sensibly aged, and is indistinguishable at the row level from
// a billing error.
export function invoicesBillingAnotherClientsMatterStatement(database: SqlDatabase): SqlStatement {
  return database
    .prepare(
      `SELECT DISTINCT l.invoice_id AS invoice_id, l.matter_id AS matter_id, i.client_entity_id AS invoice_client_entity_id
         FROM invoice_line l
         JOIN invoice i ON i.id = l.invoice_id
        WHERE NOT ${matterClientPartyExistsPredicate("l.matter_id", "i.client_entity_id")}`,
    )
    .bind();
}

// NO ACTIVE CLAIM ON AN INVOICE THAT IS NOT A DRAFT OR FINAL. A voided invoice released everything
// it held; a row here would be work locked to a bill that was thrown away, invisible on the unbilled
// read and unbillable anywhere else.
export function claimsOnVoidedInvoicesStatement(database: SqlDatabase): SqlStatement {
  return database
    .prepare(
      `SELECT c.id AS claim_id, c.invoice_id AS invoice_id
         FROM invoice_wip_claim c
         JOIN invoice i ON i.id = c.invoice_id
        WHERE c.released_at IS NULL AND i.status = 'void'`,
    )
    .bind();
}

// A FINALIZED INVOICE'S CLAIMED WORK IS BILLED, AND NOTHING ELSE IS. The lock and the receivable
// ride one batch, so an entry claimed by a finalized invoice must be `billed`; an entry marked
// `billed` with no active claim behind it is work locked without a receivable, which is the phase
// invariant this pair exists to hold.
export function claimedWorkNotLockedStatement(database: SqlDatabase): SqlStatement {
  return database
    .prepare(
      `SELECT c.source_kind AS source_kind, c.source_id AS source_id, c.invoice_id AS invoice_id
         FROM invoice_wip_claim c
         JOIN invoice i ON i.id = c.invoice_id
        WHERE c.released_at IS NULL AND i.status = 'final'
          AND ((c.source_kind = 'time_entry'
                AND EXISTS (SELECT 1 FROM time_entry t WHERE t.id = c.source_id AND t.status <> 'billed'))
            OR (c.source_kind = 'cost_entry'
                AND EXISTS (SELECT 1 FROM cost_entry e WHERE e.id = c.source_id AND e.status <> 'billed')))`,
    )
    .bind();
}

export function billedWorkWithoutAFinalizedInvoiceStatement(database: SqlDatabase): SqlStatement {
  return database
    .prepare(
      `SELECT 'time_entry' AS source_kind, t.id AS source_id FROM time_entry t
        WHERE t.status = 'billed'
          AND NOT EXISTS (SELECT 1 FROM invoice_wip_claim c JOIN invoice i ON i.id = c.invoice_id
                           WHERE c.source_kind = 'time_entry' AND c.source_id = t.id AND c.released_at IS NULL AND i.status = 'final')
        UNION ALL
       SELECT 'cost_entry' AS source_kind, e.id AS source_id FROM cost_entry e
        WHERE e.status = 'billed'
          AND NOT EXISTS (SELECT 1 FROM invoice_wip_claim c JOIN invoice i ON i.id = c.invoice_id
                           WHERE c.source_kind = 'cost_entry' AND c.source_id = e.id AND c.released_at IS NULL AND i.status = 'final')`,
    )
    .bind();
}

// THE SEQUENCE IS GAPLESS AND UNIQUE. The number is drawn inside the finalize batch, so a failed
// finalize consumes nothing; a gap here means an allocation row was lost, which the append-only
// triggers are meant to make impossible.
export function invoiceNumberSequenceGapsStatement(database: SqlDatabase): SqlStatement {
  return database
    .prepare(
      `SELECT a.scope_key AS scope_key, a.drawn_value AS drawn_value
         FROM invoice_number_allocation a
        WHERE a.drawn_value > 1
          AND NOT EXISTS (SELECT 1 FROM invoice_number_allocation p
                           WHERE p.scope_key = a.scope_key AND p.drawn_value = a.drawn_value - 1)`,
    )
    .bind();
}

// EVERY FINALIZED INVOICE HAS ITS BALANCE ROWS. The bounds CHECK is the mechanism that makes
// over-application structurally impossible, and an invoice with no balance row has no such ceiling —
// value could reach it with nothing to abort the batch.
export function finalizedInvoicesWithoutBalanceRowsStatement(database: SqlDatabase): SqlStatement {
  return database
    .prepare(
      `SELECT i.id AS invoice_id FROM invoice i
        WHERE i.status = 'final'
          AND NOT EXISTS (SELECT 1 FROM invoice_matter_balance b WHERE b.invoice_id = i.id)`,
    )
    .bind();
}
