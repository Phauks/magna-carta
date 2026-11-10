import { z } from "zod";
import { FINDING_KINDS } from "./confidentiality-detector.ts";
import {
  BODY_MAX_LENGTH,
  COMMENT_MAX_LENGTH,
  DECLINE_REASONS,
  DISPLAY_NAME_MAX_LENGTH,
  FLAG_REASONS,
  HELD_REASONS,
  MODERATION_STATES,
  POST_KINDS,
  PRODUCT_AREA_SLUGS,
  QUESTION_STATUSES,
  REQUEST_STATUSES,
  ROADMAP_COLUMNS,
  SORT_ORDERS,
  TITLE_MAX_LENGTH,
} from "./vocabulary.ts";

// The community board's contract: what its API accepts and returns, as plain zod, named with zod's
// own metadata so the worker that serves it declares routes over these without restating a field.
//
// Two absences are deliberate and must stay absent: no response carries a firm, and no response
// carries who voted. A vote count below the display floor is null rather than its exact value.

const postStatus = z.enum([...new Set([...REQUEST_STATUSES, ...QUESTION_STATUSES])] as [
  string,
  ...string[],
]);

export const confidentialityFindingSchema = z
  .object({
    kind: z.enum(FINDING_KINDS),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    text: z.string(),
  })
  .meta({ id: "CommunityConfidentialityFinding" });

export const boardPostSchema = z
  .object({
    number: z.number().int().positive(),
    kind: z.enum(POST_KINDS),
    category: z.enum(PRODUCT_AREA_SLUGS),
    status: postStatus,
    title: z.string(),
    body: z.string(),
    authorDisplayName: z.string(),
    isOwnPost: z.boolean(),
    moderationState: z.enum(MODERATION_STATES),
    heldReason: z.enum(HELD_REASONS).nullable(),
    duplicateOfNumber: z.number().int().positive().nullable(),
    declineReason: z.enum(DECLINE_REASONS).nullable(),
    declineNote: z.string().nullable(),
    voteCount: z.number().int().nonnegative().nullable(),
    firmVoteCount: z.number().int().nonnegative().nullable(),
    commentCount: z.number().int().nonnegative(),
    viewerHasVoted: z.boolean(),
    linkedChangelogAnchor: z.string().nullable(),
    createdAt: z.iso.datetime(),
    statusChangedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: "CommunityPost" });

export const boardCommentSchema = z
  .object({
    id: z.string(),
    body: z.string(),
    authorDisplayName: z.string(),
    isOwnComment: z.boolean(),
    isTeamResponse: z.boolean(),
    isAcceptedAnswer: z.boolean(),
    moderationState: z.enum(MODERATION_STATES),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: "CommunityComment" });

export const boardListQuerySchema = z
  .object({
    kind: z.enum(POST_KINDS).default("request"),
    category: z.enum(PRODUCT_AREA_SLUGS).optional(),
    status: z.array(postStatus).optional(),
    search: z.string().max(200).optional(),
    sort: z.enum(SORT_ORDERS).default("trending"),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .meta({ id: "CommunityBoardListQuery" });

export const boardListResponseSchema = z
  .object({ posts: z.array(boardPostSchema), total: z.number().int().nonnegative() })
  .meta({ id: "CommunityBoardList" });

export const boardSummarySchema = z
  .object({
    requestsByArea: z.record(z.string(), z.number().int().nonnegative()),
    questionsByArea: z.record(z.string(), z.number().int().nonnegative()),
    roadmap: z.object(
      Object.fromEntries(
        ROADMAP_COLUMNS.map((column) => [column, z.number().int().nonnegative()]),
      ) as Record<(typeof ROADMAP_COLUMNS)[number], z.ZodNumber>,
    ),
  })
  .meta({ id: "CommunityBoardSummary" });

export const postDetailResponseSchema = z
  .object({ post: boardPostSchema, comments: z.array(boardCommentSchema) })
  .meta({ id: "CommunityPostDetail" });

export const createPostRequestSchema = z
  .object({
    kind: z.enum(POST_KINDS),
    category: z.enum(PRODUCT_AREA_SLUGS),
    title: z.string().trim().min(8).max(TITLE_MAX_LENGTH),
    body: z.string().trim().min(1).max(BODY_MAX_LENGTH),
  })
  .meta({ id: "CommunityCreatePostRequest" });

export const contributionResultSchema = z
  .object({
    moderationState: z.enum(MODERATION_STATES),
    heldReason: z.enum(HELD_REASONS).nullable(),
    findings: z.array(confidentialityFindingSchema),
  })
  .meta({ id: "CommunityContributionResult" });

export const createPostResponseSchema = contributionResultSchema
  .extend({ number: z.number().int().positive() })
  .meta({ id: "CommunityCreatePostResponse" });

// The composer asks before it posts: which phrases look like client detail. The same detector runs
// again on the server when the post is written; this endpoint only lets the author see the
// highlight while they can still edit.
export const checkTextRequestSchema = z
  .object({ text: z.string().max(BODY_MAX_LENGTH + TITLE_MAX_LENGTH) })
  .meta({ id: "CommunityCheckTextRequest" });

export const checkTextResponseSchema = z
  .object({ findings: z.array(confidentialityFindingSchema) })
  .meta({ id: "CommunityCheckTextResponse" });

export const voteResponseSchema = z
  .object({ voteCount: z.number().int().nonnegative().nullable(), viewerHasVoted: z.boolean() })
  .meta({ id: "CommunityVoteResponse" });

export const createCommentRequestSchema = z
  .object({ body: z.string().trim().min(1).max(COMMENT_MAX_LENGTH) })
  .meta({ id: "CommunityCreateCommentRequest" });

export const createCommentResponseSchema = contributionResultSchema
  .extend({ id: z.string() })
  .meta({ id: "CommunityCreateCommentResponse" });

export const flagRequestSchema = z
  .object({ commentId: z.string().optional(), reason: z.enum(FLAG_REASONS) })
  .meta({ id: "CommunityFlagRequest" });

export const flagResponseSchema = z
  .object({ hidden: z.boolean() })
  .meta({ id: "CommunityFlagResponse" });

export const setStatusRequestSchema = z
  .object({
    status: z.enum(REQUEST_STATUSES),
    declineReason: z.enum(DECLINE_REASONS).optional(),
    declineNote: z.string().trim().max(2000).optional(),
    duplicateOfNumber: z.number().int().positive().optional(),
    linkedChangelogAnchor: z.string().max(200).optional(),
  })
  .meta({ id: "CommunitySetStatusRequest" });

export const moderateRequestSchema = z
  .object({ commentId: z.string().optional(), decision: z.enum(["publish", "remove"]) })
  .meta({ id: "CommunityModerateRequest" });

export const profileSchema = z
  .object({
    displayName: z.string().nullable(),
    suggestedDisplayName: z.string(),
    approved: z.boolean(),
    noticeDismissed: z.boolean(),
    isTeam: z.boolean(),
  })
  .meta({ id: "CommunityProfile" });

export const saveProfileRequestSchema = z
  .object({ displayName: z.string().trim().min(2).max(DISPLAY_NAME_MAX_LENGTH) })
  .meta({ id: "CommunitySaveProfileRequest" });
