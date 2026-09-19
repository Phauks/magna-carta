import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { readFirmSetting } from "@magna-carta/data-access/setting-statements";
import {
  discoveryDocumentCeilingDefinition,
  MAX_SELECTION_SIZE,
} from "@magna-carta/discovery/limits";
import { seedCodingPanel } from "@magna-carta/discovery/coding-panel-service";
import { declareLoad, reconcileLoad, transitionLoad } from "@magna-carta/discovery/load-service";
import { seedReviewSetAccess } from "@magna-carta/discovery/review-set-access-service";
import { readDiscoveryLoad } from "@magna-carta/discovery/load-statements";
import {
  readVisibleDiscoveryLoad,
  readVisibleDiscoveryLoads,
  readVisibleReviewSet,
  readVisibleReviewSets,
  readVisibleReviewSetsForMatter,
} from "@magna-carta/discovery/review-reads";
import { reviewSetAccessPredicate } from "@magna-carta/discovery/review-set-visibility";
import { TRANSCRIPT_SCOPES } from "@magna-carta/discovery/load-source";
import {
  createRecordCustodian,
  updateRecordCustodian,
} from "@magna-carta/discovery/record-custodian-service";
import {
  readRecordCustodian,
  readRecordCustodians,
} from "@magna-carta/discovery/record-custodian-statements";
import {
  closeReviewSet,
  createReviewSet,
  lockReviewSet,
  renameReviewSet,
  setReviewSetSemanticIndexing,
} from "@magna-carta/discovery/review-set-service";
import { readReviewSet, type ReviewSetRow } from "@magna-carta/discovery/review-set-statements";
import {
  DISCOVERY_LOAD_LANES,
  RECORD_CUSTODIAN_KINDS,
  RECORD_CUSTODIAN_NAME_MAX_LENGTH,
  REVIEW_SET_NAME_MAX_LENGTH,
  LOAD_SOURCE_DESCRIPTION_MAX_LENGTH,
} from "@magna-carta/discovery/types";
import { DiscoveryValidationError } from "@magna-carta/discovery/validation";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type {
  DiscoveryLoadId,
  MatterId,
  RecordCustodianId,
  ReviewSetId,
} from "@magna-carta/identifiers/types";
import type { Context } from "hono";
import type { Bindings } from "../bindings.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { registerDownload } from "../downloads/download-register.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierField, identifierPathParam } from "../contracts/common.ts";
import { cursorQuery, paginated } from "../contracts/pagination.ts";
import { Problem, problemJson, type ProblemResponse } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import { discoveryLoadJobName } from "../discovery/discovery-load-types.ts";
import {
  discoveryEngineGeneration,
  runProcessingDispatchTurn,
} from "../discovery/dispatch-processing.ts";
import { runInternalLoadTurn } from "../discovery/run-internal-load.ts";
import { resolveFirmBucket } from "../files/firm-bucket.ts";
import { presignerForEnv } from "../files/presigner-wiring.ts";
import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { loadExceptionReportTextKey, loadManifestTextKey } from "@magna-carta/discovery/r2-keys";
import { problemResponseForIdempotencyConflict } from "../idempotency-conflict-problems.ts";
import { registerDiscoveryCodingRoutes } from "./discovery-coding.ts";
import { registerDiscoveryReviewReadRoutes } from "./discovery-review-reads.ts";

// The discovery surface: create a corpus, name whose records are in it, declare what is coming, and
// put the firm's own material in. The review surfaces themselves — the document list, the filters,
// tagging, the exception report a reviewer reads — arrive with the review slice; what this builds is
// the object every one of them is a function over.
//
// EVERY ROUTE HERE BINDS THE MATTER, and every one requires a discovery permission. Holding matter
// access reaches no review set: material produced by another party may be attorney's-eyes-only under
// a protective order, and a platform that showed it to everyone on the matter team would have caused
// a real problem before anyone noticed.

const READ = "discovery:read";
const MANAGE = "discovery:manageReviewSets";
const LOAD = "discovery:load";

const DEFAULT_PAGE_SIZE = 100;

