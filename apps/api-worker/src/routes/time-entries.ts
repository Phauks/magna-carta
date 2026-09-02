import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import type { BatchDatabase, EffectWrite } from "@magna-carta/data-access/effect-batch";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { resolveScopedSetting } from "@magna-carta/data-access/scoped-setting-statements";
import { readFirmSetting } from "@magna-carta/data-access/setting-statements";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import {
  captureTimeEntry,
  updateDraftTimeEntry,
  submitTimeEntry,
  approveTimeEntry,
  kickBackTimeEntry,
  voidTimeEntry,
} from "@magna-carta/timekeeping/time-entry-service";
import type { DraftPatch } from "@magna-carta/timekeeping/time-entry-statements";
import { cursorQuery, paginated } from "../contracts/pagination.ts";
import { resolveRate } from "@magna-carta/timekeeping/rate-resolution";
import { roundDuration, computeAmountMinor } from "@magna-carta/timekeeping/rounding";
import {
  incrementMinutesDefinition,
  roundingDirectionDefinition,
  approvalRequiredDefinition,
} from "@magna-carta/timekeeping/settings";
import { parseQuickAdd } from "@magna-carta/timekeeping/quick-add-parser";
import {
  listTimeEntriesForTimekeeperDay,
  listTimeEntriesByMatter,
  listTimeEntryEvents,
  readTimeEntryRecord,
  type TimeEntryRecordItem,
} from "@magna-carta/timekeeping/queries";
import {
  entryNumberAllocationStatement,
  entryNumberBlockOpenStatements,
  isEntryNumberConflict,
  planEntryNumberBlock,
  TIME_ENTRY_NUMBERING_TABLES,
  type EntryNumberBlockPlan,
} from "@magna-carta/timekeeping/entry-numbering";
import {
  attachFileToTimeEntry,
  detachFileFromTimeEntry,
  listTimeEntryAttachments,
} from "@magna-carta/timekeeping/time-entry-attachments";
import { drawWithBoundedRetry } from "@magna-carta/sequence-numbering/bounded-retry";
import { captureCost } from "@magna-carta/costs/cost-entry-service";
import { CostValidationError } from "@magna-carta/costs/cost-validation";
import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
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
import { assertPermission } from "@magna-carta/access-control/registry";
import { loadEffectivePermissions } from "../session-context.ts";

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
    taskId: identifierField("matterTask")
      .nullable()
      .optional()
      .openapi({
        description:
          "The task this time was worked on. Must be a task on this same matter: a task on " +
          "another matter, or on no matter at all, is refused. One task per entry — time that " +
          "served two tasks is recorded as two entries.",
      }),
    memo: z
      .string()
      .nullable()
      .optional()
      .openapi({
        description:
          "The firm's own note about the entry. Internal only: it never appears on a bill, a " +
          "print sheet, or the client portal, and the audit trail records that it changed, never " +
          "what it says.",
      }),
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
    taskId: identifierField("matterTask")
      .nullable()
      .optional()
      .openapi({
        description:
          "The task this time was worked on. Null unlinks it; absent leaves it unchanged. A task " +
          "named here must be on the entry's own matter.",
      }),
    memo: z.string().nullable().optional().openapi({
      description: "The firm-internal note. Null clears it; absent leaves it unchanged.",
    }),
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
    // The timekeeper's name, resolved through the member mirror. Null where the member row is
    // gone: an honest gap rather than a user_ handle standing in for a person.
    timekeeperName: z.string().nullable(),
    workDate: z.string(),
    // The billed (rounded) quantity; rawDurationMinutes is what was actually worked before
    // rounding. The two are served side by side so a screen can show both literacies.
    durationMinutes: z.number().int(),
    rawDurationMinutes: z.number().int(),
    narrative: z.string(),
    billable: z.boolean(),
    amountMinor: z.number().int().nullable(),
    currency: z.string(),
    // The rate snapshot frozen at capture (scale 4), with where it came from and which card
    // resolved it. All three null on non-billable internal time.
    rateE4: z.number().int().nullable(),
    rateSource: z
      .enum(["override", "matter", "client", "timekeeper", "role", "card_default"])
      .nullable(),
    rateCardId: z.string().nullable(),
    utbmsTaskCodeId: z.string().nullable(),
    utbmsTaskCode: z.string().nullable(),
    utbmsTaskLabel: z.string().nullable(),
    utbmsActivityCodeId: z.string().nullable(),
    utbmsActivityCode: z.string().nullable(),
    utbmsActivityLabel: z.string().nullable(),
    status: z.enum(["draft", "submitted", "approved", "billed", "void"]),
    source: z.enum(["timer", "manual", "quick_add", "grid", "offline_sync", "calendar"]),
    // The invoice a billed entry rides; null until billing locks the row.
    invoiceId: z.string().nullable(),
    // The task this time was worked on, when the timekeeper named one. Null on most entries.
    taskId: z.string().nullable(),
    // Firm-internal note; never client-facing.
    memo: z.string().nullable(),
    // The matter-scoped reference ("2026-0147.0042"), immutable and never reused. Null on entries
    // captured before the sequence existed — an honest gap, never a backfilled guess.
    entryNumber: z.string().nullable(),
    // When the entry was written down (distinct from workDate, the date the work was FOR), and by
    // whom — the enterer, which delegated capture makes a different person from the timekeeper.
    createdAt: z.string(),
    createdByUserId: z.string().nullable(),
    createdByName: z.string().nullable(),
    attachmentCount: z.number().int(),
  })
  .openapi("TimeEntrySummary");
