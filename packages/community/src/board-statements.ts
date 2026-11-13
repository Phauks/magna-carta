import type {
  CommunityCommentId,
  CommunityPostId,
  FirmId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { SqlDatabase, SqlStatement } from "./sql-database.ts";
import type {
  FlagReason,
  HeldReason,
  ModerationState,
  PostKind,
  PostStatus,
  SortOrder,
} from "./vocabulary.ts";

// The board's SQL, one statement per function, over the control-plane tables declared in
// @magna-carta/database's control-plane schema. Rules about WHO may do WHAT live in board-service.ts;
// this module only says how to read and write the rows.
//
// Two rules every read here holds:
// - No statement ever selects who voted. Votes are counted, and the one per-person vote read answers
//   only "has THIS viewer voted", for the viewer's own button.
// - No statement ever selects a firm id for display. Firms are written for ranking and moderation and
//   read only inside aggregate counts.

export interface PostRow {
  readonly id: CommunityPostId;
  readonly number: number;
  readonly kind: PostKind;
  readonly category: string;
  readonly status: PostStatus;
  readonly title: string;
  readonly body: string;
  readonly authorUserId: UserId;
  readonly authorDisplayName: string;
  readonly moderationState: ModerationState;
  readonly heldReason: HeldReason | null;
  readonly duplicateOfNumber: number | null;
  readonly declineReason: string | null;
  readonly declineNote: string | null;
  readonly acceptedCommentId: CommunityCommentId | null;
  readonly voteCount: number;
  readonly firmVoteCount: number;
  readonly commentCount: number;
  readonly linkedChangelogAnchor: string | null;
  readonly createdAt: string;
  readonly statusChangedAt: string | null;
  readonly lastActivityAt: string;
}

interface PostRecord {
  id: string;
  number: number;
  kind: string;
  category: string;
  status: string;
  title: string;
  body: string;
  author_user_id: string;
  author_display_name: string | null;
  moderation_state: string;
  held_reason: string | null;
  duplicate_of_number: number | null;
  decline_reason: string | null;
  decline_note: string | null;
  accepted_comment_id: string | null;
  vote_count: number;
  firm_vote_count: number;
  comment_count: number;
  linked_changelog_anchor: string | null;
  created_at: string;
  status_changed_at: string | null;
  last_activity_at: string;
}

const POST_COLUMNS = `p.id, p.number, p.kind, p.category, p.status, p.title, p.body, p.author_user_id,
  pr.display_name AS author_display_name, p.moderation_state, p.held_reason,
  d.number AS duplicate_of_number, p.decline_reason, p.decline_note, p.accepted_comment_id,
  p.vote_count, p.firm_vote_count, p.comment_count, p.linked_changelog_anchor, p.created_at,
  p.status_changed_at, p.last_activity_at`;

const POST_FROM = `community_post p
  LEFT JOIN community_profile pr ON pr.user_id = p.author_user_id
  LEFT JOIN community_post d ON d.id = p.duplicate_of_post_id`;

function toPostRow(record: PostRecord): PostRow {
  return {
    id: record.id as CommunityPostId,
    number: record.number,
    kind: record.kind as PostKind,
    category: record.category,
    status: record.status as PostStatus,
    title: record.title,
    body: record.body,
    authorUserId: record.author_user_id as UserId,
    authorDisplayName: record.author_display_name ?? "Member",
    moderationState: record.moderation_state as ModerationState,
    heldReason: record.held_reason as HeldReason | null,
    duplicateOfNumber: record.duplicate_of_number,
    declineReason: record.decline_reason,
    declineNote: record.decline_note,
    acceptedCommentId: record.accepted_comment_id as CommunityCommentId | null,
    voteCount: record.vote_count,
    firmVoteCount: record.firm_vote_count,
    commentCount: record.comment_count,
    linkedChangelogAnchor: record.linked_changelog_anchor,
    createdAt: record.created_at,
    statusChangedAt: record.status_changed_at,
    lastActivityAt: record.last_activity_at,
  };
}

// ---------------------------------------------------------------------------------------------------
// Profiles

export interface ProfileRow {
  readonly userId: UserId;
  readonly displayName: string;
  readonly approvedAt: string | null;
  readonly noticeDismissedAt: string | null;
}

export async function findProfile(
  database: SqlDatabase,
  userId: UserId,
): Promise<ProfileRow | null> {
  const { results } = await database
    .prepare(
      `SELECT user_id, display_name, approved_at, notice_dismissed_at
       FROM community_profile WHERE user_id = ?1 LIMIT 1`,
    )
    .bind(userId)
    .all<{
      user_id: string;
      display_name: string;
      approved_at: string | null;
      notice_dismissed_at: string | null;
    }>();
  const row = results[0];
  return row === undefined
    ? null
    : {
        userId: row.user_id as UserId,
        displayName: row.display_name,
        approvedAt: row.approved_at,
        noticeDismissedAt: row.notice_dismissed_at,
      };
}

export function upsertProfileStatement(
  database: SqlDatabase,
  input: { userId: UserId; displayName: string },
  now: string,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO community_profile (user_id, display_name, approved_at, notice_dismissed_at, created_at, updated_at)
       VALUES (?1, ?2, NULL, NULL, ?3, ?3)
       ON CONFLICT (user_id) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at`,
    )
    .bind(input.userId, input.displayName, now);
}

export function dismissNoticeStatement(
  database: SqlDatabase,
  userId: UserId,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE community_profile SET notice_dismissed_at = COALESCE(notice_dismissed_at, ?2), updated_at = ?2
       WHERE user_id = ?1`,
    )
    .bind(userId, now);
}

