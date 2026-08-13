// The board's wire contract: what a caller may send and what it gets back, as runtime validators.
//
// It lives in this package rather than beside the routes so that the shapes and the projections
// that produce them are reviewed together — a response schema that admits a field the projection
// has no business emitting is exactly the drift this arrangement prevents. The worker registers
// these with its OpenAPI application; nothing here imports a web framework.

import { z } from "zod";
import { CATEGORIES } from "./categories.ts";
import {
  BADGES,
  DECLINE_REASONS,
  FLAG_REASONS,
  POST_KINDS,
  POST_STATUSES,
  SORTS,
} from "./types.ts";

// A title long enough to say what is wanted and short enough to read in a list.
const TITLE_MINIMUM = 8;
const TITLE_MAXIMUM = 140;
// A body long enough to be a question rather than a headline, capped where a post stops being a
// post. Attachments are unavailable, so the cap is generous: prose and a formula snippet are all a
// member has.
const BODY_MINIMUM = 20;
const BODY_MAXIMUM = 8000;
const COMMENT_MINIMUM = 2;
const COMMENT_MAXIMUM = 4000;
const DISPLAY_NAME_MINIMUM = 2;
const DISPLAY_NAME_MAXIMUM = 60;

export const categorySchema = z.enum(CATEGORIES);
export const postKindSchema = z.enum(POST_KINDS);
export const postStatusSchema = z.enum(POST_STATUSES);
export const declineReasonSchema = z.enum(DECLINE_REASONS);
export const flagReasonSchema = z.enum(FLAG_REASONS);
export const sortSchema = z.enum(SORTS);
export const badgeSchema = z.enum(BADGES);

export const publicAuthorSchema = z
  .object({
    // The community profile's own handle. Deliberately not the account handle: this value is
    // published, and an account handle is the key to a person's identity everywhere else on the
    // platform.
    reference: z.string(),
    displayName: z.string(),
    badge: badgeSchema,
  })
  .strict();

export const publicPostSchema = z
  .object({
    number: z.number().int().positive(),
    slug: z.string(),
    kind: postKindSchema,
    category: categorySchema,
    title: z.string(),
    body: z.string(),
    author: publicAuthorSchema,
    status: postStatusSchema.nullable(),
    declineReason: declineReasonSchema.nullable(),
    declineNote: z.string().nullable(),
    duplicateOfNumber: z.number().int().positive().nullable(),
    voteCount: z.number().int().nonnegative(),
    // Absent below the display floor rather than present and small. `.optional()` rather than
    // `.nullable()` is the difference between "we are not telling you" and "the answer is nothing".
    distinctFirmVoteCount: z.number().int().nonnegative().optional(),
    commentCount: z.number().int().nonnegative(),
    acceptedCommentReference: z.string().nullable(),
    archived: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    lastActivityAt: z.iso.datetime(),
  })
  // Strict on purpose. An extra key on a response from this surface is a leak until proven
  // otherwise, and the response validator is the last place to catch one.
  .strict();

export const publicCommentSchema = z
  .object({
    reference: z.string(),
    author: publicAuthorSchema,
    body: z.string(),
    isOperatorResponse: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const createPostRequestSchema = z
  .object({
    kind: postKindSchema,
    // Required, with no default and no catch-all option to fall into. Being asked which part of the
    // software a post is about, before writing it, is the board's primary confidentiality control.
    category: categorySchema,
    title: z.string().trim().min(TITLE_MINIMUM).max(TITLE_MAXIMUM),
    body: z.string().trim().min(BODY_MINIMUM).max(BODY_MAXIMUM),
  })
  .strict();

export const editPostRequestSchema = z
  .object({
    title: z.string().trim().min(TITLE_MINIMUM).max(TITLE_MAXIMUM),
    body: z.string().trim().min(BODY_MINIMUM).max(BODY_MAXIMUM),
  })
  .strict();

export const createCommentRequestSchema = z
  .object({ body: z.string().trim().min(COMMENT_MINIMUM).max(COMMENT_MAXIMUM) })
  .strict();

export const flagRequestSchema = z
  .object({
    reason: flagReasonSchema,
    note: z.string().trim().max(1000).optional(),
  })
  .strict();

export const profileRequestSchema = z
  .object({
    displayName: z.string().trim().min(DISPLAY_NAME_MINIMUM).max(DISPLAY_NAME_MAXIMUM),
    // Whether the name above is a handle rather than the member's own. The choice is made once, for
    // the account: a per-post choice would turn not disclosing into a signal, because a reader
    // could ask why this one post was the one hidden behind a handle.
    isPseudonym: z.boolean(),
  })
  .strict();

export const setStatusRequestSchema = z
  .object({
    status: postStatusSchema,
    // Declining is never a bare status. The schema cannot express "required when the status is a
    // decline" on its own, so the route enforces it and this documents it.
    declineReason: declineReasonSchema.optional(),
    declineNote: z.string().trim().min(1).max(2000).optional(),
  })
  .strict();

export const moderationRequestSchema = z
  .object({ note: z.string().trim().max(2000).optional() })
  .strict();

export const mergeDuplicateRequestSchema = z
  .object({ targetNumber: z.number().int().positive() })
  .strict();

export const listPostsQuerySchema = z
  .object({
    kind: postKindSchema.optional(),
    category: categorySchema.optional(),
    status: postStatusSchema.optional(),
    sort: sortSchema.default("trending"),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().optional(),
  })
  .strict();

export const postListSchema = z
  .object({
    data: z.array(publicPostSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();

export const commentListSchema = z.object({ data: z.array(publicCommentSchema) }).strict();

export const categoryListSchema = z
  .object({
    data: z.array(z.object({ key: categorySchema, label: z.string() }).strict()),
  })
  .strict();

export const boardNoticesSchema = z
  .object({
    firstPostNotice: z.string(),
    composerVenueNotice: z.string(),
    sendToSupportLabel: z.string(),
    attachmentsUnavailableNotice: z.string(),
    attachmentsEnabled: z.literal(false),
  })
  .strict();

export type CreatePostRequest = z.infer<typeof createPostRequestSchema>;
export type EditPostRequest = z.infer<typeof editPostRequestSchema>;
export type CreateCommentRequest = z.infer<typeof createCommentRequestSchema>;
export type FlagRequest = z.infer<typeof flagRequestSchema>;
export type ProfileRequest = z.infer<typeof profileRequestSchema>;
export type SetStatusRequest = z.infer<typeof setStatusRequestSchema>;
export type ListPostsQuery = z.infer<typeof listPostsQuerySchema>;
