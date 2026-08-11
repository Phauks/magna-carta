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

// The seat count, for the route's response. A review set with one member on its list is an
// attorneys'-eyes-only corpus, and a surface that shows the number makes that visible without
// listing anybody.
export function selectReviewSetAccessCountStatement(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
): SqlStatement {
  return database
    .prepare(
      `SELECT COUNT(*) AS member_count FROM ${REVIEW_SET_ACCESS_TABLE} WHERE review_set_id = ?`,
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
