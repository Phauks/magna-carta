import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { loadEffectivePermissions } from "../session-context.ts";
import { runConflictsCheck } from "@magna-carta/conflicts/run-check";
import {
  recordDisposition,
  readCurrentDisposition,
  EmptyRationaleError,
  UnknownHitError,
} from "@magna-carta/conflicts/disposition";
import {
  parseCheckInputs,
  parseCheckScope,
  readMatterConflictsPosture,
  reportedSourcesFor,
} from "@magna-carta/conflicts/posture";
import { describeCheck, type ReportedSource } from "@magna-carta/conflicts/report-text";
import { ConflictsIdempotencyConflictError } from "@magna-carta/conflicts/run-conflicts-effect";
import { CONFLICTS_CHECK_TABLE, CONFLICTS_HIT_TABLE } from "@magna-carta/conflicts/statements";
import {
  CONFLICTS_TRIGGERS,
  DISPOSITION_KINDS,
  SOURCE_AVAILABILITIES,
  SOURCE_CLASSES,
  STRICTNESS_LEVELS,
} from "@magna-carta/conflicts/types";
import type { DirectoryIdentifierContext } from "@magna-carta/directory/identifiers";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import { identifierField, identifierPathParam, idempotencyKeyHeader } from "../contracts/common.ts";
import type { Context } from "hono";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import { problemResponseForIdempotencyConflict } from "../idempotency-conflict-problems.ts";
import { firmKeyProviderForEnv } from "../firm-key-provider-wiring.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { Problem, problemJson, type ProblemResponse } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";

// The conflicts HTTP surface over the @magna-carta/conflicts domain package: running a
// conflicts-of-interest check against the directory corpus, reading back a completed check with its
// surfaced hits, and recording a reviewer's disposition of a hit. A check's trigger is always supplied
// by the caller — nothing here runs a check on its own. Every mutation rides the chokepoint's
// idempotency gate (an Idempotency-Key is required); every handler hands the domain service the
// firm-scoped per-firm database, the real clock, a crypto random source, and the authenticated actor —
// none of which is ever client input.

// ---- shared service handles ----

// The read-side context every conflicts write needs to walk the directory corpus (firm key, database,
// effective permissions, acting user, clock, random source). Mirrors directory.ts's identifierContext:
// built here because the route is the only caller that owns env, actor, and crypto-context threading.
async function conflictsContext(
  c: Context<{ Bindings: Bindings; Variables: AppVariables }>,
): Promise<DirectoryIdentifierContext> {
  const firm = requireChokepointFirmContext(c);
  const firmId = requireChokepointFirmId(c);
  const actorUserId = requireChokepointUserId(c);
  const effectivePermissions = await loadEffectivePermissions(firm.firmDatabase, actorUserId);
  return {
    firmId,
    firmKeyVersion: 1,
    firmKeyProvider: firmKeyProviderForEnv(c.env),
    database: firm.firmDatabase,
    effectivePermissions,
    actorUserId,
    clock: { now: () => new Date().toISOString() },
    randomSource: cryptoRandomSource,
  };
}

// A raw conflicts_check row, read directly (the package exposes no readCheck — it is a route-local
// concern, like the raw reads directory.ts performs for its own GET routes).
interface CheckRow {
  readonly id: string;
  readonly trigger: string;
  readonly subject_matter_id: string | null;
  readonly subject_parties_json: string;
  readonly scope_json: string;
  readonly strictness: string;
  readonly depth: number;
  // The inputs blob is read for the COUNTS the report sentence states (how many subject parties, how
  // many entities the traversal reached, which identifier types were skipped). It is never returned:
  // it also holds the identifier references, and the response has no business carrying them.
  readonly inputs_json: string;
  readonly floor_raised: number;
  readonly actor_user_id: string | null;
  readonly created_at: string;
}

