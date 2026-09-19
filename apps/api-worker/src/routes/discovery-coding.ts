import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import {
  createTag,
  createTagGroup,
  readCodingPanel,
  renameTag,
  renameTagGroup,
  setTagActive,
} from "@magna-carta/discovery/coding-panel-service";
import {
  applyTag,
  buildBulkCodingChunk,
  completeBulkCoding,
  planBulkCoding,
  removeTag,
  undoTagEvent,
} from "@magna-carta/discovery/coding-service";
import {
  readCompletionCount,
  readDocumentCoding,
  readFamilyConflictFamilyIds,
  readTagCounts,
  readTagEventPage,
  readUncodedDocumentIds,
  type ReviewDocumentTagRow,
  type ReviewTagEventRow,
  type ReviewTagGroupRow,
  type ReviewTagRow,
} from "@magna-carta/discovery/coding-statements";
import {
  BULK_CODING_MAX_DOCUMENTS,
  CODING_CRITERIA_MAX_LENGTH,
  MAX_TAG_GROUPS_PER_REVIEW_SET,
} from "@magna-carta/discovery/limits";
import {
  grantReviewSetAccess,
  revokeReviewSetAccess,
} from "@magna-carta/discovery/review-set-access-service";
import {
  memberHasReviewSetAccess,
  readReviewSetAccessList,
} from "@magna-carta/discovery/review-set-access-statements";
import { readReviewSet } from "@magna-carta/discovery/review-set-statements";
import { reviewSetAccessPredicate } from "@magna-carta/discovery/review-set-visibility";
import {
  REVIEW_TAG_EVENT_SCOPES,
  REVIEW_TAG_GROUP_CARDINALITIES,
  REVIEW_TAG_GROUP_NAME_MAX_LENGTH,
  REVIEW_TAG_NAME_MAX_LENGTH,
  REVIEW_TAG_SEMANTICS,
} from "@magna-carta/discovery/types";
import { DiscoveryValidationError } from "@magna-carta/discovery/validation";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import { matterScopedObjectDimensions } from "@magna-carta/object-dimensions";
import type {
  ReviewDocumentId,
  ReviewSetId,
  ReviewTagEventId,
  ReviewTagGroupId,
  ReviewTagId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { Context } from "hono";
import type { Bindings } from "../bindings.ts";
import { resolveFirmBucket } from "../files/firm-bucket.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierPathParam } from "../contracts/common.ts";
import { cursorQuery, paginated } from "../contracts/pagination.ts";
import { Problem, problemJson, type ProblemResponse } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";

// The review surface's write and read half: who may reach a corpus, what the questions are, and what
// a reviewer decided about a document.
//
// EVERY ROUTE HERE DOES TWO CHECKS, NOT ONE. The permission says a member may review something; the
// review set's own access list says which corpora. Holding `discovery:review` on a matter reaches no
// review set the member is not listed on — material another party produced may be attorney's-eyes-
// only under a protective order, and an attorneys'-eyes-only production is a review set whose list is
// two people.
//
// A CORPUS THE MEMBER IS NOT LISTED ON IS ABSENT, NOT REFUSED. Every handler answers 404, never 403:
// "you may not see this one" names its existence, which on a walled corpus is the disclosure. The
// list check here is a courtesy that produces the right status code — the actual wall is that every
// statement carries the access predicate in SQL, so a handler that forgot this check still reads and
// writes nothing.

const READ = "discovery:read";
const MANAGE = "discovery:manageReviewSets";
const REVIEW = "discovery:review";
const PRODUCE = "discovery:produce";

const DEFAULT_PAGE_SIZE = 100;

const authErrors = {
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "The session member lacks the discovery permission this route requires",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description:
      "The firm is unreachable, the member is deactivated, the record does not exist, or the " +
      "member is not on this review set's access list",
    content: { "application/problem+json": { schema: Problem } },
  },
  409: {
    description: "A request with this Idempotency-Key is still in progress",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description: "The request is well-formed but a rule refuses it",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
};

type DiscoveryPermission = typeof READ | typeof MANAGE | typeof REVIEW | typeof PRODUCE;

// `audited` declares that the act leaves an immutable record, not that it writes to one particular
// table. For the coding routes that record is the coding journal — richer than a generic audit row,
// since it carries the gesture's scope, its criteria, its frozen selection and its reversal — and
// coding deliberately writes only that one, because two homes for one fact drift. Panel and
// access-list changes are not coding decisions and do write the generic row.
function meta(
  action: string,
  permission: DiscoveryPermission,
  audited: boolean,
  mutates: boolean,
): RouteMeta {
  return {
    operationId: `discovery.${action}`,
    surface: "app",
    authenticated: true,
    permission,
    // A review set IS one matter's corpus and cannot exist without one.
    resource: "matter",
    audited,
    idempotency: mutates ? "required" : "optional",
    ...(mutates ? { idempotencyStore: "firm" as const } : {}),
    rateLimit: "default",
  };
}

// ---------------------------------------------------------------------------------------------
// Wire shapes

const reviewSetIdParam = z.object({
  reviewSetId: identifierPathParam("reviewSet", "reviewSetId"),
});

const AccessMember = z
  .object({
    memberUserId: z.string(),
    grantedBy: z.string(),
    createdAt: z.string(),
  })
  .openapi("ReviewSetAccessMember");

const TagGroupSummary = z
  .object({
    id: z.string(),
    reviewSetId: z.string(),
    name: z.string(),
    kind: z.enum(["system", "custom"]),
    cardinality: z.enum(REVIEW_TAG_GROUP_CARDINALITIES),
    requiredForCompletion: z.boolean(),
    sortOrder: z.number(),
  })
  .openapi("ReviewTagGroup");

const TagSummary = z
  .object({
    id: z.string(),
    reviewTagGroupId: z.string(),
    reviewSetId: z.string(),
    name: z.string(),
    semantic: z
      .enum(REVIEW_TAG_SEMANTICS)
      .nullable()
      .openapi({
        description:
          "The meaning the machine reads, where the tag has one. Production membership, privilege " +
          "logging and completion arithmetic resolve through this and never through the name, so a " +
          "firm may rename a tag freely without changing what anything does. A tag a firm created " +
          "carries none and drives no machinery — it filters, groups and exports.",
      }),
    colorToken: z.string(),
    sortOrder: z.number(),
    active: z.boolean(),
  })
  .openapi("ReviewTag");

const DocumentTagSummary = z
  .object({
    reviewTagId: z.string(),
    reviewTagGroupId: z.string(),
    appliedByEventId: z.string(),
    appliedAt: z.string(),
  })
  .openapi("ReviewDocumentTag");

const TagEventSummary = z
  .object({
    id: z.string(),
    kind: z.enum(["apply", "remove", "bulk-apply", "bulk-remove", "undo"]),
    reviewTagId: z.string(),
    scope: z.enum(REVIEW_TAG_EVENT_SCOPES),
    documentCount: z.number(),
    criteria: z.string().nullable(),
    state: z.enum(["running", "complete", "undone"]),
    reversesEventId: z.string().nullable(),
    actorUserId: z.string(),
    createdAt: z.string(),
    completedAt: z.string().nullable(),
  })
  .openapi("ReviewTagEvent");

function tagGroupPayload(row: ReviewTagGroupRow) {
  return {
    id: row.id,
    reviewSetId: row.review_set_id,
    name: row.name,
    kind: row.kind,
    cardinality: row.cardinality,
    requiredForCompletion: row.required_for_completion === 1,
    sortOrder: row.sort_order,
  };
}

function tagPayload(row: ReviewTagRow) {
  return {
    id: row.id,
    reviewTagGroupId: row.review_tag_group_id,
    reviewSetId: row.review_set_id,
    name: row.name,
    semantic: row.semantic,
    colorToken: row.color_token,
    sortOrder: row.sort_order,
    active: row.active === 1,
  };
}

function documentTagPayload(row: ReviewDocumentTagRow) {
  return {
    reviewTagId: row.review_tag_id,
    reviewTagGroupId: row.review_tag_group_id,
    appliedByEventId: row.applied_by_event_id,
    appliedAt: row.applied_at,
  };
}

function tagEventPayload(row: ReviewTagEventRow) {
  return {
    id: row.id,
    kind: row.kind,
    reviewTagId: row.review_tag_id,
    scope: row.scope,
    documentCount: row.document_count,
    criteria: row.criteria,
    state: row.state,
    reversesEventId: row.reverses_event_id,
    actorUserId: row.actor_user_id,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

// ---------------------------------------------------------------------------------------------
// Refusal mapping. Codes drive it, never messages.

function codingErrorResponse(
  c: Context,
  caught: DiscoveryValidationError,
): ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> {
  switch (caught.code) {
    case "discovery-unknown-tag-group":
    case "discovery-unknown-tag":
    case "discovery-unknown-tag-event":
    case "discovery-unknown-review-document":
    case "discovery-unknown-review-set":
    // A member not on the list gets the same answer as somebody asking after a corpus that does not
    // exist, which is the point: absence, not refusal.
    case "discovery-review-set-unreachable":
      return problemJson(c, {
        type: "not-found",
        title: "Not found",
        status: 404,
        detail: caught.message,
      });
    case "discovery-tag-group-name-taken":
    case "discovery-tag-name-taken":
      return problemJson(c, {
        type: "conflict",
        title: "That name is already in use here",
        status: 409,
        detail: caught.message,
      });
    case "discovery-event-not-undoable":
      return problemJson(c, {
        type: "discovery-coding-act-not-undoable",
        title: "That coding act is not reversed",
        status: 409,
        detail: caught.message,
      });
    case "discovery-access-list-would-be-empty":
      return problemJson(c, {
        type: "discovery-access-list-would-be-empty",
        title: "A review set's access list is never empty",
        status: 422,
        detail: caught.message,
      });
    case "discovery-semantic-tag-not-deactivatable":
    case "discovery-system-tag-group-not-deletable":
      return problemJson(c, {
        type: "discovery-coding-panel-refused",
        title: "That part of the coding panel stays",
        status: 422,
        detail: caught.message,
      });
    default:
      return problemJson(c, {
        type: "validation",
        title: "Coding request invalid",
        status: 422,
        detail: caught.message,
      });
  }
}

// ---------------------------------------------------------------------------------------------
// Routes

const getAccessListRoute = defineOpenAPIRoute(meta("getReviewSetAccess", PRODUCE, false, false), {
  method: "get",
  path: "/api/v1/review-sets/{reviewSetId}/access",
  description:
    "Who may reach this review set's corpus. Reaching a review set never follows from reaching its " +
    "matter: material another party produced may be attorney's-eyes-only under a protective order, " +
    "so a member holding every matter and file permission and not listed here sees nothing of it. " +
    "The list is fail-closed — a corpus nobody is listed on is reachable by nobody — and it never " +
    "reaches empty, so the last member cannot be removed.",
  request: { params: reviewSetIdParam },
  responses: {
    200: {
      description: "The review set's access list",
      content: {
        "application/json": {
          schema: z.object({ data: z.array(AccessMember) }).openapi("ReviewSetAccessList"),
        },
      },
    },
    ...authErrors,
  },
});

const putAccessMemberRoute = defineOpenAPIRoute(meta("grantReviewSetAccess", PRODUCE, true, true), {
  method: "put",
  path: "/api/v1/review-sets/{reviewSetId}/access/{memberUserId}",
  description:
    "Adds a member to this review set's access list. Granting somebody who is already listed is a " +
    "no-op rather than a conflict. Widening who may see a corpus is recorded, because it is the " +
    "same order of decision as deciding what leaves the firm.",
  request: {
    params: reviewSetIdParam.extend({
      memberUserId: identifierPathParam("user", "memberUserId"),
    }),
    headers: idempotencyKeyHeader,
  },
  responses: {
    204: { description: "The member is on the list" },
    ...authErrors,
  },
});

const deleteAccessMemberRoute = defineOpenAPIRoute(
  {
    ...meta("revokeReviewSetAccess", PRODUCE, true, true),
    reversal: { kind: "inverse", by: "discovery.grantReviewSetAccess" },
  },
  {
    method: "delete",
    path: "/api/v1/review-sets/{reviewSetId}/access/{memberUserId}",
    description:
      "Removes a member from this review set's access list. The last member is refused: because the " +
      "list is fail-closed, removing them would leave a corpus nobody can reach or repair. Add " +
      "whoever should hold it first.",
    request: {
      params: reviewSetIdParam.extend({
        memberUserId: identifierPathParam("user", "memberUserId"),
      }),
      headers: idempotencyKeyHeader,
    },
    responses: {
      204: { description: "The member is off the list" },
      ...authErrors,
    },
  },
);

const getCodingPanelRoute = defineOpenAPIRoute(meta("getCodingPanel", READ, false, false), {
  method: "get",
  path: "/api/v1/review-sets/{reviewSetId}/coding-panel",
  description:
    "This review set's coding questions and their answers, in the order a reviewer sees them. Every " +
    "review set is seeded with Responsiveness, Privilege and Confidentiality; a firm renames them " +
    "freely and adds its own issue codes beside them.",
  request: { params: reviewSetIdParam },
  responses: {
    200: {
      description: "The coding panel",
      content: {
        "application/json": {
          schema: z
            .object({ groups: z.array(TagGroupSummary), tags: z.array(TagSummary) })
            .openapi("CodingPanel"),
        },
      },
    },
    ...authErrors,
  },
});

const createTagGroupRoute = defineOpenAPIRoute(meta("createCodingQuestion", MANAGE, true, true), {
  method: "post",
  path: "/api/v1/review-sets/{reviewSetId}/coding-panel/questions",
  description:
    "Adds a coding question to this review set. A single-choice question is a radio row and a " +
    "multi-choice question is a flag set; the cardinality is what stops a document being coded two " +
    "contradictory ways, and it is enforced by the database rather than by the surface.",
  request: {
    params: reviewSetIdParam,
    headers: idempotencyKeyHeader,
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              name: z.string().min(1).max(REVIEW_TAG_GROUP_NAME_MAX_LENGTH),
              cardinality: z.enum(REVIEW_TAG_GROUP_CARDINALITIES),
              requiredForCompletion: z
                .boolean()
                .optional()
                .openapi({
                  description:
                    "Whether a document with no answer here counts as uncoded. That arithmetic is the " +
                    "progress figure, so turning it on for a question most documents will not answer " +
                    "makes the figure mean something else.",
                }),
            })
            .openapi("CreateCodingQuestionRequest"),
        },
      },
      required: true,
    },
  },
  responses: {
    201: {
      description: "The coding question was created",
      content: { "application/json": { schema: z.object({ id: z.string() }) } },
    },
    ...authErrors,
  },
});