export function approveProfileStatement(
  database: SqlDatabase,
  userId: UserId,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE community_profile SET approved_at = COALESCE(approved_at, ?2), updated_at = ?2 WHERE user_id = ?1`,
    )
    .bind(userId, now);
}

// ---------------------------------------------------------------------------------------------------
// Posts

export interface PostInsert {
  readonly id: CommunityPostId;
  readonly kind: PostKind;
  readonly category: string;
  readonly title: string;
  readonly body: string;
  readonly authorUserId: UserId;
  readonly authorFirmId: FirmId;
  readonly moderationState: ModerationState;
  readonly heldReason: HeldReason | null;
}

// The public number is the next in a dense sequence, taken in the same statement as the insert so two
// concurrent posts cannot take one number (D1 runs a statement atomically, and the unique index on
// number is the backstop).
export function insertPostStatement(
  database: SqlDatabase,
  input: PostInsert,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO community_post (id, number, kind, category, status, title, body, author_user_id,
         author_firm_id, moderation_state, held_reason, vote_count, firm_vote_count, comment_count,
         created_at, updated_at, last_activity_at)
       SELECT ?1, COALESCE(MAX(number), 0) + 1, ?2, ?3, 'new', ?4, ?5, ?6, ?7, ?8, ?9, 0, 0, 0, ?10, ?10, ?10
       FROM community_post`,
    )
    .bind(
      input.id,
      input.kind,
      input.category,
      input.title,
      input.body,
      input.authorUserId,
      input.authorFirmId,
      input.moderationState,
      input.heldReason,
      now,
    );
}

export async function findPostByNumber(
  database: SqlDatabase,
  number: number,
): Promise<PostRow | null> {
  const { results } = await database
    .prepare(`SELECT ${POST_COLUMNS} FROM ${POST_FROM} WHERE p.number = ?1 LIMIT 1`)
    .bind(number)
    .all<PostRecord>();
  const row = results[0];
  return row === undefined ? null : toPostRow(row);
}

export async function findPostById(
  database: SqlDatabase,
  id: CommunityPostId,
): Promise<PostRow | null> {
  const { results } = await database
    .prepare(`SELECT ${POST_COLUMNS} FROM ${POST_FROM} WHERE p.id = ?1 LIMIT 1`)
    .bind(id)
    .all<PostRecord>();
  const row = results[0];
  return row === undefined ? null : toPostRow(row);
}

