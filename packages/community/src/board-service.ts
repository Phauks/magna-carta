import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { CommunityCommentId, FirmId, UserId } from "@magna-carta/identifiers/types";
import {
  approveProfileStatement,
  countOpenFlagFirms,
  countPublishedByArea,
  countPublishedRequestsByStatus,
  deleteCommentByAuthorStatement,
  deletePostByAuthorStatement,
  deleteVoteStatement,
  dismissNoticeStatement,
  findComment,
  findPostByNumber,
  findProfile,
  insertCommentStatement,
  insertFlagStatement,
  insertPostStatement,
  insertVoteStatement,
  listComments,
  listPosts,
  recountCommentsStatement,
  recountVotesStatement,
  resolveFlagsStatement,
  setAcceptedAnswerStatement,
  setCommentModerationStatement,
  setPostModerationStatement,
  setPostStatusStatement,
  upsertProfileStatement,
  viewerHasVoted,
  type CommentRow,
  type PostRow,
} from "./board-statements.ts";
import {
  detectConfidentialDetail,
  type ConfidentialityFinding,
} from "./confidentiality-detector.ts";
import { displayedVoteCount } from "./display.ts";
import type { SqlDatabase } from "./sql-database.ts";
import {
  DECLINE_REASONS,
  PRODUCT_AREA_SLUGS,
  REQUEST_STATUSES,
  ROADMAP_COLUMNS,
  SPAM_HIDE_DISTINCT_FIRMS,
  type DeclineReason,
  type FlagReason,
  type HeldReason,
  type ModerationState,
  type PostKind,
  type PostStatus,
  type RequestStatus,
  type SortOrder,
} from "./vocabulary.ts";

// The board's rules: who may post, vote, comment, delete, flag and triage, and what each does to the
// rows. Every function takes the database and the instant explicitly, so the rules run unchanged
// against D1 in the worker and against node:sqlite in tests.
//
// A member is always a person AT a firm. The firm is written onto what they write, at the time they
// write it, and never returned by any read here.

export interface BoardMember {
  readonly userId: UserId;
  readonly firmId: FirmId;
  // A Magna Carta staff member: may triage, moderate, and reply with the team badge.
  readonly isTeam: boolean;
}

export type BoardRefusal =
  | "profile-required"
  | "post-not-found"
  | "comment-not-found"
  | "not-the-author"
  | "not-votable"
  | "not-team"
  | "invalid-category"
  | "invalid-status"
  | "decline-reason-required"
  | "duplicate-target-required"
  | "not-a-question";

export type BoardResult<T> = { ok: true; value: T } | { ok: false; refusal: BoardRefusal };

const ok = <T>(value: T): BoardResult<T> => ({ ok: true, value });
const refuse = <T>(refusal: BoardRefusal): BoardResult<T> => ({ ok: false, refusal });

// What a reader sees of a post. Never a voter, never a firm.
export interface BoardPostView {
  readonly number: number;
  readonly kind: PostKind;
  readonly category: string;
  readonly status: PostStatus;
  readonly title: string;
  readonly body: string;
  readonly authorDisplayName: string;
  readonly isOwnPost: boolean;
  readonly moderationState: ModerationState;
  readonly heldReason: HeldReason | null;
  readonly duplicateOfNumber: number | null;
  readonly declineReason: string | null;
  readonly declineNote: string | null;
  // Null below the display floor: an early post must not reveal which firm voted for it.
  readonly voteCount: number | null;
  readonly firmVoteCount: number | null;
  readonly commentCount: number;
  readonly viewerHasVoted: boolean;
  readonly linkedChangelogAnchor: string | null;
  readonly createdAt: string;
  readonly statusChangedAt: string | null;
}

export interface BoardCommentView {
  readonly id: CommunityCommentId;
  readonly body: string;
  readonly authorDisplayName: string;
  readonly isOwnComment: boolean;
  readonly isTeamResponse: boolean;
  readonly isAcceptedAnswer: boolean;
  readonly moderationState: ModerationState;
  readonly createdAt: string;
}