// Long enough for a browser to follow the redirect and a slow connection to pull a large exception
// report; short enough that a URL copied out of a network log is useless by the time it is read.
const ARTIFACT_TTL_SECONDS = 300;

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
    description: "The firm is unreachable, the member is deactivated, or the record does not exist",
    content: { "application/problem+json": { schema: Problem } },
  },
  409: {
    description:
      "The review set no longer takes material, the load has not reconciled, or a request with " +
      "this Idempotency-Key is still in progress",
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

const commonErrors = {
  401: authErrors[401],
  403: authErrors[403],
  404: authErrors[404],
  409: authErrors[409],
  422: authErrors[422],
  429: authErrors[429],
};

// ---------------------------------------------------------------------------------------------
// Refusal mapping. Codes drive it, never messages, so a message can be reworded without changing
// the contract.

function discoveryErrorResponse(
  c: Context,
  caught: DiscoveryValidationError,
): ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> {
  switch (caught.code) {
    case "discovery-unknown-review-set":
    case "discovery-unknown-record-custodian":
    case "discovery-unknown-load":
    case "discovery-unknown-review-document":
      return problemJson(c, {
        type: "not-found",
        title: "Not found",
        status: 404,
        detail: caught.message,
      });
    case "discovery-document-ceiling-exceeded":
      return problemJson(c, {
        type: "discovery-ceiling-exceeded",
        title: "This load would carry the review set past its ceiling",
        status: 422,
        detail: caught.message,
      });
    case "discovery-review-set-not-open":
      return problemJson(c, {
        type: "discovery-review-set-closed",
        title: "This review set takes no more material",
        status: 409,
        detail: caught.message,
      });
    case "discovery-review-set-reopen-refused":
      return problemJson(c, {
        type: "discovery-review-set-reopen-refused",
        title: "A closed review set is not reopened",
        status: 422,
        detail: caught.message,
      });
    case "discovery-load-lane-not-built":
    case "discovery-transcript-lane-not-built":
      return problemJson(c, {
        type: "discovery-load-source-not-built",
        title: "That source is not built yet",
        status: 422,
        detail: caught.message,
      });
    case "discovery-transcript-scope-unstated":
      return problemJson(c, {
        type: "discovery-transcript-scope-unstated",
        title: "Say whether assistant transcripts are in scope",
        status: 422,
        detail: caught.message,
      });
    case "discovery-version-not-clean":
    case "discovery-selection-empty":
    case "discovery-selection-too-large":
    case "discovery-selection-matter-mismatch":
      return problemJson(c, {
        type: "discovery-selection-refused",
        title: "That selection cannot enter a review set",
        status: 422,
        detail: caught.message,
      });
    case "discovery-load-transition-refused":
      return problemJson(c, {
        type: "discovery-load-not-reconciled",
        title: "This load has not reconciled",
        status: 409,
        detail: caught.message,
      });
    case "discovery-review-set-name-taken":
    case "discovery-record-custodian-name-taken":
      return problemJson(c, {
        type: "conflict",
        title: "That name is already in use here",
        status: 409,
        detail: caught.message,
      });
    default:
      return problemJson(c, {
        type: "validation",
        title: "Discovery request invalid",
        status: 422,
        detail: caught.message,
      });
  }
}

// ---------------------------------------------------------------------------------------------
// Route metas

function readMeta(action: string): RouteMeta {
  return {
    operationId: `discovery.${action}`,
    surface: "app",
    authenticated: true,
    permission: READ,
    // A review set IS one matter's corpus and cannot exist without one.
    resource: "matter",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  };
}

// Handing a record artifact to somebody is an EXPORT, so it is audited even though it is a GET.
// The audit row names the load and which artifact left, never a byte of its content.
function artifactMeta(action: string): RouteMeta {
  return {
    operationId: `discovery.${action}`,
    surface: "app",
    authenticated: true,
    permission: READ,
    resource: "matter",
    audited: true,
    idempotency: "optional",
    rateLimit: "default",
  };
}

function manageMeta(action: string): RouteMeta {
  return {
    operationId: `discovery.${action}`,
    surface: "app",
    authenticated: true,
    permission: MANAGE,
    resource: "matter",
    audited: true,
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

function loadMeta(action: string): RouteMeta {
  return {
    operationId: `discovery.${action}`,
    surface: "app",
    authenticated: true,
    permission: LOAD,
    resource: "matter",
    audited: true,
    // Required: a retried declaration must not produce a second load, which would be a second entry
    // in the provenance record for one act of loading.
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

// ---------------------------------------------------------------------------------------------
// Wire shapes

const ReviewSetSummary = z
  .object({
    id: z.string(),
    matterId: z.string(),
    name: z.string(),
    state: z.enum(["open", "locked", "closed"]),
    documentCeiling: z.number(),
    documentCount: z.number(),
    semanticIndexEnabled: z.boolean(),
    createdBy: z.string(),
    lockedAt: z.string().nullable(),
    closedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("ReviewSet");

const RecordCustodianSummary = z
  .object({
    id: z.string(),
    reviewSetId: z.string(),
    displayName: z.string(),
    directoryEntityId: z.string().nullable(),
    kind: z.enum(RECORD_CUSTODIAN_KINDS),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("RecordCustodian");

const LoadSummary = z
  .object({
    id: z.string(),
    reviewSetId: z.string(),
    lane: z.enum(DISCOVERY_LOAD_LANES),
    state: z.enum(["declared", "loading", "processing", "complete", "failed", "reversed"]),
    transcriptScope: z.enum(TRANSCRIPT_SCOPES),
    declaredDocumentCount: z.number(),
    loadedDocumentCount: z.number(),
    processedCount: z.number(),
    exceptionCount: z.number(),
    defaultRecordCustodianId: z.string().nullable(),
    sourceDescription: z.string().nullable(),
    initiatedBy: z.string(),
    initiatedAt: z.string(),
    completedAt: z.string().nullable(),
    manifestR2Key: z.string().nullable(),
    exceptionReportR2Key: z.string().nullable(),
    // What was claimed against what arrived, and whether every arrival is accounted for. Reported,
    // never used to correct either number.
    reconciliation: z.object({
      declarationMatched: z.boolean(),
      accountedFor: z.boolean(),
    }),
  })
  .openapi("DiscoveryLoad");

/**
 * Both review-set listings take the same search, over the one field a person has to go on.
 *
 * A review set is named to be told from the others — "Our collection", "Defendant's second
 * production" — so the name is what a reader types and the only thing matched. Its matter is NOT:
 * the register names the matter on each row, but a member on a review set's list may hold no access
 * to that matter at all, so matching against a matter's title would make a corpus findable by a
 * fact its reader is not entitled to and would answer differently for two people looking at the
 * same row.
 */
const reviewSetListQuery = cursorQuery.extend({
  search: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .openapi({ description: "Narrows to review sets whose name contains this text." }),
});

/**
 * The loads listing's search, over the one field a person has to go on.
 *
 * A load's other columns are counts and an instant, and nobody looks for a delivery by its count.
 * A load declared with no description reads on screen as its lane, which is a word this table does
 * not hold — so an undescribed load answers no search. That is the honest behaviour rather than a
 * special case, and it is why the description is asked for when a load is declared.
 */
const loadListQuery = cursorQuery.extend({
  search: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .openapi({ description: "Narrows to loads whose source description contains this text." }),
});

const matterIdParam = z.object({ matterId: identifierPathParam("matter", "matterId") });
const reviewSetIdParam = z.object({
  reviewSetId: identifierPathParam("reviewSet", "reviewSetId"),
});
const loadIdParam = z.object({ loadId: identifierPathParam("discoveryLoad", "loadId") });
const recordCustodianIdParam = z.object({
  recordCustodianId: identifierPathParam("recordCustodian", "recordCustodianId"),
});

// THE TRANSCRIPT CONTROL, on the wire. Required with no default, and the description says why in the
// terms a person deciding it needs: the assistant's transcripts are the firm's own work product, and
// whether the firm's reasoning about a matter belongs in a corpus it is about to certify the contents
// of is a decision somebody makes on purpose.
const transcriptScopeField = z.enum(TRANSCRIPT_SCOPES).openapi({
  description:
    "Whether the firm's assistant transcripts are in scope for this load. Required, with no " +
    "default in either direction: a transcript is the firm's own work product, and a silent " +
    "exclusion decides as much for somebody as a silent inclusion would. Recorded on the load, so " +
    "the manifest states what the corpus was drawn from and not only what landed in it.",
});

// ---------------------------------------------------------------------------------------------
// Routes

const listReviewSetsRoute = defineOpenAPIRoute(readMeta("listReviewSets"), {
  method: "get",
  path: "/api/v1/matters/{matterId}/review-sets",
  description:
    "The matter's review sets, newest first. A matter may have several — the firm's own " +
    "collection, a production received in March, a second request — and each is its own corpus " +
    "with its own index and its own lifecycle.",
  request: { params: matterIdParam, query: reviewSetListQuery },
  responses: {
    200: {
      description: "One page of the matter's review sets",
      content: {
        "application/json": { schema: paginated(ReviewSetSummary).openapi("ReviewSetList") },
      },
    },
    ...commonErrors,
  },
});

// The one read here whose ADDRESS names no matter — and its resource is still `matter`, which is
// not a fudge. The resource says what the permission governs, and `discovery:read` governs one
// matter's corpus wherever it is reached from: every row this returns is a review set, and a review
// set cannot exist without a matter. Declaring `firm` here would have loosened a rule the whole
// namespace stands on so that one listing could be spelled differently.
const listAllReviewSetsRoute = defineOpenAPIRoute(readMeta("listAllReviewSets"), {
  method: "get",
  path: "/api/v1/review-sets",
  description:
    "Every review set this member may reach, across every matter, newest first. Scoped by the " +
    "per-review-set access list and NOT by matter access, which is the whole reason it exists: a " +
    "reviewer brought in for one production is on that review set's list and may hold no access to " +
    "the matter it belongs to, so a register scoped by matter would hide from them precisely the " +
    "work they were given. Each row names its matter, because that is how a person tells four " +
    "review sets apart; naming it discloses nothing the reader is not already inside.",
  request: { query: reviewSetListQuery },
  responses: {
    200: {
      description: "One page of the member's review sets",
      content: {
        "application/json": { schema: paginated(ReviewSetSummary).openapi("ReviewSetList") },
      },
    },
    ...commonErrors,
  },
});

// The two records a load produces, and the only way to reach them.
//
// They are the point of the whole ingest lane: the manifest states what arrived, and the exception
// report names every document that could not be read with the reason for each — together they are
// what converts "we produced everything we could read" from an assertion into a document a firm
// hands to another party. Each exists in a machine-readable form and a printable one, because the
// receiving side may have no tooling and no account.
const downloadLoadArtifactRoute = defineOpenAPIRoute(artifactMeta("downloadLoadArtifact"), {
  method: "get",
  path: "/api/v1/loads/{loadId}/artifacts/{artifact}",
  description:
    "Redirects (302) to a short-lived URL for one of the load's two record artifacts — its " +
    "manifest, or its exception report — in either the machine-readable or the printable form. " +
    "404 until the load completes: the artifacts are written once, at completion, and a load that " +
    "failed never had them. Access is the review set's own list, so a member off it gets the same " +
    "answer as one asking about a load that does not exist.",
  request: {
    params: loadIdParam.extend({
      artifact: z.enum(["manifest", "exception-report"]).openapi({
        description: "Which of the load's two records to hand over.",
      }),
    }),
    query: z.object({
      format: z
        .enum(["json", "text"])
        .optional()
        .openapi({
          description:
            "The machine-readable form (default) or the printable one a person reads with no " +
            "tooling.",
        }),
    }),
  },
  responses: {
    302: { description: "Redirect to the artifact" },
    ...commonErrors,
  },
});

const createReviewSetRoute = defineOpenAPIRoute(manageMeta("createReviewSet"), {
  method: "post",
  path: "/api/v1/matters/{matterId}/review-sets",
  description:
    "Creates a review set on this matter. It starts open and empty, with the firm's document " +
    "ceiling snapshotted onto it — a ceiling later lowered by the firm does not retroactively " +
    "invalidate a set already created. Semantic indexing is off unless asked for: embedding a large " +
    "corpus is a real, metered cost incurred whether or not anyone runs a semantic query, and " +
    "keyword search is what discovery actually runs on.",
  request: {
    params: matterIdParam,
    headers: idempotencyKeyHeader,
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              name: z.string().min(1).max(REVIEW_SET_NAME_MAX_LENGTH),
              semanticIndexEnabled: z.boolean().optional(),
            })
            .openapi("CreateReviewSetRequest"),
        },
      },
      required: true,
    },
  },
  responses: {
    201: {
      description: "The review set was created",
      content: { "application/json": { schema: z.object({ id: z.string() }) } },
    },
    ...commonErrors,
  },
});

const getReviewSetRoute = defineOpenAPIRoute(readMeta("getReviewSet"), {
  method: "get",
  path: "/api/v1/review-sets/{reviewSetId}",
  description:
    "One review set: its lifecycle, how many documents it holds, its ceiling, and whether its " +
    "semantic half is on.",
  request: { params: reviewSetIdParam },
  responses: {
    200: {
      description: "The review set",
      content: { "application/json": { schema: ReviewSetSummary } },
    },
    ...commonErrors,
  },
});

const patchReviewSetRoute = defineOpenAPIRoute(manageMeta("updateReviewSet"), {
  method: "patch",
  path: "/api/v1/review-sets/{reviewSetId}",
  description:
    "Renames a review set, or turns its semantic half on or off. Turning semantic indexing on " +
    "afterwards drains the corpus without re-extracting anything, because the extracted text is " +
    "already stored.",
  request: {
    params: reviewSetIdParam,
    headers: idempotencyKeyHeader,
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              name: z.string().min(1).max(REVIEW_SET_NAME_MAX_LENGTH).optional(),
              semanticIndexEnabled: z.boolean().optional(),
            })
            .openapi("UpdateReviewSetRequest"),
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "The updated review set",
      content: { "application/json": { schema: ReviewSetSummary } },
    },
    ...commonErrors,
  },
});

const transitionReviewSetRoute = defineOpenAPIRoute(manageMeta("transitionReviewSet"), {
  method: "post",
  path: "/api/v1/review-sets/{reviewSetId}/state",
  description:
    "Locks or closes a review set. Locking refuses new loads and changes nothing else — every read " +
    "still serves. Closing additionally releases the derived artifacts (extracted text, metadata " +
    "sidecars, index splits) for collection, all of which are rebuildable from source; every row, " +
    "every manifest, and every exception report survives it. There is no reopen: the corpus under " +
    "review is what was reviewed, and a set that could be reopened is a corpus whose contents " +
    "depend on when you looked.",
  request: {
    params: reviewSetIdParam,
    headers: idempotencyKeyHeader,
    body: {
      content: {
        "application/json": {
          schema: z
            .object({ state: z.enum(["locked", "closed"]) })
            .openapi("TransitionReviewSetRequest"),
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "The review set in its new state",
      content: { "application/json": { schema: ReviewSetSummary } },
    },
    ...commonErrors,
  },
});

const listRecordCustodiansRoute = defineOpenAPIRoute(readMeta("listRecordCustodians"), {
  method: "get",
  path: "/api/v1/review-sets/{reviewSetId}/record-custodians",
  description:
    "Whose records are in this review set. A Custodian of Record is scoped to the review set on " +
    "purpose: the same name in two matters is not assertably the same person, and asserting it " +
    "wrongly is a defensibility problem.",
  request: { params: reviewSetIdParam, query: cursorQuery },
  responses: {
    200: {
      description: "One page of the review set's Custodians of Record, by name",
      content: {
        "application/json": {
          schema: paginated(RecordCustodianSummary).openapi("RecordCustodianList"),
        },
      },
    },
    ...commonErrors,
  },
});

const createRecordCustodianRoute = defineOpenAPIRoute(manageMeta("createRecordCustodian"), {
  method: "post",
  path: "/api/v1/review-sets/{reviewSetId}/record-custodians",
  description:
    "Records whose electronic records these were. The Directory link is optional — a production " +
    "may name somebody the firm has never met — and `unattributed` is a real kind rather than a " +
    "blank: material that arrived with no custodial attribution is a fact worth recording as one.",
  request: {
    params: reviewSetIdParam,
    headers: idempotencyKeyHeader,
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              displayName: z.string().min(1).max(RECORD_CUSTODIAN_NAME_MAX_LENGTH),
              kind: z.enum(RECORD_CUSTODIAN_KINDS),
              directoryEntityId: z.string().nullish(),
            })
            .openapi("CreateRecordCustodianRequest"),
        },
      },
      required: true,
    },
  },
  responses: {
    201: {
      description: "The Custodian of Record was created",
      content: { "application/json": { schema: z.object({ id: z.string() }) } },
    },
    ...commonErrors,
  },
});

