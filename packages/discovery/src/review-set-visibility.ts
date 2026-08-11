// THE review-set access seam. Every discovery statement builder that reads or writes review-set
// content takes one of these as a REQUIRED argument and composes it into the WHERE clause BEFORE the
// LIMIT.
//
// Required rather than optional-with-a-default on purpose: a read that forgets it is a disclosure of
// material that may be attorney's-eyes-only under a protective order, and a required argument makes
// that mistake a type error first and a fitness-test failure second, rather than a review comment
// nobody makes. `test/review-set-visibility-fitness.test.ts` proves it for every registered builder
// from one table-driven pass, so a builder added tomorrow is held to it without anybody remembering.
//
// COMPOSED IN SQL AND NEVER APPLIED IN THE WORKER after the rows come back. A post-filter would
// under-fill the page (a page of a hundred returns eleven), make the next cursor mean something
// different from page to page, and turn the page size into an existence oracle for the rows it
// removed — which on a corpus whose whole point is that some people may not see it is the difference
// between a wall and a hint. It is also the difference between a wall and a race: a Worker that
// fetched rows and then decided has already fetched them.
//
// ABSENCE, NOT EXISTENCE. A review set a member is not on the list for produces no rows, no count, no
// progress figure and no error naming it — it is not there, rather than there and refused.
//
// THE LIST IS FAIL-CLOSED. No row means no access. Making an empty list mean "open to everyone with
// the permission" would turn the wall opt-in, so a bug in the seeding path would silently disclose a
// corpus rather than silently hide one, and only one of those two failures is recoverable by a person
// noticing they cannot see something.

import type { UserId } from "@magna-carta/identifiers/types";

// Table name tracked against @magna-carta/database's per-firm schema by the schema-name-sync fitness
// test.
export const REVIEW_SET_ACCESS_TABLE = "review_set_access";

export interface ReviewSetAccessPredicate {
  // A SQL fragment over a review-set-id expression the builder supplies, e.g.
  //   `EXISTS (SELECT 1 FROM review_set_access WHERE review_set_access.review_set_id = t.review_set_id AND ...)`.
  // The builder hands in the column that names its review set; the predicate decides everything else.
  readonly fragmentFor: (reviewSetIdExpression: string) => string;
  readonly bindings: readonly unknown[];
  // A stable marker every built statement carries, so the fitness test can prove composition without
  // parsing SQL. It is part of the fragment's own TEXT, never a comment appended to it — a comment
  // could be stripped by a formatter while the predicate quietly went missing.
  readonly marker: string;
}

// The marker is the table-and-column reference the predicate always names. A statement that does not
// contain it did not compose the predicate.
export const REVIEW_SET_ACCESS_MARKER = `${REVIEW_SET_ACCESS_TABLE}.member_user_id = ?`;

// The corpora this member may reach: exactly those the access list names them on.
//
// An EXISTS subquery rather than a join, deliberately. A join to the access list would multiply rows
// if the list ever gained a second row per member (it cannot today — the unique index forbids it —
// but a predicate whose correctness depends on a different table's unique index is a predicate that
// breaks silently when that index changes). EXISTS also lets the planner stop at the first match and
// reads the same unique index the list is kept single by.
export function reviewSetAccessPredicate(memberUserId: UserId): ReviewSetAccessPredicate {
  return {
    fragmentFor: (reviewSetIdExpression) =>
      `EXISTS (SELECT 1 FROM ${REVIEW_SET_ACCESS_TABLE} ` +
      `WHERE ${REVIEW_SET_ACCESS_TABLE}.review_set_id = ${reviewSetIdExpression} ` +
      `AND ${REVIEW_SET_ACCESS_MARKER})`,
    bindings: [memberUserId],
    marker: REVIEW_SET_ACCESS_MARKER,
  };
}
