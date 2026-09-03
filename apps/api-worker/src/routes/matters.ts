import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { readFirmSetting } from "@magna-carta/data-access/setting-statements";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import {
  closeMatter,
  createMatter,
  MatterIdempotencyConflictError,
  openMatter,
  reopenMatter,
  renumberMatter,
  updateMatter,
  type NumberContext,
} from "@magna-carta/matters/matter-service";
import {
  ClosePreconditionError,
  runClosePreconditions,
  type ClosePrecondition,
} from "@magna-carta/matters/close-preconditions";
import type { CloseAdvisory } from "@magna-carta/matters/close-advisories";
import { matterCustodyCloseAdvisory } from "@magna-carta/custodian/close-advisory";
import { matterTasksCloseAdvisory } from "@magna-carta/tasks/close-advisory";
import { NumberingRenderError } from "@magna-carta/matters/numbering/render";
import { listConsultations, listMatters } from "@magna-carta/matters/queries";
import { staleConsultationAgeDaysDefinition } from "@magna-carta/matters/settings";
import { MatterValidationError } from "@magna-carta/matters/validation";
import {
  selectMatterDetailStatement,
  selectMatterStatement,
} from "@magna-carta/matters/matter-statements";
import { matterClientCreditClosePrecondition } from "@magna-carta/billing/close-precondition";
import { matterTrustClosePrecondition } from "@magna-carta/trust/close-precondition";
import type { LocationId, MatterId, MatterTypeId, UserId } from "@magna-carta/identifiers/types";
import type { Context } from "hono";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierField, identifierPathParam } from "../contracts/common.ts";
import { Problem, problemJson, type ProblemResponse } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../idempotency-conflict-problems.ts";

// The matter shell HTTP surface: create (a Prospective consultation or a numbered Open matter),
// list/get, the per-attorney Consultations view, patch, and the lifecycle actions (open/close/
// reopen/renumber). The matters domain package owns lifecycle, number allocation, and idempotency
// (design X — each mutation rides runIdempotentEffect); these handlers assemble the render context
// from the matter's Location/type/client, map domain refusals to problems, and surface the replay
// header. Reads are open to any authenticated firm member (permission: null); mutations name their
// spec permission.

// ---- request/response contracts ----

const matterStatus = z.enum(["prospective", "open", "closed"]);

const CreateMatterRequest = z
  .object({
    title: z.string().min(1),
    status: z.enum(["prospective", "open"]),
    description: z.string().nullable().optional(),
    matterTypeId: identifierField("matterType").nullable().optional(),
    locationId: identifierField("location").nullable().optional(),
    responsibleMemberId: identifierField("user"),
    clientDisplayName: z.string().nullable().optional(),
    clientCode: z.string().nullable().optional(),
  })
  .openapi("CreateMatterRequest");

const MatterSummary = z
  .object({
    id: z.string(),
    title: z.string(),
    status: matterStatus,
    matterTypeId: z.string().nullable(),
    locationId: z.string().nullable(),
    responsibleMemberId: z.string(),
    clientDisplayName: z.string().nullable(),
    matterNumber: z.string().nullable(),
    // The tentative number a consultation wears until (and after) it is opened. Carried beside the
    // matter number, never folded into it: which of the two a reader has changes what it means.
    consultationNumber: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("MatterSummary");

const MatterListResponse = z
  .object({ data: z.array(MatterSummary), nextCursor: z.string().nullable() })
  .openapi("MatterListResponse");

const ConsultationItemSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    matterNumber: z.string().nullable(),
    // A consultation's own number — on this view, the only number there is.
    consultationNumber: z.string().nullable(),
    createdAt: z.string(),
    isStale: z.boolean(),
  })
  .openapi("ConsultationItem");

const ConsultationListResponse = z
  .object({ data: z.array(ConsultationItemSchema), nextCursor: z.string().nullable() })
  .openapi("ConsultationListResponse");