const TimeEntryListResponse = paginated(TimeEntrySummary).openapi("TimeEntryListResponse");

const TimeEntryEventItem = z
  .object({
    at: z.string(),
    // The raw audit event string (e.g. "time_entry.captured", "time_entry.kicked_back").
    event: z.string(),
    actorUserId: z.string().nullable(),
    // Resolved through the member mirror; null for system events and departed members.
    actorName: z.string().nullable(),
    // The event's redacted metadata, passed through as recorded (null when the event carried none
    // — older writes recorded less, and those render as honest blanks).
    detail: z.unknown().nullable(),
  })
  .openapi("TimeEntryEventItem");
const TimeEntryEventsResponse = paginated(TimeEntryEventItem).openapi("TimeEntryEventsResponse");

const TimeEntryAttachmentItem = z
  .object({
    fileId: z.string(),
    // The file's CURRENT name, resolved at read time; null where the file row is gone.
    fileName: z.string().nullable(),
    createdAt: z.string(),
    createdByUserId: z.string().nullable(),
    createdByName: z.string().nullable(),
  })
  .openapi("TimeEntryAttachmentItem");
const TimeEntryAttachmentListResponse = z
  .object({ data: z.array(TimeEntryAttachmentItem) })
  .openapi("TimeEntryAttachmentListResponse");

const AttachTimeEntryFileRequest = z
  .object({ fileId: identifierField("file") })
  .openapi("AttachTimeEntryFileRequest");
const DetachTimeEntryFileRequest = z
  .object({ fileId: identifierField("file") })
  .openapi("DetachTimeEntryFileRequest");
const TimeEntryAttachmentAck = z
  .object({ timeEntryId: z.string(), fileId: z.string() })
  .openapi("TimeEntryAttachmentAck");

const ConvertToCostRequest = z
  .object({
    // A billable cost on an electronic-billing matter must carry a UTBMS expense code (the task
    // code on the time entry is not one), so the conversion accepts it here; without it such a
    // conversion is refused with the same 422 a direct cost capture gets.
    utbmsExpenseCodeId: identifierField("utbmsCode").nullable().optional(),
  })
  .openapi("ConvertToCostRequest");
const ConvertToCostAck = z
  .object({ costEntryId: z.string(), timeEntryId: z.string() })
  .openapi("ConvertToCostAck");

const QuickAddPreviewResponse = z
  .object({
    durationMinutes: z.number().int(),
    matterHint: z.string().nullable(),
    narrative: z.string(),
    candidates: z.array(z.object({ id: z.string(), title: z.string() })),
  })
  .openapi("QuickAddPreviewResponse");

const TimeEntryAck = z
  .object({
    timeEntryId: z.string(),
    // Present on capture, where the number is drawn; the lifecycle acks carry only the id.
    entryNumber: z.string().optional(),
  })
  .openapi("TimeEntryAck");
const GridBatchAck = z
  .object({
    timeEntryIds: z.array(z.string()),
    // Aligned with timeEntryIds, one drawn number per captured entry.
    entryNumbers: z.array(z.string()).optional(),
  })
  .openapi("GridBatchAck");

const timeEntryParam = z.object({ id: identifierPathParam("timeEntry", "id") });