function postView(row: PostRow, viewer: UserId | undefined, voted: boolean): BoardPostView {
  return {
    number: row.number,
    kind: row.kind,
    category: row.category,
    status: row.status,
    title: row.title,
    body: row.body,
    authorDisplayName: row.authorDisplayName,
    isOwnPost: viewer !== undefined && row.authorUserId === viewer,
    moderationState: row.moderationState,
    heldReason: row.heldReason,
    duplicateOfNumber: row.duplicateOfNumber,
    declineReason: row.declineReason,
    declineNote: row.declineNote,
    voteCount: displayedVoteCount(row.voteCount),
    firmVoteCount: displayedVoteCount(row.voteCount) === null ? null : row.firmVoteCount,
    commentCount: row.commentCount,
    viewerHasVoted: voted,
    linkedChangelogAnchor: row.linkedChangelogAnchor,
    createdAt: row.createdAt,
    statusChangedAt: row.statusChangedAt,
  };
}

function commentView(
  row: CommentRow,
  viewer: UserId | undefined,
  acceptedId: CommunityCommentId | null,
): BoardCommentView {
  return {
    id: row.id,
    body: row.body,
    authorDisplayName: row.authorDisplayName,
    isOwnComment: viewer !== undefined && row.authorUserId === viewer,
    isTeamResponse: row.isTeamResponse,
    isAcceptedAnswer: row.id === acceptedId,
    moderationState: row.moderationState,
    createdAt: row.createdAt,
  };
}

// Whether a published post or comment is visible to this viewer at all. The author sees their own
// held item (so they know it is waiting); the team sees everything but a deletion.
function visibleTo(
  state: ModerationState,
  authorUserId: UserId,
  viewer: BoardMember | undefined,
): boolean {
  if (state === "published") {
    return true;
  }
  if (viewer === undefined) {
    return false;
  }
  if (viewer.isTeam) {
    return state !== "deleted";
  }
  return state === "held" && authorUserId === viewer.userId;
}

// Whether a new contribution from this person goes straight up or waits for a human. A brand-new
// profile is held until a moderator approves something it wrote; any text the detector flags is held
// whoever wrote it, team included, because a slip by staff is the same disclosure.
function initialModeration(
  approved: boolean,
  isTeam: boolean,
  findings: readonly ConfidentialityFinding[],
): { state: ModerationState; heldReason: HeldReason | null } {
  if (findings.length > 0) {
    return { state: "held", heldReason: "detector" };
  }
  if (!approved && !isTeam) {
    return { state: "held", heldReason: "first-post" };
  }
  return { state: "published", heldReason: null };
}

// ---------------------------------------------------------------------------------------------------
// Profiles

export async function getProfile(database: SqlDatabase, userId: UserId) {
  return findProfile(database, userId);
}

export async function saveDisplayName(
  database: SqlDatabase,
  userId: UserId,
  displayName: string,
  now: string,
): Promise<void> {
  await upsertProfileStatement(database, { userId, displayName: displayName.trim() }, now).run();
}

export async function dismissConfidentialityNotice(
  database: SqlDatabase,
  userId: UserId,
  now: string,
): Promise<void> {
  await dismissNoticeStatement(database, userId, now).run();
}

// ---------------------------------------------------------------------------------------------------
// Reading

export interface BoardListQuery {
  readonly kind: PostKind;
  readonly category?: string;
  readonly statuses?: readonly PostStatus[];
  readonly search?: string;
  readonly sort: SortOrder;
  readonly limit: number;
  readonly offset: number;
}

export async function listBoard(
  database: SqlDatabase,
  query: BoardListQuery,
  viewer: BoardMember | undefined,
  now: string,
): Promise<{ posts: BoardPostView[]; total: number }> {
  const { posts, total } = await listPosts(
    database,
    { ...query, viewerUserId: viewer?.userId },
    now,
  );
  const voted =
    viewer === undefined
      ? new Set()
      : await viewerHasVoted(
          database,
          posts.map((post) => post.id),
          viewer.userId,
        );
  return { posts: posts.map((post) => postView(post, viewer?.userId, voted.has(post.id))), total };
}

export async function readPost(
  database: SqlDatabase,
  number: number,
  viewer: BoardMember | undefined,
): Promise<BoardResult<{ post: BoardPostView; comments: BoardCommentView[] }>> {
  const row = await findPostByNumber(database, number);
  if (row === null || !visibleTo(row.moderationState, row.authorUserId, viewer)) {
    return refuse("post-not-found");
  }
  const [comments, voted] = await Promise.all([
    listComments(database, row.id, viewer?.isTeam === true ? undefined : viewer?.userId),
    viewer === undefined
      ? Promise.resolve(new Set())
      : viewerHasVoted(database, [row.id], viewer.userId),
  ]);
  return ok({
    post: postView(row, viewer?.userId, voted.has(row.id)),
    comments: comments.map((comment) =>
      commentView(comment, viewer?.userId, row.acceptedCommentId),
    ),
  });
}

