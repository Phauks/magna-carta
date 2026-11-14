import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";

// HOW MUCH THE TRUST ACCOUNTS DID IN A PERIOD — counts, never money.
//
// Every row counted here is append-only (a movement, a request, a decision) or frozen once closed (a
// reconciliation), so each count takes the knowledge instant. Movements count on their effective
// date; a request on the day it was raised; a decision on the day it was made; a reconciliation on
// the day it was opened or closed. Those days are the UTC day of the stored instant.
//
// The office narrows by the trust account's own office.
export interface TrustVolumeRow {
  readonly measure:
    | "movement"
    | "disbursement-requested"
    | "disbursement-decided"
    | "reconciliation-opened"
    | "reconciliation-closed";
  // The movement's kind, or the decision ('approved', 'rejected', 'withdrawn'); null otherwise.
  readonly detail: string | null;
  readonly count: number;
}

export async function readTrustVolumes(
  database: SqlDatabase,
  input: {
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly knownAsOf: string;
    readonly locationId: string | null;
  },
): Promise<readonly TrustVolumeRow[]> {
  const { results } = await database
    .prepare(
      `SELECT measure, detail, COUNT(*) AS count FROM (
         SELECT 'movement' AS measure, mv.kind AS detail
           FROM trust_movement mv JOIN trust_account a ON a.id = mv.trust_account_id
          WHERE mv.effective_date BETWEEN ?1 AND ?2 AND mv.recorded_at <= ?3
            AND (?4 IS NULL OR a.location_id = ?4)
         UNION ALL
         SELECT 'disbursement-requested', NULL
           FROM trust_disbursement_request r JOIN trust_account a ON a.id = r.trust_account_id
          WHERE date(r.requested_at) BETWEEN ?1 AND ?2 AND r.requested_at <= ?3
            AND (?4 IS NULL OR a.location_id = ?4)
         UNION ALL
         SELECT 'disbursement-decided', d.decision
           FROM trust_disbursement_decision d
           JOIN trust_disbursement_request r ON r.id = d.request_id
           JOIN trust_account a ON a.id = r.trust_account_id
          WHERE date(d.decided_at) BETWEEN ?1 AND ?2 AND d.decided_at <= ?3
            AND (?4 IS NULL OR a.location_id = ?4)
         UNION ALL
         SELECT 'reconciliation-opened', NULL
           FROM trust_reconciliation c JOIN trust_account a ON a.id = c.trust_account_id
          WHERE date(c.opened_at) BETWEEN ?1 AND ?2 AND c.opened_at <= ?3
            AND (?4 IS NULL OR a.location_id = ?4)
         UNION ALL
         SELECT 'reconciliation-closed', NULL
           FROM trust_reconciliation c JOIN trust_account a ON a.id = c.trust_account_id
          WHERE c.closed_at IS NOT NULL AND date(c.closed_at) BETWEEN ?1 AND ?2 AND c.closed_at <= ?3
            AND (?4 IS NULL OR a.location_id = ?4)
       )
       GROUP BY measure, detail
       ORDER BY measure, detail`,
    )
    .bind(input.periodStart, input.periodEnd, input.knownAsOf, input.locationId)
    .all<{ measure: TrustVolumeRow["measure"]; detail: string | null; count: number }>();
  return results.map((row) => ({ measure: row.measure, detail: row.detail, count: row.count }));
}