async function readCheckRow(database: SqlDatabase, checkId: string): Promise<CheckRow | null> {
  const { results } = await database
    .prepare(
      `SELECT id, trigger, subject_matter_id, subject_parties_json, scope_json, strictness, depth, inputs_json, floor_raised, actor_user_id, created_at FROM ${CONFLICTS_CHECK_TABLE} WHERE id = ?1`,
    )
    .bind(checkId)
    .all<CheckRow>();
  return results[0] ?? null;
}

interface HitRow {
  readonly id: string;
  readonly entity_id: string;
  readonly source_class: string;
  readonly evidence_tier: number;
  readonly matched_fields_json: string;
  readonly graph_path_json: string;
  readonly co_party: number;
  readonly created_at: string;
}

async function readHitRows(database: SqlDatabase, checkId: string): Promise<HitRow[]> {
  const { results } = await database
    .prepare(
      `SELECT id, entity_id, source_class, evidence_tier, matched_fields_json, graph_path_json, co_party, created_at FROM ${CONFLICTS_HIT_TABLE} WHERE check_id = ?1 ORDER BY created_at ASC, id ASC`,
    )
    .bind(checkId)
    .all<HitRow>();
  return results;
}

// ---- request/response contracts ----

// An entity id supplied as a check subject: a person or organization handle. The domain layer skips
// (never errors on) a reference that fails to resolve to a live row, but the API still constrains the
// shape at the door. The token length is bounded so an arbitrarily long handle can never feed the
// per-seed fan-out or the bound-parameter list below.
const directoryEntityIdPattern = /^(directoryPerson|directoryOrganization)_[A-Za-z0-9_-]{1,64}$/;

// Upper bounds that keep one request's work bounded — a conflicts check runs per-seed graph expansion
// and matching in the request handler, so an unbounded subject set or depth is a caller-triggered
// fan-out (and, for the subject set, a bound-parameter overflow in the identifier-reference read). A
// real matter's party set and a real search depth sit far below these, so the caps refuse abuse at the
// door with a 422 rather than a 500 or a stalled worker.
const MAX_SUBJECT_ENTITIES = 200;
const MAX_GRAPH_DEPTH = 6;

const checkIdParam = z.object({
  checkId: identifierPathParam("conflictsCheck", "checkId"),
});

const hitIdParam = z.object({
  hitId: identifierPathParam("conflictsHit", "hitId"),
});

const ScopeRequest = z
  .object({
    sources: z.array(z.enum(SOURCE_CLASSES)).max(SOURCE_CLASSES.length),
    strictness: z.enum(STRICTNESS_LEVELS),
    // Optional: omitted means the firm's configured default depth is applied; an explicit value
    // (0 included) is honored as given, capped so no single request can walk an unbounded traversal.
    // The resolved depth is always recorded on the check.
    depth: z.number().int().min(0).max(MAX_GRAPH_DEPTH).optional(),
  })
  .openapi("ConflictsScopeRequest");

const CreateCheckRequest = z
  .object({
    trigger: z.enum(CONFLICTS_TRIGGERS),
    matterId: identifierField("matter").optional(),
    subjectEntityIds: z.array(z.string().regex(directoryEntityIdPattern)).max(MAX_SUBJECT_ENTITIES),
    scope: ScopeRequest,
  })
  .openapi("CreateConflictsCheckRequest");

const CreatedCheckResponse = z.object({ id: z.string() }).openapi("CreatedConflictsCheckResponse");

const GraphPathStep = z
  .object({
    edgeId: z.string(),
    edgeType: z.string(),
    fromEntityId: z.string(),
    toEntityId: z.string(),
  })
  .openapi("ConflictsGraphPathStep");

const DispositionDetail = z
  .object({
    id: z.string(),
    kind: z.enum(DISPOSITION_KINDS),
    rationale: z.string(),
    reviewerUserId: z.string(),
    createdAt: z.string(),
  })
  .openapi("ConflictsDispositionDetail");