export interface BoardSummary {
  readonly requestsByArea: Record<string, number>;
  readonly questionsByArea: Record<string, number>;
  readonly roadmap: Record<(typeof ROADMAP_COLUMNS)[number], number>;
}

export async function readBoardSummary(database: SqlDatabase): Promise<BoardSummary> {
  const [requests, questions, statuses] = await Promise.all([
    countPublishedByArea(database, "request"),
    countPublishedByArea(database, "question"),
    countPublishedRequestsByStatus(database),
  ]);
  const roadmap = Object.fromEntries(
    ROADMAP_COLUMNS.map((column) => [column, 0]),
  ) as BoardSummary["roadmap"];
  for (const { status, count } of statuses) {
    if ((ROADMAP_COLUMNS as readonly string[]).includes(status)) {
      roadmap[status as (typeof ROADMAP_COLUMNS)[number]] = count;
    }
  }
  return {
    requestsByArea: Object.fromEntries(requests.map(({ category, count }) => [category, count])),
    questionsByArea: Object.fromEntries(questions.map(({ category, count }) => [category, count])),
    roadmap,
  };
}

// ---------------------------------------------------------------------------------------------------
// Writing

export interface NewPost {
  readonly kind: PostKind;
  readonly category: string;
  readonly title: string;
  readonly body: string;
}

export async function createPost(
  database: SqlDatabase,
  member: BoardMember,
  input: NewPost,
  now: string,
): Promise<
  BoardResult<{
    number: number;
    moderationState: ModerationState;
    heldReason: HeldReason | null;
    findings: ConfidentialityFinding[];
  }>
> {
  if (!(PRODUCT_AREA_SLUGS as readonly string[]).includes(input.category)) {
    return refuse("invalid-category");
  }
  const profile = await findProfile(database, member.userId);
  if (profile === null) {
    return refuse("profile-required");
  }
  const title = input.title.trim();
  const body = input.body.trim();
  const findings = [...detectConfidentialDetail(title), ...detectConfidentialDetail(body)];
  const moderation = initialModeration(profile.approvedAt !== null, member.isTeam, findings);
  const id = newIdentifier("communityPost");
  await insertPostStatement(
    database,
    {
      id,
      kind: input.kind,
      category: input.category,
      title,
      body,
      authorUserId: member.userId,
      authorFirmId: member.firmId,
      moderationState: moderation.state,
      heldReason: moderation.heldReason,
    },
    now,
  ).run();
  const created = await findPostByNumberForId(database, id);
  return ok({
    number: created,
    moderationState: moderation.state,
    heldReason: moderation.heldReason,
    findings,
  });
}

async function findPostByNumberForId(database: SqlDatabase, id: string): Promise<number> {
  const { results } = await database
    .prepare(`SELECT number FROM community_post WHERE id = ?1`)
    .bind(id)
    .all<{ number: number }>();
  return results[0]?.number ?? 0;
}

export async function vote(
  database: SqlDatabase,
  member: BoardMember,
  number: number,
  cast: boolean,
  now: string,
): Promise<BoardResult<{ voteCount: number | null; viewerHasVoted: boolean }>> {
  const post = await findPostByNumber(database, number);
  if (post === null || !visibleTo(post.moderationState, post.authorUserId, member)) {
    return refuse("post-not-found");
  }
  // Only a published request is votable: a question's answers are what get judged, and a held post
  // has not been seen by anyone yet.
  if (post.kind !== "request" || post.moderationState !== "published") {
    return refuse("not-votable");
  }
  const change = cast
    ? insertVoteStatement(
        database,
        { postId: post.id, userId: member.userId, firmId: member.firmId },
        now,
      )
    : deleteVoteStatement(database, { postId: post.id, userId: member.userId });
  await database.batch([change, recountVotesStatement(database, post.id, now)]);
  const after = await findPostByNumber(database, number);
  return ok({ voteCount: displayedVoteCount(after?.voteCount ?? 0), viewerHasVoted: cast });
}

