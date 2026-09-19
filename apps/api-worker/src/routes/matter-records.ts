import { CIVIL_DATE_PATTERN } from "@magna-carta/civil-time/civil-date";
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import {
  composeCreateMatterAssignment,
  composeEndMatterAssignment,
  pageMatterAssignments,
} from "@magna-carta/matters/matter-assignment";
import {
  composeSetMatterCourtCase,
  readMatterCourtCase,
} from "@magna-carta/matters/matter-court-case";
import {
  composeSetMatterEstate,
  ESTATE_PROCEEDING_TYPES,
  readMatterEstate,
} from "@magna-carta/matters/matter-estate";
import { MatterValidationError } from "@magna-carta/matters/validation";
import type { Context } from "hono";
import type { Bindings } from "../bindings.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierField, identifierPathParam } from "../contracts/common.ts";
import { cursorQuery, paginated } from "../contracts/pagination.ts";
import { Problem, problemJson, type ProblemResponse } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../idempotency-conflict-problems.ts";

// The matter's identity records beyond the shell: staffing assignments, the court-case record, and
// the estate record. Each is the Matters area's own table with the document engine as one consumer
// — caseload views, docketing, and conflicts imputation read the same rows — and each rides the
// matter's existing permissions: reads open to any authenticated member, writes under matters:edit.

// ---- contracts ----

const civilDate = z.string().regex(CIVIL_DATE_PATTERN);

const matterParam = z.object({ id: identifierPathParam("matter", "id") });

