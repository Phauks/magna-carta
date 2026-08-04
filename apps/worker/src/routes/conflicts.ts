import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { loadEffectivePermissions } from "../session-context.ts";
import { runConflictsCheck } from "@magna-carta/conflicts/run-check";
import {
  recordDisposition,
  readCurrentDisposition,
  EmptyRationaleError,
  UnknownHitError,
} from "@magna-carta/conflicts/disposition";
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
  readonly floor_raised: number;
  readonly actor_user_id: string | null;
  readonly created_at: string;
}

async function readCheckRow(database: SqlDatabase, checkId: string): Promise<CheckRow | null> {
  const { results } = await database
    .prepare(
      `SELECT id, trigger, subject_matter_id, subject_parties_json, scope_json, strictness, depth, floor_raised, actor_user_id, created_at FROM ${CONFLICTS_CHECK_TABLE} WHERE id = ?1`,
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

const GetCheckResponse = z
  .object({ check: CheckDetail, hits: z.array(HitDetail) })
  .openapi("ConflictsCheckWithHitsResponse");

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
    "disposition when a reviewer has already adjudicated it.",
  request: { params: checkIdParam },
  responses: {
    200: {
      description: "The check and its hits",
      content: { "application/json": { schema: GetCheckResponse } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
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
      const check = {
        id: checkRow.id,
        trigger: checkRow.trigger,
        matterId: checkRow.subject_matter_id,
        subjectEntityIds: JSON.parse(checkRow.subject_parties_json) as string[],
        scope: JSON.parse(checkRow.scope_json) as Record<string, string>,
        strictness: checkRow.strictness,
        depth: checkRow.depth,
        floorRaised: checkRow.floor_raised === 1,
        actorUserId: checkRow.actor_user_id,
        createdAt: checkRow.created_at,
      };
      return c.json({ check, hits } as unknown as z.infer<typeof GetCheckResponse>, 200);
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
