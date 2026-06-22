import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import type { BatchDatabase, EffectWrite } from "@magna-carta/data-access/effect-batch";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { resolveScopedSetting } from "@magna-carta/data-access/scoped-setting-statements";
import {
  captureTimeEntry,
  updateDraftTimeEntry,
  submitTimeEntry,
  approveTimeEntry,
  kickBackTimeEntry,
  voidTimeEntry,
} from "@magna-carta/timekeeping/time-entry-service";
import { resolveRate } from "@magna-carta/timekeeping/rate-resolution";
import { roundDuration, computeAmountMinor } from "@magna-carta/timekeeping/rounding";
import {
  incrementMinutesDefinition,
  roundingDirectionDefinition,
} from "@magna-carta/timekeeping/settings";
import { parseQuickAdd } from "@magna-carta/timekeeping/quick-add-parser";
import { listTimeEntriesForTimekeeperDay } from "@magna-carta/timekeeping/queries";
import { TimeEntryValidationError } from "@magna-carta/timekeeping/time-entry-validation";
import type { TimeEntryId } from "@magna-carta/identifiers/types";
import type { Context } from "hono";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointUserId,
  requireChokepointIdempotency,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierField, identifierPathParam } from "../contracts/common.ts";
import { Problem, problemJson, type ProblemResponse } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../idempotency-conflict-problems.ts";

// Time entries: the work-in-progress store. The capture handler is the rate-resolution + duration-
// rounding site — it resolves the rate in force on the work date and rounds the raw minutes to the
// firm/timekeeper increment, then hands the resolved values to the timekeeping service which composes
// the insert + audit and returns the effect committed idempotently. Lifecycle review transitions
// (submit/approve/kick-back) require time:approve; every other mutation requires time:track. A billed
// or void row is frozen: the service throws a TimeEntryValidationError with code "frozen-entry",
// mapped to 409 here. quick-add-preview is a pure parse with no write (read-shaped POST, the
// numbering.preview precedent).

const TRACK = "time:track" as const;
const APPROVE = "time:approve" as const;

const CreateTimeEntryRequest = z
  .object({
    matterId: identifierField("matter"),
    timekeeperUserId: identifierField("user"),
    workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    rawDurationMinutes: z.number().int().positive(),
    narrative: z.string().min(1),
    billable: z.boolean(),
    nonBillableCategoryId: identifierField("nonBillableCategory").nullable().optional(),
    source: z.enum(["manual", "quick_add", "grid", "offline_sync"]),
    utbmsTaskCodeId: identifierField("utbmsCode").nullable().optional(),
    utbmsActivityCodeId: identifierField("utbmsCode").nullable().optional(),
    rateCardId: identifierField("rateCard").nullable().optional(),
    overrideRateE4: z.number().int().positive().nullable().optional(),
  })
  .openapi("CreateTimeEntryRequest");

const PatchTimeEntryRequest = z
  .object({
    narrative: z.string().min(1).optional(),
    rawDurationMinutes: z.number().int().positive().optional(),
    workDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    utbmsTaskCodeId: identifierField("utbmsCode").nullable().optional(),
    utbmsActivityCodeId: identifierField("utbmsCode").nullable().optional(),
  })
  .openapi("PatchTimeEntryRequest");

const KickBackRequest = z.object({ reason: z.string().min(1) }).openapi("KickBackRequest");

const QuickAddPreviewRequest = z
  .object({ text: z.string().min(1) })
  .openapi("QuickAddPreviewRequest");

const GridBatchRequest = z
  .object({ entries: z.array(CreateTimeEntryRequest).min(1).max(200) })
  .openapi("GridBatchRequest");

const TimeEntrySummary = z
  .object({
    id: z.string(),
    matterId: z.string(),
    timekeeperUserId: z.string(),
    workDate: z.string(),
    durationMinutes: z.number().int(),
    rawDurationMinutes: z.number().int(),
    narrative: z.string(),
    billable: z.boolean(),
    amountMinor: z.number().int().nullable(),
    currency: z.string(),
    status: z.enum(["draft", "submitted", "approved", "billed", "void"]),
  })
  .openapi("TimeEntrySummary");
const TimeEntryListResponse = z
  .object({ data: z.array(TimeEntrySummary) })
  .openapi("TimeEntryListResponse");