const AssignmentRecord = z
  .object({
    id: z.string(),
    matterId: z.string(),
    memberUserId: z.string(),
    assignmentRole: z.string(),
    validFrom: z.string().nullable(),
    validTo: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("MatterAssignmentRecord");

const AssignmentListResponse = paginated(AssignmentRecord).openapi("MatterAssignmentListResponse");

const CreateAssignmentRequest = z
  .object({
    memberUserId: identifierField("user"),
    assignmentRole: z
      .string()
      .min(1)
      .max(200)
      .openapi({
        description:
          "The working role — originating attorney, supervising attorney, billing attorney, " +
          "assigned paralegal, or the firm's own wording of one. Matched by its letters and digits, " +
          "so spelling and separators are free. The responsible attorney is refused here: that fact " +
          "lives on the matter itself.",
      }),
    validFrom: civilDate
      .nullable()
      .optional()
      .openapi({
        description:
          "The first day the assignment holds, as a civil date (YYYY-MM-DD), inclusive. Omit for an " +
          "assignment that starts open-ended.",
      }),
    validTo: civilDate
      .nullable()
      .optional()
      .openapi({
        description:
          "The last day the assignment holds, as a civil date (YYYY-MM-DD), inclusive — an " +
          "assignment through 2026-08-07 still staffs the matter for the whole of that day. Omit " +
          "for a current assignment; ending one later stamps the exact ending moment instead.",
      }),
  })
  .openapi("CreateMatterAssignmentRequest");

const AssignmentResponse = z.object({ id: z.string() }).openapi("MatterAssignmentResponse");

const CourtCaseFields = z
  .object({
    courtEntityId: z.string().nullable().openapi({
      description: "The court, as a Directory organisation — its name and identity live there.",
    }),
    judgeEntityId: z.string().nullable().openapi({
      description: "The assigned judge, as a Directory person.",
    }),
    caseNumber: z.string().max(200).nullable(),
    division: z.string().max(200).nullable(),
    department: z.string().max(200).nullable(),
    filedOn: civilDate.nullable(),
    clientDesignation: z.string().max(100).nullable().openapi({
      description: "What this court's caption calls the client's side — Plaintiff, Petitioner.",
    }),
    opposingDesignation: z.string().max(100).nullable().openapi({
      description: "What this court's caption calls the other side — Defendant, Respondent.",
    }),
  })
  .openapi("MatterCourtCaseFields");

// The record shape stays unnamed; the two named components derive from it. Naming the record once
// and reusing it nullable inside the read response would register one component name under two
// emitted shapes, which the contract conformance suite refuses.
const CourtCaseRecord = z
  .object({ id: z.string(), matterId: z.string() })
  .extend(CourtCaseFields.shape);

const CourtCaseResponse = CourtCaseRecord.openapi("MatterCourtCaseResponse");

const CourtCaseReadResponse = z
  .object({ courtCase: CourtCaseRecord.nullable() })
  .openapi("MatterCourtCaseReadResponse");

const EstateFields = z
  .object({
    decedentEntityId: z.string().nullable().openapi({
      description: "The decedent, as a Directory person — every name rendering reads from there.",
    }),
    estateEntityId: z
      .string()
      .nullable()
      .openapi({
        description:
          "The estate's own Directory organisation, where the firm keeps one — the home of the " +
          "estate's encrypted tax identifier.",
      }),
    dateOfDeath: civilDate.nullable(),
    estateStyle: z.string().max(500).nullable().openapi({
      description: "The estate's style exactly as the court has it — stored, never composed.",
    }),
    shortStyle: z.string().max(200).nullable(),
    proceedingType: z.enum(ESTATE_PROCEEDING_TYPES).nullable(),
    lettersIssuedOn: civilDate.nullable(),
  })
  .openapi("MatterEstateFields");

// Unnamed for the same reason the court-case record is.
const EstateRecord = z.object({ id: z.string(), matterId: z.string() }).extend(EstateFields.shape);

const EstateResponse = EstateRecord.openapi("MatterEstateResponse");

const EstateReadResponse = z
  .object({ estate: EstateRecord.nullable() })
  .openapi("MatterEstateReadResponse");

// ---- metas ----

function readMeta(operation: string): RouteMeta {
  return {
    operationId: `matters.${operation}`,
    surface: "app",
    authenticated: true,
    permission: null,
    resource: "matter",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  };
}

function editMeta(operation: string): RouteMeta {
  return {
    operationId: `matters.${operation}`,
    surface: "app",
    authenticated: true,
    permission: "matters:edit",
    resource: "matter",
    audited: true,
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

// ---- shared responses ----

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
    description: "The firm is unreachable, the member is deactivated, or the matter is unknown",
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

// ---- routes ----

const listAssignmentsRoute = defineOpenAPIRoute(readMeta("listAssignments"), {
  method: "get",
  path: "/api/v1/matters/{id}/assignments",
  description:
    "Lists the matter's staffing assignments, every recorded window included, a page at a time. " +
    "The responsible attorney is not among them: that fact lives on the matter record itself. " +
    "Ordered by role, then by when the window was recorded.",
  request: { params: matterParam, query: cursorQuery },
  responses: {
    200: {
      description: "The matter's assignments",
      content: { "application/json": { schema: AssignmentListResponse } },
    },
    401: authErrors[401],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const createAssignmentRoute = defineOpenAPIRoute(editMeta("createAssignment"), {
  method: "post",
  path: "/api/v1/matters/{id}/assignments",
  description:
    "Staffs a firm member onto the matter in a working role. A role that names the responsible " +
    "attorney is refused — edit the matter's responsible attorney instead, so that fact keeps one " +
    "home.",
  request: {
    headers: idempotencyKeyHeader,
    params: matterParam,
    body: { content: { "application/json": { schema: CreateAssignmentRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The assignment",
      content: { "application/json": { schema: AssignmentResponse } },
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

const endAssignmentRoute = defineOpenAPIRoute(editMeta("endAssignment"), {
  method: "post",
  path: "/api/v1/matters/{id}/assignments/{assignmentId}/end",
  description:
    "Ends an assignment: stamps its validity window closed and keeps the row — who carried a file, " +
    "and when, is the matter's own record and outlives the staffing.",
  request: {
    headers: idempotencyKeyHeader,
    params: z.object({
      id: identifierPathParam("matter", "id"),
      assignmentId: identifierPathParam("matterAssignment", "assignmentId"),
    }),
  },
  responses: {
    200: {
      description: "The assignment was ended",
      content: { "application/json": { schema: AssignmentResponse } },
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

const courtCaseReadRoute = defineOpenAPIRoute(readMeta("courtCase"), {
  method: "get",
  path: "/api/v1/matters/{id}/court-case",
  description:
    "Returns the matter's court-case record, or null for a matter that is not before a court — " +
    "which is an ordinary state, not an error.",
  request: { params: matterParam },
  responses: {
    200: {
      description: "The matter's court-case record, when one is recorded",
      content: { "application/json": { schema: CourtCaseReadResponse } },
    },
    401: authErrors[401],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const setCourtCaseRoute = defineOpenAPIRoute(editMeta("setCourtCase"), {
  method: "put",
  path: "/api/v1/matters/{id}/court-case",
  description:
    "Records or updates the matter's court-case identity: the court (a Directory organisation), " +
    "the judge (a Directory person), the case number, and the designation words this court's " +
    "captions use. One record per matter; its facts accrete as the case does.",
  request: {
    headers: idempotencyKeyHeader,
    params: matterParam,
    body: { content: { "application/json": { schema: CourtCaseFields } }, required: true },
  },
  responses: {
    200: {
      description: "The recorded court-case record",
      content: { "application/json": { schema: CourtCaseResponse } },
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

const estateReadRoute = defineOpenAPIRoute(readMeta("estate"), {
  method: "get",
  path: "/api/v1/matters/{id}/estate",
  description:
    "Returns the matter's estate record, or null for a matter that administers no estate — an " +
    "ordinary state, not an error.",
  request: { params: matterParam },
  responses: {
    200: {
      description: "The matter's estate record, when one is recorded",
      content: { "application/json": { schema: EstateReadResponse } },
    },
    401: authErrors[401],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const setEstateRoute = defineOpenAPIRoute(editMeta("setEstate"), {
  method: "put",
  path: "/api/v1/matters/{id}/estate",
  description:
    "Records or updates the estate a probate matter administers: the decedent (a Directory " +
    "person), the date of death, the estate's styles exactly as the court fixed them, the " +
    "proceeding type, and the letters-issued date. One record per matter.",
  request: {
    headers: idempotencyKeyHeader,
    params: matterParam,
    body: { content: { "application/json": { schema: EstateFields } }, required: true },
  },
  responses: {
    200: {
      description: "The recorded estate record",
      content: { "application/json": { schema: EstateResponse } },
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

// ---- helpers ----

function serviceClock() {
  return { now: () => new Date().toISOString() };
}

function matterRecordErrorResponse(
  c: Context,
  error: MatterValidationError,
): ProblemResponse<404> | ProblemResponse<422> {
  if (error.code === "matter-not-found") {
    return problemJson(c, {
      type: "not-found",
      title: "Not found",
      status: 404,
      detail: "No such record in this firm.",
    });
  }
  return problemJson(c, {
    type: "validation",
    title: "Matter record request invalid",
    status: 422,
    detail: error.message,
  });
}

type MatterRecordsApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

export function registerMatterRecordsRoutes(app: MatterRecordsApp, chokepoint: Chokepoint): void {
  // GET /api/v1/matters/{id}/assignments
  app.openapi(
    { ...listAssignmentsRoute, middleware: chokepointMiddleware(chokepoint, listAssignmentsRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      const { cursor } = c.req.valid("query");
      const page = await pageMatterAssignments(firm.firmDatabase, id, { cursor });
      return c.json(
        { data: [...page.data], nextCursor: page.nextCursor } as z.infer<
          typeof AssignmentListResponse
        >,
        200,
      );
    },
  );

  // POST /api/v1/matters/{id}/assignments
  app.openapi(
    {
      ...createAssignmentRoute,
      middleware: chokepointMiddleware(chokepoint, createAssignmentRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const request = c.req.valid("json");
      let result;
      try {
        result = await runIdempotentEffect({
          database: firm.firmDatabase,
          key: idempotency.key,
          fingerprint: idempotency.fingerprint,
          effect: async () => {
            const built = await composeCreateMatterAssignment(
              firm.firmDatabase,
              {
                matterId: id,
                memberUserId: request.memberUserId,
                assignmentRole: request.assignmentRole,
                validFrom: request.validFrom ?? null,
                validTo: request.validTo ?? null,
              },
              { clock: serviceClock(), actorUserId: userId },
            );
            return {
              write: { statements: built.statements, outboxMessages: [] },
              responseCode: 201,
              responseBody: canonicalJsonStringify({ id: built.assignmentId }),
            };
          },
        });
      } catch (caught) {
        if (caught instanceof MatterValidationError) return matterRecordErrorResponse(c, caught);
        throw caught;
      }
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
        return problemResponseForIdempotencyConflict(c, result);
      }
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      const body = JSON.parse(result.responseBody ?? "{}") as z.infer<typeof AssignmentResponse>;
      return c.json(body, 201);
    },
  );

  // POST /api/v1/matters/{id}/assignments/{assignmentId}/end
  app.openapi(
    { ...endAssignmentRoute, middleware: chokepointMiddleware(chokepoint, endAssignmentRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id, assignmentId } = c.req.valid("param");
      let result;
      try {
        result = await runIdempotentEffect({
          database: firm.firmDatabase,
          key: idempotency.key,
          fingerprint: idempotency.fingerprint,
          effect: async () => {
            const built = await composeEndMatterAssignment(firm.firmDatabase, id, assignmentId, {
              clock: serviceClock(),
              actorUserId: userId,
            });
            return {
              write: { statements: built.statements, outboxMessages: [] },
              responseCode: 200,
              responseBody: canonicalJsonStringify({ id: assignmentId }),
            };
          },
        });
      } catch (caught) {
        if (caught instanceof MatterValidationError) return matterRecordErrorResponse(c, caught);
        throw caught;
      }
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
        return problemResponseForIdempotencyConflict(c, result);
      }
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      const body = JSON.parse(result.responseBody ?? "{}") as z.infer<typeof AssignmentResponse>;
      return c.json(body, 200);
    },
  );

  // GET /api/v1/matters/{id}/court-case
  app.openapi(
    { ...courtCaseReadRoute, middleware: chokepointMiddleware(chokepoint, courtCaseReadRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      const record = await readMatterCourtCase(firm.firmDatabase, id);
      return c.json({ courtCase: record ?? null } as z.infer<typeof CourtCaseReadResponse>, 200);
    },
  );

  // PUT /api/v1/matters/{id}/court-case
  app.openapi(
    { ...setCourtCaseRoute, middleware: chokepointMiddleware(chokepoint, setCourtCaseRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const request = c.req.valid("json");
      let result;
      try {
        result = await runIdempotentEffect({
          database: firm.firmDatabase,
          key: idempotency.key,
          fingerprint: idempotency.fingerprint,
          effect: async () => {
            const built = await composeSetMatterCourtCase(firm.firmDatabase, id, request, {
              clock: serviceClock(),
              actorUserId: userId,
            });
            return {
              write: { statements: built.statements, outboxMessages: [] },
              responseCode: 200,
              responseBody: canonicalJsonStringify({
                id: built.courtCaseId,
                matterId: id,
                ...request,
              }),
            };
          },
        });
      } catch (caught) {
        if (caught instanceof MatterValidationError) return matterRecordErrorResponse(c, caught);
        throw caught;
      }
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
        return problemResponseForIdempotencyConflict(c, result);
      }
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      const body = JSON.parse(result.responseBody ?? "{}") as z.infer<typeof CourtCaseResponse>;
      return c.json(body, 200);
    },
  );

  // GET /api/v1/matters/{id}/estate
  app.openapi(
    { ...estateReadRoute, middleware: chokepointMiddleware(chokepoint, estateReadRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      const record = await readMatterEstate(firm.firmDatabase, id);
      return c.json({ estate: record ?? null } as z.infer<typeof EstateReadResponse>, 200);
    },
  );

  // PUT /api/v1/matters/{id}/estate
  app.openapi(
    { ...setEstateRoute, middleware: chokepointMiddleware(chokepoint, setEstateRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const request = c.req.valid("json");
      let result;
      try {
        result = await runIdempotentEffect({
          database: firm.firmDatabase,
          key: idempotency.key,
          fingerprint: idempotency.fingerprint,
          effect: async () => {
            const built = await composeSetMatterEstate(firm.firmDatabase, id, request, {
              clock: serviceClock(),
              actorUserId: userId,
            });
            return {
              write: { statements: built.statements, outboxMessages: [] },
              responseCode: 200,
              responseBody: canonicalJsonStringify({
                id: built.estateId,
                matterId: id,
                ...request,
              }),
            };
          },
        });
      } catch (caught) {
        if (caught instanceof MatterValidationError) return matterRecordErrorResponse(c, caught);
        throw caught;
      }
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
        return problemResponseForIdempotencyConflict(c, result);
      }
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      const body = JSON.parse(result.responseBody ?? "{}") as z.infer<typeof EstateResponse>;
      return c.json(body, 200);
    },
  );
}