const patchRecordCustodianRoute = defineOpenAPIRoute(manageMeta("updateRecordCustodian"), {
  method: "patch",
  path: "/api/v1/record-custodians/{recordCustodianId}",
  description:
    "Corrects a Custodian of Record in place, which re-points every document already attributed " +
    'to it — and that is the intent: a production that named "J. Smith" and the person the firm ' +
    "later identified are one Custodian of Record, and a second row would split the attribution " +
    "of documents already loaded under the first.",
  request: {
    params: recordCustodianIdParam,
    headers: idempotencyKeyHeader,
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              displayName: z.string().min(1).max(RECORD_CUSTODIAN_NAME_MAX_LENGTH).optional(),
              kind: z.enum(RECORD_CUSTODIAN_KINDS).optional(),
              directoryEntityId: z.string().nullish(),
            })
            .openapi("UpdateRecordCustodianRequest"),
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "The updated Custodian of Record",
      content: { "application/json": { schema: RecordCustodianSummary } },
    },
    ...commonErrors,
  },
});

const listLoadsRoute = defineOpenAPIRoute(readMeta("listLoads"), {
  method: "get",
  path: "/api/v1/review-sets/{reviewSetId}/loads",
  description:
    "What went into this corpus: every load, newest first, with its lane, its source, who ran it, " +
    "when, whether assistant transcripts were in scope, and how what arrived reconciles against " +
    "what was declared. This is the provenance record a firm hands over.",
  request: { params: reviewSetIdParam, query: loadListQuery },
  responses: {
    200: {
      description: "One page of the review set's loads",
      content: {
        "application/json": { schema: paginated(LoadSummary).openapi("DiscoveryLoadList") },
      },
    },
    ...commonErrors,
  },
});

