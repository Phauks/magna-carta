import { MEMBER_TABLE } from "@magna-carta/data-access/member-statements";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { ReviewSetAccessId, ReviewSetId, UserId } from "@magna-carta/identifiers/types";
import { REVIEW_SET_ACCESS_TABLE, type ReviewSetAccessPredicate } from "./review-set-visibility.ts";

// The access list itself — who may reach one review set's corpus. Reads and writes OF the list are
// gated by `discovery:produce` at the route; the list is what then gates every read and write of the
// corpus behind it (packages/discovery/src/coding-statements.ts).

export interface ReviewSetAccessRow {
  readonly id: ReviewSetAccessId;
  readonly review_set_id: ReviewSetId;
  readonly member_user_id: UserId;
  readonly granted_by: UserId;
  readonly created_at: string;
}

const REVIEW_SET_ACCESS_COLUMNS = "id, review_set_id, member_user_id, granted_by, created_at";

// `INSERT OR IGNORE` against the unique index rather than a read-then-write: granting access to
// somebody who already has it is a no-op, not a conflict, and a retried request must not depend on
// the caller having read first.
export function grantReviewSetAccessStatement(
  database: SqlDatabase,
  row: {
    id: ReviewSetAccessId;
    reviewSetId: ReviewSetId;
    memberUserId: UserId;
    grantedBy: UserId;
    now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT OR IGNORE INTO ${REVIEW_SET_ACCESS_TABLE} ` +
        `(id, review_set_id, member_user_id, granted_by, created_at) VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(row.id, row.reviewSetId, row.memberUserId, row.grantedBy, row.now);
}

// Revocation DELETES the grant rather than soft-removing it. The list answers "who may look right
// now", and a revoked row that lingered would be a row every read had to remember to exclude — the
// exact shape of mistake the fail-closed posture exists to avoid. How the list came to say what it
// says is the audit log's job, written in the same batch by the service.
export function revokeReviewSetAccessStatement(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  memberUserId: UserId,
): SqlStatement {
  return database
    .prepare(
      `DELETE FROM ${REVIEW_SET_ACCESS_TABLE} WHERE review_set_id = ? AND member_user_id = ?`,
    )
    .bind(reviewSetId, memberUserId);
}

export function selectReviewSetAccessListStatement(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  limit: number,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${REVIEW_SET_ACCESS_COLUMNS} FROM ${REVIEW_SET_ACCESS_TABLE} ` +
        `WHERE review_set_id = ? ORDER BY created_at ASC, id ASC LIMIT ?`,
    )
    .bind(reviewSetId, limit);
}

export async function readReviewSetAccessList(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  limit: number,
): Promise<ReviewSetAccessRow[]> {
  const { results } = await selectReviewSetAccessListStatement(
    database,
    reviewSetId,
    limit,
  ).all<ReviewSetAccessRow>();
  return results;
}

// THE AUTHORIZATION READ. Composed from the same predicate every corpus read composes, rather than
// spelling the membership test a second time — two spellings of one rule drift, and the direction
// this one drifts in is disclosure.
//
// Used by the route to turn "not on the list" into a 404 before any work happens. It is a
// convenience, NOT the wall: the wall is that every corpus statement carries the predicate itself, so
// a route that forgot this call still reads nothing.
export function selectMemberHasReviewSetAccessStatement(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  access: ReviewSetAccessPredicate,
): SqlStatement {
  return database
    .prepare(`SELECT 1 AS reachable WHERE ${access.fragmentFor("?")}`)
    .bind(reviewSetId, ...access.bindings);
}

export async function memberHasReviewSetAccess(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  access: ReviewSetAccessPredicate,
): Promise<boolean> {
  const { results } = await selectMemberHasReviewSetAccessStatement(
    database,
    reviewSetId,
    access,
  ).all<{ reachable: number }>();
  return results.length > 0;
}

// The seat count, for the route's response and for the guard that stops the list reaching empty. A
// review set with one member on its list is an attorneys'-eyes-only corpus, and a surface that shows
// the number makes that visible without listing anybody.
//
// IT COUNTS MEMBERS WHO CAN ACTUALLY ACT, NOT ROWS, and the difference is the whole reason this
// statement joins a second table. A deactivated member keeps every row they had — that is deliberate,
// because history is not rewritten when somebody leaves — while the platform's permission reads gate
// on `member.status = 'active'` and treat them as absent everywhere else. A count of rows would
// therefore let the revoke guard believe a list has two people on it when one of them left the firm
// last year, and removing the other would strand the corpus permanently: the list is fail-closed, so
// nobody could read it, nobody could close it, and nobody could grant access back.
export function selectReviewSetAccessCountStatement(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
): SqlStatement {
  return database
    .prepare(
      `SELECT COUNT(*) AS member_count FROM ${REVIEW_SET_ACCESS_TABLE} ` +
        `JOIN ${MEMBER_TABLE} ON ${MEMBER_TABLE}.user_id = ${REVIEW_SET_ACCESS_TABLE}.member_user_id ` +
        `AND ${MEMBER_TABLE}.status = 'active' ` +
        `WHERE ${REVIEW_SET_ACCESS_TABLE}.review_set_id = ?`,
    )
    .bind(reviewSetId);
}

export async function readReviewSetAccessCount(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
): Promise<number> {
  const { results } = await selectReviewSetAccessCountStatement(database, reviewSetId).all<{
    member_count: number;
  }>();
  return results[0]?.member_count ?? 0;
}

// THE OTHER HALF OF THE SAME HOLE, and the one the guard above structurally cannot close.
//
// The guard is on REVOKING. Deactivating a member is a different verb, performed somewhere else, by
// somebody who has never heard of this review set — and it strands a corpus just as completely,
// because a deactivated member is absent to every read while their access row stays put. Nothing is
// revoked, so nothing refuses.
//
// This is the read the deactivation path must run first: every review set where this member is the
// only ACTIVE person on the list. A non-empty answer means deactivating them makes those corpora
// unreachable by everybody, permanently, with no operator override and no Owner bypass — so the
// deactivation is refused until somebody else is added to each one. There is deliberately no escape
// hatch on the other side: every one of them would weaken the exact property the list exists to
// provide, which is that no role sees through the wall.
export interface StrandedReviewSet {
  readonly review_set_id: ReviewSetId;
  readonly name: string;
}

export function selectReviewSetsHeldOnlyByStatement(
  database: SqlDatabase,
  memberUserId: UserId,
  limit: number,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${REVIEW_SET_ACCESS_TABLE}.review_set_id AS review_set_id, review_set.name AS name ` +
        `FROM ${REVIEW_SET_ACCESS_TABLE} ` +
        `JOIN review_set ON review_set.id = ${REVIEW_SET_ACCESS_TABLE}.review_set_id ` +
        `WHERE ${REVIEW_SET_ACCESS_TABLE}.member_user_id = ? ` +
        // The member being asked about is excluded from the count, so this reads "nobody else who
        // can act is on this list" rather than "one person is". Written as a correlated NOT EXISTS
        // rather than a grouped count: the answer is wanted per review set, and a HAVING over a
        // join to `member` would have to re-state the active rule a third time.
        `AND NOT EXISTS (` +
        `SELECT 1 FROM ${REVIEW_SET_ACCESS_TABLE} AS other ` +
        `JOIN ${MEMBER_TABLE} ON ${MEMBER_TABLE}.user_id = other.member_user_id ` +
        `AND ${MEMBER_TABLE}.status = 'active' ` +
        `WHERE other.review_set_id = ${REVIEW_SET_ACCESS_TABLE}.review_set_id ` +
        `AND other.member_user_id <> ?` +
        `) ` +
        `ORDER BY review_set.name ASC, ${REVIEW_SET_ACCESS_TABLE}.review_set_id ASC LIMIT ?`,
    )
    .bind(memberUserId, memberUserId, limit);
}

export async function readReviewSetsHeldOnlyBy(
  database: SqlDatabase,
  memberUserId: UserId,
  limit: number,
): Promise<StrandedReviewSet[]> {
  const { results } = await selectReviewSetsHeldOnlyByStatement(
    database,
    memberUserId,
    limit,
  ).all<StrandedReviewSet>();
  return results;
}