const QuickAddPreviewResponse = z
  .object({
    durationMinutes: z.number().int(),
    matterHint: z.string().nullable(),
    narrative: z.string(),
    candidates: z.array(z.object({ id: z.string(), title: z.string() })),
  })
  .openapi("QuickAddPreviewResponse");

const TimeEntryAck = z.object({ timeEntryId: z.string() }).openapi("TimeEntryAck");
const GridBatchAck = z.object({ timeEntryIds: z.array(z.string()) }).openapi("GridBatchAck");

const timeEntryParam = z.object({ id: identifierPathParam("timeEntry", "id") });

const listQuery = z.object({
  timekeeperUserId: identifierField("user").optional(),
  matterId: identifierField("matter").optional(),
  workDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  status: z.enum(["draft", "submitted", "approved", "billed", "void"]).optional(),
});

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
    description: "The session member lacks the required capability",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description: "The firm is unreachable, the member is deactivated, or the entry is unknown",
    content: { "application/problem+json": { schema: Problem } },
  },
  409: {
    description:
      "A request with this Idempotency-Key is in progress, the entry is frozen (billed or void), or the lifecycle transition is illegal",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description:
      "The request is invalid, the Idempotency-Key was reused with a different payload, or no rate could be resolved for a billable entry",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;
const writeErrorResponses = {
  400: authErrors[400],
  401: authErrors[401],
  403: authErrors[403],
  404: authErrors[404],
  409: authErrors[409],
  422: authErrors[422],
  429: authErrors[429],
} as const;
const readErrorResponses = {
  401: authErrors[401],
  403: authErrors[403],
  404: authErrors[404],
  429: authErrors[429],
} as const;

function writeMeta(operationId: string, permission: typeof TRACK | typeof APPROVE): RouteMeta {
  return {
    operationId,
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

const createMeta = writeMeta("timeEntries.create", TRACK);
const updateMeta = writeMeta("timeEntries.update", TRACK);
const voidMeta = writeMeta("timeEntries.void", TRACK);
const gridBatchMeta = writeMeta("timeEntries.gridBatch", TRACK);
const submitMeta = writeMeta("timeEntries.submit", APPROVE);
const approveMeta = writeMeta("timeEntries.approve", APPROVE);
const kickBackMeta = writeMeta("timeEntries.kickBack", APPROVE);
const listMeta: RouteMeta = {
  operationId: "timeEntries.list",
  surface: "app",
  authenticated: true,
  permission: TRACK,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};
const getMeta: RouteMeta = {
  operationId: "timeEntries.get",
  surface: "app",
  authenticated: true,
  permission: TRACK,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};
// A pure parse: read-shaped POST, no write, no audit (the numbering.preview precedent).
const previewMeta: RouteMeta = {
  operationId: "timeEntries.previewQuickAdd",
  surface: "app",
  authenticated: true,
  permission: TRACK,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const createRoute = defineOpenAPIRoute(createMeta, {
  method: "post",
  path: "/api/v1/time-entries",
  description:
    "Captures a time entry: resolves the rate in force on the work date, rounds the raw duration to the firm/timekeeper increment, and stores the work-in-progress row.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: CreateTimeEntryRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The time entry was captured",
      content: { "application/json": { schema: TimeEntryAck } },
    },
    400: writeErrorResponses[400],
    401: writeErrorResponses[401],
    403: writeErrorResponses[403],
    404: writeErrorResponses[404],
    409: writeErrorResponses[409],
    422: writeErrorResponses[422],
    429: writeErrorResponses[429],
  },
});

const listRoute = defineOpenAPIRoute(listMeta, {
  method: "get",
  path: "/api/v1/time-entries",
  description:
    "Lists time entries filtered by timekeeper and work date (the daily view) or by matter and status (the unbilled work-in-progress view).",
  request: { query: listQuery },
  responses: {
    200: {
      description: "The time entries",
      content: { "application/json": { schema: TimeEntryListResponse } },
    },
    401: readErrorResponses[401],
    403: readErrorResponses[403],
    404: readErrorResponses[404],
    429: readErrorResponses[429],
  },
});

const getRoute = defineOpenAPIRoute(getMeta, {
  method: "get",
  path: "/api/v1/time-entries/{id}",
  description: "Returns one time entry's detail.",
  request: { params: timeEntryParam },
  responses: {
    200: {
      description: "The time entry",
      content: { "application/json": { schema: TimeEntrySummary } },
    },
    401: readErrorResponses[401],
    403: readErrorResponses[403],
    404: readErrorResponses[404],
    429: readErrorResponses[429],
  },
});

const updateRoute = defineOpenAPIRoute(updateMeta, {
  method: "patch",
  path: "/api/v1/time-entries/{id}",
  description: "Updates a draft time entry. A billed or void entry is frozen and cannot be edited.",
  request: {
    headers: idempotencyKeyHeader,
    params: timeEntryParam,
    body: { content: { "application/json": { schema: PatchTimeEntryRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The time entry was updated",
      content: { "application/json": { schema: TimeEntryAck } },
    },
    400: writeErrorResponses[400],
    401: writeErrorResponses[401],
    403: writeErrorResponses[403],
    404: writeErrorResponses[404],
    409: writeErrorResponses[409],
    422: writeErrorResponses[422],
    429: writeErrorResponses[429],
  },
});

function transitionRoute(
  meta: RouteMeta,
  action: string,
  description: string,
  withBody?: z.ZodTypeAny,
) {
  return defineOpenAPIRoute(meta, {
    method: "post",
    path: `/api/v1/time-entries/{id}/${action}`,
    description,
    request: {
      headers: idempotencyKeyHeader,
      params: timeEntryParam,
      ...(withBody
        ? { body: { content: { "application/json": { schema: withBody } }, required: true } }
        : {}),
    },
    responses: {
      200: {
        description: "The transition was applied",
        content: { "application/json": { schema: TimeEntryAck } },
      },
      400: writeErrorResponses[400],
      401: writeErrorResponses[401],
      403: writeErrorResponses[403],
      404: writeErrorResponses[404],
      409: writeErrorResponses[409],
      422: writeErrorResponses[422],
      429: writeErrorResponses[429],
    },
  });
}
const submitRoute = transitionRoute(
  submitMeta,
  "submit",
  "Submits a draft entry for review (only when the firm's review gate is on).",
);
const approveRoute = transitionRoute(
  approveMeta,
  "approve",
  "Approves a submitted entry, making it billable.",
);
const kickBackRoute = defineOpenAPIRoute(kickBackMeta, {
  method: "post",
  path: "/api/v1/time-entries/{id}/kick-back",
  description: "Returns a submitted entry to draft with an audited reason.",
  request: {
    headers: idempotencyKeyHeader,
    params: timeEntryParam,
    body: { content: { "application/json": { schema: KickBackRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The transition was applied",
      content: { "application/json": { schema: TimeEntryAck } },
    },
    400: writeErrorResponses[400],
    401: writeErrorResponses[401],
    403: writeErrorResponses[403],
    404: writeErrorResponses[404],
    409: writeErrorResponses[409],
    422: writeErrorResponses[422],
    429: writeErrorResponses[429],
  },
});
const voidRoute = transitionRoute(
  voidMeta,
  "void",
  "Voids a time entry. The row freezes — it can no longer be edited or billed.",
);

const previewRoute = defineOpenAPIRoute(previewMeta, {
  method: "post",
  path: "/api/v1/time-entries/quick-add-preview",
  description:
    "Parses a one-line quick-add string into a duration, a matter hint, and a narrative, returning matching matters for the timekeeper to confirm. Writes nothing.",
  request: {
    body: { content: { "application/json": { schema: QuickAddPreviewRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The parsed candidate",
      content: { "application/json": { schema: QuickAddPreviewResponse } },
    },
    401: readErrorResponses[401],
    403: readErrorResponses[403],
    404: readErrorResponses[404],
    429: readErrorResponses[429],
  },
});

const gridBatchRoute = defineOpenAPIRoute(gridBatchMeta, {
  method: "post",
  path: "/api/v1/time-entries/grid-batch",
  description:
    "Captures a batch of time entries from the weekly grid in one request. Each entry resolves its rate and rounds its duration independently.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: GridBatchRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The batch was captured",
      content: { "application/json": { schema: GridBatchAck } },
    },
    400: writeErrorResponses[400],
    401: writeErrorResponses[401],
    403: writeErrorResponses[403],
    404: writeErrorResponses[404],
    409: writeErrorResponses[409],
    422: writeErrorResponses[422],
    429: writeErrorResponses[429],
  },
});

function timeEntryErrorResponse(
  c: Context,
  error: TimeEntryValidationError,
): ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> {
  if (error.code === "not-found") {
    return problemJson(c, {
      type: "not-found",
      title: "Not found",
      status: 404,
      detail: "No such time entry.",
    });
  }
  if (error.code === "frozen-entry" || error.code === "illegal-transition") {
    return problemJson(c, {
      type: "conflict",
      title: "The time entry cannot change",
      status: 409,
      detail: error.message,
    });
  }
  return problemJson(c, {
    type: "validation",
    title: "Invalid time-entry request",
    status: 422,
    detail: error.message,
  });
}

type TimeApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

// The rate-resolution + rounding site: resolves the billable rate in force on the work date from
// the precedence chain (override > matter > client > timekeeper > role > card_default), rounds the
// raw duration to the scope-resolved increment/direction, then returns the values captureTimeEntry
// stores. When no rateCardId is provided, the first non-archived card is tried (the common single-
// card firm scenario). A non-billable entry resolves to no rate and a null amount. Uses D1Database
// directly (the handler's firm.firmDatabase) so it can call .all() on the native statement.
async function resolveCaptureValues(
  database: D1Database,
  input: z.infer<typeof CreateTimeEntryRequest>,
) {
  const increment = await resolveScopedSetting(database, incrementMinutesDefinition, {
    matterId: input.matterId,
    userId: input.timekeeperUserId,
  });
  const direction = await resolveScopedSetting(database, roundingDirectionDefinition, {
    matterId: input.matterId,
    userId: input.timekeeperUserId,
  });
  const durationMinutes = roundDuration(input.rawDurationMinutes, increment, direction);

  if (!input.billable) {
    return { durationMinutes, rate: { noRate: true } as const, currency: "USD" };
  }

  // Resolve the rate card ID: explicit > first active card in the firm.
  let rateCardId: string | undefined = input.rateCardId ?? undefined;
  if (rateCardId === undefined) {
    const { results: cardRows } = await database
      .prepare("SELECT id FROM rate_card WHERE archived_at IS NULL ORDER BY created_at LIMIT 1")
      .all<{ id: string }>();
    rateCardId = cardRows[0]?.id;
  }

  const { results: memberRows } = await database
    .prepare("SELECT role_id FROM member_role WHERE member_user_id = ?1 LIMIT 1")
    .bind(input.timekeeperUserId)
    .all<{ role_id: string | null }>();

  const rate = await resolveRate(database, {
    matterId: input.matterId,
    clientId: null,
    timekeeperUserId: input.timekeeperUserId,
    roleId: memberRows[0]?.role_id ?? null,
    workDate: input.workDate,
    rateCardId,
    overrideE4: input.overrideRateE4 ?? undefined,
  });

  if ("noRate" in rate) {
    return { durationMinutes, rate, currency: "USD" };
  }

  const amountMinor = computeAmountMinor(rate.rateE4, durationMinutes, rate.currency);
  return {
    durationMinutes,
    rate: {
      rateE4: rate.rateE4,
      rateCardId: rate.rateCardId,
      rateSource: rate.rateSource,
      currency: rate.currency,
      amountMinor,
    },
    currency: rate.currency,
  };
}

// Row type read from the time_entry table for the list / get handlers.
interface TimeEntryRow {
  id: string;
  matter_id: string;
  timekeeper_user_id: string;
  work_date: string;
  duration_minutes: number;
  raw_duration_minutes: number;
  narrative: string;
  billable: number;
  amount_minor: number | null;
  currency: string;
  status: "draft" | "submitted" | "approved" | "billed" | "void";
}

function rowToSummary(row: TimeEntryRow) {
  return {
    id: row.id,
    matterId: row.matter_id,
    timekeeperUserId: row.timekeeper_user_id,
    workDate: row.work_date,
    durationMinutes: row.duration_minutes,
    rawDurationMinutes: row.raw_duration_minutes,
    narrative: row.narrative,
    billable: row.billable === 1,
    amountMinor: row.amount_minor,
    currency: row.currency,
    status: row.status,
  };
}

export function registerTimeEntriesRoutes(app: TimeApp, chokepoint: Chokepoint): void {
  // POST /api/v1/time-entries — capture
  app.openapi(
    { ...createRoute, middleware: chokepointMiddleware(chokepoint, createRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const request = c.req.valid("json");
      const now = () => new Date().toISOString();
      let result;
      try {
        const { durationMinutes, rate, currency } = await resolveCaptureValues(
          firm.firmDatabase,
          request,
        );
        result = await runIdempotentEffect({
          database: firm.firmDatabase,
          key: idempotency.key,
          fingerprint: idempotency.fingerprint,
          now,
          effect: async () => {
            const captured = await captureTimeEntry(
              firm.firmDatabase,
              {
                matterId: request.matterId,
                timekeeperUserId: request.timekeeperUserId,
                workDate: request.workDate,
                rawDurationMinutes: request.rawDurationMinutes,
                durationMinutes,
                narrative: request.narrative,
                billable: request.billable,
                nonBillableCategoryId: request.nonBillableCategoryId ?? undefined,
                source: request.source,
                utbmsTaskCodeId: request.utbmsTaskCodeId ?? undefined,
                utbmsActivityCodeId: request.utbmsActivityCodeId ?? undefined,
                rate,
                currency,
              },
              { clock: { now }, actorUserId: userId },
            );
            return {
              write: captured.effect,
              responseCode: 201,
              responseBody: canonicalJsonStringify({ timeEntryId: captured.timeEntryId }),
            };
          },
        });
      } catch (caught) {
        if (caught instanceof TimeEntryValidationError) return timeEntryErrorResponse(c, caught);
        throw caught;
      }
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
        return problemResponseForIdempotencyConflict(c, result);
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      return c.json(JSON.parse(result.responseBody ?? "{}") as z.infer<typeof TimeEntryAck>, 201);
    },
  );

  // GET /api/v1/time-entries — list (My-Day or per-matter shape)
  app.openapi(
    { ...listRoute, middleware: chokepointMiddleware(chokepoint, listRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const query = c.req.valid("query");

      if (query.timekeeperUserId !== undefined && query.workDate !== undefined) {
        // My-Day view: one timekeeper, one work date, newest first.
        const page = await listTimeEntriesForTimekeeperDay(firm.firmDatabase, {
          timekeeperUserId: query.timekeeperUserId,
          workDate: query.workDate,
        });
        // Map to the TimeEntrySummary shape (queries.ts Page uses readonly arrays; map to mutable).
        const data = page.data.map((item) => ({
          id: item.id,
          matterId: item.matterId,
          timekeeperUserId: item.timekeeperUserId,
          workDate: item.workDate,
          durationMinutes: item.durationMinutes,
          // listTimeEntriesForTimekeeperDay does not select raw_duration_minutes; default to duration.
          rawDurationMinutes: item.durationMinutes,
          narrative: item.narrative,
          billable: item.billable,
          amountMinor: item.amountMinor,
          currency: item.currency,
          status: item.status,
        }));
        return c.json({ data }, 200);
      }

      if (query.matterId !== undefined) {
        // Per-matter WIP view: individual entries for a matter, filtered by status.
        const statusFilter = query.status ?? "draft";
        const { results } = await firm.firmDatabase
          .prepare(
            "SELECT id, matter_id, timekeeper_user_id, work_date, duration_minutes, raw_duration_minutes, narrative, billable, amount_minor, currency, status FROM time_entry WHERE matter_id = ?1 AND status = ?2 ORDER BY work_date DESC, id DESC",
          )
          .bind(query.matterId, statusFilter)
          .all<TimeEntryRow>();
        return c.json({ data: results.map(rowToSummary) }, 200);
      }

      // No recognized filter — return an empty list rather than a full-table scan.
      return c.json({ data: [] as z.infer<typeof TimeEntrySummary>[] }, 200);
    },
  );

  // GET /api/v1/time-entries/{id} — detail
  app.openapi(
    { ...getRoute, middleware: chokepointMiddleware(chokepoint, getRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      const { results } = await firm.firmDatabase
        .prepare(
          "SELECT id, matter_id, timekeeper_user_id, work_date, duration_minutes, raw_duration_minutes, narrative, billable, amount_minor, currency, status FROM time_entry WHERE id = ?1",
        )
        .bind(id)
        .all<TimeEntryRow>();
      const row = results[0];
      if (row === undefined)
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such time entry in this firm.",
        });
      return c.json(rowToSummary(row), 200);
    },
  );

  // PATCH /api/v1/time-entries/{id} — update a draft
  app.openapi(
    { ...updateRoute, middleware: chokepointMiddleware(chokepoint, updateRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const patch = c.req.valid("json");
      const entryId = id as TimeEntryId;
      const outcome = await commitTimeEntryEffect(c, firm.firmDatabase, idempotency, entryId, () =>
        updateDraftTimeEntry(firm.firmDatabase, entryId, patch, {
          clock: { now: () => new Date().toISOString() },
          actorUserId: userId,
        }),
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ timeEntryId: outcome.id } as z.infer<typeof TimeEntryAck>, 200);
    },
  );

  // POST .../quick-add-preview must be registered BEFORE the /{id}/* transitions so Hono matches
  // the literal path segment "quick-add-preview" before the dynamic :id pattern.
  app.openapi(
    { ...previewRoute, middleware: chokepointMiddleware(chokepoint, previewRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { text } = c.req.valid("json");
      const parsed = parseQuickAdd(text);
      const candidates =
        parsed.matterHint === null
          ? { results: [] as { id: string; title: string }[] }
          : await firm.firmDatabase
              .prepare(
                "SELECT id, title FROM matter WHERE title LIKE ?1 AND status != 'prospective' ORDER BY title LIMIT 10",
              )
              .bind(`%${parsed.matterHint}%`)
              .all<{ id: string; title: string }>();
      return c.json(
        {
          durationMinutes: parsed.durationMinutes,
          matterHint: parsed.matterHint,
          narrative: parsed.narrative,
          candidates: candidates.results,
        },
        200,
      );
    },
  );

  // POST /api/v1/time-entries/grid-batch — bulk weekly-grid capture (registered before /{id}/*).
  app.openapi(
    { ...gridBatchRoute, middleware: chokepointMiddleware(chokepoint, gridBatchRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { entries } = c.req.valid("json");
      const now = () => new Date().toISOString();
      let result;
      try {
        const resolved = await Promise.all(
          entries.map((entry) => resolveCaptureValues(firm.firmDatabase, entry)),
        );
        result = await runIdempotentEffect({
          database: firm.firmDatabase,
          key: idempotency.key,
          fingerprint: idempotency.fingerprint,
          now,
          effect: async () => {
            const statements: EffectWrite["statements"][number][] = [];
            const outboxMessages: EffectWrite["outboxMessages"][number][] = [];
            const ids: string[] = [];
            for (let i = 0; i < entries.length; i++) {
              const entry = entries[i];
              const res = resolved[i];
              if (entry === undefined || res === undefined) continue;
              const captured = await captureTimeEntry(
                firm.firmDatabase,
                {
                  matterId: entry.matterId,
                  timekeeperUserId: entry.timekeeperUserId,
                  workDate: entry.workDate,
                  rawDurationMinutes: entry.rawDurationMinutes,
                  durationMinutes: res.durationMinutes,
                  narrative: entry.narrative,
                  billable: entry.billable,
                  nonBillableCategoryId: entry.nonBillableCategoryId ?? undefined,
                  source: "grid",
                  utbmsTaskCodeId: entry.utbmsTaskCodeId ?? undefined,
                  utbmsActivityCodeId: entry.utbmsActivityCodeId ?? undefined,
                  rate: res.rate,
                  currency: res.currency,
                },
                { clock: { now }, actorUserId: userId },
              );
              statements.push(...captured.effect.statements);
              outboxMessages.push(...captured.effect.outboxMessages);
              ids.push(captured.timeEntryId);
            }
            return {
              write: { statements, outboxMessages },
              responseCode: 201,
              responseBody: canonicalJsonStringify({ timeEntryIds: ids }),
            };
          },
        });
      } catch (caught) {
        if (caught instanceof TimeEntryValidationError) return timeEntryErrorResponse(c, caught);
        throw caught;
      }
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
        return problemResponseForIdempotencyConflict(c, result);
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      return c.json(JSON.parse(result.responseBody ?? "{}") as z.infer<typeof GridBatchAck>, 201);
    },
  );

  // POST .../{id}/submit | /approve | /kick-back | /void — lifecycle transitions.
  // submit/approve/kickBack are the review-gate API — they only make sense when the review gate is on.
  // Passing approvalRequired: true to the service enables the draft→submitted→approved path; the gate
  // setting itself is a product/UI concern (whether to surface the submit button), not a server guard.
  // void is always legal from any non-frozen state regardless of the gate.
  app.openapi(
    { ...submitRoute, middleware: chokepointMiddleware(chokepoint, submitRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const entryId = id as TimeEntryId;
      const outcome = await commitTimeEntryEffect(c, firm.firmDatabase, idempotency, entryId, () =>
        submitTimeEntry(firm.firmDatabase, entryId, {
          clock: { now: () => new Date().toISOString() },
          actorUserId: userId,
          approvalRequired: true,
        }),
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ timeEntryId: outcome.id } as z.infer<typeof TimeEntryAck>, 200);
    },
  );
  app.openapi(
    { ...approveRoute, middleware: chokepointMiddleware(chokepoint, approveRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const entryId = id as TimeEntryId;
      const outcome = await commitTimeEntryEffect(c, firm.firmDatabase, idempotency, entryId, () =>
        approveTimeEntry(firm.firmDatabase, entryId, {
          clock: { now: () => new Date().toISOString() },
          actorUserId: userId,
          approvalRequired: true,
        }),
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ timeEntryId: outcome.id } as z.infer<typeof TimeEntryAck>, 200);
    },
  );
  app.openapi(
    { ...kickBackRoute, middleware: chokepointMiddleware(chokepoint, kickBackRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const entryId = id as TimeEntryId;
      const { reason } = c.req.valid("json") as z.infer<typeof KickBackRequest>;
      const outcome = await commitTimeEntryEffect(c, firm.firmDatabase, idempotency, entryId, () =>
        kickBackTimeEntry(
          firm.firmDatabase,
          entryId,
          { reason },
          {
            clock: { now: () => new Date().toISOString() },
            actorUserId: userId,
            approvalRequired: true,
          },
        ),
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ timeEntryId: outcome.id } as z.infer<typeof TimeEntryAck>, 200);
    },
  );
  app.openapi(
    { ...voidRoute, middleware: chokepointMiddleware(chokepoint, voidRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const entryId = id as TimeEntryId;
      const outcome = await commitTimeEntryEffect(c, firm.firmDatabase, idempotency, entryId, () =>
        voidTimeEntry(firm.firmDatabase, entryId, {
          clock: { now: () => new Date().toISOString() },
          actorUserId: userId,
        }),
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ timeEntryId: outcome.id } as z.infer<typeof TimeEntryAck>, 200);
    },
  );
}

// The shared idempotent commit for an effect-returning time-entry mutation, mapping a frozen/illegal
// transition to 409 and an unknown entry to 404 — the locations commitLocationEffect shape.
type TimeEntryEffectOutcome =
  | { ok: true; id: string; replayed: boolean }
  | {
      ok: false;
      problem:
        | ProblemResponse<400>
        | ProblemResponse<404>
        | ProblemResponse<409>
        | ProblemResponse<422>;
    };

async function commitTimeEntryEffect(
  c: Context,
  database: BatchDatabase,
  idempotency: { key: string | undefined; fingerprint: string },
  id: TimeEntryId,
  call: () => Promise<{ effect: EffectWrite }>,
): Promise<TimeEntryEffectOutcome> {
  const now = () => new Date().toISOString();
  let result;
  try {
    result = await runIdempotentEffect({
      database,
      key: idempotency.key,
      fingerprint: idempotency.fingerprint,
      now,
      effect: async () => {
        const { effect } = await call();
        return {
          write: effect,
          responseCode: 200,
          responseBody: canonicalJsonStringify({ timeEntryId: id }),
        };
      },
    });
  } catch (caught) {
    if (caught instanceof TimeEntryValidationError)
      return { ok: false, problem: timeEntryErrorResponse(c, caught) };
    throw caught;
  }
  if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
    return { ok: false, problem: problemResponseForIdempotencyConflict(c, result) };
  const body = JSON.parse(result.responseBody ?? "{}") as { timeEntryId: string };
  return { ok: true, id: body.timeEntryId, replayed: result.kind === "replayed" };
}