const createTagRoute = defineOpenAPIRoute(meta("createCodingTag", MANAGE, true, true), {
  method: "post",
  path: "/api/v1/review-sets/{reviewSetId}/coding-panel/questions/{reviewTagGroupId}/tags",
  description:
    "Adds an answer to a coding question. A tag created here carries no machine meaning and drives " +
    "no production behaviour — it filters, groups and exports. The answers production and privilege " +
    "logging resolve through are the seeded ones, so that renaming a label can never change what a " +
    "production withholds.",
  request: {
    params: reviewSetIdParam.extend({
      reviewTagGroupId: identifierPathParam("reviewTagGroup", "reviewTagGroupId"),
    }),
    headers: idempotencyKeyHeader,
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              name: z.string().min(1).max(REVIEW_TAG_NAME_MAX_LENGTH),
              colorToken: z
                .string()
                .min(1)
                .openapi({
                  description:
                    "The NAME of a design token, never a colour value — the coding panel styles " +
                    "through the design system, and a raw value would be an off-token colour no theme " +
                    "could correct.",
                }),
            })
            .openapi("CreateCodingTagRequest"),
        },
      },
      required: true,
    },
  },
  responses: {
    201: {
      description: "The tag was created",
      content: { "application/json": { schema: z.object({ id: z.string() }) } },
    },
    ...authErrors,
  },
});

