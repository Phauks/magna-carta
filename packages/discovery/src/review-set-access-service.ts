import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { ReviewSetId, UserId } from "@magna-carta/identifiers/types";
import type { DiscoveryServiceOptions } from "./review-set-service.ts";
import {
  grantReviewSetAccessStatement,
  readReviewSetAccessCount,
  revokeReviewSetAccessStatement,
} from "./review-set-access-statements.ts";
import { DiscoveryValidationError } from "./validation.ts";

// Who may reach one review set's corpus. The list is the wall; the discovery permission keys say only
// that a member may review SOMETHING.
//
// The service composes statements into an effect batch and holds no binding and no clock, like every
// other service here. It writes a domain audit row per change, which is the one place this subsystem
// does use the platform's generic audit wrapper: a grant is not a coding decision, so it has no
// business in the coding journal, and "who widened this wall and when" is exactly what the audit log
// is for.

export interface SeedReviewSetAccessInput {
  readonly reviewSetId: ReviewSetId;
  // The members the list starts with. The creator is added by the caller as part of this set — a
  // review set whose creator is not on its own list is one nobody can administer.
  readonly memberUserIds: readonly UserId[];
}

// Seeding runs in the SAME batch as the review set's own insert. A review set that existed for even
// one commit with an empty list would be a corpus nobody could reach, and the repair would need
// exactly the access the list is refusing.
export function seedReviewSetAccess(
  database: SqlDatabase,
  input: SeedReviewSetAccessInput,
  options: DiscoveryServiceOptions,
): EffectWrite {
  const memberUserIds = [...new Set(input.memberUserIds)];
  if (memberUserIds.length === 0) {
    throw new DiscoveryValidationError(
      "discovery-access-list-would-be-empty",
      "a review set's access list starts with at least the member creating it — the list is " +
        "fail-closed, so an empty one is a corpus nobody can reach or repair",
    );
  }
  const now = options.clock.now();
  return {
    statements: [
      ...memberUserIds.map((memberUserId) =>
        grantReviewSetAccessStatement(database, {
          id: newIdentifier("reviewSetAccess", options.randomSource),
          reviewSetId: input.reviewSetId,
          memberUserId,
          grantedBy: options.actorUserId,
          now,
        }),
      ),
      domainAuditStatement(database, {
        clock: options.clock,
        actorUserId: options.actorUserId,
        randomSource: options.randomSource,
        event: "discovery.reviewSetAccessSeeded",
        subjectId: input.reviewSetId,
        // The COUNT, never the member ids. How many people can see a corpus is an operational fact;
        // which people is on the list itself, behind the same wall.
        metadata: JSON.stringify({ memberCount: memberUserIds.length }),
      }),
    ],
    outboxMessages: [],
  };
}

export function grantReviewSetAccess(
  database: SqlDatabase,
  input: { reviewSetId: ReviewSetId; memberUserId: UserId },
  options: DiscoveryServiceOptions,
): EffectWrite {
  const now = options.clock.now();
  return {
    statements: [
      grantReviewSetAccessStatement(database, {
        id: newIdentifier("reviewSetAccess", options.randomSource),
        reviewSetId: input.reviewSetId,
        memberUserId: input.memberUserId,
        grantedBy: options.actorUserId,
        now,
      }),
      domainAuditStatement(database, {
        clock: options.clock,
        actorUserId: options.actorUserId,
        randomSource: options.randomSource,
        event: "discovery.reviewSetAccessGranted",
        subjectId: input.reviewSetId,
        metadata: JSON.stringify({ memberUserId: input.memberUserId }),
      }),
    ],
    outboxMessages: [],
  };
}

// Revoking the last member is refused. An access list that can reach empty is a corpus that can
// become unreachable by everybody, including whoever would fix it — and because the list is
// fail-closed, "unreachable" is permanent short of a migration.
//
// The count is of members who can ACT, not of rows: a deactivated member keeps their row and is
// absent to every read, so counting rows would let this guard wave through the removal of the last
// person who could actually open the corpus. The other half of that hole is on the deactivation
// path, which must run readReviewSetsHeldOnlyBy before it deactivates anybody.
export async function revokeReviewSetAccess(
  database: SqlDatabase,
  input: { reviewSetId: ReviewSetId; memberUserId: UserId },
  options: DiscoveryServiceOptions,
): Promise<EffectWrite> {
  const memberCount = await readReviewSetAccessCount(database, input.reviewSetId);
  if (memberCount <= 1) {
    throw new DiscoveryValidationError(
      "discovery-access-list-would-be-empty",
      "this is the last member of the firm who can still open this review set, and the list is " +
        "fail-closed — removing them would leave a corpus nobody can reach. Add the member who " +
        "should hold it first, then remove this one.",
    );
  }
  return {
    statements: [
      revokeReviewSetAccessStatement(database, input.reviewSetId, input.memberUserId),
      domainAuditStatement(database, {
        clock: options.clock,
        actorUserId: options.actorUserId,
        randomSource: options.randomSource,
        event: "discovery.reviewSetAccessRevoked",
        subjectId: input.reviewSetId,
        metadata: JSON.stringify({ memberUserId: input.memberUserId }),
      }),
    ],
    outboxMessages: [],
  };
}