export interface PostListQuery {
  readonly kind: PostKind;
  readonly category?: string;
  readonly statuses?: readonly PostStatus[];
  readonly search?: string;
  readonly sort: SortOrder;
  readonly limit: number;
  readonly offset: number;
  // The viewer's own held posts are listed to them alongside the published ones.
  readonly viewerUserId?: UserId;
}

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}

const ORDER_BY: Record<SortOrder, string> = {
  // (firms + 1) / (hours since last activity + 2)^2 — the same formula as ranking.ts.
  trending: `(p.firm_vote_count + 1.0) /
    (((julianday(?1) - julianday(p.last_activity_at)) * 24 + 2) *
     ((julianday(?1) - julianday(p.last_activity_at)) * 24 + 2)) DESC, p.number DESC`,
  top: `p.firm_vote_count DESC, p.vote_count DESC, p.number DESC`,
  new: `p.created_at DESC, p.number DESC`,
};

export async function listPosts(
  database: SqlDatabase,
  query: PostListQuery,
  now: string,
): Promise<{ posts: PostRow[]; total: number }> {
  // ?1 is always `now` (the trending sort reads it); the filters take ?2 onward.
  const conditions = [`p.kind = ?2`];
  const values: unknown[] = [now, query.kind];
  const placeholder = (value: unknown): string => {
    values.push(value);
    return `?${values.length}`;
  };
  conditions.push(
    query.viewerUserId === undefined
      ? `p.moderation_state = 'published'`
      : `(p.moderation_state = 'published' OR (p.moderation_state = 'held' AND p.author_user_id = ${placeholder(query.viewerUserId)}))`,
  );
  if (query.category !== undefined) {
    conditions.push(`p.category = ${placeholder(query.category)}`);
  }
  if (query.statuses !== undefined && query.statuses.length > 0) {
    conditions.push(
      `p.status IN (${query.statuses.map((status) => placeholder(status)).join(", ")})`,
    );
  }
  if (query.search !== undefined && query.search.trim() !== "") {
    const pattern = placeholder(`%${escapeLike(query.search.trim())}%`);
    conditions.push(`(p.title LIKE ${pattern} ESCAPE '\\' OR p.body LIKE ${pattern} ESCAPE '\\')`);
  }
  const where = conditions.join(" AND ");
  const limitPlaceholder = placeholder(query.limit);
  const offsetPlaceholder = placeholder(query.offset);
  const [{ results }, counted] = await Promise.all([
    database
      .prepare(
        `SELECT ${POST_COLUMNS} FROM ${POST_FROM} WHERE ${where}
         ORDER BY ${ORDER_BY[query.sort]} LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
      )
      .bind(...values)
      .all<PostRecord>(),
    database
      .prepare(`SELECT COUNT(*) AS total FROM community_post p WHERE ${where} AND ?1 IS NOT NULL`)
      .bind(...values.slice(0, values.length - 2))
      .all<{ total: number }>(),
  ]);
  return { posts: results.map(toPostRow), total: counted.results[0]?.total ?? 0 };
}

// Published posts per product area and kind, for the area rail.
export async function countPublishedByArea(
  database: SqlDatabase,
  kind: PostKind,
): Promise<{ category: string; count: number }[]> {
  const { results } = await database
    .prepare(
      `SELECT category, COUNT(*) AS count FROM community_post
       WHERE moderation_state = 'published' AND kind = ?1 GROUP BY category`,
    )
    .bind(kind)
    .all<{ category: string; count: number }>();
  return results;
}

// Published requests per status, for the roadmap summary.
export async function countPublishedRequestsByStatus(
  database: SqlDatabase,
): Promise<{ status: string; count: number }[]> {
  const { results } = await database
    .prepare(
      `SELECT status, COUNT(*) AS count FROM community_post
       WHERE moderation_state = 'published' AND kind = 'request' GROUP BY status`,
    )
    .all<{ status: string; count: number }>();
  return results;
}

// The author's delete. ONE write, and the text is gone: title and body are blanked in place, so no
// copy survives anywhere and no second store has to be chased. The row stays so the number and any
// replies still resolve.
// fitness:unguarded-write — board-service.ts checks the author and the state first; a zero is a repeat delete of an already-deleted post, which is the outcome asked for
export function deletePostByAuthorStatement(
  database: SqlDatabase,
  input: { postId: CommunityPostId; authorUserId: UserId },
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE community_post SET title = '', body = '', moderation_state = 'deleted', updated_at = ?3
       WHERE id = ?1 AND author_user_id = ?2 AND moderation_state != 'deleted'`,
    )
    .bind(input.postId, input.authorUserId, now);
}

// fitness:unguarded-write — board-service.ts reads the post first; a zero means it was deleted by its author in between, and a deleted post is never re-published
export function setPostModerationStatement(
  database: SqlDatabase,
  input: { postId: CommunityPostId; state: ModerationState; heldReason: HeldReason | null },
  now: string,
): SqlStatement {
  // A moderator's removal blanks the text exactly as the author's delete does.
  const blank = input.state === "removed" ? `, title = '', body = ''` : "";
  return database
    .prepare(
      `UPDATE community_post SET moderation_state = ?2, held_reason = ?3, updated_at = ?4${blank}
       WHERE id = ?1 AND moderation_state != 'deleted'`,
    )
    .bind(input.postId, input.state, input.heldReason, now);
}

export interface StatusChange {
  readonly postId: CommunityPostId;
  readonly status: PostStatus;
  readonly declineReason: string | null;
  readonly declineNote: string | null;
  readonly duplicateOfPostId: CommunityPostId | null;
  readonly linkedChangelogAnchor: string | null;
}

export function setPostStatusStatement(
  database: SqlDatabase,
  change: StatusChange,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE community_post SET status = ?2, decline_reason = ?3, decline_note = ?4,
         duplicate_of_post_id = ?5, linked_changelog_anchor = COALESCE(?6, linked_changelog_anchor),
         triaged_at = COALESCE(triaged_at, ?7), status_changed_at = ?7, updated_at = ?7, last_activity_at = ?7
       WHERE id = ?1`,
    )
    .bind(
      change.postId,
      change.status,
      change.declineReason,
      change.declineNote,
      change.duplicateOfPostId,
      change.linkedChangelogAnchor,
      now,
    );
}

// fitness:unguarded-write — board-service.ts has already refused anything but a published question; the kind guard is a backstop and a zero changes nothing a reader can see
export function setAcceptedAnswerStatement(
  database: SqlDatabase,
  input: { postId: CommunityPostId; commentId: CommunityCommentId | null },
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE community_post SET accepted_comment_id = ?2,
         status = CASE WHEN ?2 IS NULL THEN 'new' ELSE 'answered' END, updated_at = ?3
       WHERE id = ?1 AND kind = 'question'`,
    )
    .bind(input.postId, input.commentId, now);
}

// ---------------------------------------------------------------------------------------------------
// Votes

export function insertVoteStatement(
  database: SqlDatabase,
  input: { postId: CommunityPostId; userId: UserId; firmId: FirmId },
  now: string,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO community_vote (post_id, user_id, firm_id, created_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (post_id, user_id) DO NOTHING`,
    )
    .bind(input.postId, input.userId, input.firmId, now);
}

// fitness:unguarded-write — withdrawing a vote that does not exist is the outcome asked for; the recount in the same batch is what readers see
export function deleteVoteStatement(
  database: SqlDatabase,
  input: { postId: CommunityPostId; userId: UserId },
): SqlStatement {
  return database
    .prepare(`DELETE FROM community_vote WHERE post_id = ?1 AND user_id = ?2`)
    .bind(input.postId, input.userId);
}

// Recomputes both counts from the vote rows, so the denormalized numbers can never drift.
export function recountVotesStatement(
  database: SqlDatabase,
  postId: CommunityPostId,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE community_post SET
         vote_count = (SELECT COUNT(*) FROM community_vote WHERE post_id = ?1),
         firm_vote_count = (SELECT COUNT(DISTINCT firm_id) FROM community_vote WHERE post_id = ?1),
         last_activity_at = ?2
       WHERE id = ?1`,
    )
    .bind(postId, now);
}

// The one per-person vote read: whether THIS viewer has voted, for their own button. Never a list.
export async function viewerHasVoted(
  database: SqlDatabase,
  postIds: readonly CommunityPostId[],
  userId: UserId,
): Promise<Set<CommunityPostId>> {
  if (postIds.length === 0) {
    return new Set();
  }
  const placeholders = postIds.map((_, index) => `?${index + 2}`).join(", ");
  const { results } = await database
    .prepare(
      `SELECT post_id FROM community_vote WHERE user_id = ?1 AND post_id IN (${placeholders})`,
    )
    .bind(userId, ...postIds)
    .all<{ post_id: string }>();
  return new Set(results.map((row) => row.post_id as CommunityPostId));
}

// ---------------------------------------------------------------------------------------------------
// Comments

export interface CommentRow {
  readonly id: CommunityCommentId;
  readonly postId: CommunityPostId;
  readonly body: string;
  readonly authorUserId: UserId;
  readonly authorDisplayName: string;
  readonly isTeamResponse: boolean;
  readonly moderationState: ModerationState;
  readonly createdAt: string;
}

export interface CommentInsert {
  readonly id: CommunityCommentId;
  readonly postId: CommunityPostId;
  readonly body: string;
  readonly authorUserId: UserId;
  readonly authorFirmId: FirmId;
  readonly isTeamResponse: boolean;
  readonly moderationState: ModerationState;
  readonly heldReason: HeldReason | null;
}

export function insertCommentStatement(
  database: SqlDatabase,
  input: CommentInsert,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO community_comment (id, post_id, body, author_user_id, author_firm_id, is_team_response,
         moderation_state, held_reason, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)`,
    )
    .bind(
      input.id,
      input.postId,
      input.body,
      input.authorUserId,
      input.authorFirmId,
      input.isTeamResponse ? 1 : 0,
      input.moderationState,
      input.heldReason,
      now,
    );
}

// fitness:unguarded-write — the WHERE names the post by id only to scope the recount; a zero means the post row is gone, and there is nothing to count
export function recountCommentsStatement(
  database: SqlDatabase,
  postId: CommunityPostId,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE community_post SET
         comment_count = (SELECT COUNT(*) FROM community_comment WHERE post_id = ?1 AND moderation_state = 'published'),
         last_activity_at = ?2
       WHERE id = ?1`,
    )
    .bind(postId, now);
}