const patchTagGroupRoute = defineOpenAPIRoute(meta("updateCodingQuestion", MANAGE, true, true), {
  method: "patch",
  path: "/api/v1/review-sets/{reviewSetId}/coding-panel/questions/{reviewTagGroupId}",
  description:
    "Renames a coding question. Renaming is the only edit it takes, and a seeded question renames as " +
    "freely as one the firm added: nothing ever matched a question by its name.",
  request: {
    params: reviewSetIdParam.extend({
      reviewTagGroupId: identifierPathParam("reviewTagGroup", "reviewTagGroupId"),
    }),
    headers: idempotencyKeyHeader,
    body: {
      content: {
        "application/json": {
          schema: z
            .object({ name: z.string().min(1).max(REVIEW_TAG_GROUP_NAME_MAX_LENGTH) })
            .openapi("UpdateCodingQuestionRequest"),
        },
      },
      required: true,
    },
  },
  responses: { 204: { description: "The question was renamed" }, ...authErrors },
});

const patchTagRoute = defineOpenAPIRoute(meta("updateCodingTag", MANAGE, true, true), {
  method: "patch",
  path: "/api/v1/review-sets/{reviewSetId}/coding-panel/tags/{reviewTagId}",
  description:
    "Renames a tag, or takes it out of use. A tag is never deleted: it is on every document anybody " +
    "ever applied it to, and deleting it would erase the coding history those rows exist to keep. " +
    "Deactivating hides it from the panel and leaves all of that readable. A tag carrying a machine " +
    "meaning cannot be deactivated at all, because production and privilege logging resolve through " +
    "it — rename it instead.",
  request: {
    params: reviewSetIdParam.extend({
      reviewTagId: identifierPathParam("reviewTag", "reviewTagId"),
    }),
    headers: idempotencyKeyHeader,
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              name: z.string().min(1).max(REVIEW_TAG_NAME_MAX_LENGTH).optional(),
              active: z.boolean().optional(),
            })
            .openapi("UpdateCodingTagRequest"),
        },
      },
      required: true,
    },
  },
  responses: { 204: { description: "The tag was updated" }, ...authErrors },
});