const MatterDetail = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    status: matterStatus,
    matterTypeId: z.string().nullable(),
    locationId: z.string().nullable(),
    responsibleMemberId: z.string(),
    clientDisplayName: z.string().nullable(),
    clientCode: z.string().nullable(),
    matterNumber: z.string().nullable(),
    consultationNumber: z.string().nullable(),
    eBilling: z.boolean(),
    openedAt: z.string().nullable(),
    closedAt: z.string().nullable(),
    createdAt: z.string(),
    // The three names beside their ids, resolved in the same read. A screen cannot print a
    // matterType_ handle at a person, and asking for each name separately would be three more round
    // trips per matter view. Null where the matter carries no type or Location, or where the
    // responsible member's row is gone: an honest gap, never the identifier as a stand-in.
    matterTypeName: z.string().nullable(),
    locationName: z.string().nullable(),
    responsibleMemberName: z.string().nullable(),
  })
  .openapi("MatterDetail");

// The create/open/action responses echo exactly what the idempotency record stores (the matters
// service owns the commit + the stored body), so an idempotent replay — answered by the chokepoint
// from the stored body — is byte-identical to the fresh response. That is why these carry matterId,
// not a remapped id: the handler returns the service value verbatim.
const CreateMatterResponse = z
  .object({
    matterId: z.string(),
    matterNumber: z.string().nullable(),
    // Filled for a consultation, which is numbered the moment it is created; null for a matter
    // created straight to open, which never was one.
    consultationNumber: z.string().nullable(),
  })
  .openapi("CreateMatterResponse");

const PatchMatterRequest = z
  .object({
    title: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    matterTypeId: identifierField("matterType").nullable().optional(),
    locationId: identifierField("location").nullable().optional(),
    responsibleMemberId: identifierField("user").optional(),
    clientDisplayName: z.string().nullable().optional(),
    clientCode: z.string().nullable().optional(),
  })
  .openapi("PatchMatterRequest");

const OpenMatterResponse = z
  .object({ matterId: z.string(), matterNumber: z.string() })
  .openapi("OpenMatterResponse");
// A minimal lifecycle-action acknowledgement: the matter id only. The new status is not echoed —
// reopen restores open OR prospective, and patch/renumber leave status unchanged; the client refetches
// detail. matterId matches the service's stored value so a replay is byte-identical to the fresh ack.
const StatusAck = z.object({ matterId: z.string() }).openapi("MatterActionAck");

// The close acknowledgement carries the advisory notices alongside the id. They are INFORMATION, not
// a refusal: a close that produced notices still closed, and there is no arm of this contract on
// which a notice prevents one. Its own component rather than an extra field on the shared ack so a
// notice cannot leak onto open, reopen, or renumber, none of which run advisories.
const CloseAck = z
  .object({
    matterId: z.string(),
    notices: z.array(z.object({ code: z.string(), message: z.string() })),
  })
  .openapi("MatterCloseAck");

// Whether a matter would close if somebody asked it to, WITHOUT asking. The close hook's rules are
// pure reads with a separate commit guard, so running them read-only is the same question the close
// asks and none of the write. A screen that offers a close can therefore state the answer instead of
// making a person press a button to discover it.
//
// It is a probe and not a promise: the balances it reads can move a second later, which is exactly
// why the close re-asserts every rule inside its own batch. `closable` here means "nothing stands in
// the way right now", never "this close will succeed".
const CloseReadiness = z
  .object({
    matterId: z.string(),
    status: matterStatus,
    closable: z.boolean(),
    blockers: z.array(z.object({ code: z.string(), message: z.string() })),
  })
  .openapi("MatterCloseReadiness");

const RenumberRequest = z
  .object({ matterNumber: z.string().min(1) })
  .openapi("RenumberMatterRequest");

const matterParam = z.object({ id: identifierPathParam("matter", "id") });

// The close rules, registered here because this app is where the subsystems meet: the matter shell
// runs whatever it is handed and never imports the subsystem that owns a rule. Two, and both are
// about somebody else's money — a matter whose client trust ledger still holds funds does not close,
// and neither does one carrying a credit the firm has conceded it owes the client back.
//
// There is deliberately no rule here on an unpaid bill: an uncollectable receivable is an ordinary
// business outcome whose lawful exit is a write-off, and blocking on one would be friction with no
// ethical floor under it.
const CLOSE_PRECONDITIONS: readonly ClosePrecondition[] = [
  matterTrustClosePrecondition,
  matterClientCreditClosePrecondition,
];