export async function listComments(
  database: SqlDatabase,
  postId: CommunityPostId,
  viewerUserId: UserId | undefined,
): Promise<CommentRow[]> {
  const visibility =
    viewerUserId === undefined
      ? `c.moderation_state = 'published'`
      : `(c.moderation_state = 'published' OR (c.moderation_state = 'held' AND c.author_user_id = ?2))`;
  const statement = database.prepare(
    `SELECT c.id, c.post_id, c.body, c.author_user_id, pr.display_name AS author_display_name,
       c.is_team_response, c.moderation_state, c.created_at
     FROM community_comment c LEFT JOIN community_profile pr ON pr.user_id = c.author_user_id
     WHERE c.post_id = ?1 AND ${visibility}
     ORDER BY c.is_team_response DESC, c.created_at ASC`,
  );
  const { results } = await (
    viewerUserId === undefined ? statement.bind(postId) : statement.bind(postId, viewerUserId)
  ).all<{
    id: string;
    post_id: string;
    body: string;
    author_user_id: string;
    author_display_name: string | null;
    is_team_response: number;
    moderation_state: string;
    created_at: string;
  }>();
  return results.map((row) => ({
    id: row.id as CommunityCommentId,
    postId: row.post_id as CommunityPostId,
    body: row.body,
    authorUserId: row.author_user_id as UserId,
    authorDisplayName: row.author_display_name ?? "Member",
    isTeamResponse: row.is_team_response === 1,
    moderationState: row.moderation_state as ModerationState,
    createdAt: row.created_at,
  }));
}