export async function addComment(
  database: SqlDatabase,
  member: BoardMember,
  number: number,
  body: string,
  now: string,
): Promise<
  BoardResult<{
    id: CommunityCommentId;
    moderationState: ModerationState;
    heldReason: HeldReason | null;
    findings: ConfidentialityFinding[];
  }>
> {
  const post = await findPostByNumber(database, number);
  if (post === null || post.moderationState !== "published") {
    return refuse("post-not-found");
  }
  const profile = await findProfile(database, member.userId);
  if (profile === null) {
    return refuse("profile-required");
  }
  const text = body.trim();
  const findings = detectConfidentialDetail(text);
  const moderation = initialModeration(profile.approvedAt !== null, member.isTeam, findings);
  const id = newIdentifier("communityComment");
  await database.batch([
    insertCommentStatement(
      database,
      {
        id,
        postId: post.id,
        body: text,
        authorUserId: member.userId,
        authorFirmId: member.firmId,
        isTeamResponse: member.isTeam,
        moderationState: moderation.state,
        heldReason: moderation.heldReason,
      },
      now,
    ),
    recountCommentsStatement(database, post.id, now),
  ]);
  return ok({ id, moderationState: moderation.state, heldReason: moderation.heldReason, findings });
}

// The author's own delete: instant, complete, no queue, one write.
export async function deleteOwnPost(
  database: SqlDatabase,
  member: BoardMember,
  number: number,
  now: string,
): Promise<BoardResult<null>> {
  const post = await findPostByNumber(database, number);
  if (post === null || post.moderationState === "deleted") {
    return refuse("post-not-found");
  }
  if (post.authorUserId !== member.userId) {
    return refuse("not-the-author");
  }
  await deletePostByAuthorStatement(
    database,
    { postId: post.id, authorUserId: member.userId },
    now,
  ).run();
  return ok(null);
}

export async function deleteOwnComment(
  database: SqlDatabase,
  member: BoardMember,
  commentId: CommunityCommentId,
  now: string,
): Promise<BoardResult<null>> {
  const comment = await findComment(database, commentId);
  if (comment === null || comment.moderationState === "deleted") {
    return refuse("comment-not-found");
  }
  if (comment.authorUserId !== member.userId) {
    return refuse("not-the-author");
  }
  await database.batch([
    deleteCommentByAuthorStatement(database, { commentId, authorUserId: member.userId }, now),
    recountCommentsStatement(database, comment.postId, now),
  ]);
  return ok(null);
}

// A reader's report. Confidentiality hides on the FIRST flag: a false positive costs an author a
// wait for review, a false negative is a permanent disclosure. Spam and abuse hide once several
// distinct firms agree, which bounds one firm's ability to silence a post.
export async function flag(
  database: SqlDatabase,
  member: BoardMember,
  input: { number: number; commentId?: CommunityCommentId; reason: FlagReason },
  now: string,
): Promise<BoardResult<{ hidden: boolean }>> {
  const post = await findPostByNumber(database, input.number);
  if (post === null || !visibleTo(post.moderationState, post.authorUserId, member)) {
    return refuse("post-not-found");
  }
  const commentId = input.commentId ?? null;
  if (commentId !== null) {
    const comment = await findComment(database, commentId);
    if (comment === null || comment.postId !== post.id) {
      return refuse("comment-not-found");
    }
  }
  await insertFlagStatement(
    database,
    {
      id: newIdentifier("communityFlag"),
      postId: post.id,
      commentId,
      reason: input.reason,
      reporterUserId: member.userId,
      reporterFirmId: member.firmId,
    },
    now,
  ).run();
  const shouldHide =
    input.reason === "confidential" ||
    (await countOpenFlagFirms(database, {
      postId: post.id,
      commentId,
      reasons: ["spam", "abuse"],
    })) >= SPAM_HIDE_DISTINCT_FIRMS;
  if (!shouldHide) {
    return ok({ hidden: false });
  }
  if (commentId === null) {
    await setPostModerationStatement(
      database,
      { postId: post.id, state: "hidden", heldReason: null },
      now,
    ).run();
  } else {
    await database.batch([
      setCommentModerationStatement(
        database,
        { commentId, state: "hidden", heldReason: null },
        now,
      ),
      recountCommentsStatement(database, post.id, now),
    ]);
  }
  return ok({ hidden: true });
}

// ---------------------------------------------------------------------------------------------------
// The team

