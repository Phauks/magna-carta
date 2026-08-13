import type {
  CommunityCommentId,
  CommunityPostId,
  CommunityProfileId,
  FirmId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { SqlDatabase, SqlStatement } from "../sql.ts";
import type { Category } from "../categories.ts";
import type {
  DeclineReason,
  HiddenReason,
  PostKind,
  PostStatus,
  Sort,
  Visibility,
} from "../types.ts";
import { COMMUNITY_POST_TABLE, COMMUNITY_PROFILE_TABLE, COMMUNITY_VOTE_TABLE } from "./tables.ts";

// The column list every read of a post uses, joined to its author's profile. Written once so a new
// read cannot accidentally select a column the projection has no field for — in particular
// `author_firm_id`, which is on the row and belongs on no response.
const POST_COLUMNS = `
  post.number AS number,
  post.slug AS slug,
  post.kind AS kind,
  post.category AS category,
  post.title AS title,
  post.body AS body,
  post.status AS status,
  post.decline_reason AS decline_reason,
  post.decline_note AS decline_note,
  post.vote_count AS vote_count,
  post.distinct_firm_vote_count AS distinct_firm_vote_count,
  post.comment_count AS comment_count,
  post.accepted_comment_id AS accepted_comment_id,
  post.visibility AS visibility,
  post.archived_at AS archived_at,
  post.created_at AS created_at,
  post.updated_at AS updated_at,
  post.last_activity_at AS last_activity_at,
  post.author_profile_id AS author_profile_id,
  duplicate_target.number AS duplicate_of_number,
  author.id AS author_id,
  author.display_name AS author_display_name,
  author.badge AS author_badge
`;

const POST_FROM = `
  FROM ${COMMUNITY_POST_TABLE} AS post
  JOIN ${COMMUNITY_PROFILE_TABLE} AS author ON author.id = post.author_profile_id
  LEFT JOIN ${COMMUNITY_POST_TABLE} AS duplicate_target ON duplicate_target.id = post.duplicate_of_post_id
`;

export interface StoredPostRow {
  readonly number: number;
  readonly slug: string;
  readonly kind: string;
  readonly category: string;
  readonly title: string;
  readonly body: string;
  readonly status: string | null;
  readonly decline_reason: string | null;
  readonly decline_note: string | null;
  readonly vote_count: number;
  readonly distinct_firm_vote_count: number;
  readonly comment_count: number;
  readonly accepted_comment_id: string | null;
  readonly visibility: string;
  readonly archived_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly last_activity_at: string;
  readonly author_profile_id: string;
  readonly duplicate_of_number: number | null;
  readonly author_id: string;
  readonly author_display_name: string;
  readonly author_badge: string;
}

export interface InsertPostInput {
  readonly id: CommunityPostId;
  readonly number: number;
  readonly slug: string;
  readonly kind: PostKind;
  readonly category: Category;
  readonly title: string;
  readonly body: string;
  readonly authorProfileId: CommunityProfileId;
  readonly authorUserId: UserId;
  readonly authorFirmId: FirmId;
  readonly visibility: Visibility;
  readonly hiddenReason: HiddenReason | null;
  readonly now: string;
}

export function insertPostStatement(database: SqlDatabase, input: InsertPostInput): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${COMMUNITY_POST_TABLE}
         (id, number, slug, kind, category, title, body, author_profile_id, author_user_id,
          author_firm_id, visibility, hidden_reason, created_at, updated_at, last_activity_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13, ?13)`,
    )
    .bind(
      input.id,
      input.number,
      input.slug,
      input.kind,
      input.category,
      input.title,
      input.body,
      input.authorProfileId,
      input.authorUserId,
      input.authorFirmId,
      input.visibility,
      input.hiddenReason,
      input.now,
    );
}

export function selectPostByNumberStatement(database: SqlDatabase, number: number): SqlStatement {
  return database.prepare(`SELECT ${POST_COLUMNS} ${POST_FROM} WHERE post.number = ?1`).bind(number);
}

// The handle behind a number. Kept separate from the read above because a write path needs the
// identifier and nothing else, and selecting the body to throw it away is how a body ends up
// somewhere it should not be.
export function selectPostIdentityByNumberStatement(
  database: SqlDatabase,
  number: number,
): SqlStatement {
  return database
    .prepare(
      `SELECT id, kind, status, visibility, author_profile_id, author_user_id
       FROM ${COMMUNITY_POST_TABLE} WHERE number = ?1`,
    )
    .bind(number);
}

export interface ListPostsFilter {
  readonly kind?: PostKind;
  readonly category?: Category;
  readonly status?: PostStatus;
  readonly sort: Sort;
  readonly limit: number;
  // A cursor is the exclusive lower bound in the sort's own terms, carried opaquely by the caller.
  readonly cursor?: { readonly createdAt: string; readonly number: number };
  readonly now: string;
}

// The board's list read. Only published posts, always — an unpublished post is absent from every
// list for every reader including its author, who reaches their own through their profile instead.
//
// The ordering is expressed in SQL rather than by reading rows into memory and sorting them: a
// category with two thousand requests must not be paged by fetching two thousand rows. The trending
// expression is the same arithmetic as the comparator in ranking.ts, and the test that keeps them
// agreeing is what stops the two definitions drifting.
export function listPostsStatement(database: SqlDatabase, filter: ListPostsFilter): SqlStatement {
  const conditions = ["post.visibility = 'published'"];
  const bindings: unknown[] = [];
  let nextParameter = 1;

  if (filter.kind !== undefined) {
    conditions.push(`post.kind = ?${nextParameter++}`);
    bindings.push(filter.kind);
  }
  if (filter.category !== undefined) {
    conditions.push(`post.category = ?${nextParameter++}`);
    bindings.push(filter.category);
  }
  if (filter.status !== undefined) {
    conditions.push(`post.status = ?${nextParameter++}`);
    bindings.push(filter.status);
  }
  if (filter.cursor !== undefined) {
    // Keyset pagination on (created_at, number). The number breaks the tie so two posts written in
    // the same millisecond cannot make a page repeat or skip.
    conditions.push(
      `(post.created_at < ?${nextParameter} OR (post.created_at = ?${nextParameter} AND post.number < ?${nextParameter + 1}))`,
    );
    bindings.push(filter.cursor.createdAt, filter.cursor.number);
    nextParameter += 2;
  }

  const nowParameter = nextParameter++;
  bindings.push(filter.now);
  const limitParameter = nextParameter;
  bindings.push(filter.limit);

  const orderBy =
    filter.sort === "new"
      ? "post.created_at DESC, post.number DESC"
      : filter.sort === "top"
        ? "post.distinct_firm_vote_count DESC, post.vote_count DESC, post.created_at DESC"
        : // Trending: distinct-firm demand plus a quarter-weight for each comment, divided by how
          // long ago the post was last active. Computed in the query rather than stored, so nothing
          // has to be recomputed on a schedule and no score can go stale.
          //
          // The decay is hyperbolic rather than exponential for a portability reason worth knowing:
          // `pow` and `exp` are SQLite's optional math functions, present only in builds compiled
          // with them, while `julianday` and division are core. A score that silently fails to
          // evaluate would reorder the board rather than raise anything, so the arithmetic stays
          // inside what every SQLite build has. ranking.ts computes the identical expression, and
          // the test comparing the two orderings is what keeps them from drifting.
          `(post.distinct_firm_vote_count + post.comment_count * 0.25) /
             (1.0 + max(0, julianday(?${nowParameter}) - julianday(post.last_activity_at)) / 30.0) DESC,
           post.last_activity_at DESC`;

  return database
    .prepare(
      `SELECT ${POST_COLUMNS} ${POST_FROM}
       WHERE ${conditions.join(" AND ")}
       ORDER BY ${orderBy}
       LIMIT ?${limitParameter}`,
    )
    .bind(...bindings);
}

// THE AUTHOR'S OWN DELETE, and the reason it is one statement.
//
// It is a single UPDATE that erases the text and flips the visibility together. The body is not
// hidden and queued for erasure — it is gone when this statement returns, because the body has
// exactly one home and no revision table shadows it. The title goes with it: a title can identify a
// client as thoroughly as a body can, and leaving it behind would make the deletion a tombstone
// naming the thing the member just decided not to say.
//
// Guarded on the author's own account, so it is not an operator action wearing a member's clothes.
export function authorDeletePostStatement(
  database: SqlDatabase,
  input: { readonly postId: CommunityPostId; readonly authorUserId: UserId; readonly now: string },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${COMMUNITY_POST_TABLE}
         SET title = '', body = '', visibility = 'deleted_by_author', hidden_reason = NULL, updated_at = ?3
       WHERE id = ?1 AND author_user_id = ?2 AND visibility <> 'deleted_by_author'`,
    )
    .bind(input.postId, input.authorUserId, input.now);
}

