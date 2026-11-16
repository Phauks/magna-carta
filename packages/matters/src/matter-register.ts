import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";

// THE FIRM'S MATTERS AS A LIST, for the Matters List report: every matter that has been opened (open,
// on hold or closed) with its number, client, type, office, responsible attorney and the instants it
// opened and closed.
//
// LIVE: `matter` is a mutable record (a matter is retyped, moved to another office, closed and
// reopened), so this read takes no knowledge instant. Intakes and consultations are left out, as the
// matters listing leaves them out by default: they are enquiries, not matters, and they have their own
// desk. A platform-owned matter (`system_key`) is never a client engagement and is never listed.
//
// The client is the lower client party, the attribution every report reads. The office narrows by the
// matter's own office; null lists every office. One row past the ceiling tells a full list from a
// truncated one.

export const MAXIMUM_MATTER_REGISTER_ROWS = 5000;

export interface MatterRegisterRow {
  readonly matterId: string;
  readonly matterNumber: string | null;
  readonly matterTitle: string;
  readonly status: "open" | "hold" | "closed";
  readonly matterTypeName: string | null;
  readonly clientEntityId: string | null;
  readonly clientName: string | null;
  readonly locationId: string | null;
  readonly locationName: string | null;
  readonly responsibleMemberId: string;
  readonly responsibleName: string | null;
  readonly openedAt: string | null;
  readonly closedAt: string | null;
}

export interface MatterRegister {
  readonly truncated: boolean;
  readonly rows: readonly MatterRegisterRow[];
}

interface MatterRegisterRaw {
  matter_id: string;
  matter_number: string | null;
  matter_title: string;
  status: "open" | "hold" | "closed";
  matter_type_name: string | null;
  client_entity_id: string | null;
  client_name: string | null;
  location_id: string | null;
  location_name: string | null;
  responsible_member_id: string;
  responsible_name: string | null;
  opened_at: string | null;
  closed_at: string | null;
}

export async function readMatterRegister(
  database: SqlDatabase,
  input: { readonly locationId: string | null },
): Promise<MatterRegister> {
  const { results } = await database
    .prepare(
      `SELECT m.id AS matter_id, m.matter_number, m.title AS matter_title, m.status,
              t.name AS matter_type_name,
              (SELECT MIN(p.entity_id) FROM matter_party p
                WHERE p.matter_id = m.id AND p.role = 'client') AS client_entity_id,
              m.client_display_name AS client_name,
              m.location_id, l.name AS location_name,
              m.responsible_member_id, mem.display_name AS responsible_name,
              m.opened_at, m.closed_at
         FROM matter m
         LEFT JOIN matter_type t ON t.id = m.matter_type_id
         LEFT JOIN location l ON l.id = m.location_id
         LEFT JOIN member mem ON mem.user_id = m.responsible_member_id
        WHERE m.status IN ('open', 'hold', 'closed') AND m.system_key IS NULL
          AND (?1 IS NULL OR m.location_id = ?1)
        ORDER BY m.matter_number, m.title, m.id
        LIMIT ?2`,
    )
    .bind(input.locationId, MAXIMUM_MATTER_REGISTER_ROWS + 1)
    .all<MatterRegisterRaw>();
  return {
    truncated: results.length > MAXIMUM_MATTER_REGISTER_ROWS,
    rows: results.slice(0, MAXIMUM_MATTER_REGISTER_ROWS).map((row) => ({
      matterId: row.matter_id,
      matterNumber: row.matter_number,
      matterTitle: row.matter_title,
      status: row.status,
      matterTypeName: row.matter_type_name,
      clientEntityId: row.client_entity_id,
      clientName: row.client_name,
      locationId: row.location_id,
      locationName: row.location_name,
      responsibleMemberId: row.responsible_member_id,
      responsibleName: row.responsible_name,
      openedAt: row.opened_at,
      closedAt: row.closed_at,
    })),
  };
}