const getDocumentCodingRoute = defineOpenAPIRoute(meta("getDocumentCoding", READ, false, false), {
  method: "get",
  path: "/api/v1/review-sets/{reviewSetId}/documents/{reviewDocumentId}/coding",
  description: "What is currently coded on one document, and which act put each answer there.",
  request: {
    params: reviewSetIdParam.extend({
      reviewDocumentId: identifierPathParam("reviewDocument", "reviewDocumentId"),
    }),
  },
  responses: {
    200: {
      description: "The document's live coding",
      content: {
        "application/json": {
          schema: z.object({ data: z.array(DocumentTagSummary) }).openapi("DocumentCoding"),
        },
      },
    },
    ...authErrors,
  },
});

const applyCodingRoute = defineOpenAPIRoute(meta("applyCoding", REVIEW, true, true), {
  method: "post",
  path: "/api/v1/review-sets/{reviewSetId}/documents/{reviewDocumentId}/coding",
  description:
    "Applies or removes a tag on one document, or on its whole family. A family gesture writes a row " +
    "per family member rather than one row the members inherit, so what a production later reads is " +
    "the decision itself and not a rule about decisions. Answering a single-choice question again " +
    "replaces the previous answer, which is kept — removal is a state with an actor and an instant, " +
    "never a deletion.",
  request: {
    params: reviewSetIdParam.extend({
      reviewDocumentId: identifierPathParam("reviewDocument", "reviewDocumentId"),
    }),
    headers: idempotencyKeyHeader,
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              reviewTagId: identifierPathParam("reviewTag", "reviewTagId"),
              action: z.enum(["apply", "remove"]),
              scope: z.enum(["document", "family"]).optional(),
            })
            .openapi("ApplyCodingRequest"),
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "The coding act, as recorded",
      content: {
        "application/json": {
          schema: z
            .object({ reviewTagEventId: z.string(), documentCount: z.number() })
            .openapi("CodingActResult"),
        },
      },
    },
    ...authErrors,
  },
});

const bulkCodingRoute = defineOpenAPIRoute(meta("bulkCoding", REVIEW, true, true), {
  method: "post",
  path: "/api/v1/review-sets/{reviewSetId}/coding/bulk",
  description:
    "Applies or removes a tag across a named set of documents. The selection is resolved ONCE and " +
    "frozen before anything is written, and the operation walks that frozen list: a selection " +
    "re-resolved as it went would tag documents the person who started it never saw. The criteria " +
    "that produced it are recorded alongside for whoever reads the history later. Documents outside " +
    "this review set are dropped from the selection rather than named.",
  request: {
    params: reviewSetIdParam,
    headers: idempotencyKeyHeader,
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              reviewTagId: identifierPathParam("reviewTag", "reviewTagId"),
              action: z.enum(["apply", "remove"]),
              reviewDocumentIds: z
                .array(identifierPathParam("reviewDocument", "reviewDocumentId"))
                .min(1)
                .max(BULK_CODING_MAX_DOCUMENTS),
              criteria: z
                .string()
                .max(CODING_CRITERIA_MAX_LENGTH)
                .optional()
                .openapi({
                  description:
                    "The filter this selection came from, as a note for whoever reads the history. " +
                    "Field names and identifiers only — it is never re-run, and free text here would " +
                    "put content into a record that has no way to redact it.",
                }),
            })
            .openapi("BulkCodingRequest"),
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "The bulk act, as recorded",
      content: {
        "application/json": {
          schema: z
            .object({ reviewTagEventId: z.string(), documentCount: z.number() })
            .openapi("BulkCodingResult"),
        },
      },
    },
    ...authErrors,
  },
});