export async function findComment(
  database: SqlDatabase,
  commentId: CommunityCommentId,
): Promise<{
  id: CommunityCommentId;
  postId: CommunityPostId;
  authorUserId: UserId;
  moderationState: ModerationState;
} | null> {
  const { results } = await database
    .prepare(
      `SELECT id, post_id, author_user_id, moderation_state FROM community_comment WHERE id = ?1 LIMIT 1`,
    )
    .bind(commentId)
    .all<{ id: string; post_id: string; author_user_id: string; moderation_state: string }>();
  const row = results[0];
  return row === undefined
    ? null
    : {
        id: row.id as CommunityCommentId,
        postId: row.post_id as CommunityPostId,
        authorUserId: row.author_user_id as UserId,
        moderationState: row.moderation_state as ModerationState,
      };
}

// fitness:unguarded-write — board-service.ts checks the author and the state first; a zero is a repeat delete, which is the outcome asked for
export function deleteCommentByAuthorStatement(
  database: SqlDatabase,
  input: { commentId: CommunityCommentId; authorUserId: UserId },
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE community_comment SET body = '', moderation_state = 'deleted', updated_at = ?3
       WHERE id = ?1 AND author_user_id = ?2 AND moderation_state != 'deleted'`,
    )
    .bind(input.commentId, input.authorUserId, now);
}

// fitness:unguarded-write — board-service.ts reads the comment first; a zero means its author deleted it in between, which a moderator decision must not undo
export function setCommentModerationStatement(
  database: SqlDatabase,
  input: { commentId: CommunityCommentId; state: ModerationState; heldReason: HeldReason | null },
  now: string,
): SqlStatement {
  const blank = input.state === "removed" ? `, body = ''` : "";
  return database
    .prepare(
      `UPDATE community_comment SET moderation_state = ?2, held_reason = ?3, updated_at = ?4${blank}
       WHERE id = ?1 AND moderation_state != 'deleted'`,
    )
    .bind(input.commentId, input.state, input.heldReason, now);
}

// ---------------------------------------------------------------------------------------------------
// Flags

export function insertFlagStatement(
  database: SqlDatabase,
  input: {
    id: string;
    postId: CommunityPostId;
    commentId: CommunityCommentId | null;
    reason: FlagReason;
    reporterUserId: UserId;
    reporterFirmId: FirmId;
  },
  now: string,
): SqlStatement {
  // A repeat report from the same person for the same reason is a no-op. The unique index cannot
  // say so for a post-level flag (its comment id is NULL, and NULLs never collide), so the insert
  // checks for itself.
  return database
    .prepare(
      `INSERT INTO community_flag (id, post_id, comment_id, reason, reporter_user_id, reporter_firm_id, created_at, resolved_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL
       WHERE NOT EXISTS (
         SELECT 1 FROM community_flag WHERE post_id = ?2 AND comment_id IS ?3 AND reporter_user_id = ?5
           AND reason = ?4 AND resolved_at IS NULL)`,
    )
    .bind(
      input.id,
      input.postId,
      input.commentId,
      input.reason,
      input.reporterUserId,
      input.reporterFirmId,
      now,
    );
}

export async function countOpenFlagFirms(
  database: SqlDatabase,
  input: {
    postId: CommunityPostId;
    commentId: CommunityCommentId | null;
    reasons: readonly FlagReason[];
  },
): Promise<number> {
  const reasonPlaceholders = input.reasons.map((_, index) => `?${index + 3}`).join(", ");
  const { results } = await database
    .prepare(
      `SELECT COUNT(DISTINCT reporter_firm_id) AS firms FROM community_flag
       WHERE post_id = ?1 AND comment_id IS ?2 AND resolved_at IS NULL AND reason IN (${reasonPlaceholders})`,
    )
    .bind(input.postId, input.commentId, ...input.reasons)
    .all<{ firms: number }>();
  return results[0]?.firms ?? 0;
}

// fitness:unguarded-write — a target with no open flags (a first-post hold, a detector hold) has nothing to resolve; a zero is normal
export function resolveFlagsStatement(
  database: SqlDatabase,
  input: { postId: CommunityPostId; commentId: CommunityCommentId | null },
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE community_flag SET resolved_at = ?3 WHERE post_id = ?1 AND comment_id IS ?2 AND resolved_at IS NULL`,
    )
    .bind(input.postId, input.commentId, now);
}

