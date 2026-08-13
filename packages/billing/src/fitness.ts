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

// A TRUST APPLICATION IS ACCOMPANIED BY EXACTLY ONE ACCOUNTS-RECEIVABLE CREDIT, AND IT IS TRUST'S.
//
// This is the query behind the slice's most dangerous detail. A transfer out of a client's trust
// ledger is two linked entries composed by @magna-carta/trust, and the operating leg already credits
// accounts receivable. Billing therefore composes NO ledger entry for a trust application — and if a
// future caller ever adds one, the ledger still balances, every entry is still valid, nothing fails,
// and the receivable control account simply drifts below the invoice subledger by the total of every
// trust-funded fee the firm has ever taken.
//
// So it is re-proved over stored rows rather than trusted: for each trust application, count the
// ledger lines crediting the receivable account on the transfer's own operating entry, and report any
// application whose transfer does not carry exactly one. Zero means the credit went missing; more
// than one means somebody composed a second.
export function trustApplicationsWithoutExactlyOneReceivableCreditStatement(
  database: SqlDatabase,
): SqlStatement {
  return database
    .prepare(
      `SELECT a.id AS application_id,
              a.invoice_id AS invoice_id,
              a.trust_transfer_id AS trust_transfer_id,
              (SELECT COUNT(*)
                 FROM ledger_line l
                 JOIN firm_account_role r ON r.role = 'accounts_receivable'
                WHERE l.entry_id = t.operating_entry_id
                  AND l.account_id = r.ledger_account_id
                  AND l.direction = 'credit') AS receivable_credit_count
         FROM invoice_application a
         JOIN trust_transfer t ON t.id = a.trust_transfer_id
        WHERE a.kind = 'trust_transfer'
          AND (SELECT COUNT(*)
                 FROM ledger_line l
                 JOIN firm_account_role r ON r.role = 'accounts_receivable'
                WHERE l.entry_id = t.operating_entry_id
                  AND l.account_id = r.ledger_account_id
                  AND l.direction = 'credit') <> 1`,
    )
    .bind();
}

