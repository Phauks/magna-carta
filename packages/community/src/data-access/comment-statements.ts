import type {
  CommunityCommentId,
  CommunityPostId,
  CommunityProfileId,
  FirmId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { SqlDatabase, SqlStatement } from "../sql.ts";
import type { HiddenReason, Visibility } from "../types.ts";
import { COMMUNITY_COMMENT_TABLE, COMMUNITY_PROFILE_TABLE } from "./tables.ts";

const COMMENT_COLUMNS = `
  comment.id AS id,
  comment.body AS body,
  comment.is_operator_response AS is_operator_response,
  comment.visibility AS visibility,
  comment.created_at AS created_at,
  comment.updated_at AS updated_at,
  comment.author_profile_id AS author_profile_id,
  author.id AS author_id,
  author.display_name AS author_display_name,
  author.badge AS author_badge
`;

export interface StoredCommentRow {
  readonly id: string;
  readonly body: string;
  readonly is_operator_response: number;
  readonly visibility: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly author_profile_id: string;
  readonly author_id: string;
  readonly author_display_name: string;
  readonly author_badge: string;
}

export function insertCommentStatement(
  database: SqlDatabase,
  input: {
    readonly id: CommunityCommentId;
    readonly postId: CommunityPostId;
    readonly authorProfileId: CommunityProfileId;
    readonly authorUserId: UserId;
    readonly authorFirmId: FirmId;
    readonly body: string;
    readonly isOperatorResponse: boolean;
    readonly visibility: Visibility;
    readonly hiddenReason: HiddenReason | null;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${COMMUNITY_COMMENT_TABLE}
         (id, post_id, author_profile_id, author_user_id, author_firm_id, body,
          is_operator_response, visibility, hidden_reason, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)`,
    )
    .bind(
      input.id,
      input.postId,
      input.authorProfileId,
      input.authorUserId,
      input.authorFirmId,
      input.body,
      input.isOperatorResponse ? 1 : 0,
      input.visibility,
      input.hiddenReason,
      input.now,
    );
}

// A post's thread, oldest first — a conversation reads forward. Only published comments: a hidden
// one is absent rather than replaced by a marker, for the same reason a hidden post is.
export function listCommentsStatement(
  database: SqlDatabase,
  input: { readonly postId: CommunityPostId; readonly limit: number },
): SqlStatement {
  return database
    .prepare(
      `SELECT ${COMMENT_COLUMNS}
       FROM ${COMMUNITY_COMMENT_TABLE} AS comment
       JOIN ${COMMUNITY_PROFILE_TABLE} AS author ON author.id = comment.author_profile_id
       WHERE comment.post_id = ?1 AND comment.visibility = 'published'
       ORDER BY comment.created_at ASC
       LIMIT ?2`,
    )
    .bind(input.postId, input.limit);
}

export function selectCommentIdentityStatement(
  database: SqlDatabase,
  commentId: CommunityCommentId,
): SqlStatement {
  return database
    .prepare(
      `SELECT id, post_id, author_profile_id, author_user_id, visibility
       FROM ${COMMUNITY_COMMENT_TABLE} WHERE id = ?1`,
    )
    .bind(commentId);
}

// The author's delete: the same single erasing write a post gets, for the same reason.
export function authorDeleteCommentStatement(
  database: SqlDatabase,
  input: {
    readonly commentId: CommunityCommentId;
    readonly authorUserId: UserId;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${COMMUNITY_COMMENT_TABLE}
         SET body = '', visibility = 'deleted_by_author', hidden_reason = NULL, updated_at = ?3
       WHERE id = ?1 AND author_user_id = ?2 AND visibility <> 'deleted_by_author'`,
    )
    .bind(input.commentId, input.authorUserId, input.now);
}

export function hideCommentStatement(
  database: SqlDatabase,
  input: {
    readonly commentId: CommunityCommentId;
    readonly reason: HiddenReason;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${COMMUNITY_COMMENT_TABLE}
         SET visibility = 'hidden', hidden_reason = ?2, updated_at = ?3
       WHERE id = ?1 AND visibility IN ('published', 'pending_first_write_review')`,
    )
    .bind(input.commentId, input.reason, input.now);
}

export function restoreCommentStatement(
  database: SqlDatabase,
  commentId: CommunityCommentId,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${COMMUNITY_COMMENT_TABLE}
         SET visibility = 'published', hidden_reason = NULL, updated_at = ?2
       WHERE id = ?1 AND visibility = 'hidden'`,
    )
    .bind(commentId, now);
}

export function removeCommentStatement(
  database: SqlDatabase,
  commentId: CommunityCommentId,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${COMMUNITY_COMMENT_TABLE}
         SET body = '', visibility = 'removed', updated_at = ?2
       WHERE id = ?1 AND visibility <> 'deleted_by_author'`,
    )
    .bind(commentId, now);
}

export function publishCommentStatement(
  database: SqlDatabase,
  commentId: CommunityCommentId,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${COMMUNITY_COMMENT_TABLE}
         SET visibility = 'published', hidden_reason = NULL, updated_at = ?2
       WHERE id = ?1 AND visibility = 'pending_first_write_review'`,
    )
    .bind(commentId, now);
}
