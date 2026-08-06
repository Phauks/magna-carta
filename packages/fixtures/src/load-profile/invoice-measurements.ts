import type { DatabaseSync } from "node:sqlite";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { NodeSqlStatement } from "@magna-carta/database/node-sqlite";
import { explainStatement, type LabeledPlan } from "./runner.ts";
import type { InvoiceProbes } from "./invoice-generate.ts";

// The billing volume-shaped plan set. The cost of each of these depends on the data SHAPE the
// invoice generator laid down — matters carrying a backlog of finalized bills, drafts holding active
// claims, and a receivables book spread across the aging buckets.
//
// The four measured operations, in the order they matter:
//
//  1. DRAFT ASSEMBLY over a matter with a large unbilled backlog — the read that finds unclaimed
//     entries. It is served from the entry's mirror column with NO join to the claim table, which is
//     the whole reason the mirror exists; if this plan ever starts touching invoice_wip_claim, the
//     mirror has stopped doing its job.
//  2. THE FINALIZE BATCH, which is the one with a real ceiling: its statement count scales with
//     claims and lines (two writes per claimed entry plus one per line) while the ledger entry does
//     not. The batch is what bounds an invoice, so the ceiling is measured rather than guessed — see
//     the note on the claim maximum below.
//  3. BALANCE AND AGING reads across the firm's open receivables.
//  4. The per-invoice detail read a finalized invoice re-renders from.

export interface InvoiceMeasurementHandle {
  readonly database: SqlDatabase; // D1-shaped — builds the statements the EXPLAIN probes run
  readonly raw: DatabaseSync; // the node:sqlite escape hatch EXPLAIN QUERY PLAN runs against
  readonly probes: InvoiceProbes;
}

// The aging read is table-wide BY NATURE: "what does the whole firm still have outstanding" has no
// narrower answer, and every finalized invoice with an unpaid balance is in it. It is the only
// billing read allowed to scan, and it scans the finalized slice through the (status, due_date)
// index rather than the whole table.
export const INVOICE_PLAN_SCAN_ALLOWLIST: readonly string[] = ["receivables.aging"];

function capturedStatement(statement: SqlStatement): NodeSqlStatement {
  return statement as NodeSqlStatement;
}

// The hot read: what is still billable on this matter. Mirrors the SQL in
// packages/billing/src/queries.ts (readUnbilledWorkInProgress) bound to the same parameters, so a
// failing EXPLAIN on a populated snapshot catches drift in either.
function unbilledTimeByMatterStatement(database: SqlDatabase, matterId: string): SqlStatement {
  return database
    .prepare(
      `SELECT COUNT(*) AS entry_count, SUM(amount_minor) AS amount_minor
         FROM time_entry
        WHERE matter_id = ?1 AND status NOT IN ('billed', 'void') AND invoice_id IS NULL AND amount_minor IS NOT NULL`,
    )
    .bind(matterId);
}

// The claim read the finalize batch opens with: every active claim on one invoice.
function activeClaimsStatement(database: SqlDatabase, invoiceId: string): SqlStatement {
  return database
    .prepare(
      `SELECT id, source_kind, source_id, invoice_line_id, claimed_amount_minor
         FROM invoice_wip_claim WHERE invoice_id = ?1 AND released_at IS NULL ORDER BY claimed_at, id`,
    )
    .bind(invoiceId);
}

// The lines a finalized invoice re-renders from, in presentation order.
function invoiceLinesStatement(database: SqlDatabase, invoiceId: string): SqlStatement {
  return database
    .prepare(
      `SELECT id, line_index, matter_id, kind, description, amount_minor
         FROM invoice_line WHERE invoice_id = ?1 ORDER BY line_index`,
    )
    .bind(invoiceId);
}

// "Invoices for this matter" — served by the (matter_id, invoice_id) index on the LINE table,
// because there is no invoice.matter_id column: a stored column that is supposed to agree with the
// lines is a column that will eventually disagree with them.
function invoicesForMatterStatement(database: SqlDatabase, matterId: string): SqlStatement {
  return database
    .prepare(`SELECT DISTINCT invoice_id FROM invoice_line WHERE matter_id = ?1`)
    .bind(matterId);
}

// One matter's receivable across every invoice that bills it.
function matterReceivableStatement(database: SqlDatabase, matterId: string): SqlStatement {
  return database
    .prepare(
      `SELECT SUM(total_minor) AS total_minor, SUM(applied_minor) AS applied_minor
         FROM invoice_matter_balance WHERE matter_id = ?1`,
    )
    .bind(matterId);
}

// The client's invoice list, keyset-paginated on the platform's (created_at, id) cursor.
function clientInvoiceListStatement(database: SqlDatabase, clientEntityId: string): SqlStatement {
  return database
    .prepare(
      `SELECT id, status, invoice_number, due_date, created_at FROM invoice
        WHERE client_entity_id = ?1 ORDER BY created_at DESC, id DESC LIMIT 51`,
    )
    .bind(clientEntityId);
}

// The firm-wide aging read — the allow-listed scan, narrowed to the finalized slice.
function agingStatement(database: SqlDatabase): SqlStatement {
  return database
    .prepare(
      `SELECT invoice.id, invoice.due_date,
              (SELECT SUM(total_minor - applied_minor) FROM invoice_matter_balance WHERE invoice_id = invoice.id) AS unpaid_minor
         FROM invoice
        WHERE invoice.status = 'final' AND invoice.due_date IS NOT NULL
        ORDER BY invoice.due_date`,
    )
    .bind();
}

export function invoiceHotPathPlans(handle: InvoiceMeasurementHandle): LabeledPlan[] {
  const { database, raw, probes } = handle;
  const statements: readonly { label: string; statement: NodeSqlStatement }[] = [
    {
      label: "unbilled-time.by-matter",
      statement: capturedStatement(unbilledTimeByMatterStatement(database, probes.busiestMatterId)),
    },
    {
      label: "invoice-claims.active-by-invoice",
      statement: capturedStatement(activeClaimsStatement(database, probes.openDraftInvoiceId)),
    },
    {
      label: "invoice-lines.by-invoice",
      statement: capturedStatement(invoiceLinesStatement(database, probes.probeInvoiceId)),
    },
    {
      label: "invoices.by-matter",
      statement: capturedStatement(invoicesForMatterStatement(database, probes.busiestMatterId)),
    },
    {
      label: "receivable.by-matter",
      statement: capturedStatement(matterReceivableStatement(database, probes.busiestMatterId)),
    },
    {
      label: "invoices.by-client-keyset",
      statement: capturedStatement(
        clientInvoiceListStatement(database, probes.busiestClientEntityId),
      ),
    },
    {
      label: "receivables.aging",
      statement: capturedStatement(agingStatement(database)),
    },
  ];
  return statements.map(({ label, statement }) => ({
    label,
    details: explainStatement(raw, statement.sql, statement.bindings),
  }));
}
