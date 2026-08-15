import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { UserId } from "@magna-carta/identifiers/types";
import type { NotificationType } from "./registry.ts";
import { MAX_RECIPIENTS_PER_EVENT } from "./types.ts";

// WHO HEARS IT. Resolved in the queue consumer, off the hot path, never in the emitting write —
// which is the whole reason no producing package had to change. A write path that resolved
// recipients would be a write path that read the RBAC tables, the matter row, and the preference
// chain before it could commit, and would be slower for every firm whether or not anybody was ever
// told anything.
//
// Every resolver is BOUNDED by construction: one row, or one indexed read capped at the fan-out
// ceiling. A resolver that could return a firm's whole staff is a resolver that can mail a firm's
// whole staff, so the cap is applied in SQL rather than in memory — a clamped read is a bounded
// read, where a clamped array is a bounded array after an unbounded query.

export interface RecipientResolutionContext {
  readonly database: SqlDatabase;
  readonly matterId: string | null;
  // Whoever performed the act, where the topic's payload names one. Most do not, which is why this
  // is optional rather than required-and-often-null.
  readonly actorUserId: UserId | null;
  // Supplied rather than read here: this package holds no binding and reads no clock, so the one
  // resolver that needs the time (direct-grant expiry) is handed it by whoever is running the pass.
  readonly now: () => string;
}

export interface RecipientResolution {
  readonly recipientUserIds: readonly UserId[];
  // Set when a declared audience could not be resolved as declared and something narrower stood in.
  readonly substituted: boolean;
}

export async function resolveNotificationRecipients(
  type: NotificationType,
  context: RecipientResolutionContext,
): Promise<RecipientResolution> {
  switch (type.audience) {
    case "responsible-member":
      return { recipientUserIds: await responsibleMember(context), substituted: false };
    case "matter-team":
      return { recipientUserIds: await matterTeam(context), substituted: false };
    case "actor":
      return {
        recipientUserIds: context.actorUserId === null ? [] : [context.actorUserId],
        substituted: false,
      };
    case "capability-holders":
      return {
        recipientUserIds: await capabilityHolders(
          context.database,
          type.audienceCapability,
          context.now(),
        ),
        substituted: false,
      };
    case "designated":
      // The firm-tier designation of trust-compliance recipients is a later slice. It resolves to
      // nobody rather than to everybody: an audience that has not been configured has not been
      // configured, and defaulting it to the firm would be inventing a disclosure out of an absent
      // setting.
      return { recipientUserIds: [], substituted: false };
  }
}

async function responsibleMember(context: RecipientResolutionContext): Promise<readonly UserId[]> {
  if (context.matterId === null) return [];
  const { results } = await context.database
    .prepare("SELECT responsible_member_id FROM matter WHERE id = ?1")
    .bind(context.matterId)
    .all<{ responsible_member_id: string }>();
  const row = results[0];
  return row === undefined ? [] : [row.responsible_member_id as UserId];
}

// THE PEOPLE WORKING THIS MATTER, NOW: the matter's responsible member, plus every member holding a
// currently-valid `matter_assignment` row on it. One statement, both arms, deduplicated in SQL and
// clamped there — the same shape `capabilityHolders` below takes, and for the same reason.
//
// The responsible member is ALWAYS an arm of this read, never conditional on holding an assignment
// row. `matter.responsible_member_id` is that fact's one home and the assignment write path
// (packages/matters/src/matter-assignment.ts) refuses a role that normalizes to it, so the attorney
// who owns the file is structurally incapable of appearing in the assignment table — resolving "the
// team" from assignments alone would omit exactly the person most entitled to hear. It is also why
// a matter with no assignments resolves to that one member rather than to nobody: a team of one is
// a correct answer, where an empty one would silently drop a critical notice (a quarantined file on
// an unstaffed matter still needs somebody told).
//
// The two arms filter membership differently, on purpose. The responsible arm is byte-for-byte the
// `responsible-member` resolver's read, so the two audiences can never disagree about the same
// person. The assignment arm additionally requires an ACTIVE member: an assignment row outlives the
// member's departure by design — staffing history is a matter record and ends only by an explicit
// act — so a departed member's still-open assignment is the ordinary case rather than the
// exception, and this audience reaches email, which a deactivated member's feed does not.
//
// The validity window's two recorded forms are told apart exactly as the staffing read in
// packages/document-assembly/src/merge-statements.ts tells them apart, and for the same reason: a
// bound written at creation is a CIVIL DATE (YYYY-MM-DD) inclusive of its whole day, while a
// `valid_to` stamped by the end-assignment path is the ending INSTANT, exclusive from that moment.
// Both comparisons are lexicographic, which is chronological for both forms. A second convention
// here would mean an assignment that staffs a document and does not staff its notifications.
async function matterTeam(context: RecipientResolutionContext): Promise<readonly UserId[]> {
  if (context.matterId === null) return [];
  const { results } = await context.database
    .prepare(
      "SELECT user_id FROM (" +
        "SELECT matter.responsible_member_id AS user_id FROM matter WHERE matter.id = ?1" +
        " UNION " +
        "SELECT assignment.member_user_id AS user_id FROM matter_assignment AS assignment" +
        " JOIN member ON member.user_id = assignment.member_user_id AND member.status = 'active'" +
        " WHERE assignment.matter_id = ?1" +
        " AND (assignment.valid_from IS NULL OR assignment.valid_from <= ?2)" +
        " AND (assignment.valid_to IS NULL" +
        " OR (length(assignment.valid_to) = 10 AND assignment.valid_to >= substr(?2, 1, 10))" +
        " OR (length(assignment.valid_to) > 10 AND assignment.valid_to > ?2))" +
        ") ORDER BY user_id LIMIT ?3",
    )
    .bind(context.matterId, context.now(), MAX_RECIPIENTS_PER_EVENT + 1)
    .all<{ user_id: string }>();
  return results.map((row) => row.user_id as UserId);
}

// Members whose EFFECTIVE permissions include the capability: a role grant, or an unexpired direct
// grant, on an active member. The union and the expiry are composed in SQL rather than resolved in
// the Worker, because the alternative is reading every member's permission set to answer a question
// about one permission.
//
// The expiry comparison is a text comparison over canonical ISO-8601 instants, which is
// chronological for exactly that shape — the same property the whole platform's ordering rests on.
async function capabilityHolders(
  database: SqlDatabase,
  capability: string | undefined,
  now: string,
): Promise<readonly UserId[]> {
  if (capability === undefined) {
    // A `capability-holders` type without a capability is a registry error, and the fitness test
    // catches it at build. At runtime it resolves to nobody, because the failure mode of guessing
    // would be mailing a firm about something nobody decided they should hear.
    return [];
  }
  const { results } = await database
    .prepare(
      "SELECT member.user_id AS user_id FROM member WHERE member.status = 'active' AND (" +
        "EXISTS (SELECT 1 FROM member_role JOIN role_permission ON role_permission.role_id = member_role.role_id WHERE member_role.member_user_id = member.user_id AND role_permission.permission = ?1)" +
        " OR EXISTS (SELECT 1 FROM direct_grant WHERE direct_grant.member_user_id = member.user_id AND direct_grant.permission = ?1 AND (direct_grant.expires_at IS NULL OR direct_grant.expires_at > ?2))" +
        ") ORDER BY member.user_id LIMIT ?3",
    )
    .bind(capability, now, MAX_RECIPIENTS_PER_EVENT + 1)
    .all<{ user_id: string }>();
  return results.map((row) => row.user_id as UserId);
}