const declareLoadRoute = defineOpenAPIRoute(loadMeta("declareLoad"), {
  method: "post",
  path: "/api/v1/review-sets/{reviewSetId}/loads",
  description:
    "Declares a load BEFORE the material arrives. That ordering is what makes the manifest's " +
    "declared-against-actual reconciliation possible at all, and what lets a load resume across a " +
    "dropped connection. The declaration states the lane, how many documents are expected, where " +
    "the material came from, and whether assistant transcripts are in scope; a load that would " +
    "carry the review set past its ceiling is refused here, with the count and the ceiling in the " +
    "message, rather than degrading partway through.",
  request: {
    params: reviewSetIdParam,
    headers: idempotencyKeyHeader,
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              lane: z.enum(DISCOVERY_LOAD_LANES),
              transcriptScope: transcriptScopeField,
              declaredDocumentCount: z.number().int().min(0),
              sourceDescription: z.string().max(LOAD_SOURCE_DESCRIPTION_MAX_LENGTH).nullish(),
              defaultRecordCustodianId: identifierField("recordCustodian").nullish(),
            })
            .openapi("DeclareLoadRequest"),
        },
      },
      required: true,
    },
  },
  responses: {
    201: {
      description: "The load was declared",
      content: { "application/json": { schema: z.object({ id: z.string() }) } },
    },
    ...commonErrors,
  },
});

const getLoadRoute = defineOpenAPIRoute(readMeta("getLoad"), {
  method: "get",
  path: "/api/v1/loads/{loadId}",
  description:
    "One load: its provenance, its state, its counts, and its reconciliation. Once complete it " +
    "also carries the keys of its manifest and its exception report, neither of which is ever " +
    "regenerated — a re-processing writes a new processing record, while the manifest describes " +
    "what arrived, which does not change.",
  request: { params: loadIdParam },
  responses: {
    200: {
      description: "The load",
      content: { "application/json": { schema: LoadSummary } },
    },
    ...commonErrors,
  },
});

