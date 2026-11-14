import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";

// HOW MANY MATTERS OPENED AND CLOSED IN A PERIOD, by matter type, for the operational report.
//
// LIVE: `matter` is a mutable record — a matter reopened or retyped changes these counts on a re-run —
// so this read takes no knowledge instant. A day is the UTC day of the stored instant.
//
// The office narrows by the matter's own office; null counts every office.
export interface MatterVolumeRow {
  readonly measure: "opened" | "closed";
  readonly matterTypeId: string | null;
  readonly matterTypeName: string | null;
  readonly count: number;
}

export async function readMatterVolumes(
  database: SqlDatabase,
  input: {
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly locationId: string | null;
  },
): Promise<readonly MatterVolumeRow[]> {
  const { results } = await database
    .prepare(
      `SELECT measure, matter_type_id, matter_type_name, COUNT(*) AS count FROM (
         SELECT 'opened' AS measure, m.matter_type_id, t.name AS matter_type_name
           FROM matter m LEFT JOIN matter_type t ON t.id = m.matter_type_id
          WHERE m.opened_at IS NOT NULL AND date(m.opened_at) BETWEEN ?1 AND ?2
            AND (?3 IS NULL OR m.location_id = ?3)
         UNION ALL
         SELECT 'closed', m.matter_type_id, t.name
           FROM matter m LEFT JOIN matter_type t ON t.id = m.matter_type_id
          WHERE m.closed_at IS NOT NULL AND date(m.closed_at) BETWEEN ?1 AND ?2
            AND (?3 IS NULL OR m.location_id = ?3)
       )
       GROUP BY measure, matter_type_id
       ORDER BY measure, count DESC`,
    )
    .bind(input.periodStart, input.periodEnd, input.locationId)
    .all<{
      measure: "opened" | "closed";
      matter_type_id: string | null;
      matter_type_name: string | null;
      count: number;
    }>();
  return results.map((row) => ({
    measure: row.measure,
    matterTypeId: row.matter_type_id,
    matterTypeName: row.matter_type_name,
    count: row.count,
  }));
}