// The author's edit. Same guard, and no history is kept anywhere: a member who realises their post
// said too much must be able to make the original unreadable, which a revision table would defeat.
export function authorEditPostStatement(
  database: SqlDatabase,
  input: {
    readonly postId: CommunityPostId;
    readonly authorUserId: UserId;
    readonly title: string;
    readonly body: string;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${COMMUNITY_POST_TABLE}
         SET title = ?3, body = ?4, updated_at = ?5
       WHERE id = ?1 AND author_user_id = ?2 AND visibility IN ('published', 'pending_first_write_review')`,
    )
    .bind(input.postId, input.authorUserId, input.title, input.body, input.now);
}

// The hide. Guarded on the post not already being terminal, so a hide cannot resurrect something an
// author deleted.
export function hidePostStatement(
  database: SqlDatabase,
  input: {
    readonly postId: CommunityPostId;
    readonly reason: HiddenReason;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${COMMUNITY_POST_TABLE}
         SET visibility = 'hidden', hidden_reason = ?2, updated_at = ?3
       WHERE id = ?1 AND visibility IN ('published', 'pending_first_write_review')`,
    )
    .bind(input.postId, input.reason, input.now);
}

// The restore, which is the half of remove-first that makes remove-first affordable. Only a hidden
// post restores; a removed or author-deleted one has no text left to restore.
export function restorePostStatement(
  database: SqlDatabase,
  postId: CommunityPostId,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${COMMUNITY_POST_TABLE}
         SET visibility = 'published', hidden_reason = NULL, updated_at = ?2
       WHERE id = ?1 AND visibility = 'hidden'`,
    )
    .bind(postId, now);
}

// The operator's permanent removal. Erases the text for the same reason the author's delete does —
// a removal that leaves the words in the database has not removed anything that matters.
export function removePostStatement(
  database: SqlDatabase,
  postId: CommunityPostId,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${COMMUNITY_POST_TABLE}
         SET title = '', body = '', visibility = 'removed', updated_at = ?2
       WHERE id = ?1 AND visibility <> 'deleted_by_author'`,
    )
    .bind(postId, now);
}