const undoCodingRoute = defineOpenAPIRoute(meta("undoCodingAct", REVIEW, true, true), {
  method: "post",
  path: "/api/v1/review-sets/{reviewSetId}/coding/acts/{reviewTagEventId}/undo",
  description:
    "Takes back one coding act, exactly. It reverses precisely the rows that act wrote and which are " +
    "still current — a tag somebody applied independently afterwards is untouched, and a row already " +
    "removed keeps its original attribution. Nothing is deleted: the reversed act stays in the " +
    "history pointing at the act that reversed it. An undo is itself an act and is not undone.",
  request: {
    params: reviewSetIdParam.extend({
      reviewTagEventId: identifierPathParam("reviewTagEvent", "reviewTagEventId"),
    }),
    headers: idempotencyKeyHeader,
  },
  responses: {
    200: {
      description: "The reversal, as recorded",
      content: {
        "application/json": {
          schema: z.object({ reviewTagEventId: z.string() }).openapi("UndoCodingResult"),
        },
      },
    },
    ...authErrors,
  },
});

const getCodingHistoryRoute = defineOpenAPIRoute(meta("getCodingHistory", READ, false, false), {
  method: "get",
  path: "/api/v1/review-sets/{reviewSetId}/coding/acts",
  description:
    "The coding history of this review set, newest first: who coded what, when, one document at a " +
    "time or in bulk, under what criteria, and who reversed it. This is the record a challenge to a " +
    "production is answered from.",
  request: { params: reviewSetIdParam, query: cursorQuery },
  responses: {
    200: {
      description: "One page of the coding history",
      content: {
        "application/json": { schema: paginated(TagEventSummary).openapi("CodingHistory") },
      },
    },
    ...authErrors,
  },
});

const getCodingProgressRoute = defineOpenAPIRoute(meta("getCodingProgress", READ, false, false), {
  method: "get",
  path: "/api/v1/review-sets/{reviewSetId}/coding/progress",
  description:
    "How far the review has got: how many documents are coded in every question that requires one, " +
    "how many each tag is on, which documents are still uncoded, and which families are split across " +
    "the produce/withhold line. The split-family read is computed from the coding rather than stored, " +
    "because a stored flag about two documents goes stale the moment either one is re-coded — and " +
    "that is exactly how a privileged document rides a family into a production.",
  request: { params: reviewSetIdParam },
  responses: {
    200: {
      description: "Review progress and the quality-control reads",
      content: {
        "application/json": {
          schema: z
            .object({
              documentCount: z.number(),
              completedCount: z.number(),
              tagCounts: z.array(
                z.object({
                  reviewTagId: z.string(),
                  reviewTagGroupId: z.string(),
                  documentCount: z.number(),
                }),
              ),
              uncodedDocumentIds: z.array(z.string()),
              splitFamilyIds: z.array(z.string()),
            })
            .openapi("CodingProgress"),
        },
      },
    },
    ...authErrors,
  },
});

// ---------------------------------------------------------------------------------------------
// Handlers

type DiscoveryApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

function serviceOptions(c: Context<{ Bindings: Bindings; Variables: AppVariables }>) {
  return {
    clock: { now: () => new Date().toISOString() },
    actorUserId: requireChokepointUserId(c),
    randomSource: cryptoRandomSource,
  };
}

function accessFor(c: Context<{ Bindings: Bindings; Variables: AppVariables }>) {
  return reviewSetAccessPredicate(requireChokepointUserId(c));
}

// The 404 a member not on the list gets. Called first in every handler so the status code is right;
// the wall itself is the predicate every statement carries, which is why forgetting this call would
// be a cosmetic bug and not a disclosure.
function notOnTheList(c: Context): ProblemResponse<404> {
  return problemJson(c, {
    type: "not-found",
    title: "Not found",
    status: 404,
    detail: "No such review set in this firm.",
  });
}