// The close NOTICES, registered the same way and kept deliberately separate from the rules above.
// Custody is the first: closing a matter surfaces the physical originals the firm still holds against
// it and never blocks on them. A firm holds a client's will for decades after the last matter for
// that client closed — that is the steady state of a safe-custody register, and a block here would
// only teach people to unlink packets from matters before closing them.
const CLOSE_ADVISORIES: readonly CloseAdvisory[] = [
  matterCustodyCloseAdvisory,
  matterTasksCloseAdvisory,
];

// ---- shared helpers ----

// The clock the matter service reads: an ISO instant and the civil date the number draw renders the
// year/date segments from.
function serviceClock() {
  return {
    now: () => new Date().toISOString(),
    today: () => new Date().toISOString().slice(0, 10),
  };
}

// Maps a matters domain refusal to its problem response. Codes — never messages — drive the mapping.
// The return type is annotated (not inferred) so the precise ProblemResponse status union survives to
// the handler — an inferred union widens to bare Response and breaks the zod-openapi typed handler.
function matterErrorResponse(
  c: Context,
  error: MatterValidationError,
): ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> {
  switch (error.code) {
    case "matter-not-found":
      return problemJson(c, {
        type: "not-found",
        title: "Not found",
        status: 404,
        detail: "No such matter in this firm.",
      });
    case "matter-not-prospective":
    case "matter-not-closed":
    case "matter-already-closed":
    case "matter-number-taken":
      return problemJson(c, {
        type: "conflict",
        title: "Matter not in the required state",
        status: 409,
        detail: error.message,
      });
    default:
      // empty-matter-title, scheme-missing, matter-number-not-url-safe — a bad request/config.
      return problemJson(c, {
        type: "validation",
        title: "Matter request invalid",
        status: 422,
        detail: error.message,
      });
  }
}

// A number draw whose active scheme references a value the matter lacks (e.g. a location_code segment
// with no Location and no firm default) is a bad request against this matter, not a server fault —
// map it to a 422, mirroring the numbering preview route.
function numberingRenderResponse(c: Context, error: NumberingRenderError): ProblemResponse<422> {
  return problemJson(c, {
    type: "validation",
    title: "Cannot render the matter number",
    status: 422,
    detail: error.message,
  });
}

// Reads a single string column for a row by id (used to assemble the number context from the Location
// and type rows). Returns null when absent.
async function readColumn(database: SqlDatabase, sql: string, id: string): Promise<string | null> {
  const { results } = await database.prepare(sql).bind(id).all<{ value: string | null }>();
  return results[0]?.value ?? null;
}