// The moderation queue: everything held or hidden, oldest first, for the team.
export async function listModerationQueue(database: SqlDatabase): Promise<{
  posts: PostRow[];
  comments: (CommentRow & {
    postNumber: number;
    postTitle: string;
    heldReason: HeldReason | null;
  })[];
}> {
  const [posts, comments] = await Promise.all([
    database
      .prepare(
        `SELECT ${POST_COLUMNS} FROM ${POST_FROM} WHERE p.moderation_state IN ('held', 'hidden') ORDER BY p.updated_at ASC`,
      )
      .all<PostRecord>(),
    database
      .prepare(
        `SELECT c.id, c.post_id, c.body, c.author_user_id, pr.display_name AS author_display_name,
           c.is_team_response, c.moderation_state, c.held_reason, c.created_at,
           p.number AS post_number, p.title AS post_title
         FROM community_comment c
         JOIN community_post p ON p.id = c.post_id
         LEFT JOIN community_profile pr ON pr.user_id = c.author_user_id
         WHERE c.moderation_state IN ('held', 'hidden') ORDER BY c.updated_at ASC`,
      )
      .all<{
        id: string;
        post_id: string;
        body: string;
        author_user_id: string;
        author_display_name: string | null;
        is_team_response: number;
        moderation_state: string;
        held_reason: string | null;
        created_at: string;
        post_number: number;
        post_title: string;
      }>(),
  ]);
  return {
    posts: posts.results.map(toPostRow),
    comments: comments.results.map((row) => ({
      id: row.id as CommunityCommentId,
      postId: row.post_id as CommunityPostId,
      body: row.body,
      authorUserId: row.author_user_id as UserId,
      authorDisplayName: row.author_display_name ?? "Member",
      isTeamResponse: row.is_team_response === 1,
      moderationState: row.moderation_state as ModerationState,
      createdAt: row.created_at,
      postNumber: row.post_number,
      postTitle: row.post_title,
      heldReason: row.held_reason as HeldReason | null,
    })),
  };
}

// What the open reports on held and hidden contributions say: one row per target and reason, with
// how many people made it. Never who reported, and never their firm.
export async function listOpenFlagReasons(database: SqlDatabase): Promise<
  {
    postId: CommunityPostId;
    commentId: CommunityCommentId | null;
    reason: FlagReason;
    reports: number;
  }[]
> {
  const { results } = await database
    .prepare(
      `SELECT post_id, comment_id, reason, COUNT(*) AS reports FROM community_flag
       WHERE resolved_at IS NULL GROUP BY post_id, comment_id, reason`,
    )
    .all<{ post_id: string; comment_id: string | null; reason: string; reports: number }>();
  return results.map((row) => ({
    postId: row.post_id as CommunityPostId,
    commentId: row.comment_id as CommunityCommentId | null,
    reason: row.reason as FlagReason,
    reports: row.reports,
  }));
}