const runInternalLoadRoute = defineOpenAPIRoute(loadMeta("runInternalLoad"), {
  method: "post",
  path: "/api/v1/loads/{loadId}/internal-selection",
  description:
    "Resolves a selection of the firm's own matter files, or its filed email, into review " +
    "documents. NO BYTES MOVE: the platform already holds them, along with their hashes and their " +
    "scan verdicts, so this pins the version each review document points at and nothing is copied. " +
    "Loading is a snapshot of a version, not a subscription to a file — a later version of the same " +
    "file does not change this review set, and enters only through a new load. A quarantined or " +
    "unscanned version is refused by name rather than skipped, and email enters as a family: the " +
    "message and its attachments stay together.",
  request: {
    params: loadIdParam,
    headers: idempotencyKeyHeader,
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              recordCustodianId: identifierField("recordCustodian"),
              fileIds: z.array(identifierField("file")).max(MAX_SELECTION_SIZE).optional(),
              emailMessageIds: z
                .array(identifierField("emailMessage"))
                .max(MAX_SELECTION_SIZE)
                .optional(),
            })
            .openapi("RunInternalLoadRequest"),
        },
      },
      required: true,
    },
  },
  responses: {
    202: {
      description: "The load's fan-out has run a turn; the response says how far it got",
      content: {
        "application/json": {
          schema: z
            .object({
              loadId: z.string(),
              plannedCount: z.number(),
              allocatedCount: z.number(),
              // How many of the allocated documents this turn queued to be read. Reading happens off
              // the request entirely — this number says what was asked for, never what came back.
              dispatchedCount: z.number(),
              complete: z.boolean(),
            })
            .openapi("RunInternalLoadResponse"),
        },
      },
    },
    ...commonErrors,
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

// The session member's own view of which corpora exist. Every member-facing READ here composes it;
// the pipeline reads beside them do not, because a queue consumer has no member to check.
function accessFor(c: Context<{ Bindings: Bindings; Variables: AppVariables }>) {
  return reviewSetAccessPredicate(requireChokepointUserId(c));
}

// The gate every route that NAMES a review set passes first, writes included.
//
// A read that leaks a corpus and a write that reaches into one are the same failure from two sides:
// closing a review set releases its derived artifacts, and declaring a load into one puts material in
// it. Holding the matter's discovery permission is not the same as being cleared for what an opposing
// party produced under a protective order, so the list decides both.
//
// Returns the 404 to return, or undefined to carry on. Absent rather than refused, for the same
// reason the reads are.
async function refuseUnlessOnTheList(
  c: Context<{ Bindings: Bindings; Variables: AppVariables }>,
  database: Parameters<typeof readVisibleReviewSet>[0],
  reviewSetId: ReviewSetId,
): Promise<ProblemResponse<404> | undefined> {
  const visible = await readVisibleReviewSet(database, reviewSetId, accessFor(c));
  return visible === undefined
    ? problemJson(c, {
        type: "not-found",
        title: "Not found",
        status: 404,
        detail: "No such review set in this firm.",
      })
    : undefined;
}

function reviewSetPayload(row: ReviewSetRow) {
  return {
    id: row.id,
    matterId: row.matter_id,
    name: row.name,
    state: row.state,
    documentCeiling: row.document_ceiling,
    documentCount: row.document_count,
    semanticIndexEnabled: row.semantic_index_enabled === 1,
    createdBy: row.created_by,
    lockedAt: row.locked_at,
    closedAt: row.closed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function registerDiscoveryRoutes(app: DiscoveryApp, chokepoint: Chokepoint): void {
  // The review half — the access list, the coding panel, and coding itself — registered from here
  // rather than from the app so that everything under the discovery namespace arrives together.
  registerDiscoveryCodingRoutes(app, chokepoint);
  // The reads the review surface pages through — the document list, the exception surface, the
  // occurrences, and what the index still owes.
  registerDiscoveryReviewReadRoutes(app, chokepoint);

  app.openapi(
    {
      ...listAllReviewSetsRoute,
      middleware: chokepointMiddleware(chokepoint, listAllReviewSetsRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { cursor, search } = c.req.valid("query");
      const page = await readVisibleReviewSets(
        firm.firmDatabase,
        accessFor(c),
        DEFAULT_PAGE_SIZE,
        cursor,
        search,
      );
      return c.json({ data: page.data.map(reviewSetPayload), nextCursor: page.nextCursor }, 200);
    },
  );

  app.openapi(
    {
      ...downloadLoadArtifactRoute,
      middleware: chokepointMiddleware(chokepoint, downloadLoadArtifactRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const { loadId, artifact } = c.req.valid("param");
      const format = c.req.valid("query").format ?? "json";
      // Access-scoped, so a member off the review set's list gets ABSENCE rather than a refusal that
      // would itself disclose that a corpus is there.
      const load = await readVisibleDiscoveryLoad(
        firm.firmDatabase,
        loadId as DiscoveryLoadId,
        accessFor(c),
      );
      // The stored key is the machine-readable object; its printable sibling is derived from the
      // same identifiers rather than stored a second time. Reading the stored key first is what
      // makes the printable form unreachable on a load that never wrote either — the two are
      // written in one act, so one key standing for both is not an assumption, it is the invariant.
      const storedKey =
        artifact === "manifest" ? load?.manifest_r2_key : load?.exception_report_r2_key;
      if (load === undefined || storedKey === null || storedKey === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail:
            "No such load with that record. A load writes its manifest and its exception report " +
            "once, when every document in it has reached a terminal state.",
        });
      }
      const key =
        format === "json"
          ? storedKey
          : artifact === "manifest"
            ? loadManifestTextKey(load.review_set_id, load.id)
            : loadExceptionReportTextKey(load.review_set_id, load.id);
      const { bucketName } = resolveFirmBucket(c.env, firm.bucketName);
      const url = await presignerForEnv(c.env).presignGet(bucketName, key, ARTIFACT_TTL_SECONDS);
      const now = new Date().toISOString();
      await commitEffectBatch(
        firm.firmDatabase,
        {
          statements: [
            // The member's own register, beside the firm's audit entry and in the same batch. A
            // production's manifest and its exception report are court-facing documents somebody
            // comes back for, and before this they were audited and then unfindable.
            registerDownload(firm.firmDatabase, {
              memberId: userId,
              now: new Date(now),
              registration: {
                producer: "discovery",
                title: `${artifact === "manifest" ? "Load manifest" : "Exception report"} (${format.toUpperCase()})`,
                objectKey: key,
                byteSize: null,
              },
            }).statement,
            insertAuditLogStatement(firm.firmDatabase, {
              id: newIdentifier("auditLog"),
              event: "discovery.loadArtifactExported",
              actorUserId: userId,
              subjectId: load.id,
              // The load, which record, and which form. Never a line of either document: the
              // exception report names documents, and an audit row is not where they belong.
              metadata: { reviewSetId: load.review_set_id, artifact, format },
              now,
            }),
          ],
          outboxMessages: [],
        },
        { now: () => now },
      );
      return c.redirect(url, 302);
    },
  );

  app.openapi(
    { ...listReviewSetsRoute, middleware: chokepointMiddleware(chokepoint, listReviewSetsRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { matterId } = c.req.valid("param");
      // ACCESS-SCOPED, and it is the list that most needed to be. A review set's NAME is enough to
      // disclose it — "Plaintiff's production, Ridgeway settlement" tells a reader what exists — and
      // holding the matter's discovery permission is not the same thing as being cleared for material
      // an opposing party produced under a protective order.
      const { cursor, search } = c.req.valid("query");
      const page = await readVisibleReviewSetsForMatter(
        firm.firmDatabase,
        matterId as MatterId,
        accessFor(c),
        DEFAULT_PAGE_SIZE,
        cursor,
        search,
      );
      return c.json({ data: page.data.map(reviewSetPayload), nextCursor: page.nextCursor }, 200);
    },
  );

  app.openapi(
    { ...createReviewSetRoute, middleware: chokepointMiddleware(chokepoint, createReviewSetRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { matterId } = c.req.valid("param");
      const body = c.req.valid("json");
      const idempotency = requireChokepointIdempotency(c);
      const now = () => new Date().toISOString();
      // The firm's ceiling is read HERE and snapshotted onto the row, so the domain package reads no
      // configuration of its own and a firm that lowers its ceiling does not invalidate a set that
      // already exists.
      const documentCeiling = await readFirmSetting(
        firm.firmDatabase,
        discoveryDocumentCeilingDefinition,
      );
      try {
        const result = await runIdempotentEffect({
          database: firm.firmDatabase,
          key: idempotency.key,
          fingerprint: idempotency.fingerprint,
          now,
          effect: async () => {
            const options = serviceOptions(c);
            const { reviewSetId, effect } = await createReviewSet(
              firm.firmDatabase,
              {
                matterId: matterId as MatterId,
                name: body.name,
                documentCeiling,
                semanticIndexEnabled: body.semanticIndexEnabled ?? false,
              },
              options,
            );
            // The access list and the coding panel are seeded in the SAME batch as the review set's
            // own insert. A corpus that existed for even one commit with an empty access list would
            // be one nobody could reach, and repairing it would need exactly the access the list is
            // refusing; a review set with no panel is one nobody can code against.
            //
            // The list starts with the creating member alone. Widening it to the matter team is a
            // recorded act somebody performs on purpose — inferring a wall's membership from staffing
            // would assert something about who is cleared that nobody decided.
            const access = seedReviewSetAccess(
              firm.firmDatabase,
              { reviewSetId, memberUserIds: [options.actorUserId] },
              options,
            );
            const panel = seedCodingPanel(firm.firmDatabase, reviewSetId, options);
            return {
              write: {
                statements: [...effect.statements, ...access.statements, ...panel.statements],
                outboxMessages: [
                  ...effect.outboxMessages,
                  ...access.outboxMessages,
                  ...panel.outboxMessages,
                ],
              },
              responseCode: 201,
              responseBody: canonicalJsonStringify({ id: reviewSetId }),
            };
          },
        });
        if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
          return problemResponseForIdempotencyConflict(c, result);
        }
        return c.json(JSON.parse(result.responseBody ?? "{}") as { id: string }, 201);
      } catch (caught) {
        if (caught instanceof DiscoveryValidationError) return discoveryErrorResponse(c, caught);
        throw caught;
      }
    },
  );

  app.openapi(
    { ...getReviewSetRoute, middleware: chokepointMiddleware(chokepoint, getReviewSetRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { reviewSetId } = c.req.valid("param");
      // ABSENT, not refused: a member off the list gets the same answer as for a review set that does
      // not exist, because the difference between the two is itself information about a corpus.
      const row = await readVisibleReviewSet(
        firm.firmDatabase,
        reviewSetId as ReviewSetId,
        accessFor(c),
      );
      if (row === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such review set in this firm.",
        });
      }
      return c.json(reviewSetPayload(row), 200);
    },
  );

  app.openapi(
    { ...patchReviewSetRoute, middleware: chokepointMiddleware(chokepoint, patchReviewSetRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { reviewSetId } = c.req.valid("param");
      const refusal = await refuseUnlessOnTheList(c, firm.firmDatabase, reviewSetId as ReviewSetId);
      if (refusal !== undefined) return refusal;
      const body = c.req.valid("json");
      const options = serviceOptions(c);
      try {
        if (body.name !== undefined) {
          const { effect } = await renameReviewSet(
            firm.firmDatabase,
            reviewSetId as ReviewSetId,
            body.name,
            options,
          );
          await commitEffectBatch(firm.firmDatabase, effect, { now: options.clock.now });
        }
        if (body.semanticIndexEnabled !== undefined) {
          const { effect } = await setReviewSetSemanticIndexing(
            firm.firmDatabase,
            reviewSetId as ReviewSetId,
            body.semanticIndexEnabled,
            options,
          );
          await commitEffectBatch(firm.firmDatabase, effect, { now: options.clock.now });
        }
        const row = await readReviewSet(firm.firmDatabase, reviewSetId as ReviewSetId);
        if (row === undefined) {
          return problemJson(c, {
            type: "not-found",
            title: "Not found",
            status: 404,
            detail: "No such review set in this firm.",
          });
        }
        return c.json(reviewSetPayload(row), 200);
      } catch (caught) {
        if (caught instanceof DiscoveryValidationError) return discoveryErrorResponse(c, caught);
        throw caught;
      }
    },
  );

  app.openapi(
    {
      ...transitionReviewSetRoute,
      middleware: chokepointMiddleware(chokepoint, transitionReviewSetRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { reviewSetId } = c.req.valid("param");
      const refusal = await refuseUnlessOnTheList(c, firm.firmDatabase, reviewSetId as ReviewSetId);
      if (refusal !== undefined) return refusal;
      const { state } = c.req.valid("json");
      const options = serviceOptions(c);
      try {
        const { effect } =
          state === "locked"
            ? await lockReviewSet(firm.firmDatabase, reviewSetId as ReviewSetId, options)
            : await closeReviewSet(firm.firmDatabase, reviewSetId as ReviewSetId, options);
        await commitEffectBatch(firm.firmDatabase, effect, { now: options.clock.now });
        const row = await readReviewSet(firm.firmDatabase, reviewSetId as ReviewSetId);
        if (row === undefined) {
          return problemJson(c, {
            type: "not-found",
            title: "Not found",
            status: 404,
            detail: "No such review set in this firm.",
          });
        }
        return c.json(reviewSetPayload(row), 200);
      } catch (caught) {
        if (caught instanceof DiscoveryValidationError) return discoveryErrorResponse(c, caught);
        throw caught;
      }
    },
  );

  app.openapi(
    {
      ...listRecordCustodiansRoute,
      middleware: chokepointMiddleware(chokepoint, listRecordCustodiansRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { reviewSetId } = c.req.valid("param");
      const refusal = await refuseUnlessOnTheList(c, firm.firmDatabase, reviewSetId as ReviewSetId);
      if (refusal !== undefined) return refusal;
      const { cursor } = c.req.valid("query");
      const page = await readRecordCustodians(
        firm.firmDatabase,
        reviewSetId as ReviewSetId,
        DEFAULT_PAGE_SIZE,
        cursor,
      );
      return c.json(
        {
          nextCursor: page.nextCursor,
          data: page.data.map((row) => ({
            id: row.id,
            reviewSetId: row.review_set_id,
            displayName: row.display_name,
            directoryEntityId: row.directory_entity_id,
            kind: row.kind,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          })),
        },
        200,
      );
    },
  );

  app.openapi(
    {
      ...createRecordCustodianRoute,
      middleware: chokepointMiddleware(chokepoint, createRecordCustodianRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { reviewSetId } = c.req.valid("param");
      const refusal = await refuseUnlessOnTheList(c, firm.firmDatabase, reviewSetId as ReviewSetId);
      if (refusal !== undefined) return refusal;
      const body = c.req.valid("json");
      const idempotency = requireChokepointIdempotency(c);
      const now = () => new Date().toISOString();
      try {
        const result = await runIdempotentEffect({
          database: firm.firmDatabase,
          key: idempotency.key,
          fingerprint: idempotency.fingerprint,
          now,
          effect: async () => {
            const { recordCustodianId, effect } = await createRecordCustodian(
              firm.firmDatabase,
              {
                reviewSetId: reviewSetId as ReviewSetId,
                displayName: body.displayName,
                kind: body.kind,
                directoryEntityId: body.directoryEntityId ?? null,
              },
              serviceOptions(c),
            );
            return {
              write: effect,
              responseCode: 201,
              responseBody: canonicalJsonStringify({ id: recordCustodianId }),
            };
          },
        });
        if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
          return problemResponseForIdempotencyConflict(c, result);
        }
        return c.json(JSON.parse(result.responseBody ?? "{}") as { id: string }, 201);
      } catch (caught) {
        if (caught instanceof DiscoveryValidationError) return discoveryErrorResponse(c, caught);
        throw caught;
      }
    },
  );

  app.openapi(
    {
      ...patchRecordCustodianRoute,
      middleware: chokepointMiddleware(chokepoint, patchRecordCustodianRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { recordCustodianId } = c.req.valid("param");
      // The custodian names its review set, and the review set decides. Read BEFORE the update, not
      // after: the point of the gate is that the write does not happen.
      const existing = await readRecordCustodian(
        firm.firmDatabase,
        recordCustodianId as RecordCustodianId,
      );
      if (existing === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such Custodian of Record in this firm.",
        });
      }
      const refusal = await refuseUnlessOnTheList(c, firm.firmDatabase, existing.review_set_id);
      if (refusal !== undefined) return refusal;
      const body = c.req.valid("json");
      const options = serviceOptions(c);
      try {
        const { effect } = await updateRecordCustodian(
          firm.firmDatabase,
          recordCustodianId as RecordCustodianId,
          {
            displayName: body.displayName,
            kind: body.kind,
            directoryEntityId: body.directoryEntityId,
          },
          options,
        );
        await commitEffectBatch(firm.firmDatabase, effect, { now: options.clock.now });
        const row = await readRecordCustodian(
          firm.firmDatabase,
          recordCustodianId as RecordCustodianId,
        );
        if (row === undefined) {
          return problemJson(c, {
            type: "not-found",
            title: "Not found",
            status: 404,
            detail: "No such Custodian of Record in this firm.",
          });
        }
        return c.json(
          {
            id: row.id,
            reviewSetId: row.review_set_id,
            displayName: row.display_name,
            directoryEntityId: row.directory_entity_id,
            kind: row.kind,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          },
          200,
        );
      } catch (caught) {
        if (caught instanceof DiscoveryValidationError) return discoveryErrorResponse(c, caught);
        throw caught;
      }
    },
  );

  app.openapi(
    { ...listLoadsRoute, middleware: chokepointMiddleware(chokepoint, listLoadsRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { reviewSetId } = c.req.valid("param");
      const refusal = await refuseUnlessOnTheList(c, firm.firmDatabase, reviewSetId as ReviewSetId);
      if (refusal !== undefined) return refusal;
      const { cursor, search } = c.req.valid("query");
      const page = await readVisibleDiscoveryLoads(
        firm.firmDatabase,
        reviewSetId as ReviewSetId,
        accessFor(c),
        DEFAULT_PAGE_SIZE,
        cursor,
        search,
      );
      return c.json({ data: page.data.map(loadPayload), nextCursor: page.nextCursor }, 200);
    },
  );

  app.openapi(
    { ...declareLoadRoute, middleware: chokepointMiddleware(chokepoint, declareLoadRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { reviewSetId } = c.req.valid("param");
      const refusal = await refuseUnlessOnTheList(c, firm.firmDatabase, reviewSetId as ReviewSetId);
      if (refusal !== undefined) return refusal;
      const body = c.req.valid("json");
      const idempotency = requireChokepointIdempotency(c);
      const now = () => new Date().toISOString();
      try {
        const result = await runIdempotentEffect({
          database: firm.firmDatabase,
          key: idempotency.key,
          fingerprint: idempotency.fingerprint,
          now,
          effect: async () => {
            const { loadId, effect } = await declareLoad(
              firm.firmDatabase,
              {
                reviewSetId: reviewSetId as ReviewSetId,
                lane: body.lane,
                transcriptScope: body.transcriptScope,
                declaredDocumentCount: body.declaredDocumentCount,
                sourceDescription: body.sourceDescription ?? null,
                defaultRecordCustodianId:
                  (body.defaultRecordCustodianId as RecordCustodianId | undefined) ?? null,
              },
              serviceOptions(c),
            );
            return {
              write: effect,
              responseCode: 201,
              responseBody: canonicalJsonStringify({ id: loadId }),
            };
          },
        });
        if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
          return problemResponseForIdempotencyConflict(c, result);
        }
        return c.json(JSON.parse(result.responseBody ?? "{}") as { id: string }, 201);
      } catch (caught) {
        if (caught instanceof DiscoveryValidationError) return discoveryErrorResponse(c, caught);
        throw caught;
      }
    },
  );

  app.openapi(
    { ...getLoadRoute, middleware: chokepointMiddleware(chokepoint, getLoadRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { loadId } = c.req.valid("param");
      const row = await readVisibleDiscoveryLoad(
        firm.firmDatabase,
        loadId as DiscoveryLoadId,
        accessFor(c),
      );
      if (row === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such load in this firm.",
        });
      }
      return c.json(loadPayload(row), 200);
    },
  );

  app.openapi(
    { ...runInternalLoadRoute, middleware: chokepointMiddleware(chokepoint, runInternalLoadRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { loadId } = c.req.valid("param");
      const body = c.req.valid("json");
      const options = serviceOptions(c);
      try {
        const load = await readDiscoveryLoad(firm.firmDatabase, loadId as DiscoveryLoadId);
        if (load === undefined) {
          return problemJson(c, {
            type: "not-found",
            title: "Not found",
            status: 404,
            detail: "No such load in this firm.",
          });
        }
        // Access-scoped, so this doubles as the wall: a member off the review set's list reaches the
        // load through its own identifier and gets the same answer as for a load that does not exist.
        const reviewSet = await readVisibleReviewSet(
          firm.firmDatabase,
          load.review_set_id,
          accessFor(c),
        );
        if (reviewSet === undefined) {
          return problemJson(c, {
            type: "not-found",
            title: "Not found",
            status: 404,
            detail: "No such review set in this firm.",
          });
        }
        // A load only starts once. `declared -> loading` is the transition that says the material is
        // arriving, and the trigger refuses a second one — so a retried run resumes the coordinator
        // rather than restarting the load.
        if (load.state === "declared") {
          const { effect } = await transitionLoad(
            firm.firmDatabase,
            loadId as DiscoveryLoadId,
            "loading",
            options,
          );
          await commitEffectBatch(firm.firmDatabase, effect, { now: options.clock.now });
        }

        // Addressed by the SESSION firm id, never by a path value, so a firm can no more drive
        // another firm's load than it can read one.
        const sessionFirmId = requireChokepointFirmId(c);
        const coordinator = c.env.DISCOVERY_LOAD_JOB.get(
          c.env.DISCOVERY_LOAD_JOB.idFromName(discoveryLoadJobName(sessionFirmId, loadId)),
        );
        const message = {
          firmId: sessionFirmId,
          reviewSetId: load.review_set_id,
          loadId,
          matterId: reviewSet.matter_id,
          lane: load.lane,
          recordCustodianId: body.recordCustodianId,
          fileIds: (body.fileIds ?? []) as string[],
          emailMessageIds: (body.emailMessageIds ?? []) as string[],
        };
        await coordinator.start(message);
        const turn = await runInternalLoadTurn({
          database: firm.firmDatabase,
          coordinator,
          message,
          now: options.clock.now,
          randomSource: options.randomSource,
        });

        // The processing walk starts only once every row the load will ever hold is committed. A
        // dispatch that overlapped allocation would queue a corpus that was still growing, and the
        // reconciliation the load completes against would be counted against a moving number.
        //
        // Nothing here reads a byte. The walk puts one message per document on the discovery lane and
        // returns; extraction runs in the consumer, against the engine Container, off this request
        // and off every other hot path.
        let dispatchedCount = 0;
        let dispatchComplete = false;
        // A firm with no provisioned bucket has nowhere its documents' bytes could be, so there is
        // nothing to point a reader at. The rows stay, the load stays `processing`, and the
        // coordinator says why — parked work the platform owes rather than a failure of this request,
        // which committed exactly what it was asked to.
        if (turn.complete && firm.bucketName === null) {
          await coordinator.markWaiting("the firm has no provisioned object storage");
        }
        if (turn.complete && firm.bucketName !== null) {
          const { bucketName } = resolveFirmBucket(c.env, firm.bucketName);
          const dispatch = await runProcessingDispatchTurn({
            database: firm.firmDatabase,
            coordinator,
            queue: c.env.DISCOVERY_PROCESS,
            firmId: sessionFirmId,
            bucketName,
            matterId: reviewSet.matter_id,
            reviewSetId: load.review_set_id,
            loadId,
            engineGeneration: discoveryEngineGeneration(c.env),
          });
          dispatchedCount = dispatch.dispatched;
          dispatchComplete = dispatch.complete;
        }
        return c.json(
          {
            loadId,
            plannedCount: turn.plannedCount,
            allocatedCount: turn.allocatedCount,
            dispatchedCount,
            // COMPLETE MEANS BOTH WALKS ARE DONE. A caller that stopped re-running here because
            // allocation finished would leave the tail of the corpus queued to nobody.
            complete: turn.complete && dispatchComplete,
          },
          202,
        );
      } catch (caught) {
        if (caught instanceof DiscoveryValidationError) return discoveryErrorResponse(c, caught);
        throw caught;
      }
    },
  );
}

function loadPayload(row: {
  id: string;
  review_set_id: string;
  lane: (typeof DISCOVERY_LOAD_LANES)[number];
  state: "declared" | "loading" | "processing" | "complete" | "failed" | "reversed";
  transcript_scope: (typeof TRANSCRIPT_SCOPES)[number];
  declared_document_count: number;
  loaded_document_count: number;
  processed_count: number;
  exception_count: number;
  default_record_custodian_id: string | null;
  source_description: string | null;
  initiated_by: string;
  initiated_at: string;
  completed_at: string | null;
  manifest_r2_key: string | null;
  exception_report_r2_key: string | null;
}) {
  const reconciliation = reconcileLoad(row);
  return {
    id: row.id,
    reviewSetId: row.review_set_id,
    lane: row.lane,
    state: row.state,
    transcriptScope: row.transcript_scope,
    declaredDocumentCount: row.declared_document_count,
    loadedDocumentCount: row.loaded_document_count,
    processedCount: row.processed_count,
    exceptionCount: row.exception_count,
    defaultRecordCustodianId: row.default_record_custodian_id,
    sourceDescription: row.source_description,
    initiatedBy: row.initiated_by,
    initiatedAt: row.initiated_at,
    completedAt: row.completed_at,
    manifestR2Key: row.manifest_r2_key,
    exceptionReportR2Key: row.exception_report_r2_key,
    reconciliation: {
      declarationMatched: reconciliation.declarationMatched,
      accountedFor: reconciliation.accountedFor,
    },
  };
}