const listQuery = z.object({
  timekeeperUserId: identifierField("user").optional(),
  matterId: identifierField("matter").optional(),
  workDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  status: z
    .enum(["draft", "submitted", "approved", "billed", "void"])
    .optional()
    .openapi({
      description:
        "Narrows a per-matter listing to one status. Omitted, the listing answers with every " +
        "status the matter carries, which is what a matter's time record is.",
    }),
  ...cursorQuery.shape,
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
const submitMeta = writeMeta("timeEntries.submit", TRACK);
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
const eventsMeta: RouteMeta = {
  operationId: "timeEntries.events",
  surface: "app",
  authenticated: true,
  permission: TRACK,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};
const listAttachmentsMeta: RouteMeta = {
  operationId: "timeEntries.listAttachments",
  surface: "app",
  authenticated: true,
  permission: TRACK,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};
const attachFileMeta = writeMeta("timeEntries.attachFile", TRACK);
const detachFileMeta = writeMeta("timeEntries.detachFile", TRACK);
const convertToCostMeta = writeMeta("timeEntries.convertToCost", TRACK);

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
    "Lists time entries filtered by timekeeper and work date (the daily view) or by matter and " +
    "status (the matter's own record). The per-matter listing is CURSOR-PAGED, newest work date " +
    "first: a matter that has been billing for years is not a single response, and this read " +
    "carried no bound at all until it was. The daily view is complete in one page by construction " +
    "— one timekeeper, one date — so its cursor is always null.",
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

const eventsRoute = defineOpenAPIRoute(eventsMeta, {
  method: "get",
  path: "/api/v1/time-entries/{id}/events",
  description:
    "Lists the entry's recorded audit events, OLDEST first — the order a history rail reads in: " +
    "captured, updated, submitted, approved, kicked back, voided, files attached and detached, " +
    "conversions. Each event carries its instant, its actor (id and resolved name), and the " +
    "redacted detail the write recorded — older writes recorded less, and those render as honest " +
    "blanks rather than guesses. CURSOR-PAGED: an entry worked over a week records an event per " +
    "edit, so the history grows with the work rather than with the lifecycle.",
  request: { params: timeEntryParam, query: cursorQuery },
  responses: {
    200: {
      description: "The entry's events",
      content: { "application/json": { schema: TimeEntryEventsResponse } },
    },
    401: readErrorResponses[401],
    403: readErrorResponses[403],
    404: readErrorResponses[404],
    429: readErrorResponses[429],
  },
});

const listAttachmentsRoute = defineOpenAPIRoute(listAttachmentsMeta, {
  method: "get",
  path: "/api/v1/time-entries/{id}/attachments",
  description:
    "Lists the files attached to the entry — references to documents in the entry's own matter, " +
    "oldest link first, with the attacher resolved.",
  request: { params: timeEntryParam },
  responses: {
    200: {
      description: "The entry's attachments",
      content: { "application/json": { schema: TimeEntryAttachmentListResponse } },
    },
    401: readErrorResponses[401],
    403: readErrorResponses[403],
    404: readErrorResponses[404],
    429: readErrorResponses[429],
  },
});

const attachFileRoute = defineOpenAPIRoute(attachFileMeta, {
  method: "post",
  path: "/api/v1/time-entries/{id}/attachments",
  description:
    "Attaches one of the matter's own files to the entry, by reference — no bytes move. A file on " +
    "another matter (or a deleted one) is refused: an entry can never point outside its own " +
    "matter's record.",
  request: {
    headers: idempotencyKeyHeader,
    params: timeEntryParam,
    body: {
      content: { "application/json": { schema: AttachTimeEntryFileRequest } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "The file was attached",
      content: { "application/json": { schema: TimeEntryAttachmentAck } },
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

const detachFileRoute = defineOpenAPIRoute(detachFileMeta, {
  method: "post",
  path: "/api/v1/time-entries/{id}/attachments/detach",
  description:
    "Detaches a file from the entry. Detaching is not deleting: the link goes, the file stays in " +
    "the matter, and both acts stay on the entry's audit trail.",
  request: {
    headers: idempotencyKeyHeader,
    params: timeEntryParam,
    body: {
      content: { "application/json": { schema: DetachTimeEntryFileRequest } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "The file was detached",
      content: { "application/json": { schema: TimeEntryAttachmentAck } },
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

const convertToCostRoute = defineOpenAPIRoute(convertToCostMeta, {
  method: "post",
  path: "/api/v1/time-entries/{id}/convert-to-cost",
  description:
    "Converts the entry into a cost: one act creates the cost entry carrying the entry's matter, " +
    "narrative and amount, and voids the time entry, so the value is never counted twice. Both " +
    "records' audit trails name each other. Refused for an entry that is billed, claimed by a " +
    "draft invoice, already void, or carrying no amount.",
  request: {
    headers: idempotencyKeyHeader,
    params: timeEntryParam,
    body: {
      content: { "application/json": { schema: ConvertToCostRequest } },
      required: true,
    },
  },
  responses: {
    201: {
      description: "The cost entry was created and the time entry voided",
      content: { "application/json": { schema: ConvertToCostAck } },
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
  if (error.code === "not-attached") {
    return problemJson(c, {
      type: "not-found",
      title: "Not found",
      status: 404,
      detail: error.message,
    });
  }
  if (
    error.code === "frozen-entry" ||
    error.code === "illegal-transition" ||
    error.code === "draft-only" ||
    error.code === "already-attached" ||
    error.code === "claimed-by-draft"
  ) {
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
// card firm scenario). A non-billable entry resolves to no rate and a null amount. Takes the firm's
// SqlDatabase (the handler's firm.firmDatabase) so it can call .all() on the prepared statement.
async function resolveCaptureValues(
  database: SqlDatabase,
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
  if (durationMinutes === 0) {
    throw new TimeEntryValidationError(
      "non-positive-duration",
      "the rounded duration is 0 minutes — the raw duration is shorter than the rounding increment with direction 'down'",
    );
  }

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

// Maps the shared record read (queries.ts) onto the wire summary — one mapper for the listings,
// the detail, and any handler that echoes an entry, so no surface can serve less than another.
function recordToSummary(item: TimeEntryRecordItem): z.infer<typeof TimeEntrySummary> {
  return {
    id: item.id,
    matterId: item.matterId,
    timekeeperUserId: item.timekeeperUserId,
    timekeeperName: item.timekeeperName,
    workDate: item.workDate,
    durationMinutes: item.durationMinutes,
    rawDurationMinutes: item.rawDurationMinutes,
    narrative: item.narrative,
    billable: item.billable,
    amountMinor: item.amountMinor,
    currency: item.currency,
    rateE4: item.rateE4,
    rateSource: item.rateSource as z.infer<typeof TimeEntrySummary>["rateSource"],
    rateCardId: item.rateCardId,
    utbmsTaskCodeId: item.utbmsTaskCodeId,
    utbmsTaskCode: item.utbmsTaskCode,
    utbmsTaskLabel: item.utbmsTaskLabel,
    utbmsActivityCodeId: item.utbmsActivityCodeId,
    utbmsActivityCode: item.utbmsActivityCode,
    utbmsActivityLabel: item.utbmsActivityLabel,
    status: item.status,
    source: item.source as z.infer<typeof TimeEntrySummary>["source"],
    invoiceId: item.invoiceId,
    taskId: item.taskId,
    memo: item.memo,
    entryNumber: item.entryNumber,
    createdAt: item.createdAt,
    createdByUserId: item.createdByUserId,
    createdByName: item.createdByName,
    attachmentCount: item.attachmentCount,
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

      // A timekeeper may only capture entries for themselves — creating on behalf of another
      // user is reserved for a supervisor role that does not exist yet.
      if (request.timekeeperUserId !== userId) {
        return problemJson(c, {
          type: "permission-denied",
          title: "Forbidden",
          status: 403,
          detail: "You may only capture time entries for yourself.",
        });
      }

      const now = () => new Date().toISOString();
      let result;
      try {
        const { durationMinutes, rate, currency } = await resolveCaptureValues(
          firm.firmDatabase,
          request,
        );
        // The entry-number draw wraps the idempotent effect (the matter-number arrangement): the
        // plan is read INSIDE the effect so a replayed request never draws, and a losing
        // concurrent draw aborts on the allocation primary key and retries with a fresh number.
        result = await drawWithBoundedRetry(
          firm.firmDatabase,
          TIME_ENTRY_NUMBERING_TABLES,
          {
            sequenceLabel: "time-entry number",
            alsoRetryable: isEntryNumberConflict,
            nonConvergenceError: ({ message }) => new Error(message),
          },
          async (observe) =>
            await runIdempotentEffect({
              database: firm.firmDatabase,
              key: idempotency.key,
              fingerprint: idempotency.fingerprint,
              now,
              effect: async () => {
                const plan = await planEntryNumberBlock(firm.firmDatabase, request.matterId, 1);
                observe({
                  scopeKey: plan.scopeKey,
                  observedValue: plan.observedValue,
                  startValue: plan.startValue,
                });
                const entryNumber = plan.numbers[0];
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
                    taskId: request.taskId ?? undefined,
                    memo: request.memo ?? undefined,
                    entryNumber,
                    rate,
                    currency,
                  },
                  { clock: { now }, actorUserId: userId },
                );
                return {
                  write: {
                    statements: [
                      ...entryNumberBlockOpenStatements(firm.firmDatabase, plan),
                      ...captured.effect.statements,
                      // Last: time_entry_id is a foreign key, so the entry row must exist first.
                      entryNumberAllocationStatement(
                        firm.firmDatabase,
                        plan,
                        0,
                        captured.timeEntryId,
                        now(),
                      ),
                    ],
                    outboxMessages: captured.effect.outboxMessages,
                  },
                  responseCode: 201,
                  responseBody: canonicalJsonStringify({
                    timeEntryId: captured.timeEntryId,
                    ...(entryNumber === undefined ? {} : { entryNumber }),
                  }),
                };
              },
            }),
        );
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
      const sessionUserId = requireChokepointUserId(c);
      const query = c.req.valid("query");

      if (query.timekeeperUserId !== undefined && query.workDate !== undefined) {
        // My-Day view: one timekeeper, one work date, newest first.
        // A timekeeper may only list their own daily entries unless they hold time:viewFirm.
        if (query.timekeeperUserId !== sessionUserId) {
          const permissions = await loadEffectivePermissions(firm.firmDatabase, sessionUserId);
          if (!permissions.has(assertPermission("time:viewFirm"))) {
            return problemJson(c, {
              type: "permission-denied",
              title: "Forbidden",
              status: 403,
              detail:
                "Listing another timekeeper's daily entries requires the time:viewFirm capability.",
            });
          }
        }
        const page = await listTimeEntriesForTimekeeperDay(firm.firmDatabase, {
          timekeeperUserId: query.timekeeperUserId,
          workDate: query.workDate,
        });
        // One timekeeper on one date is a complete answer by construction, so the page is the whole
        // record and the cursor is null rather than absent — the envelope is uniform.
        return c.json({ data: page.data.map(recordToSummary), nextCursor: null }, 200);
      }

      if (query.matterId !== undefined) {
        // Per-matter listing. An absent status means EVERY status: a matter's time record is all
        // of the time on it, and a caller that wanted only the work in progress says so. This
        // defaulted to "draft" and answered a narrower question than it was asked, silently -- the
        // approved, billed and voided entries on the matter simply did not appear, and nothing in
        // the contract said they would not.
        const page = await listTimeEntriesByMatter(firm.firmDatabase, {
          matterId: query.matterId,
          ...(query.status === undefined ? {} : { status: query.status }),
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        });
        return c.json({ nextCursor: page.nextCursor, data: page.data.map(recordToSummary) }, 200);
      }

      // No recognized filter — return an empty list rather than a full-table scan.
      return c.json({ data: [] as z.infer<typeof TimeEntrySummary>[], nextCursor: null }, 200);
    },
  );

  // GET /api/v1/time-entries/{id} — detail, through the same record read the listings use.
  app.openapi(
    { ...getRoute, middleware: chokepointMiddleware(chokepoint, getRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      const record = await readTimeEntryRecord(firm.firmDatabase, id);
      if (record === undefined)
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such time entry in this firm.",
        });
      return c.json(recordToSummary(record), 200);
    },
  );

  // GET /api/v1/time-entries/{id}/events — the entry's recorded history, oldest first.
  app.openapi(
    { ...eventsRoute, middleware: chokepointMiddleware(chokepoint, eventsRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      // 404 for an unknown entry rather than an empty rail — an absent record and a record with
      // no history are different answers.
      const record = await readTimeEntryRecord(firm.firmDatabase, id);
      if (record === undefined)
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such time entry in this firm.",
        });
      const { cursor } = c.req.valid("query");
      const page = await listTimeEntryEvents(
        firm.firmDatabase,
        id,
        cursor === undefined ? {} : { cursor },
      );
      return c.json(
        {
          nextCursor: page.nextCursor,
          data: page.data.map((event) => ({
            at: event.at,
            event: event.event,
            actorUserId: event.actorUserId,
            actorName: event.actorName,
            // The stored metadata is redacted JSON written by this platform; parse it back into
            // the object the writer recorded. A row that carried none passes through as null.
            detail:
              event.metadataJson === null ? null : (JSON.parse(event.metadataJson) as unknown),
          })),
        } as z.infer<typeof TimeEntryEventsResponse>,
        200,
      );
    },
  );

  // GET /api/v1/time-entries/{id}/attachments — the entry's attached files.
  app.openapi(
    { ...listAttachmentsRoute, middleware: chokepointMiddleware(chokepoint, listAttachmentsRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      const record = await readTimeEntryRecord(firm.firmDatabase, id);
      if (record === undefined)
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such time entry in this firm.",
        });
      const attachments = await listTimeEntryAttachments(firm.firmDatabase, id as TimeEntryId);
      return c.json({ data: attachments } as z.infer<typeof TimeEntryAttachmentListResponse>, 200);
    },
  );

  // POST /api/v1/time-entries/{id}/attachments — attach one of the matter's files by reference.
  app.openapi(
    { ...attachFileRoute, middleware: chokepointMiddleware(chokepoint, attachFileRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const { fileId } = c.req.valid("json");
      const entryId = id as TimeEntryId;
      const now = () => new Date().toISOString();
      let result;
      try {
        result = await runIdempotentEffect({
          database: firm.firmDatabase,
          key: idempotency.key,
          fingerprint: idempotency.fingerprint,
          now,
          effect: async () => {
            const { effect } = await attachFileToTimeEntry(firm.firmDatabase, entryId, fileId, {
              clock: { now },
              actorUserId: userId,
            });
            return {
              write: effect,
              responseCode: 200,
              responseBody: canonicalJsonStringify({ timeEntryId: entryId, fileId }),
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
      return c.json(
        JSON.parse(result.responseBody ?? "{}") as z.infer<typeof TimeEntryAttachmentAck>,
        200,
      );
    },
  );

  // POST /api/v1/time-entries/{id}/attachments/detach — remove the link, keep the file.
  app.openapi(
    { ...detachFileRoute, middleware: chokepointMiddleware(chokepoint, detachFileRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const { fileId } = c.req.valid("json");
      const entryId = id as TimeEntryId;
      const now = () => new Date().toISOString();
      let result;
      try {
        result = await runIdempotentEffect({
          database: firm.firmDatabase,
          key: idempotency.key,
          fingerprint: idempotency.fingerprint,
          now,
          effect: async () => {
            const { effect } = await detachFileFromTimeEntry(firm.firmDatabase, entryId, fileId, {
              clock: { now },
              actorUserId: userId,
            });
            return {
              write: effect,
              responseCode: 200,
              responseBody: canonicalJsonStringify({ timeEntryId: entryId, fileId }),
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
      return c.json(
        JSON.parse(result.responseBody ?? "{}") as z.infer<typeof TimeEntryAttachmentAck>,
        200,
      );
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

      // Pre-flight ownership check: also reads the fields required for workDate re-resolution
      // so only one DB round-trip is needed before the effect. Treat a non-owned entry as not-found
      // to avoid leaking existence to a caller who does not own the entry.
      const ownerRow = await firm.firmDatabase
        .prepare(
          "SELECT timekeeper_user_id, matter_id, billable, rate_card_id, duration_minutes FROM time_entry WHERE id = ?1",
        )
        .bind(entryId)
        .first<{
          timekeeper_user_id: string;
          matter_id: string;
          billable: number;
          rate_card_id: string | null;
          duration_minutes: number;
        }>();
      if (ownerRow === null) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such time entry.",
        });
      }
      if (ownerRow.timekeeper_user_id !== userId) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such time entry.",
        });
      }

      // When the patch changes workDate, re-resolve the rate for the new date so the stored
      // rate snapshot stays accurate. This requires the entry's matter, timekeeper, billable
      // flag, and role (for the precedence chain) — all read from the pre-flight row above.
      let enrichedPatch: DraftPatch = patch;
      if (patch.workDate !== undefined) {
        const { results: memberRows } = await firm.firmDatabase
          .prepare("SELECT role_id FROM member_role WHERE member_user_id = ?1 LIMIT 1")
          .bind(ownerRow.timekeeper_user_id)
          .all<{ role_id: string | null }>();

        const resolved = await resolveRate(firm.firmDatabase, {
          matterId: ownerRow.matter_id,
          clientId: null,
          timekeeperUserId: ownerRow.timekeeper_user_id,
          roleId: memberRows[0]?.role_id ?? null,
          workDate: patch.workDate,
          rateCardId: ownerRow.rate_card_id ?? undefined,
        });

        const isBillable = ownerRow.billable === 1;
        if (isBillable && !("noRate" in resolved)) {
          const amountMinor = computeAmountMinor(
            resolved.rateE4,
            ownerRow.duration_minutes,
            resolved.currency,
          );
          enrichedPatch = {
            ...patch,
            rateE4: resolved.rateE4,
            rateCardId: resolved.rateCardId,
            rateSource: resolved.rateSource,
            amountMinor,
          };
        } else if (isBillable && "noRate" in resolved) {
          enrichedPatch = {
            ...patch,
            rateE4: null,
            rateCardId: null,
            rateSource: null,
            amountMinor: null,
          };
        }
      }

      const outcome = await commitTimeEntryEffect(c, firm.firmDatabase, idempotency, entryId, () =>
        updateDraftTimeEntry(firm.firmDatabase, entryId, enrichedPatch, {
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
                "SELECT id, title FROM matter WHERE title LIKE ?1 ESCAPE '\\' AND status != 'prospective' ORDER BY title LIMIT 10",
              )
              .bind(`%${parsed.matterHint.replace(/[%_\\]/g, "\\$&")}%`)
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

      // Fail-fast before any rate resolution: every entry in the batch must belong to the
      // session user. Accepting a foreign timekeeperUserId would let one timekeeper silently
      // post time against another's record.
      for (const entry of entries) {
        if (entry.timekeeperUserId !== userId) {
          return problemJson(c, {
            type: "permission-denied",
            title: "Forbidden",
            status: 403,
            detail: "You may only capture time entries for yourself.",
          });
        }
      }

      const now = () => new Date().toISOString();
      let result;
      try {
        const resolved = await Promise.all(
          entries.map((entry) => resolveCaptureValues(firm.firmDatabase, entry)),
        );
        // Entry numbers are drawn as one BLOCK per matter: one counter read, consecutive values,
        // one guarded increment by the block size. The bounded retry re-runs the whole effect on a
        // losing concurrent draw, so the batch re-renders fresh numbers.
        result = await drawWithBoundedRetry(
          firm.firmDatabase,
          TIME_ENTRY_NUMBERING_TABLES,
          {
            sequenceLabel: "time-entry number",
            alsoRetryable: isEntryNumberConflict,
            nonConvergenceError: ({ message }) => new Error(message),
          },
          async (observe) =>
            await runIdempotentEffect({
              database: firm.firmDatabase,
              key: idempotency.key,
              fingerprint: idempotency.fingerprint,
              now,
              effect: async () => {
                // Plan one number block per distinct matter, sized to how many of the batch's
                // entries land on it, preserving the batch's own order within each matter.
                const blockSizes = new Map<string, number>();
                for (const entry of entries) {
                  blockSizes.set(entry.matterId, (blockSizes.get(entry.matterId) ?? 0) + 1);
                }
                const plans = new Map<string, { plan: EntryNumberBlockPlan; used: number }>();
                for (const [matterId, count] of blockSizes) {
                  const plan = await planEntryNumberBlock(firm.firmDatabase, matterId, count);
                  plans.set(matterId, { plan, used: 0 });
                }
                // The retry's out-of-band advance can carry one scope; the first is as good as
                // any — a lost draw re-reads every counter fresh on the next attempt regardless.
                const firstPlan = [...plans.values()][0]?.plan;
                if (firstPlan !== undefined) {
                  observe({
                    scopeKey: firstPlan.scopeKey,
                    observedValue: firstPlan.observedValue,
                    startValue: firstPlan.startValue,
                  });
                }

                const statements: EffectWrite["statements"][number][] = [];
                const allocationStatements: EffectWrite["statements"][number][] = [];
                const outboxMessages: EffectWrite["outboxMessages"][number][] = [];
                const ids: string[] = [];
                const numbers: string[] = [];
                for (const { plan } of plans.values()) {
                  statements.push(...entryNumberBlockOpenStatements(firm.firmDatabase, plan));
                }
                for (let i = 0; i < entries.length; i++) {
                  const entry = entries[i];
                  const res = resolved[i];
                  if (entry === undefined || res === undefined) continue;
                  const held = plans.get(entry.matterId);
                  const blockIndex = held?.used ?? 0;
                  if (held !== undefined) held.used += 1;
                  const entryNumber = held?.plan.numbers[blockIndex];
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
                      taskId: entry.taskId ?? undefined,
                      memo: entry.memo ?? undefined,
                      entryNumber,
                      rate: res.rate,
                      currency: res.currency,
                    },
                    { clock: { now }, actorUserId: userId },
                  );
                  statements.push(...captured.effect.statements);
                  if (held !== undefined) {
                    allocationStatements.push(
                      entryNumberAllocationStatement(
                        firm.firmDatabase,
                        held.plan,
                        blockIndex,
                        captured.timeEntryId,
                        now(),
                      ),
                    );
                  }
                  outboxMessages.push(...captured.effect.outboxMessages);
                  ids.push(captured.timeEntryId);
                  if (entryNumber !== undefined) numbers.push(entryNumber);
                }
                return {
                  // Allocations last: every entry row they reference exists by then.
                  write: { statements: [...statements, ...allocationStatements], outboxMessages },
                  responseCode: 201,
                  responseBody: canonicalJsonStringify({
                    timeEntryIds: ids,
                    entryNumbers: numbers,
                  }),
                };
              },
            }),
        );
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

      // Ownership pre-check: treat a non-owned entry as not-found to avoid leaking existence.
      if (!(await ownsEntry(firm.firmDatabase, entryId, userId))) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such time entry.",
        });
      }

      const approvalRequired = await readFirmSetting(firm.firmDatabase, approvalRequiredDefinition);
      const outcome = await commitTimeEntryEffect(c, firm.firmDatabase, idempotency, entryId, () =>
        submitTimeEntry(firm.firmDatabase, entryId, {
          clock: { now: () => new Date().toISOString() },
          actorUserId: userId,
          approvalRequired,
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
      // approve is a cross-user reviewer action: no self-scope guard applied here.
      const approvalRequired = await readFirmSetting(firm.firmDatabase, approvalRequiredDefinition);
      const outcome = await commitTimeEntryEffect(c, firm.firmDatabase, idempotency, entryId, () =>
        approveTimeEntry(firm.firmDatabase, entryId, {
          clock: { now: () => new Date().toISOString() },
          actorUserId: userId,
          approvalRequired,
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
      // kickBack is a cross-user reviewer action: no self-scope guard applied here.
      const approvalRequired = await readFirmSetting(firm.firmDatabase, approvalRequiredDefinition);
      const outcome = await commitTimeEntryEffect(c, firm.firmDatabase, idempotency, entryId, () =>
        kickBackTimeEntry(
          firm.firmDatabase,
          entryId,
          { reason },
          {
            clock: { now: () => new Date().toISOString() },
            actorUserId: userId,
            approvalRequired,
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

      // Ownership pre-check: treat a non-owned entry as not-found to avoid leaking existence.
      if (!(await ownsEntry(firm.firmDatabase, entryId, userId))) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such time entry.",
        });
      }

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

  // POST /api/v1/time-entries/{id}/convert-to-cost — one act: create the cost, void the entry.
  // Time is WIP, not a ledger posting, and so is a cost — the conversion moves value between the
  // two work-in-progress stores and touches no ledger. The void in the same batch is what keeps
  // the value from ever being counted twice; both audit trails name the other record.
  app.openapi(
    { ...convertToCostRoute, middleware: chokepointMiddleware(chokepoint, convertToCostRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const { utbmsExpenseCodeId } = c.req.valid("json");
      const entryId = id as TimeEntryId;

      // The chokepoint enforces time:track; the same act also creates a cost row, so the actor
      // must hold costs:track as well — a conversion is not a way around the cost capture gate.
      const permissions = await loadEffectivePermissions(firm.firmDatabase, userId);
      if (!permissions.has(assertPermission("costs:track"))) {
        return problemJson(c, {
          type: "permission-denied",
          title: "Forbidden",
          status: 403,
          detail: "Converting an entry to a cost requires the costs:track capability.",
        });
      }

      const now = () => new Date().toISOString();
      let result;
      try {
        // Pre-reads produce the named refusals; the freeze-guarded void statement in the batch is
        // the concurrency backstop behind them.
        const { results: entryRows } = await firm.firmDatabase
          .prepare(
            "SELECT matter_id, narrative, billable, amount_minor, currency, status, invoice_id, work_date FROM time_entry WHERE id = ?1",
          )
          .bind(entryId)
          .all<{
            matter_id: string;
            narrative: string;
            billable: number;
            amount_minor: number | null;
            currency: string;
            status: "draft" | "submitted" | "approved" | "billed" | "void";
            invoice_id: string | null;
            work_date: string;
          }>();
        const entry = entryRows[0];
        if (entry === undefined) {
          throw new TimeEntryValidationError("not-found", `no such time entry: ${entryId}`);
        }
        if (entry.status === "billed" || entry.status === "void" || entry.invoice_id !== null) {
          throw new TimeEntryValidationError(
            "frozen-entry",
            `time entry ${entryId} is ${entry.status} and cannot convert — a billed entry is evidence on a bill, and a void entry already carries no value`,
          );
        }
        // An entry a draft invoice has claimed is spoken for: voiding it out from under the draft
        // would leave the bill charging a voided row. Release the claim first.
        const { results: claimRows } = await firm.firmDatabase
          .prepare(
            "SELECT 1 AS present FROM invoice_wip_claim WHERE source_kind = 'time_entry' AND source_id = ?1 AND released_at IS NULL",
          )
          .bind(entryId)
          .all<{ present: number }>();
        if (claimRows[0] !== undefined) {
          throw new TimeEntryValidationError(
            "claimed-by-draft",
            "a draft invoice has claimed this entry — release the claim before converting it",
          );
        }
        if (entry.amount_minor === null) {
          throw new TimeEntryValidationError(
            "no-amount",
            "this entry carries no amount, and a cost is an amount — resolve a rate (or re-rate) before converting",
          );
        }
        const amountMinor = entry.amount_minor;

        result = await runIdempotentEffect({
          database: firm.firmDatabase,
          key: idempotency.key,
          fingerprint: idempotency.fingerprint,
          now,
          effect: async () => {
            const serviceOptions = { clock: { now }, actorUserId: userId };
            const cost = await captureCost(
              firm.firmDatabase,
              {
                matterId: entry.matter_id,
                incurredDate: entry.work_date,
                amountMinor,
                currency: entry.currency,
                // The hard/soft classification is a required column the cost store still carries;
                // converted professional time is no third-party outlay, which is the soft class.
                disbursementClass: "soft",
                billable: entry.billable === 1,
                utbmsExpenseCodeId: utbmsExpenseCodeId ?? undefined,
                description: entry.narrative,
                source: "manual",
              },
              serviceOptions,
            );
            const voided = await voidTimeEntry(firm.firmDatabase, entryId, serviceOptions);
            return {
              write: {
                statements: [
                  ...cost.effect.statements,
                  // The cross-references: each record's trail names the other, ids only.
                  domainAuditStatement(firm.firmDatabase, {
                    event: "cost_entry.converted_from_time_entry",
                    subjectId: cost.costEntryId,
                    actorUserId: userId,
                    clock: { now },
                    metadata: { timeEntryId: entryId },
                  }),
                  ...voided.effect.statements,
                  domainAuditStatement(firm.firmDatabase, {
                    event: "time_entry.converted_to_cost",
                    subjectId: entryId,
                    actorUserId: userId,
                    clock: { now },
                    metadata: { costEntryId: cost.costEntryId },
                  }),
                ],
                outboxMessages: [...cost.effect.outboxMessages, ...voided.effect.outboxMessages],
              },
              responseCode: 201,
              responseBody: canonicalJsonStringify({
                costEntryId: cost.costEntryId,
                timeEntryId: entryId,
              }),
            };
          },
        });
      } catch (caught) {
        if (caught instanceof TimeEntryValidationError) return timeEntryErrorResponse(c, caught);
        if (caught instanceof CostValidationError) {
          return problemJson(c, {
            type: "validation",
            title: "The entry cannot become this cost",
            status: 422,
            detail: caught.message,
          });
        }
        throw caught;
      }
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
        return problemResponseForIdempotencyConflict(c, result);
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      return c.json(
        JSON.parse(result.responseBody ?? "{}") as z.infer<typeof ConvertToCostAck>,
        201,
      );
    },
  );
}

// Ownership pre-check shared by submit and void: reads the entry's timekeeper and compares it to
// the session user. Returns true when the caller owns the entry. Returns false when the entry is
// missing or belongs to another timekeeper — the caller emits a not-found (rather than a 403) so
// existence is not leaked: a caller learns nothing more than "no such entry" for rows they do not own.
async function ownsEntry(
  database: SqlDatabase,
  id: TimeEntryId,
  sessionUserId: string,
): Promise<boolean> {
  const row = await database
    .prepare("SELECT timekeeper_user_id FROM time_entry WHERE id = ?1")
    .bind(id)
    .first<{ timekeeper_user_id: string }>();
  return row !== null && row.timekeeper_user_id === sessionUserId;
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