// A BALANCE'S applied_minor IS THE SUM OF THE APPLICATIONS THAT PRODUCED IT. The two are written in
// one batch by the one application door, so a row here means value reached invoice_matter_balance
// without going through that door — the same class of finding as trust's book-to-client
// disagreement, and the reason `composeInvoiceApplication` composes both statements or neither.
export function invoiceMatterBalancesDisagreeingWithApplicationsStatement(
  database: SqlDatabase,
): SqlStatement {
  return database
    .prepare(
      `SELECT b.invoice_id AS invoice_id,
              b.matter_id AS matter_id,
              b.applied_minor AS applied_minor,
              COALESCE(SUM(CASE WHEN a.kind = 'reversal' THEN -a.amount_minor ELSE a.amount_minor END), 0) AS application_sum_minor
         FROM invoice_matter_balance b
         LEFT JOIN invoice_application a ON a.invoice_id = b.invoice_id AND a.matter_id = b.matter_id
        GROUP BY b.invoice_id, b.matter_id, b.applied_minor
       HAVING b.applied_minor <> COALESCE(SUM(CASE WHEN a.kind = 'reversal' THEN -a.amount_minor ELSE a.amount_minor END), 0)`,
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

// A FLAT FEE IS NOT BILLED PAST ITS AGREEMENT. Instalments are ordinary — several flat-fee lines
// across several finalized invoices against one agreement — and no scheduler polices them, so this
// is the report that says when the finalized lines under one arrangement version sum past the
// amount that version agreed. Drafts are excluded: a draft asserts nothing yet and bill review is
// where it gets fixed.
export function flatFeeBilledBeyondArrangementStatement(database: SqlDatabase): SqlStatement {
  return database
    .prepare(
      `SELECT a.id AS arrangement_id,
              a.matter_id AS matter_id,
              a.flat_fee_amount_minor AS agreed_minor,
              SUM(l.amount_minor) AS billed_minor
         FROM matter_billing_arrangement a
         JOIN invoice_line l ON l.billing_arrangement_id = a.id AND l.kind = 'flat_fee'
         JOIN invoice i ON i.id = l.invoice_id
        WHERE a.kind = 'flat_fee' AND i.status = 'final'
        GROUP BY a.id, a.matter_id, a.flat_fee_amount_minor
       HAVING SUM(l.amount_minor) > a.flat_fee_amount_minor`,
    )
    .bind();
}

// A CREDIT NOTE, A WRITE-OFF, AND A REVERSAL EACH BRING EXACTLY ONE RECEIVABLE CREDIT — and a
// reversal's is a DEBIT, because it takes one back.
//
// The mirror of the trust query above, in the other direction. There the danger is a second credit
// composed for a movement trust already posted; here it is NO credit at all, or two. A correction
// that moved `applied_minor` with nothing on the firm's books to match reduces what a client owes
// while the receivable control account carries on as before, and the drift is exactly as silent: the
// ledger stays balanced, every entry stays valid, and nothing fails.
//
// The entry is read from the row that OWNS the posting — the note for a credit note, the application
// for everything else — which is the pairing the `invoice_application_entry_paired` trigger holds.
// A trust application is deliberately absent from this query: it is proved by the trust query above,
// which asserts the opposite thing about it.
export function billingCompositionsWithoutTheirReceivablePostingStatement(
  database: SqlDatabase,
): SqlStatement {
  return database
    .prepare(
      `SELECT application_id, invoice_id, kind, expected_direction, receivable_line_count
         FROM (SELECT a.id AS application_id,
                      a.invoice_id AS invoice_id,
                      a.kind AS kind,
                      CASE WHEN a.kind = 'reversal' THEN 'debit' ELSE 'credit' END AS expected_direction,
                      (SELECT COUNT(*)
                         FROM ledger_line l
                         JOIN firm_account_role r ON r.role = 'accounts_receivable'
                        WHERE l.entry_id = COALESCE(a.entry_id, (SELECT n.entry_id FROM credit_note n WHERE n.id = a.credit_note_id))
                          AND l.account_id = r.ledger_account_id
                          AND l.direction = CASE WHEN a.kind = 'reversal' THEN 'debit' ELSE 'credit' END) AS receivable_line_count
                 FROM invoice_application a
                WHERE a.kind <> 'trust_transfer')
        WHERE receivable_line_count <> 1`,
    )
    .bind();
}

// A CLIENT CREDIT'S DISCHARGED TOTAL IS THE SUM OF THE APPLICATIONS THAT DISCHARGED IT. The delta and
// the application row are written by the one composer in the same batch, so a row here means a
// credit was recorded as given back without an application saying where it went — or, in the other
// direction, that a reversal gave one back without the delta following it. Same class of finding as
// the balance-versus-applications query above, and the reason the composer writes both or neither.
export function clientCreditsDisagreeingWithApplicationsStatement(
  database: SqlDatabase,
): SqlStatement {
  return database
    .prepare(
      `SELECT c.id AS client_credit_id,
              c.discharged_minor AS discharged_minor,
              COALESCE(SUM(CASE WHEN a.kind = 'reversal' THEN -o.amount_minor ELSE a.amount_minor END), 0) AS application_sum_minor
         FROM client_credit c
         LEFT JOIN invoice_application a
                ON (a.client_credit_id = c.id AND a.kind = 'client_credit')
                OR (a.kind = 'reversal'
                    AND EXISTS (SELECT 1 FROM invoice_application r
                                 WHERE r.id = a.reverses_application_id AND r.client_credit_id = c.id))
         LEFT JOIN invoice_application o ON o.id = a.reverses_application_id
        GROUP BY c.id, c.discharged_minor
       HAVING c.discharged_minor <> COALESCE(SUM(CASE WHEN a.kind = 'reversal' THEN -o.amount_minor ELSE a.amount_minor END), 0)`,
    )
    .bind();
}

// A CREDIT NOTE CORRECTS A FINALIZED INVOICE, and never reduces a matter's balance below what has
// already been applied to it. The first half is a trigger and the second is the bounds CHECK, so a
// row here means one of the two was bypassed — the query exists because both are guarantees about
// rows this table can hold, and an invariant that cannot be re-proved against stored data is one you
// are trusting rather than holding.
export function creditNotesAgainstUnfinalizedInvoicesStatement(
  database: SqlDatabase,
): SqlStatement {
  return database
    .prepare(
      `SELECT n.id AS credit_note_id, n.invoice_id AS invoice_id, i.status AS status
         FROM credit_note n
         JOIN invoice i ON i.id = n.invoice_id
        WHERE i.status <> 'final'`,
    )
    .bind();
}

// A MATTER IS NOT BILLED PAST ITS CONTINGENCY ENTITLEMENT. The entitlement ceiling is the IN-FORCE
// contingency version's share against the basis as it survives NOW — the non-voided recoveries,
// minus (under the net-after-costs election) the matter's approved or billed advanced costs — and
// what is billed is summed across the matter's WHOLE agreement chain: every finalized contingency
// fee line under ANY version, because the recoveries are the matter's and an amendment mints a new
// version without minting a new recovery. A version-scoped comparison would pass a matter whose
// every version individually looks clean while the matter as a whole is double-billed. Three
// findings surface as one shape: an offset the write path missed, a basis that SHRANK after billing
// (a recovery voided, or a late advanced cost — no write-path guard can catch either, because the
// bill was true when it finalized), and a share LOWERED by amendment below what the old share
// already billed. A matter amended off contingency entirely carries no in-force ceiling and is not
// reported here — the agreement moved on, and its old bills answer to the versions that issued
// them. The half-up CAST matches the line boundary's half-away-from-zero exactly, because the base
// here is never negative.
//
// BILLED IS NET OF THE CREDIT NOTES ATTRIBUTED TO THOSE FEE LINES, and that is what makes the
// finding actionable rather than permanent. A finalized invoice cannot be edited, so the only record
// that can answer a shrunk basis is a credit note standing beside the bill; comparing the gross
// charge would leave every such matter reported forever, with the one correct remedy having no
// effect on the report that demanded it — and a report nothing can clear stops being read. Only a
// credit aimed at a contingency fee line counts, through `credit_note_line.credits_invoice_line_id`:
// a general credit against the same bill is not a statement about the fee.
export function contingencyBilledBeyondEntitlementStatement(database: SqlDatabase): SqlStatement {
  return database
    .prepare(
      `SELECT matter_id, in_force_arrangement_id, billed_minor, entitlement_minor
         FROM (SELECT a.matter_id AS matter_id,
                      a.id AS in_force_arrangement_id,
                      (SELECT COALESCE(SUM(l.amount_minor), 0)
                              - COALESCE((SELECT SUM(c.amount_minor)
                                            FROM credit_note_line c
                                            JOIN invoice_line cl ON cl.id = c.credits_invoice_line_id
                                            JOIN invoice ci ON ci.id = cl.invoice_id
                                            JOIN matter_billing_arrangement cv ON cv.id = cl.billing_arrangement_id
                                           WHERE cv.matter_id = a.matter_id AND cv.kind = 'contingency'
                                             AND cl.kind = 'fee' AND ci.status = 'final'), 0)
                         FROM invoice_line l
                         JOIN invoice i ON i.id = l.invoice_id
                         JOIN matter_billing_arrangement v ON v.id = l.billing_arrangement_id
                        WHERE v.matter_id = a.matter_id AND v.kind = 'contingency'
                          AND l.kind = 'fee' AND i.status = 'final') AS billed_minor,
                      CAST(MAX((SELECT COALESCE(SUM(r.amount_minor), 0)
                                  FROM matter_recovery r
                                 WHERE r.matter_id = a.matter_id AND r.voided_at IS NULL)
                               - CASE WHEN a.contingency_basis = 'net_after_costs'
                                      THEN (SELECT COALESCE(SUM(c.amount_minor), 0)
                                              FROM cost_entry c
                                             WHERE c.matter_id = a.matter_id
                                               AND c.disbursement_class = 'hard'
                                               AND c.status IN ('approved', 'billed'))
                                      ELSE 0 END,
                               0) * a.contingency_share_e4 / 10000.0 + 0.5 AS INTEGER) AS entitlement_minor
                 FROM matter_billing_arrangement a
                WHERE a.kind = 'contingency' AND a.valid_to IS NULL)
        WHERE billed_minor > entitlement_minor`,
    )
    .bind();
}

// EVERY LINE'S RECORDED AGREEMENT VERSION WAS IN FORCE WHEN ITS BILL ISSUED. The composer reads the
// in-force version and the finalize batch freezes the line, but nothing holds the two instants
// together — an amendment can land between the read and the commit. Rather than a batch guard (a
// zero-row guarded write aborts nothing, and aiming a CHECK violation at the arrangement row would
// entangle the finalize batch with a table it does not own), the binding is re-proved here: a
// finalized line whose version started after the bill's issue date, or ended before it, is a line
// billed under an agreement that did not govern that bill. A version closed ON the issue date is
// tolerated — that is the ordinary same-day amendment, where the old version governed the morning.
export function invoiceLinesUnderArrangementsNotInForceStatement(
  database: SqlDatabase,
): SqlStatement {
  return database
    .prepare(
      `SELECT l.id AS invoice_line_id, l.invoice_id AS invoice_id, l.billing_arrangement_id AS billing_arrangement_id
         FROM invoice_line l
         JOIN invoice i ON i.id = l.invoice_id
         JOIN matter_billing_arrangement a ON a.id = l.billing_arrangement_id
        WHERE i.status = 'final'
          AND (a.valid_from > i.issue_date OR (a.valid_to IS NOT NULL AND a.valid_to < i.issue_date))`,
    )
    .bind();
}

// FEE-AGREEMENT VERSIONS DO NOT OVERLAP. The service closes the superseded version's valid_to at the
// new version's valid_from and refuses a back-dated amendment, but SQLite has no range-exclusion
// constraint (the same gap the rate engine documents), so which agreement governed a date must be
// re-provable to have exactly one answer: a row here is two versions of one matter's agreement both
// claiming the same day.
export function billingArrangementOverlapsStatement(database: SqlDatabase): SqlStatement {
  return database
    .prepare(
      `SELECT a.id AS arrangement_id, b.id AS overlapping_arrangement_id, a.matter_id AS matter_id
         FROM matter_billing_arrangement a
         JOIN matter_billing_arrangement b
           ON b.matter_id = a.matter_id AND b.version > a.version
        WHERE a.valid_to IS NULL OR b.valid_from < a.valid_to`,
    )
    .bind();
}
