import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";

// One of the firm's own people, found on a matter as a party. This is what imputation means: the
// conflict belongs to the firm, not to the individual lawyer.
export interface ImputationHit {
  readonly memberUserId: string;
  readonly entityId: string;
  readonly matterId: string;
  readonly role: string;
}

// Imputation matches by IDENTITY, never by name similarity.
//
// Firm personnel carry a flat display name with no phonetic code and no full-text index entry, so they
// are invisible to the similarity channels by construction. Fuzzy-matching them would be pure noise: a
// firm named "Smith Law" would hit every client named Smith, on every check, forever, and a partner
// sharing a surname with a client is not a conflict. The conflict is the partner BEING a party — which
// is an identity join through the optional member_id link on the directory entity.
//
// A lawyer who is genuinely a party is an ordinary directory entity, matched by the party class like
// anyone else. This function must never call the similarity matchers.
//
// A deactivated member still imputes: a conflict does not lapse when a lawyer leaves the firm.
export async function findImputationHits(
  database: SqlDatabase,
  subjectMatterIds: readonly string[],
): Promise<ImputationHit[]> {
  if (subjectMatterIds.length === 0) return [];

  const placeholders = subjectMatterIds.map((_, index) => `?${index + 1}`).join(", ");
  const { results } = await database
    .prepare(
      `SELECT m.user_id AS member_user_id, dp.id AS entity_id, mp.matter_id AS matter_id, mp.role AS role
       FROM matter_party AS mp
       JOIN directory_person AS dp ON dp.id = mp.entity_id
       JOIN member AS m ON m.user_id = dp.member_id
       WHERE mp.matter_id IN (${placeholders})
         AND mp.deleted_at IS NULL
         AND dp.deleted_at IS NULL
       ORDER BY m.user_id ASC, mp.matter_id ASC, mp.role ASC`,
    )
    .bind(...subjectMatterIds)
    .all<{ member_user_id: string; entity_id: string; matter_id: string; role: string }>();

  return results.map((row) => ({
    memberUserId: row.member_user_id,
    entityId: row.entity_id,
    matterId: row.matter_id,
    role: row.role,
  }));
}
