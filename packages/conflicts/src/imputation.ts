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

// One of the firm's own people, found among the entities a check reached.
export interface MemberEntity {
  readonly memberUserId: string;
  readonly entityId: string;
}

// Kept well under SQLite's bound-parameter ceiling, so a closure of any size is read in a few
// set-valued queries rather than one per entity or one that the database refuses.
const MEMBER_LOOKUP_CHUNK = 500;

// The firm's own people among the given entities, by IDENTITY — the same member_id join as above,
// for the same reasons, and never a name match.
//
// This is what the Firm Employees option means on a check that names no matter: not "is a member a
// party on this matter" (there is no matter to ask about) but "is anybody this check reached one of
// the firm's own people". A partner who is themselves a subject party, or who sits one recorded
// relationship away from one, is exactly what the pre-engagement screen exists to catch.
export async function findMemberEntities(
  database: SqlDatabase,
  entityIds: readonly string[],
): Promise<MemberEntity[]> {
  const found: MemberEntity[] = [];
  for (let start = 0; start < entityIds.length; start += MEMBER_LOOKUP_CHUNK) {
    const chunk = entityIds.slice(start, start + MEMBER_LOOKUP_CHUNK);
    const placeholders = chunk.map((_, index) => `?${index + 1}`).join(", ");
    const { results } = await database
      .prepare(
        `SELECT m.user_id AS member_user_id, dp.id AS entity_id
         FROM directory_person AS dp
         JOIN member AS m ON m.user_id = dp.member_id
         WHERE dp.id IN (${placeholders})
           AND dp.deleted_at IS NULL
         ORDER BY dp.id ASC`,
      )
      .bind(...chunk)
      .all<{ member_user_id: string; entity_id: string }>();
    for (const row of results) {
      found.push({ memberUserId: row.member_user_id, entityId: row.entity_id });
    }
  }
  return found;
}