const HitDetail = z
  .object({
    id: z.string(),
    entityId: z.string(),
    sourceClass: z.enum(SOURCE_CLASSES),
    evidenceTier: z.number().int().min(1).max(4),
    matchedFields: z.array(z.string()),
    graphPath: z.array(GraphPathStep),
    // True when the matched entity is itself a subject party of this check — a co-party surfacing (a
    // positional conflict or a co-party collision), triaged apart from a conflict with a prior client.
    coParty: z.boolean(),
    createdAt: z.string(),
    // The hit's current disposition (the latest reviewer adjudication), or null when no reviewer has
    // acted on it yet.
    disposition: DispositionDetail.nullable(),
  })
  .openapi("ConflictsHitDetail");

const CheckDetail = z
  .object({
    id: z.string(),
    trigger: z.enum(CONFLICTS_TRIGGERS),
    matterId: z.string().nullable(),
    subjectEntityIds: z.array(z.string()),
    // Keyed by source class (plus prior_firm_history, which carries no dedicated class of its own) —
    // every registered source is present, so a caller can always tell "searched and clean" apart from
    // "never searched".
    scope: z.record(z.string(), z.enum(SOURCE_AVAILABILITIES)),
    strictness: z.enum(STRICTNESS_LEVELS),
    depth: z.number().int(),
    floorRaised: z.boolean(),
    actorUserId: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("ConflictsCheckDetail");

// The reader-facing account of the search, one line per statement, in reading order. Every line is a
// fact about the search itself — which channels ran, which sources have no corpus, how many candidates
// surfaced. A search that surfaced nothing ends "Nothing surfaced.", which reports that the search
// ended and says nothing about the matter.
const CheckStatement = z.array(z.string());

const GetCheckResponse = z
  .object({ check: CheckDetail, statement: CheckStatement, hits: z.array(HitDetail) })
  .openapi("ConflictsCheckWithHitsResponse");

// ---- the matter conflicts posture ----

const matterIdParam = z.object({
  matterId: identifierPathParam("matter", "matterId"),
});

const PostureScope = z
  .object({
    // Every registered source with the availability the check recorded. A source with no corpus is
    // present and marked unavailable, never omitted and never conflated with one that was searched.
    sources: z.record(z.string(), z.enum(SOURCE_AVAILABILITIES)),
    strictness: z.string(),
    depth: z.number().int(),
    floorRaised: z.boolean(),
  })
  .openapi("ConflictsPostureScope");

const PostureLatestCheck = z
  .object({
    id: z.string(),
    createdAt: z.string(),
    trigger: z.string(),
    actorUserId: z.string().nullable(),
    scope: PostureScope,
    subjectEntityCount: z.number().int(),
    expandedEntityCount: z.number().int(),
    skippedIdentifierTypes: z.array(z.string()),
    hitCount: z.number().int(),
  })
  .openapi("ConflictsPostureLatestCheck");

const PostureScopeShortfall = z
  .object({
    // Source classes the firm's current policy requires that the latest check did not consider.
    sources: z.array(z.enum(SOURCE_CLASSES)),
    strictness: z.object({ firmFloor: z.enum(STRICTNESS_LEVELS), ranUnder: z.string() }).nullable(),
    depth: z.object({ firmDefault: z.number().int(), ranAt: z.number().int() }).nullable(),
  })
  .openapi("ConflictsPostureScopeShortfall");

const PostureUndisposedTier = z
  .object({ tier: z.number().int().min(1).max(4), count: z.number().int() })
  .openapi("ConflictsPostureUndisposedTier");

const PostureDispositionKind = z
  .object({
    kind: z.enum(DISPOSITION_KINDS),
    count: z.number().int(),
    reviewerUserIds: z.array(z.string()),
  })
  .openapi("ConflictsPostureDispositionKind");

const PostureUnavailableSource = z
  .object({ source: z.string(), reason: z.string() })
  .openapi("ConflictsPostureUnavailableSource");

const PosturePendingRecheck = z
  .object({
    causeTopic: z.string(),
    causeReference: z.string(),
    causeOccurredAt: z.string(),
    requestedAt: z.string(),
  })
  .openapi("ConflictsPosturePendingRecheck");

const MatterConflictsPostureResponse = z
  .object({
    matterId: z.string(),
    // True when no check has ever named this matter — a different state from a check that searched
    // and surfaced nothing, and different again from one whose sources were all unavailable.
    neverChecked: z.boolean(),
    latestCheck: PostureLatestCheck.nullable(),
    scopeShortfall: PostureScopeShortfall,
    pendingRecheck: z.array(PosturePendingRecheck),
    undisposedByTier: z.array(PostureUndisposedTier),
    dispositionsByKind: z.array(PostureDispositionKind),
    unavailableSources: z.array(PostureUnavailableSource),
  })
  .openapi("MatterConflictsPostureResponse");

const RecordDispositionRequest = z
  .object({
    kind: z.enum(DISPOSITION_KINDS),
    rationale: z.string().min(1),
  })
  .openapi("RecordConflictsDispositionRequest");

const CreatedDispositionResponse = z
  .object({ id: z.string() })
  .openapi("CreatedConflictsDispositionResponse");

// ---- shared error responses ----

const authErrors = {
  400: {
    description: "Missing Idempotency-Key (this operation requires one)",
    content: { "application/problem+json": { schema: Problem } },
  },
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "The session member lacks the required permission",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description: "The firm is unreachable, the member is deactivated, or the resource is unknown",
    content: { "application/problem+json": { schema: Problem } },
  },
  409: {
    description: "A request with this Idempotency-Key is still in progress",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description:
      "The request is invalid, or the Idempotency-Key was reused with a different payload",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;

// Maps a conflicts domain refusal to its RFC 9457 problem. Codes — never messages — drive it; an
// unrecognized throw propagates to the standard error pipeline (a 500).
function conflictsErrorResponse(
  c: Context,
  caught: unknown,
): ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> {
  if (caught instanceof ConflictsIdempotencyConflictError) {
    return problemResponseForIdempotencyConflict(c, caught);
  }
  if (caught instanceof UnknownHitError) {
    return problemJson(c, {
      type: "not-found",
      title: "Not found",
      status: 404,
      detail: caught.message,
    });
  }
  if (caught instanceof EmptyRationaleError) {
    return problemJson(c, {
      type: "validation",
      title: "Conflicts request invalid",
      status: 422,
      detail: caught.message,
    });
  }
  throw caught;
}

// ---- route metas ----

function mutationMeta(action: string, permission: RouteMeta["permission"]): RouteMeta {
  return {
    operationId: `conflicts.${action}`,
    surface: "app",
    authenticated: true,
    permission,
    resource: "firm",
    audited: true,
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

function readMeta(action: string, permission: RouteMeta["permission"]): RouteMeta {
  return {
    operationId: `conflicts.${action}`,
    surface: "app",
    authenticated: true,
    permission,
    resource: "firm",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  };
}

const runCheckRoute = defineOpenAPIRoute(mutationMeta("runCheck", "conflicts:run"), {
  method: "post",
  path: "/api/v1/conflicts/checks",
  description:
    "Runs a conflicts-of-interest check against the directory corpus for the given subject parties " +
    "(and, when a matter is supplied, its existing parties too), and records the search — what was " +
    "asked for, what actually ran, and what it found — as a new entry in the append-only conflicts " +
    "log. The trigger must always be supplied; no check ever runs on its own.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: CreateCheckRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The completed check",
      content: { "application/json": { schema: CreatedCheckResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const getCheckRoute = defineOpenAPIRoute(readMeta("getCheck", "conflicts:read"), {
  method: "get",
  path: "/api/v1/conflicts/checks/{checkId}",
  description:
    "Returns a completed conflicts check and every hit it surfaced, including each hit's current " +
    "disposition when a reviewer has already adjudicated it, alongside a plain-language statement of " +
    "what the search did: which sources ran and with what settings, which could not run and why, and " +
    "how many candidates surfaced. The statement reports the search and reaches no conclusion about " +
    "the matter — a search that surfaced nothing ends by saying so, which is a fact about the search " +
    "and not about whether an interest is adverse. Deciding that is a reviewer's act and is recorded " +
    "as a disposition naming them.",
  request: { params: checkIdParam },
  responses: {
    200: {
      description: "The check, the statement of what it searched, and its hits",
      content: { "application/json": { schema: GetCheckResponse } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const matterPostureRoute = defineOpenAPIRoute(readMeta("matterPosture", "conflicts:read"), {
  method: "get",
  path: "/api/v1/matters/{matterId}/conflicts-posture",
  description:
    "Where a matter stands on conflicts: the most recent check with the scope it actually ran under, " +
    "which of the firm's current policy requirements that check did not meet, how many of its hits no " +
    "reviewer has answered (by evidence tier), how its answered hits were disposed of and by whom, and " +
    "every source that could not be searched with the reason it could not. A matter that has never " +
    "been checked reports that as its own distinct state, separate from a check that searched and " +
    "surfaced nothing. Every field is computed from the log at the moment of the request and nothing " +
    "is stored, so raising the firm's policy shows up here immediately. The response reports what was " +
    "searched and what was found and asserts nothing about whether an interest is adverse: there is no " +
    "summary field and no single verdict, because concluding is a lawyer's act and the record says " +
    "whose.",
  request: { params: matterIdParam },
  responses: {
    200: {
      description: "The matter's conflicts posture, derived at read time",
      content: { "application/json": { schema: MatterConflictsPostureResponse } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    422: authErrors[422],
    429: authErrors[429],
  },
});

const recordDispositionRoute = defineOpenAPIRoute(
  mutationMeta("recordDisposition", "conflicts:dispose"),
  {
    method: "post",
    path: "/api/v1/conflicts/hits/{hitId}/dispositions",
    description:
      "Records a reviewer's adjudication of a surfaced hit — clearing it, noting a waiver, recording " +
      "that an ethical wall was erected, or declining the representation. Every call appends a new " +
      "row; a reviewer who reverses an earlier call records a second disposition rather than editing " +
      "the first, so the full history of the adjudication stays visible.",
    request: {
      headers: idempotencyKeyHeader,
      params: hitIdParam,
      body: {
        content: { "application/json": { schema: RecordDispositionRequest } },
        required: true,
      },
    },
    responses: {
      201: {
        description: "The recorded disposition",
        content: { "application/json": { schema: CreatedDispositionResponse } },
      },
      400: authErrors[400],
      401: authErrors[401],
      403: authErrors[403],
      404: authErrors[404],
      409: authErrors[409],
      422: authErrors[422],
      429: authErrors[429],
    },
  },
);

type ConflictsApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

export function registerConflictsRoutes(app: ConflictsApp, chokepoint: Chokepoint): void {
  // POST /api/v1/conflicts/checks
  app.openapi(
    { ...runCheckRoute, middleware: chokepointMiddleware(chokepoint, runCheckRoute) },
    async (c) => {
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const request = c.req.valid("json");
      const context = await conflictsContext(c);
      try {
        const id = await runConflictsCheck(
          context,
          {
            trigger: request.trigger,
            matterId: request.matterId,
            subjectEntityIds: request.subjectEntityIds,
            scope: request.scope,
          },
          {
            clock: { now: () => new Date().toISOString() },
            actorUserId: userId,
            randomSource: cryptoRandomSource,
            idempotency,
          },
        );
        return c.json({ id } as z.infer<typeof CreatedCheckResponse>, 201);
      } catch (caught) {
        return conflictsErrorResponse(c, caught);
      }
    },
  );

  // GET /api/v1/conflicts/checks/{checkId}
  app.openapi(
    { ...getCheckRoute, middleware: chokepointMiddleware(chokepoint, getCheckRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { checkId } = c.req.valid("param");
      const checkRow = await readCheckRow(firm.firmDatabase, checkId);
      if (checkRow === null) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such conflicts check in this firm.",
        });
      }
      const hitRows = await readHitRows(firm.firmDatabase, checkId);
      const hits = await Promise.all(
        hitRows.map(async (hitRow) => {
          const disposition = await readCurrentDisposition(firm.firmDatabase, hitRow.id);
          return {
            id: hitRow.id,
            entityId: hitRow.entity_id,
            sourceClass: hitRow.source_class,
            evidenceTier: hitRow.evidence_tier,
            matchedFields: JSON.parse(hitRow.matched_fields_json) as string[],
            graphPath: JSON.parse(hitRow.graph_path_json) as unknown[],
            coParty: hitRow.co_party === 1,
            createdAt: hitRow.created_at,
            disposition:
              disposition === null
                ? null
                : {
                    id: disposition.id,
                    kind: disposition.kind,
                    rationale: disposition.rationale,
                    reviewerUserId: disposition.reviewerUserId,
                    createdAt: disposition.createdAt,
                  },
          };
        }),
      );
      const scope = parseCheckScope(checkRow.scope_json);
      const inputs = parseCheckInputs(checkRow.inputs_json);
      const sources: ReportedSource[] = reportedSourcesFor(scope, {
        hasSubjectMatter: checkRow.subject_matter_id !== null,
      });
      const statement = describeCheck(
        {
          createdAt: checkRow.created_at,
          trigger: checkRow.trigger,
          actorUserId: checkRow.actor_user_id,
          strictness: checkRow.strictness as "balanced" | "over_inclusive",
          depth: checkRow.depth,
          floorRaised: checkRow.floor_raised === 1,
          subjectEntityCount: inputs.subjectEntityIds.length,
          expandedEntityCount: inputs.expandedEntityIds.length,
          skippedIdentifierTypes: inputs.skippedIdentifierTypes,
        },
        hitRows.map((hitRow) => ({ evidenceTier: hitRow.evidence_tier as 1 | 2 | 3 | 4 })),
        sources,
      );
      const check = {
        id: checkRow.id,
        trigger: checkRow.trigger,
        matterId: checkRow.subject_matter_id,
        subjectEntityIds: JSON.parse(checkRow.subject_parties_json) as string[],
        scope,
        strictness: checkRow.strictness,
        depth: checkRow.depth,
        floorRaised: checkRow.floor_raised === 1,
        actorUserId: checkRow.actor_user_id,
        createdAt: checkRow.created_at,
      };
      return c.json({ check, statement, hits } as unknown as z.infer<typeof GetCheckResponse>, 200);
    },
  );

  // GET /api/v1/matters/{matterId}/conflicts-posture
  app.openapi(
    { ...matterPostureRoute, middleware: chokepointMiddleware(chokepoint, matterPostureRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { matterId } = c.req.valid("param");
      // No existence check on the matter, and deliberately: a matter that has never been checked
      // reads `neverChecked`, and that is exactly the state a caller needs to see. A 404 here would
      // make "never checked" and "no such matter" the same answer, which is the conflation this read
      // exists to prevent.
      const posture = await readMatterConflictsPosture(firm.firmDatabase, matterId);
      return c.json(posture as z.infer<typeof MatterConflictsPostureResponse>, 200);
    },
  );

  // POST /api/v1/conflicts/hits/{hitId}/dispositions
  app.openapi(
    {
      ...recordDispositionRoute,
      middleware: chokepointMiddleware(chokepoint, recordDispositionRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { hitId } = c.req.valid("param");
      const request = c.req.valid("json");
      try {
        const id = await recordDisposition(
          firm.firmDatabase,
          { hitId, kind: request.kind, rationale: request.rationale, reviewerUserId: userId },
          {
            clock: { now: () => new Date().toISOString() },
            actorUserId: userId,
            randomSource: cryptoRandomSource,
            idempotency,
          },
        );
        return c.json({ id } as z.infer<typeof CreatedDispositionResponse>, 201);
      } catch (caught) {
        return conflictsErrorResponse(c, caught);
      }
    },
  );
}
