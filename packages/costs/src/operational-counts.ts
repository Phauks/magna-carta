import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";

// HOW MANY COST ENTRIES WERE INCURRED IN A PERIOD, by class (hard or soft) — counts, never money.
//
// LIVE: a cost entry is a mutable working store until billed or voided and records no date for
// either, so this read takes no knowledge instant. Voided entries are left out.
//
// The office narrows by the matter's office.
export interface CostVolumeRow {
  readonly disbursementClass: "hard" | "soft";
  readonly count: number;
}

export async function readCostVolumes(
  database: SqlDatabase,
  input: {
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly locationId: string | null;
  },
): Promise<readonly CostVolumeRow[]> {
  const { results } = await database
    .prepare(
      `SELECT c.disbursement_class, COUNT(*) AS count
         FROM cost_entry c JOIN matter m ON m.id = c.matter_id
        WHERE c.incurred_date BETWEEN ?1 AND ?2 AND c.status <> 'void'
          AND (?3 IS NULL OR m.location_id = ?3)
        GROUP BY c.disbursement_class
        ORDER BY c.disbursement_class`,
    )
    .bind(input.periodStart, input.periodEnd, input.locationId)
    .all<{ disbursement_class: "hard" | "soft"; count: number }>();
  return results.map((row) => ({ disbursementClass: row.disbursement_class, count: row.count }));
}