export interface StatusUpdate {
  readonly status: RequestStatus;
  readonly declineReason?: DeclineReason;
  readonly declineNote?: string;
  readonly duplicateOfNumber?: number;
  readonly linkedChangelogAnchor?: string;
}

export async function setStatus(
  database: SqlDatabase,
  member: BoardMember,
  number: number,
  update: StatusUpdate,
  now: string,
): Promise<BoardResult<null>> {
  if (!member.isTeam) {
    return refuse("not-team");
  }
  if (!(REQUEST_STATUSES as readonly string[]).includes(update.status)) {
    return refuse("invalid-status");
  }
  const post = await findPostByNumber(database, number);
  if (post === null || post.moderationState === "deleted" || post.kind !== "request") {
    return refuse("post-not-found");
  }
  const declining = update.status === "not-on-the-roadmap";
  if (
    declining &&
    (update.declineReason === undefined ||
      !(DECLINE_REASONS as readonly string[]).includes(update.declineReason) ||
      (update.declineNote ?? "").trim() === "")
  ) {
    return refuse("decline-reason-required");
  }
  let duplicateOfPostId = null;
  if (update.status === "duplicate") {
    const target =
      update.duplicateOfNumber === undefined
        ? null
        : await findPostByNumber(database, update.duplicateOfNumber);
    if (target === null || target.id === post.id) {
      return refuse("duplicate-target-required");
    }
    duplicateOfPostId = target.id;
  }
  await setPostStatusStatement(
    database,
    {
      postId: post.id,
      status: update.status,
      declineReason: declining ? (update.declineReason ?? null) : null,
      declineNote: declining ? (update.declineNote?.trim() ?? null) : null,
      duplicateOfPostId,
      linkedChangelogAnchor: update.linkedChangelogAnchor ?? null,
    },
    now,
  ).run();
  return ok(null);
}

// A question's author (or the team) marks the answer that solved it.
export async function acceptAnswer(
  database: SqlDatabase,
  member: BoardMember,
  number: number,
  commentId: CommunityCommentId | null,
  now: string,
): Promise<BoardResult<null>> {
  const post = await findPostByNumber(database, number);
  if (post === null || post.moderationState !== "published") {
    return refuse("post-not-found");
  }
  if (post.kind !== "question") {
    return refuse("not-a-question");
  }
  if (post.authorUserId !== member.userId && !member.isTeam) {
    return refuse("not-the-author");
  }
  if (commentId !== null) {
    const comment = await findComment(database, commentId);
    if (comment === null || comment.postId !== post.id || comment.moderationState !== "published") {
      return refuse("comment-not-found");
    }
  }
  await setAcceptedAnswerStatement(database, { postId: post.id, commentId }, now).run();
  return ok(null);
}

// A moderator's decision on something held or hidden. Publishing a first post also approves its
// author, so their next contribution goes straight up. Removing blanks the text in place.
export async function moderate(
  database: SqlDatabase,
  member: BoardMember,
  target: { number: number; commentId?: CommunityCommentId },
  decision: "publish" | "remove",
  now: string,
): Promise<BoardResult<null>> {
  if (!member.isTeam) {
    return refuse("not-team");
  }
  const post = await findPostByNumber(database, target.number);
  if (post === null || post.moderationState === "deleted") {
    return refuse("post-not-found");
  }
  const state: ModerationState = decision === "publish" ? "published" : "removed";
  const commentId = target.commentId ?? null;
  if (commentId === null) {
    const statements = [
      setPostModerationStatement(database, { postId: post.id, state, heldReason: null }, now),
      resolveFlagsStatement(database, { postId: post.id, commentId: null }, now),
    ];
    if (decision === "publish") {
      statements.push(approveProfileStatement(database, post.authorUserId, now));
    }
    await database.batch(statements);
    return ok(null);
  }
  const comment = await findComment(database, commentId);
  if (comment === null || comment.postId !== post.id || comment.moderationState === "deleted") {
    return refuse("comment-not-found");
  }
  const statements = [
    setCommentModerationStatement(database, { commentId, state, heldReason: null }, now),
    resolveFlagsStatement(database, { postId: post.id, commentId }, now),
    recountCommentsStatement(database, post.id, now),
  ];
  if (decision === "publish") {
    statements.push(approveProfileStatement(database, comment.authorUserId, now));
  }
  await database.batch(statements);
  return ok(null);
}