export function registerDiscoveryCodingRoutes(app: DiscoveryApp, chokepoint: Chokepoint): void {
  app.openapi(
    { ...getAccessListRoute, middleware: chokepointMiddleware(chokepoint, getAccessListRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { reviewSetId } = c.req.valid("param");
      if (
        !(await memberHasReviewSetAccess(
          firm.firmDatabase,
          reviewSetId as ReviewSetId,
          accessFor(c),
        ))
      ) {
        return notOnTheList(c);
      }
      const rows = await readReviewSetAccessList(
        firm.firmDatabase,
        reviewSetId as ReviewSetId,
        DEFAULT_PAGE_SIZE,
      );
      return c.json(
        {
          data: rows.map((row) => ({
            memberUserId: row.member_user_id,
            grantedBy: row.granted_by,
            createdAt: row.created_at,
          })),
        },
        200,
      );
    },
  );

  app.openapi(
    { ...putAccessMemberRoute, middleware: chokepointMiddleware(chokepoint, putAccessMemberRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { reviewSetId, memberUserId } = c.req.valid("param");
      const options = serviceOptions(c);
      if (
        !(await memberHasReviewSetAccess(
          firm.firmDatabase,
          reviewSetId as ReviewSetId,
          accessFor(c),
        ))
      ) {
        return notOnTheList(c);
      }
      const effect = grantReviewSetAccess(
        firm.firmDatabase,
        { reviewSetId: reviewSetId as ReviewSetId, memberUserId: memberUserId as UserId },
        options,
      );
      await commitEffectBatch(firm.firmDatabase, effect, { now: options.clock.now });
      return c.body(null, 204);
    },
  );

  app.openapi(
    {
      ...deleteAccessMemberRoute,
      middleware: chokepointMiddleware(chokepoint, deleteAccessMemberRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { reviewSetId, memberUserId } = c.req.valid("param");
      const options = serviceOptions(c);
      if (
        !(await memberHasReviewSetAccess(
          firm.firmDatabase,
          reviewSetId as ReviewSetId,
          accessFor(c),
        ))
      ) {
        return notOnTheList(c);
      }
      try {
        const effect = await revokeReviewSetAccess(
          firm.firmDatabase,
          { reviewSetId: reviewSetId as ReviewSetId, memberUserId: memberUserId as UserId },
          options,
        );
        await commitEffectBatch(firm.firmDatabase, effect, { now: options.clock.now });
        return c.body(null, 204);
      } catch (caught) {
        if (caught instanceof DiscoveryValidationError) return codingErrorResponse(c, caught);
        throw caught;
      }
    },
  );

  app.openapi(
    { ...getCodingPanelRoute, middleware: chokepointMiddleware(chokepoint, getCodingPanelRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { reviewSetId } = c.req.valid("param");
      const access = accessFor(c);
      if (
        !(await memberHasReviewSetAccess(firm.firmDatabase, reviewSetId as ReviewSetId, access))
      ) {
        return notOnTheList(c);
      }
      const panel = await readCodingPanel(firm.firmDatabase, reviewSetId as ReviewSetId, access);
      return c.json(
        { groups: panel.groups.map(tagGroupPayload), tags: panel.tags.map(tagPayload) },
        200,
      );
    },
  );

  app.openapi(
    { ...createTagGroupRoute, middleware: chokepointMiddleware(chokepoint, createTagGroupRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { reviewSetId } = c.req.valid("param");
      const body = c.req.valid("json");
      const access = accessFor(c);
      const idempotency = requireChokepointIdempotency(c);
      if (
        !(await memberHasReviewSetAccess(firm.firmDatabase, reviewSetId as ReviewSetId, access))
      ) {
        return notOnTheList(c);
      }
      try {
        const result = await runIdempotentEffect({
          database: firm.firmDatabase,
          key: idempotency.key,
          fingerprint: idempotency.fingerprint,
          now: () => new Date().toISOString(),
          effect: async () => {
            const { reviewTagGroupId, effect } = await createTagGroup(
              firm.firmDatabase,
              {
                reviewSetId: reviewSetId as ReviewSetId,
                name: body.name,
                cardinality: body.cardinality,
                requiredForCompletion: body.requiredForCompletion ?? false,
              },
              access,
              serviceOptions(c),
            );
            return {
              write: effect,
              responseCode: 201,
              responseBody: canonicalJsonStringify({ id: reviewTagGroupId }),
            };
          },
        });
        if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
          return problemJson(c, {
            type: "conflict",
            title: "A request with this Idempotency-Key is still in progress",
            status: 409,
            detail: "Retry once it settles.",
          });
        }
        return c.json(JSON.parse(result.responseBody ?? "{}") as { id: string }, 201);
      } catch (caught) {
        if (caught instanceof DiscoveryValidationError) return codingErrorResponse(c, caught);
        throw caught;
      }
    },
  );

  app.openapi(
    { ...createTagRoute, middleware: chokepointMiddleware(chokepoint, createTagRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { reviewSetId, reviewTagGroupId } = c.req.valid("param");
      const body = c.req.valid("json");
      const access = accessFor(c);
      const idempotency = requireChokepointIdempotency(c);
      if (
        !(await memberHasReviewSetAccess(firm.firmDatabase, reviewSetId as ReviewSetId, access))
      ) {
        return notOnTheList(c);
      }
      try {
        const result = await runIdempotentEffect({
          database: firm.firmDatabase,
          key: idempotency.key,
          fingerprint: idempotency.fingerprint,
          now: () => new Date().toISOString(),
          effect: async () => {
            const { reviewTagId, effect } = await createTag(
              firm.firmDatabase,
              {
                reviewTagGroupId: reviewTagGroupId as ReviewTagGroupId,
                name: body.name,
                colorToken: body.colorToken,
              },
              access,
              serviceOptions(c),
            );
            return {
              write: effect,
              responseCode: 201,
              responseBody: canonicalJsonStringify({ id: reviewTagId }),
            };
          },
        });
        if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
          return problemJson(c, {
            type: "conflict",
            title: "A request with this Idempotency-Key is still in progress",
            status: 409,
            detail: "Retry once it settles.",
          });
        }
        return c.json(JSON.parse(result.responseBody ?? "{}") as { id: string }, 201);
      } catch (caught) {
        if (caught instanceof DiscoveryValidationError) return codingErrorResponse(c, caught);
        throw caught;
      }
    },
  );

  app.openapi(
    { ...patchTagGroupRoute, middleware: chokepointMiddleware(chokepoint, patchTagGroupRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { reviewSetId, reviewTagGroupId } = c.req.valid("param");
      const body = c.req.valid("json");
      const access = accessFor(c);
      const options = serviceOptions(c);
      if (
        !(await memberHasReviewSetAccess(firm.firmDatabase, reviewSetId as ReviewSetId, access))
      ) {
        return notOnTheList(c);
      }
      try {
        const effect = await renameTagGroup(
          firm.firmDatabase,
          reviewTagGroupId as ReviewTagGroupId,
          body.name,
          access,
          options,
        );
        await commitEffectBatch(firm.firmDatabase, effect, { now: options.clock.now });
        return c.body(null, 204);
      } catch (caught) {
        if (caught instanceof DiscoveryValidationError) return codingErrorResponse(c, caught);
        throw caught;
      }
    },
  );

  app.openapi(
    { ...patchTagRoute, middleware: chokepointMiddleware(chokepoint, patchTagRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { reviewSetId, reviewTagId } = c.req.valid("param");
      const body = c.req.valid("json");
      const access = accessFor(c);
      const options = serviceOptions(c);
      if (
        !(await memberHasReviewSetAccess(firm.firmDatabase, reviewSetId as ReviewSetId, access))
      ) {
        return notOnTheList(c);
      }
      try {
        if (body.name !== undefined) {
          const effect = await renameTag(
            firm.firmDatabase,
            reviewTagId as ReviewTagId,
            body.name,
            access,
            options,
          );
          await commitEffectBatch(firm.firmDatabase, effect, { now: options.clock.now });
        }
        if (body.active !== undefined) {
          const effect = await setTagActive(
            firm.firmDatabase,
            reviewTagId as ReviewTagId,
            body.active,
            access,
            options,
          );
          await commitEffectBatch(firm.firmDatabase, effect, { now: options.clock.now });
        }
        return c.body(null, 204);
      } catch (caught) {
        if (caught instanceof DiscoveryValidationError) return codingErrorResponse(c, caught);
        throw caught;
      }
    },
  );

  app.openapi(
    {
      ...getDocumentCodingRoute,
      middleware: chokepointMiddleware(chokepoint, getDocumentCodingRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { reviewSetId, reviewDocumentId } = c.req.valid("param");
      const access = accessFor(c);
      if (
        !(await memberHasReviewSetAccess(firm.firmDatabase, reviewSetId as ReviewSetId, access))
      ) {
        return notOnTheList(c);
      }
      const rows = await readDocumentCoding(
        firm.firmDatabase,
        reviewDocumentId as ReviewDocumentId,
        access,
        DEFAULT_PAGE_SIZE,
      );
      return c.json({ data: rows.map(documentTagPayload) }, 200);
    },
  );

  app.openapi(
    { ...applyCodingRoute, middleware: chokepointMiddleware(chokepoint, applyCodingRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { reviewSetId, reviewDocumentId } = c.req.valid("param");
      const body = c.req.valid("json");
      const access = accessFor(c);
      const options = serviceOptions(c);
      if (
        !(await memberHasReviewSetAccess(firm.firmDatabase, reviewSetId as ReviewSetId, access))
      ) {
        return notOnTheList(c);
      }
      try {
        const input = {
          reviewSetId: reviewSetId as ReviewSetId,
          reviewDocumentId: reviewDocumentId as ReviewDocumentId,
          reviewTagId: body.reviewTagId as ReviewTagId,
          scope: body.scope ?? ("document" as const),
        };
        const result =
          body.action === "apply"
            ? await applyTag(firm.firmDatabase, input, access, options)
            : await removeTag(firm.firmDatabase, input, access, options);
        await commitEffectBatch(firm.firmDatabase, result.effect, { now: options.clock.now });
        return c.json(
          { reviewTagEventId: result.reviewTagEventId, documentCount: result.documentCount },
          200,
        );
      } catch (caught) {
        if (caught instanceof DiscoveryValidationError) return codingErrorResponse(c, caught);
        throw caught;
      }
    },
  );

  app.openapi(
    { ...bulkCodingRoute, middleware: chokepointMiddleware(chokepoint, bulkCodingRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { reviewSetId } = c.req.valid("param");
      const body = c.req.valid("json");
      const access = accessFor(c);
      const options = serviceOptions(c);
      if (
        !(await memberHasReviewSetAccess(firm.firmDatabase, reviewSetId as ReviewSetId, access))
      ) {
        return notOnTheList(c);
      }
      const kind = body.action === "apply" ? ("bulk-apply" as const) : ("bulk-remove" as const);
      // Read for the matter the selection object is stamped with. The key is deliberately scope-free,
      // so an unstamped object is one nothing can place.
      const reviewSet = await readReviewSet(firm.firmDatabase, reviewSetId as ReviewSetId);
      if (reviewSet === undefined) return notOnTheList(c);
      try {
        const plan = await planBulkCoding(
          firm.firmDatabase,
          {
            reviewSetId: reviewSetId as ReviewSetId,
            reviewTagId: body.reviewTagId as ReviewTagId,
            reviewDocumentIds: body.reviewDocumentIds as ReviewDocumentId[],
            kind,
            criteria: body.criteria ?? null,
          },
          access,
          options,
        );
        // The event first, so the frozen selection has something to belong to and a run that dies
        // part-way has something its rows are attributed to.
        await commitEffectBatch(firm.firmDatabase, plan.openEffect, { now: options.clock.now });
        // Then the selection itself, BEFORE any row moves: the list is the record of what executed,
        // and a run whose rows landed without it would be a bulk act nobody could reconstruct.
        await resolveFirmBucket(c.env, firm.bucketName).bucket.put(
          plan.selectionR2Key,
          canonicalJsonStringify({
            reviewTagEventId: plan.reviewTagEventId,
            reviewSetId: plan.reviewSetId,
            reviewDocumentIds: plan.documentIds,
          }),
          {
            httpMetadata: { contentType: "application/json" },
            customMetadata: matterScopedObjectDimensions({
              matterId: reviewSet.matter_id,
              objectClass: "review-coding-selection",
            }),
          },
        );
        let written = 0;
        for (const chunk of plan.chunks) {
          const effect = await buildBulkCodingChunk(
            firm.firmDatabase,
            plan,
            chunk,
            { reviewTagId: body.reviewTagId as ReviewTagId, kind },
            access,
            options,
          );
          await commitEffectBatch(firm.firmDatabase, effect, { now: options.clock.now });
          written += chunk.length;
        }
        await commitEffectBatch(
          firm.firmDatabase,
          completeBulkCoding(firm.firmDatabase, plan, written, options),
          { now: options.clock.now },
        );
        return c.json({ reviewTagEventId: plan.reviewTagEventId, documentCount: written }, 200);
      } catch (caught) {
        if (caught instanceof DiscoveryValidationError) return codingErrorResponse(c, caught);
        throw caught;
      }
    },
  );

  app.openapi(
    { ...undoCodingRoute, middleware: chokepointMiddleware(chokepoint, undoCodingRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { reviewSetId, reviewTagEventId } = c.req.valid("param");
      const access = accessFor(c);
      const options = serviceOptions(c);
      if (
        !(await memberHasReviewSetAccess(firm.firmDatabase, reviewSetId as ReviewSetId, access))
      ) {
        return notOnTheList(c);
      }
      try {
        const result = await undoTagEvent(
          firm.firmDatabase,
          reviewTagEventId as ReviewTagEventId,
          access,
          options,
        );
        await commitEffectBatch(firm.firmDatabase, result.effect, { now: options.clock.now });
        return c.json({ reviewTagEventId: result.reviewTagEventId }, 200);
      } catch (caught) {
        if (caught instanceof DiscoveryValidationError) return codingErrorResponse(c, caught);
        throw caught;
      }
    },
  );

  app.openapi(
    {
      ...getCodingHistoryRoute,
      middleware: chokepointMiddleware(chokepoint, getCodingHistoryRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { reviewSetId } = c.req.valid("param");
      const access = accessFor(c);
      if (
        !(await memberHasReviewSetAccess(firm.firmDatabase, reviewSetId as ReviewSetId, access))
      ) {
        return notOnTheList(c);
      }
      const { cursor } = c.req.valid("query");
      const page = await readTagEventPage(
        firm.firmDatabase,
        reviewSetId as ReviewSetId,
        access,
        DEFAULT_PAGE_SIZE,
        cursor,
      );
      return c.json({ data: page.data.map(tagEventPayload), nextCursor: page.nextCursor }, 200);
    },
  );

  app.openapi(
    {
      ...getCodingProgressRoute,
      middleware: chokepointMiddleware(chokepoint, getCodingProgressRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { reviewSetId } = c.req.valid("param");
      const access = accessFor(c);
      if (
        !(await memberHasReviewSetAccess(firm.firmDatabase, reviewSetId as ReviewSetId, access))
      ) {
        return notOnTheList(c);
      }
      // The denominator is the maintained count the load path already keeps, not a COUNT(*) over a
      // quarter-million rows on a read a reviewer refreshes.
      const reviewSet = await readReviewSet(firm.firmDatabase, reviewSetId as ReviewSetId);
      const [completedCount, tagCounts, uncodedDocumentIds, splitFamilyIds] = await Promise.all([
        readCompletionCount(firm.firmDatabase, reviewSetId as ReviewSetId, access),
        readTagCounts(firm.firmDatabase, reviewSetId as ReviewSetId, access, DEFAULT_PAGE_SIZE),
        readUncodedDocumentIds(
          firm.firmDatabase,
          reviewSetId as ReviewSetId,
          access,
          DEFAULT_PAGE_SIZE,
        ),
        readFamilyConflictFamilyIds(
          firm.firmDatabase,
          reviewSetId as ReviewSetId,
          access,
          DEFAULT_PAGE_SIZE,
        ),
      ]);
      return c.json(
        {
          documentCount: reviewSet?.document_count ?? 0,
          completedCount,
          tagCounts: tagCounts.map((row) => ({
            reviewTagId: row.review_tag_id,
            reviewTagGroupId: row.review_tag_group_id,
            documentCount: row.document_count,
          })),
          uncodedDocumentIds,
          splitFamilyIds,
        },
        200,
      );
    },
  );
}

// Re-exported so the review-set create path can seed a panel bounded by the same constant the panel
// reads are bounded by, without importing the limit twice.
export { MAX_TAG_GROUPS_PER_REVIEW_SET };
