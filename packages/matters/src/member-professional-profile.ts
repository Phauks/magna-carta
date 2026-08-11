import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { UserId } from "@magna-carta/identifiers/types";

// A member's professional identity as documents and letterhead state it — title, admissions, direct
// dial, professional email, and the signature block a pleading signs off with. One row per member,
// keyed by the member's own user id, upserted whole: the profile is one record a person writes as
// one thing, not five separately versioned facts. A member's bar number is deliberately NOT here —
// it lives encrypted in directory_identifier on the member's mapped Directory person, behind the
// protected-field chokepoint.

export interface MemberProfessionalProfileFields {
  readonly title: string | null;
  readonly admissions: string | null;
  readonly directDial: string | null;
  readonly professionalEmail: string | null;
  readonly signatureBlock: string | null;
}

export interface MemberProfessionalProfileRecord extends MemberProfessionalProfileFields {
  readonly memberUserId: UserId;
}

interface ProfileColumns {
  member_user_id: string;
  title: string | null;
  admissions: string | null;
  direct_dial: string | null;
  professional_email: string | null;
  signature_block: string | null;
}

export async function readMemberProfessionalProfile(
  database: SqlDatabase,
  memberUserId: UserId,
): Promise<MemberProfessionalProfileRecord | undefined> {
  const { results } = await database
    .prepare(
      `SELECT member_user_id, title, admissions, direct_dial, professional_email, signature_block
         FROM member_professional_profile WHERE member_user_id = ?1`,
    )
    .bind(memberUserId)
    .all<ProfileColumns>();
  const row = results[0];
  if (row === undefined) return undefined;
  return {
    memberUserId: row.member_user_id as UserId,
    title: row.title,
    admissions: row.admissions,
    directDial: row.direct_dial,
    professionalEmail: row.professional_email,
    signatureBlock: row.signature_block,
  };
}

// The one home for the member_professional_profile write, so the route, the fixtures harness, and
// any later self-service door all land the identical row shape.
export function upsertMemberProfessionalProfileStatement(
  database: SqlDatabase,
  memberUserId: UserId,
  fields: MemberProfessionalProfileFields,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO member_professional_profile (member_user_id, title, admissions, direct_dial, professional_email, signature_block, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
       ON CONFLICT(member_user_id) DO UPDATE SET
         title = excluded.title, admissions = excluded.admissions, direct_dial = excluded.direct_dial,
         professional_email = excluded.professional_email, signature_block = excluded.signature_block,
         updated_at = excluded.updated_at`,
    )
    .bind(
      memberUserId,
      fields.title,
      fields.admissions,
      fields.directDial,
      fields.professionalEmail,
      fields.signatureBlock,
      now,
    );
}