export function publishPostStatement(
  database: SqlDatabase,
  postId: CommunityPostId,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${COMMUNITY_POST_TABLE}
         SET visibility = 'published', hidden_reason = NULL, updated_at = ?2
       WHERE id = ?1 AND visibility = 'pending_first_write_review'`,
    )
    .bind(postId, now);
}

// A status write, refused at the database for a question: the guard is `kind = 'request'`, so a
// question cannot acquire a roadmap position even if a caller asks for one.
export function setPostStatusStatement(
  database: SqlDatabase,
  input: {
    readonly postId: CommunityPostId;
    readonly status: PostStatus;
    readonly declineReason: DeclineReason | null;
    readonly declineNote: string | null;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${COMMUNITY_POST_TABLE}
         SET status = ?2, decline_reason = ?3, decline_note = ?4, updated_at = ?5
       WHERE id = ?1 AND kind = 'request'`,
    )
    .bind(input.postId, input.status, input.declineReason, input.declineNote, input.now);
}

// A question becomes a request in one action, carrying its whole thread with it. This is the move a
// board with only one post kind cannot make, and it is why the two kinds share a table.
export function convertQuestionToRequestStatement(
  database: SqlDatabase,
  input: { readonly postId: CommunityPostId; readonly status: PostStatus; readonly now: string },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${COMMUNITY_POST_TABLE}
         SET kind = 'request', status = ?2, accepted_comment_id = NULL, updated_at = ?3
       WHERE id = ?1 AND kind = 'question'`,
    )
    .bind(input.postId, input.status, input.now);
}

export function markDuplicateStatement(
  database: SqlDatabase,
  input: {
    readonly postId: CommunityPostId;
    readonly targetPostId: CommunityPostId;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${COMMUNITY_POST_TABLE}
         SET status = 'duplicate', duplicate_of_post_id = ?2, updated_at = ?3
       WHERE id = ?1 AND kind = 'request' AND id <> ?2`,
    )
    .bind(input.postId, input.targetPostId, input.now);
}