// Initials from a display name: the first letter of each whitespace-separated word, upper-cased. A
// best-effort value for a staff_initials segment; an empty result (no name) lets the renderer refuse a
// scheme that requires it.
function initialsOf(displayName: string): string {
  return displayName
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

// Assembles the plain-string render context the number draw needs (decided: the renderer reads no
// tables — handlers resolve the Location code, type code, and staff initials). Only the values a
// scheme might reference; an absent value only matters if a scoping/value segment needs it.
async function assembleNumberContext(
  database: SqlDatabase,
  fields: {
    locationId: LocationId | null;
    matterTypeId: MatterTypeId | null;
    clientCode: string | null;
    clientDisplayName: string | null;
    responsibleMemberId: UserId;
  },
): Promise<NumberContext> {
  const [locationCode, matterTypeCode, memberName] = await Promise.all([
    fields.locationId === null
      ? Promise.resolve(null)
      : readColumn(
          database,
          "SELECT number_code AS value FROM location WHERE id = ?1",
          fields.locationId,
        ),
    fields.matterTypeId === null
      ? Promise.resolve(null)
      : readColumn(
          database,
          "SELECT code AS value FROM matter_type WHERE id = ?1",
          fields.matterTypeId,
        ),
    readColumn(
      database,
      "SELECT display_name AS value FROM member WHERE user_id = ?1",
      fields.responsibleMemberId,
    ),
  ]);
  return {
    locationCode: locationCode ?? undefined,
    matterTypeCode: matterTypeCode ?? undefined,
    clientCode: fields.clientCode ?? undefined,
    clientName: fields.clientDisplayName ?? undefined,
    staffInitials: memberName === null ? undefined : initialsOf(memberName),
  };
}

// ---- route metas ----

const createMatterMeta: RouteMeta = {
  operationId: "matters.create",
  surface: "app",
  authenticated: true,
  permission: "matters:create",
  resource: "matter",
  audited: true,
  idempotency: "required",
  idempotencyStore: "firm",
  rateLimit: "default",
};

const listMattersMeta: RouteMeta = {
  operationId: "matters.list",
  surface: "app",
  authenticated: true,
  permission: null,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const listConsultationsMeta: RouteMeta = {
  operationId: "matters.listConsultations",
  surface: "app",
  authenticated: true,
  permission: null,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const getMatterMeta: RouteMeta = {
  operationId: "matters.get",
  surface: "app",
  authenticated: true,
  permission: null,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

// The same permission the close itself names: the answer quotes trust balances and conceded client
// credits, so whoever may read it is whoever may act on it.
const getMatterCloseReadinessMeta: RouteMeta = {
  operationId: "matters.closeReadiness",
  surface: "app",
  authenticated: true,
  permission: "matters:close",
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const patchMatterMeta: RouteMeta = {
  operationId: "matters.update",
  surface: "app",
  authenticated: true,
  permission: "matters:edit",
  resource: "matter",
  audited: true,
  idempotency: "required",
  idempotencyStore: "firm",
  rateLimit: "default",
};

function actionMeta(action: string, permission: RouteMeta["permission"]): RouteMeta {
  return {
    operationId: `matters.${action}`,
    surface: "app",
    authenticated: true,
    permission,
    resource: "matter",
    audited: true,
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

const openMatterMeta = actionMeta("open", "matters:open");
const closeMatterMeta = actionMeta("close", "matters:close");
const reopenMatterMeta = actionMeta("reopen", "matters:reopen");
const renumberMatterMeta = actionMeta("renumber", "matters:renumber");

// Shared response fragments.
const authErrors = {
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "The session member lacks the required permission",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description: "The firm is unreachable, the member is deactivated, or the matter is unknown",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;

const idempotencyErrors = {
  400: {
    description: "Missing Idempotency-Key (this operation requires one)",
    content: { "application/problem+json": { schema: Problem } },
  },
  409: {
    description:
      "A request with this Idempotency-Key is still in progress, or the matter is in the wrong state",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description:
      "The request is invalid, or the Idempotency-Key was reused with a different payload",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;

const createMatterRoute = defineOpenAPIRoute(createMatterMeta, {
  method: "post",
  path: "/api/v1/matters",
  description:
    "Creates a matter. status 'prospective' opens an unnumbered consultation (it appears only in the " +
    "responsible attorney's Consultations view); status 'open' draws the firm's next matter number " +
    "atomically and opens it.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: CreateMatterRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The matter was created (numbered when opened)",
      content: { "application/json": { schema: CreateMatterResponse } },
    },
    400: idempotencyErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: idempotencyErrors[409],
    422: idempotencyErrors[422],
    429: authErrors[429],
  },
});

const listMattersRoute = defineOpenAPIRoute(listMattersMeta, {
  method: "get",
  path: "/api/v1/matters",
  description:
    "Lists the firm's matters (the working caseload — Prospective consultations are excluded unless " +
    "status=prospective is named), cursor-paginated, filterable by status/type/location/responsible " +
    "member and a free-text search over title, number, and client.",
  request: {
    query: z.object({
      status: matterStatus.optional(),
      matterTypeId: identifierField("matterType").optional(),
      locationId: identifierField("location").optional(),
      responsibleMemberId: identifierField("user").optional(),
      search: z.string().optional(),
      cursor: z.string().optional(),
      pageSize: z.coerce.number().int().positive().max(200).optional(),
    }),
  },
  responses: {
    200: {
      description: "A page of matters",
      content: { "application/json": { schema: MatterListResponse } },
    },
    401: authErrors[401],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const listConsultationsRoute = defineOpenAPIRoute(listConsultationsMeta, {
  method: "get",
  path: "/api/v1/matters/consultations",
  description:
    "The Consultations view: the session attorney's unnumbered Prospective matters, each flagged " +
    "stale once it has sat past the firm's stale-consultation age. Cursor-paginated.",
  request: {
    query: z.object({
      cursor: z.string().optional(),
      pageSize: z.coerce.number().int().positive().max(200).optional(),
    }),
  },
  responses: {
    200: {
      description: "A page of the attorney's consultations",
      content: { "application/json": { schema: ConsultationListResponse } },
    },
    401: authErrors[401],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const getMatterRoute = defineOpenAPIRoute(getMatterMeta, {
  method: "get",
  path: "/api/v1/matters/{id}",
  description: "Returns one matter's detail.",
  request: { params: matterParam },
  responses: {
    200: { description: "The matter", content: { "application/json": { schema: MatterDetail } } },
    401: authErrors[401],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const getMatterCloseReadinessRoute = defineOpenAPIRoute(getMatterCloseReadinessMeta, {
  method: "get",
  path: "/api/v1/matters/{id}/close-readiness",
  description:
    "Answers whether this matter would close right now, without closing it. Runs the same close " +
    "preconditions the close runs and reports each one that stands in the way, with the balance and " +
    "the movements that clear it, in the words of the subsystem that owns the rule. A matter that is " +
    "already closed is reported as not closable, with that as its blocker. The answer is a reading " +
    "of the present, never a guarantee: the close re-asserts every rule inside its own batch, so a " +
    "balance that moves in between is caught there.",
  request: { params: matterParam },
  responses: {
    200: {
      description: "Whether the matter can close, and what stands in the way",
      content: { "application/json": { schema: CloseReadiness } },
    },
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const patchMatterRoute = defineOpenAPIRoute(patchMatterMeta, {
  method: "patch",
  path: "/api/v1/matters/{id}",
  description:
    "Updates a matter's editable fields (title, description, type, Location, responsible member, " +
    "client display fields). Does not change status or the assigned number.",
  request: {
    headers: idempotencyKeyHeader,
    params: matterParam,
    body: { content: { "application/json": { schema: PatchMatterRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The matter was updated",
      content: { "application/json": { schema: StatusAck } },
    },
    400: idempotencyErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: idempotencyErrors[409],
    422: idempotencyErrors[422],
    429: authErrors[429],
  },
});

const openMatterRoute = defineOpenAPIRoute(openMatterMeta, {
  method: "post",
  path: "/api/v1/matters/{id}/open",
  description:
    "Opens a Prospective matter: draws the firm's next matter number atomically and transitions it to " +
    "open. Refuses a matter that is not Prospective.",
  request: { headers: idempotencyKeyHeader, params: matterParam },
  responses: {
    200: {
      description: "The matter was opened and numbered",
      content: { "application/json": { schema: OpenMatterResponse } },
    },
    400: idempotencyErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: idempotencyErrors[409],
    422: idempotencyErrors[422],
    429: authErrors[429],
  },
});

const closeMatterRoute = defineOpenAPIRoute(closeMatterMeta, {
  method: "post",
  path: "/api/v1/matters/{id}/close",
  description:
    "Closes a matter (archived-but-additive — it leaves active lists but still accepts documents). " +
    "Runs the close preconditions first; a matter whose client trust ledger still holds money, or " +
    "carries an active disputed-funds hold, is refused with the balance and the movements that " +
    "clear it. Refuses a matter that is already closed, so its recorded close date never moves. " +
    "The response also carries advisory notices — things worth knowing about the matter being " +
    "closed, such as physical originals the firm still holds against it. A notice never blocks a " +
    "close and never becomes a refusal; the matter in the response is closed.",
  request: { headers: idempotencyKeyHeader, params: matterParam },
  responses: {
    200: {
      description: "The matter was closed, with any advisory notices",
      content: { "application/json": { schema: CloseAck } },
    },
    400: idempotencyErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: {
      description:
        "A close precondition refused the matter, a request with this Idempotency-Key is still in progress, or the matter is already closed",
      content: { "application/problem+json": { schema: Problem } },
    },
    422: idempotencyErrors[422],
    429: authErrors[429],
  },
});

const reopenMatterRoute = defineOpenAPIRoute(reopenMatterMeta, {
  method: "post",
  path: "/api/v1/matters/{id}/reopen",
  description:
    "Reopens a closed matter, restoring its pre-close status (open if it was numbered, else " +
    "Prospective). The frozen number, if any, is untouched.",
  request: { headers: idempotencyKeyHeader, params: matterParam },
  responses: {
    200: {
      description: "The matter was reopened",
      content: { "application/json": { schema: StatusAck } },
    },
    400: idempotencyErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: idempotencyErrors[409],
    422: idempotencyErrors[422],
    429: authErrors[429],
  },
});

const renumberMatterRoute = defineOpenAPIRoute(renumberMatterMeta, {
  method: "post",
  path: "/api/v1/matters/{id}/renumber",
  description:
    "Assigns a manual/court/legacy matter number (never touches a counter). The number must be " +
    "URL-safe and unique within the firm.",
  request: {
    headers: idempotencyKeyHeader,
    params: matterParam,
    body: { content: { "application/json": { schema: RenumberRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The matter was renumbered",
      content: { "application/json": { schema: StatusAck } },
    },
    400: idempotencyErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: idempotencyErrors[409],
    422: idempotencyErrors[422],
    429: authErrors[429],
  },
});

type MattersApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

export function registerMattersRoutes(app: MattersApp, chokepoint: Chokepoint): void {
  // POST /api/v1/matters — create
  app.openapi(
    {
      ...createMatterRoute,
      middleware: chokepointMiddleware(chokepoint, createMatterRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const request = c.req.valid("json");
      const numberContext =
        request.status === "open"
          ? await assembleNumberContext(firm.firmDatabase, {
              locationId: request.locationId ?? null,
              matterTypeId: request.matterTypeId ?? null,
              clientCode: request.clientCode ?? null,
              clientDisplayName: request.clientDisplayName ?? null,
              responsibleMemberId: request.responsibleMemberId,
            })
          : undefined;
      try {
        const result = await createMatter(
          firm.firmDatabase,
          {
            title: request.title,
            status: request.status,
            description: request.description ?? null,
            matterTypeId: request.matterTypeId ?? null,
            locationId: request.locationId ?? null,
            responsibleMemberId: request.responsibleMemberId,
            clientDisplayName: request.clientDisplayName ?? null,
            clientCode: request.clientCode ?? null,
            numberContext,
          },
          { clock: serviceClock(), actorUserId: userId, idempotency },
        );
        if (result.idempotentReplay) c.header("Idempotency-Replayed", "true");
        return c.json(
          {
            matterId: result.matterId,
            matterNumber: result.matterNumber,
            consultationNumber: result.consultationNumber,
          } as z.infer<typeof CreateMatterResponse>,
          201,
        );
      } catch (caught) {
        if (caught instanceof MatterIdempotencyConflictError) {
          return problemResponseForIdempotencyConflict(c, caught);
        }
        if (caught instanceof MatterValidationError) return matterErrorResponse(c, caught);
        if (caught instanceof NumberingRenderError) return numberingRenderResponse(c, caught);
        throw caught;
      }
    },
  );

  // GET /api/v1/matters — list
  app.openapi(
    {
      ...listMattersRoute,
      middleware: chokepointMiddleware(chokepoint, listMattersRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const query = c.req.valid("query");
      const page = await listMatters(firm.firmDatabase, {
        status: query.status,
        matterTypeId: query.matterTypeId,
        locationId: query.locationId,
        responsibleMemberId: query.responsibleMemberId,
        search: query.search,
        cursor: query.cursor,
        pageSize: query.pageSize,
      });
      return c.json(page as unknown as z.infer<typeof MatterListResponse>, 200);
    },
  );

  // GET /api/v1/matters/consultations — the per-attorney Consultations view
  app.openapi(
    {
      ...listConsultationsRoute,
      middleware: chokepointMiddleware(chokepoint, listConsultationsRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const query = c.req.valid("query");
      const staleAgeDays = await readFirmSetting(
        firm.firmDatabase,
        staleConsultationAgeDaysDefinition,
      );
      const page = await listConsultations(firm.firmDatabase, {
        responsibleMemberId: userId,
        now: new Date().toISOString(),
        staleAgeDays,
        cursor: query.cursor,
        pageSize: query.pageSize,
      });
      return c.json(page as unknown as z.infer<typeof ConsultationListResponse>, 200);
    },
  );

  // GET /api/v1/matters/{id} — detail
  app.openapi(
    {
      ...getMatterRoute,
      middleware: chokepointMiddleware(chokepoint, getMatterRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      const { results } = await selectMatterDetailStatement(firm.firmDatabase, id).all<{
        id: MatterId;
        title: string;
        description: string | null;
        status: "prospective" | "open" | "closed";
        matter_type_id: string | null;
        location_id: string | null;
        responsible_member_id: string;
        client_display_name: string | null;
        client_code: string | null;
        matter_number: string | null;
        consultation_number: string | null;
        e_billing: number;
        opened_at: string | null;
        closed_at: string | null;
        created_at: string;
        matter_type_name: string | null;
        location_name: string | null;
        responsible_member_name: string | null;
      }>();
      const row = results[0];
      if (row === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such matter in this firm.",
        });
      }
      return c.json(
        {
          id: row.id,
          title: row.title,
          description: row.description,
          status: row.status,
          matterTypeId: row.matter_type_id,
          locationId: row.location_id,
          responsibleMemberId: row.responsible_member_id,
          clientDisplayName: row.client_display_name,
          clientCode: row.client_code,
          matterNumber: row.matter_number,
          consultationNumber: row.consultation_number,
          eBilling: row.e_billing !== 0,
          openedAt: row.opened_at,
          closedAt: row.closed_at,
          createdAt: row.created_at,
          matterTypeName: row.matter_type_name,
          locationName: row.location_name,
          responsibleMemberName: row.responsible_member_name,
        } as z.infer<typeof MatterDetail>,
        200,
      );
    },
  );

  // GET /api/v1/matters/{id}/close-readiness — would this close, if asked?
  app.openapi(
    {
      ...getMatterCloseReadinessRoute,
      middleware: chokepointMiddleware(chokepoint, getMatterCloseReadinessRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      const { results } = await selectMatterDetailStatement(firm.firmDatabase, id).all<{
        status: "prospective" | "open" | "closed";
      }>();
      const row = results[0];
      if (row === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such matter in this firm.",
        });
      }
      // A matter that is already closed is not closable, and saying so here rather than leaving it
      // to the caller keeps one definition of the word: the close refuses it for its own reason (a
      // recorded close date must never move), which is as real a blocker as a balance.
      const blockers =
        row.status === "closed"
          ? [
              {
                code: "matter-already-closed",
                message: `matter ${id} is already closed; its close date and events stand`,
              },
            ]
          : await runClosePreconditions(
              { matterId: id, database: firm.firmDatabase },
              CLOSE_PRECONDITIONS,
            );
      return c.json(
        {
          matterId: id,
          status: row.status,
          closable: blockers.length === 0,
          blockers: blockers.map((blocker) => ({ code: blocker.code, message: blocker.message })),
        } as z.infer<typeof CloseReadiness>,
        200,
      );
    },
  );

  // PATCH /api/v1/matters/{id} — update editable fields
  app.openapi(
    {
      ...patchMatterRoute,
      middleware: chokepointMiddleware(chokepoint, patchMatterRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const patch = c.req.valid("json");
      try {
        const result = await updateMatter(firm.firmDatabase, id, patch, {
          clock: serviceClock(),
          actorUserId: userId,
          idempotency,
        });
        if (result.idempotentReplay) c.header("Idempotency-Replayed", "true");
        return c.json({ matterId: id } as z.infer<typeof StatusAck>, 200);
      } catch (caught) {
        return mapMutationError(c, caught);
      }
    },
  );

  // POST /api/v1/matters/{id}/open
  app.openapi(
    {
      ...openMatterRoute,
      middleware: chokepointMiddleware(chokepoint, openMatterRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      try {
        const matter = await loadMatterFields(firm.firmDatabase, id);
        const numberContext =
          matter === undefined ? undefined : await assembleNumberContext(firm.firmDatabase, matter);
        const result = await openMatter(
          firm.firmDatabase,
          id,
          { numberContext },
          { clock: serviceClock(), actorUserId: userId, idempotency },
        );
        if (result.idempotentReplay) c.header("Idempotency-Replayed", "true");
        return c.json(
          {
            matterId: result.matterId,
            matterNumber: result.matterNumber,
          } as z.infer<typeof OpenMatterResponse>,
          200,
        );
      } catch (caught) {
        return mapMutationError(c, caught);
      }
    },
  );

  // POST /api/v1/matters/{id}/close
  app.openapi(
    {
      ...closeMatterRoute,
      middleware: chokepointMiddleware(chokepoint, closeMatterRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      try {
        const result = await closeMatter(firm.firmDatabase, id, {
          clock: serviceClock(),
          actorUserId: userId,
          idempotency,
          closePreconditions: CLOSE_PRECONDITIONS,
          closeAdvisories: CLOSE_ADVISORIES,
        });
        if (result.idempotentReplay) c.header("Idempotency-Replayed", "true");
        return c.json(
          { matterId: id, notices: [...result.notices] } as z.infer<typeof CloseAck>,
          200,
        );
      } catch (caught) {
        if (caught instanceof ClosePreconditionError) {
          return problemJson(c, {
            type: "matter-close-refused",
            title: "Matter cannot be closed yet",
            status: 409,
            detail: "One or more close preconditions refused this matter.",
            errors: caught.failures.map((failure) => ({
              path: "$",
              code: failure.code,
              detail: failure.message,
            })),
          });
        }
        return mapMutationError(c, caught);
      }
    },
  );

  // POST /api/v1/matters/{id}/reopen
  app.openapi(
    {
      ...reopenMatterRoute,
      middleware: chokepointMiddleware(chokepoint, reopenMatterRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      try {
        const result = await reopenMatter(firm.firmDatabase, id, {
          clock: serviceClock(),
          actorUserId: userId,
          idempotency,
        });
        if (result.idempotentReplay) c.header("Idempotency-Replayed", "true");
        return c.json({ matterId: id } as z.infer<typeof StatusAck>, 200);
      } catch (caught) {
        return mapMutationError(c, caught);
      }
    },
  );

  // POST /api/v1/matters/{id}/renumber
  app.openapi(
    {
      ...renumberMatterRoute,
      middleware: chokepointMiddleware(chokepoint, renumberMatterRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const { matterNumber } = c.req.valid("json");
      try {
        const result = await renumberMatter(firm.firmDatabase, id, matterNumber, {
          clock: serviceClock(),
          actorUserId: userId,
          idempotency,
        });
        if (result.idempotentReplay) c.header("Idempotency-Replayed", "true");
        return c.json({ matterId: id } as z.infer<typeof StatusAck>, 200);
      } catch (caught) {
        return mapMutationError(c, caught);
      }
    },
  );
}

// The shared catch for the lifecycle actions: idempotency conflict → 409/422, domain refusal → its
// mapped problem; anything else propagates to the standard error pipeline.
function mapMutationError(
  c: Context,
  caught: unknown,
): ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> {
  if (caught instanceof MatterIdempotencyConflictError) {
    return problemResponseForIdempotencyConflict(c, caught);
  }
  if (caught instanceof MatterValidationError) return matterErrorResponse(c, caught);
  if (caught instanceof NumberingRenderError) return numberingRenderResponse(c, caught);
  throw caught;
}

// Reads the fields the number draw assembles its context from, for the open action.
async function loadMatterFields(
  database: SqlDatabase,
  id: MatterId,
): Promise<
  | {
      locationId: LocationId | null;
      matterTypeId: MatterTypeId | null;
      clientCode: string | null;
      clientDisplayName: string | null;
      responsibleMemberId: UserId;
    }
  | undefined
> {
  const { results } = await selectMatterStatement(database, id).all<{
    location_id: LocationId | null;
    matter_type_id: MatterTypeId | null;
    client_code: string | null;
    client_display_name: string | null;
    responsible_member_id: UserId;
  }>();
  const row = results[0];
  if (row === undefined) return undefined;
  return {
    locationId: row.location_id,
    matterTypeId: row.matter_type_id,
    clientCode: row.client_code,
    clientDisplayName: row.client_display_name,
    responsibleMemberId: row.responsible_member_id,
  };
}
