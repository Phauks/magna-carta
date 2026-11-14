import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";

// HOW MANY BILLS, CREDIT NOTES AND WRITE-OFFS IN A PERIOD — counts, never money. Where a reader wants
// the value beside a count, it is the realization report's, on its own read.
//
// Every count here is over a record that never changes once written (a finalized bill, a voided
// draft, a credit note, an application), so each takes the knowledge instant: a credit note recorded
// next week with a backdated effective date does not move this week's count re-run under this week's
// instant. Bills drafted is the exception — a draft can be voided or finalized after — so it counts
// drafts CREATED in the period, which is a fact about the creation and never changes either.
//
// The office narrows by the bill's letterhead office, which a bill fixes when it is finalized.
export interface BillingVolumes {
  readonly billsDrafted: number;
  readonly billsFinalized: number;
  readonly draftsVoided: number;
  readonly creditNotesIssued: number;
  readonly writeOffs: number;
}

export async function readBillingVolumes(
  database: SqlDatabase,
  input: {
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly knownAsOf: string;
    readonly locationId: string | null;
  },
): Promise<BillingVolumes> {
  const { results } = await database
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM invoice
           WHERE date(created_at) BETWEEN ?1 AND ?2 AND created_at <= ?3
             AND (?4 IS NULL OR location_id = ?4)) AS bills_drafted,
         (SELECT COUNT(*) FROM invoice
           WHERE status = 'final' AND issue_date BETWEEN ?1 AND ?2 AND finalized_at <= ?3
             AND (?4 IS NULL OR location_id = ?4)) AS bills_finalized,
         (SELECT COUNT(*) FROM invoice
           WHERE status = 'void' AND date(voided_at) BETWEEN ?1 AND ?2 AND voided_at <= ?3
             AND (?4 IS NULL OR location_id = ?4)) AS drafts_voided,
         (SELECT COUNT(*) FROM credit_note n JOIN invoice i ON i.id = n.invoice_id
           WHERE n.effective_date BETWEEN ?1 AND ?2 AND n.issued_at <= ?3
             AND (?4 IS NULL OR i.location_id = ?4)) AS credit_notes_issued,
         (SELECT COUNT(*) FROM invoice_application a JOIN invoice i ON i.id = a.invoice_id
           WHERE a.kind = 'write_off' AND a.effective_date BETWEEN ?1 AND ?2 AND a.applied_at <= ?3
             AND (?4 IS NULL OR i.location_id = ?4)) AS write_offs`,
    )
    .bind(input.periodStart, input.periodEnd, input.knownAsOf, input.locationId)
    .all<{
      bills_drafted: number;
      bills_finalized: number;
      drafts_voided: number;
      credit_notes_issued: number;
      write_offs: number;
    }>();
  const row = results[0];
  return {
    billsDrafted: row?.bills_drafted ?? 0,
    billsFinalized: row?.bills_finalized ?? 0,
    draftsVoided: row?.drafts_voided ?? 0,
    creditNotesIssued: row?.credit_notes_issued ?? 0,
    writeOffs: row?.write_offs ?? 0,
  };
}