export function acceptAnswerStatement(
  database: SqlDatabase,
  input: {
    readonly postId: CommunityPostId;
    readonly commentId: CommunityCommentId;
    readonly authorUserId: UserId;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${COMMUNITY_POST_TABLE}
         SET accepted_comment_id = ?2, updated_at = ?4
       WHERE id = ?1 AND kind = 'question' AND author_user_id = ?3`,
    )
    .bind(input.postId, input.commentId, input.authorUserId, input.now);
}

// Bumped by a vote or a comment, and read by the archive sweep and the trending order.
export function touchLastActivityStatement(
  database: SqlDatabase,
  postId: CommunityPostId,
  now: string,
): SqlStatement {
  return database
    .prepare(`UPDATE ${COMMUNITY_POST_TABLE} SET last_activity_at = ?2 WHERE id = ?1`)
    .bind(postId, now);
}

// Archives, never deletes. A request with no activity for a year stops competing for attention and
// keeps every word of itself.
export function archiveStalePostsStatement(
  database: SqlDatabase,
  cutoff: string,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${COMMUNITY_POST_TABLE}
         SET archived_at = ?2, updated_at = ?2
       WHERE archived_at IS NULL AND visibility = 'published' AND last_activity_at < ?1`,
    )
    .bind(cutoff, now);
}

// The untriaged queue: requests that have been published for longer than the triage window and
// still carry no status. Read by the operator's own view — nothing on this board sits unanswered
// because nobody was counting.
export function listUntriagedRequestsStatement(
  database: SqlDatabase,
  cutoff: string,
  limit: number,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${POST_COLUMNS} ${POST_FROM}
       WHERE post.kind = 'request' AND post.status IS NULL AND post.visibility = 'published'
         AND post.created_at < ?1
       ORDER BY post.created_at ASC
       LIMIT ?2`,
    )
    .bind(cutoff, limit);
}

// Recomputes both counters from the vote rows themselves rather than incrementing them.
//
// A counter maintained by increments drifts the first time a batch half-applies, and the drift is
// silent and permanent. Recomputing costs one indexed scan of one post's votes, which is nothing at
// this board's size, and it makes the vote table the only place a count can come from. The
// distinct-firm figure is the one ranking uses; note that it counts firms and never reads which
// firms, which is the only thing it is allowed to know.
export function recountPostVotesStatement(
  database: SqlDatabase,
  postId: CommunityPostId,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${COMMUNITY_POST_TABLE}
         SET vote_count = (SELECT COUNT(*) FROM ${COMMUNITY_VOTE_TABLE} WHERE post_id = ?1),
             distinct_firm_vote_count =
               (SELECT COUNT(DISTINCT firm_id) FROM ${COMMUNITY_VOTE_TABLE} WHERE post_id = ?1)
       WHERE id = ?1`,
    )
    .bind(postId);
}

export function recountPostCommentsStatement(
  database: SqlDatabase,
  postId: CommunityPostId,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${COMMUNITY_POST_TABLE}
         SET comment_count =
           (SELECT COUNT(*) FROM community_comment WHERE post_id = ?1 AND visibility = 'published')
       WHERE id = ?1`,
    )
    .bind(postId);
}

// Moves every vote on a duplicate to the request it was merged into, skipping any account that had
// already voted for the target — which the unique index would refuse anyway, and which must not
// abort the merge.
export function carryVotesToDuplicateTargetStatement(
  database: SqlDatabase,
  input: { readonly postId: CommunityPostId; readonly targetPostId: CommunityPostId },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${COMMUNITY_VOTE_TABLE}
         SET post_id = ?2
       WHERE post_id = ?1
         AND user_id NOT IN (SELECT user_id FROM ${COMMUNITY_VOTE_TABLE} WHERE post_id = ?2)`,
    )
    .bind(input.postId, input.targetPostId);
}
