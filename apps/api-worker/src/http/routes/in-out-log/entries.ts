import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import type { BatchDatabase, EffectWrite } from "@magna-carta/data-access/effect-batch";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { GuardedWriteRefusedError } from "@magna-carta/database/guarded-write";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type { CustodyPacketId, InOutEntryId, UserId } from "@magna-carta/identifiers/types";
import {
  DropOffRequest,
  InOutEntry,
  InOutEntryCreated,
  InOutEntryPage,
  MoveToCustodianRequest,
  PickUpRequest,
} from "@magna-carta/in-out-log/contract";
import {
  deleteWaitingEntry,
  recordDropOff,
  recordMovedToCustodian,
  recordPickUp,
} from "@magna-carta/in-out-log/entry-service";
import {
  readEntry,
  readRecipients,
  selectEntriesStatement,
  type InOutEntryRow,
} from "@magna-carta/in-out-log/entry-statements";
import {
  IN_OUT_ENTRY_NUMBERING_TABLES,
  isEntryNumberConflict,
} from "@magna-carta/in-out-log/numbering";
import {
  decodeEntryCursor,
  encodeEntryCursor,
  presentEntry,
} from "@magna-carta/in-out-log/presentation";
import { MAX_ENTRY_PAGE_SIZE } from "@magna-carta/in-out-log/types";
import { InOutValidationError } from "@magna-carta/in-out-log/validation";
import { drawWithBoundedRetry } from "@magna-carta/sequence-numbering/bounded-retry";
import type { Context } from "hono";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierPathParam } from "../../contracts/common.ts";
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";

// The In/Out Log's HTTP surface over @magna-carta/in-out-log: the front desk's record of copies,
// papers and files that are dropped off for somebody and then picked up, or moved into Custodian.
// Every write is one batch with its audit row; a Drop Off draws its number inside that batch.

const READ = "inOutLog:read" as const;
const MANAGE = "inOutLog:manage" as const;

const AcknowledgedResponse = z.object({ ok: z.literal(true) }).openapi("InOutAcknowledged");
const entryIdParam = z.object({ entryId: identifierPathParam("inOutEntry", "entryId") });
const listQuery = z.object({
  // `waiting` is Waiting for Pickup, oldest first; `all` is the whole Log, newest first.
  status: z.enum(["waiting", "all"]).optional(),
  search: z.string().min(1).max(200).optional(),
  cursor: z.string().min(1).max(400).optional(),
});

const problem = (description: string) => ({
  description,
  content: { "application/problem+json": { schema: Problem } },
});
const errors = {
  400: problem("Missing Idempotency-Key (this operation requires one)"),
  401: problem("No valid session"),
  403: problem("The session member lacks the required permission"),
  404: problem("The firm is unreachable, or the entry is not one this member can see"),
  409: problem("The entry has already been picked up or moved to Custodian, or a retry is in progress"),
  422: problem("The request body is not a shape this operation accepts"),
  429: problem("Rate limited"),
} as const;
const writeErrors = {
  400: errors[400],
  401: errors[401],
  403: errors[403],
  404: errors[404],
  409: errors[409],
  422: errors[422],
  429: errors[429],
};

function readMeta(action: string): RouteMeta {
  return {
    operationId: `inOutLog.${action}`,
    surface: "app",
    authenticated: true,
    permission: READ,
    resource: "firm",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  };
}

function writeMeta(action: string): RouteMeta {
  return {
    operationId: `inOutLog.${action}`,
    surface: "app",
    authenticated: true,
    permission: MANAGE,
    resource: "firm",
    audited: true,
    // Required: a retried Drop Off must not log the same envelope twice under two numbers.
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

const listRoute = defineOpenAPIRoute(readMeta("listEntries"), {
  method: "get",
  path: "/api/v1/in-out-entries",
  description:
    "The In/Out Log. `status=waiting` lists what is waiting for pickup, oldest first; otherwise the " +
    "whole log, newest first. A search matches the number, what it is, who it came from, who it is " +
    "to, and the matter's name.",
  request: { query: listQuery },
  responses: {
    200: { description: "One page of the log", content: { "application/json": { schema: InOutEntryPage } } },
    401: errors[401],
    403: errors[403],
    404: errors[404],
    422: errors[422],
    429: errors[429],
  },
});

const getRoute = defineOpenAPIRoute(readMeta("getEntry"), {
  method: "get",
  path: "/api/v1/in-out-entries/{entryId}",
  description: "One entry in the In/Out Log, with the people it is to.",
  request: { params: entryIdParam },
  responses: {
    200: { description: "The entry", content: { "application/json": { schema: InOutEntry } } },
    401: errors[401],
    403: errors[403],
    404: errors[404],
    429: errors[429],
  },
});

const dropOffRoute = defineOpenAPIRoute(writeMeta("dropOff"), {
  method: "post",
  path: "/api/v1/in-out-entries",
  description:
    "Drop Off: records something left at the front desk for one or more people to collect, and " +
    "gives it the next In/Out Log number.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: DropOffRequest } }, required: true },
  },
  responses: {
    201: { description: "The entry and its number", content: { "application/json": { schema: InOutEntryCreated } } },
    ...writeErrors,
  },
});

const pickUpRoute = defineOpenAPIRoute(writeMeta("pickUp"), {
  method: "post",
  path: "/api/v1/in-out-entries/{entryId}/pick-up",
  description:
    "Pick Up: records who collected the entry, one of the people it is to or somebody else by " +
    "name, whether their identity was checked, and who handed it over.",
  request: {
    headers: idempotencyKeyHeader,
    params: entryIdParam,
    body: { content: { "application/json": { schema: PickUpRequest } }, required: true },
  },
  responses: {
    200: { description: "Picked up", content: { "application/json": { schema: AcknowledgedResponse } } },
    ...writeErrors,
  },
});

const moveToCustodianRoute = defineOpenAPIRoute(writeMeta("moveToCustodian"), {
  method: "post",
  path: "/api/v1/in-out-entries/{entryId}/custody-packet",
  description:
    "Move to Custodian: links a waiting entry to the custody packet it became. The packet is logged " +
    "first through Custodian's own New Packet route; this records the link and takes the entry " +
    "off Waiting for Pickup.",
  request: {
    headers: idempotencyKeyHeader,
    params: entryIdParam,
    body: { content: { "application/json": { schema: MoveToCustodianRequest } }, required: true },
  },
  responses: {
    200: { description: "Moved to Custodian", content: { "application/json": { schema: AcknowledgedResponse } } },
    ...writeErrors,
  },
});

const deleteRoute = defineOpenAPIRoute(
  {
    ...writeMeta("deleteEntry"),
    reversal: {
      kind: "none",
      reason:
        "An entry recorded by mistake is removed while it is still waiting. Its number is not given back, and the audit row records that it existed.",
    },
  },
  {
    method: "delete",
    path: "/api/v1/in-out-entries/{entryId}",
    description:
      "Deletes an entry recorded by mistake. Only while it is waiting: once picked up or moved to " +
      "Custodian, the entry is the record of that.",
    request: { headers: idempotencyKeyHeader, params: entryIdParam },
    responses: {
      200: { description: "Deleted", content: { "application/json": { schema: AcknowledgedResponse } } },
      ...writeErrors,
    },
  },
);

function serviceOptions(userId: string) {
  return {
    clock: { now: () => new Date().toISOString() },
    actorUserId: userId as UserId,
    randomSource: cryptoRandomSource,
    visibility: visibleMatterPredicate(),
  };
}

function inOutErrorResponse(
  c: Context,
  caught: InOutValidationError,
): ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> {
  switch (caught.code) {
    case "in-out-unknown-entry":
      return problemJson(c, { type: "not-found", title: "Not found", status: 404, detail: caught.message });
    case "in-out-not-waiting":
      return problemJson(c, { type: "conflict", title: "Already handled", status: 409, detail: caught.message });
    default:
      return problemJson(c, {
        type: "validation",
        title: "In/Out Log request invalid",
        status: 422,
        detail: caught.message,
      });
  }
}

type EffectOutcome =
  | { ok: true; body: Record<string, unknown>; replayed: boolean }
  | { ok: false; problem: ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> };

async function commitEffect(
  c: Context,
  database: BatchDatabase,
  idempotency: { key: string | undefined; fingerprint: string },
  responseCode: number,
  call: () => Promise<{ body: Record<string, unknown>; effect: EffectWrite }>,
): Promise<EffectOutcome> {
  let result;
  try {
    result = await runIdempotentEffect({
      database,
      key: idempotency.key,
      fingerprint: idempotency.fingerprint,
      now: () => new Date().toISOString(),
      effect: async () => {
        const { body, effect } = await call();
        return { write: effect, responseCode, responseBody: canonicalJsonStringify(body) };
      },
    });
  } catch (caught) {
    if (caught instanceof InOutValidationError) {
      return { ok: false, problem: inOutErrorResponse(c, caught) };
    }
    // Two people pressed Pick Up on one envelope: the second batch's guard found it no longer waiting.
    if (caught instanceof GuardedWriteRefusedError) {
      return {
        ok: false,
        problem: problemJson(c, {
          type: "conflict",
          title: "Already handled",
          status: 409,
          detail: "that entry was picked up or moved to Custodian a moment ago",
        }),
      };
    }
    throw caught;
  }
  if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
    return { ok: false, problem: problemResponseForIdempotencyConflict(c, result) };
  }
  const body = JSON.parse(result.responseBody ?? "{}") as Record<string, unknown>;
  return { ok: true, body, replayed: result.kind === "replayed" };
}

export function registerInOutLogRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  // GET /api/v1/in-out-entries
  app.openapi({ ...listRoute, middleware: chokepointMiddleware(chokepoint, listRoute) }, async (c) => {
    const firm = requireChokepointFirmContext(c);
    const { status, search, cursor } = c.req.valid("query");
    const decoded = cursor === undefined ? undefined : decodeEntryCursor(cursor);
    if (decoded === null) {
      return problemJson(c, { type: "validation", title: "Invalid cursor", status: 422 });
    }
    const visibility = visibleMatterPredicate();
    const { results } = await selectEntriesStatement(firm.firmDatabase, visibility, {
      status: status === "waiting" ? "waiting" : undefined,
      search,
      cursor: decoded,
      limit: MAX_ENTRY_PAGE_SIZE + 1,
    }).all<InOutEntryRow>();
    const hasMore = results.length > MAX_ENTRY_PAGE_SIZE;
    const rows = hasMore ? results.slice(0, MAX_ENTRY_PAGE_SIZE) : results;
    // Everybody each entry on the page is To, in one bounded read.
    const recipients = await readRecipients(
      firm.firmDatabase,
      rows.map((row) => row.id),
    );
    const last = rows.at(-1);
    return c.json(
      {
        entries: rows.map((row) => presentEntry(row, recipients)),
        nextCursor: hasMore && last !== undefined ? encodeEntryCursor(last) : null,
      },
      200,
    );
  });

  // GET /api/v1/in-out-entries/{entryId}
  app.openapi({ ...getRoute, middleware: chokepointMiddleware(chokepoint, getRoute) }, async (c) => {
    const firm = requireChokepointFirmContext(c);
    const { entryId } = c.req.valid("param");
    const row = await readEntry(firm.firmDatabase, entryId as InOutEntryId, visibleMatterPredicate());
    if (row === undefined) {
      return problemJson(c, {
        type: "not-found",
        title: "Not found",
        status: 404,
        detail: "No such entry in this firm's In/Out Log.",
      });
    }
    const recipients = await readRecipients(firm.firmDatabase, [row.id]);
    return c.json(presentEntry(row, recipients), 200);
  });

  // POST /api/v1/in-out-entries
  app.openapi({ ...dropOffRoute, middleware: chokepointMiddleware(chokepoint, dropOffRoute) }, async (c) => {
    const firm = requireChokepointFirmContext(c);
    const userId = requireChokepointUserId(c);
    const idempotency = requireChokepointIdempotency(c);
    const request = c.req.valid("json");
    // THE NUMBER IS DRAWN INSIDE THE WRITE, so the entry and its number are one batch or neither. A
    // concurrent Drop Off that took the value first aborts this batch on the allocation table or the
    // unique number; the shared loop advances the counter and runs this again. The idempotency gate
    // is inside the retry, so a replay answers from the stored body without drawing anything.
    const outcome = await drawWithBoundedRetry(
      firm.firmDatabase,
      IN_OUT_ENTRY_NUMBERING_TABLES,
      {
        sequenceLabel: "in/out log number",
        alsoRetryable: isEntryNumberConflict,
        nonConvergenceError: ({ message }) => new Error(message),
      },
      async (observe) =>
        await commitEffect(c, firm.firmDatabase, idempotency, 201, async () => {
          const created = await recordDropOff(firm.firmDatabase, request, {
            ...serviceOptions(userId),
            observeDraw: observe,
          });
          return { body: { id: created.entryId, number: created.number }, effect: created.effect };
        }),
    );
    if (!outcome.ok) return outcome.problem;
    if (outcome.replayed) c.header("Idempotency-Replayed", "true");
    return c.json({ id: String(outcome.body.id), number: String(outcome.body.number) }, 201);
  });

  // POST /api/v1/in-out-entries/{entryId}/pick-up
  app.openapi({ ...pickUpRoute, middleware: chokepointMiddleware(chokepoint, pickUpRoute) }, async (c) => {
    const firm = requireChokepointFirmContext(c);
    const userId = requireChokepointUserId(c);
    const idempotency = requireChokepointIdempotency(c);
    const { entryId } = c.req.valid("param");
    const request = c.req.valid("json");
    const outcome = await commitEffect(c, firm.firmDatabase, idempotency, 200, async () => {
      const { effect } = await recordPickUp(
        firm.firmDatabase,
        entryId as InOutEntryId,
        request,
        serviceOptions(userId),
      );
      return { body: { ok: true }, effect };
    });
    if (!outcome.ok) return outcome.problem;
    if (outcome.replayed) c.header("Idempotency-Replayed", "true");
    return c.json({ ok: true } as const, 200);
  });

  // POST /api/v1/in-out-entries/{entryId}/custody-packet
  app.openapi(
    { ...moveToCustodianRoute, middleware: chokepointMiddleware(chokepoint, moveToCustodianRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { entryId } = c.req.valid("param");
      const { packetId } = c.req.valid("json");
      const outcome = await commitEffect(c, firm.firmDatabase, idempotency, 200, async () => {
        const { effect } = await recordMovedToCustodian(
          firm.firmDatabase,
          entryId as InOutEntryId,
          packetId as CustodyPacketId,
          serviceOptions(userId),
        );
        return { body: { ok: true }, effect };
      });
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ ok: true } as const, 200);
    },
  );

  // DELETE /api/v1/in-out-entries/{entryId}
  app.openapi({ ...deleteRoute, middleware: chokepointMiddleware(chokepoint, deleteRoute) }, async (c) => {
    const firm = requireChokepointFirmContext(c);
    const userId = requireChokepointUserId(c);
    const idempotency = requireChokepointIdempotency(c);
    const { entryId } = c.req.valid("param");
    const outcome = await commitEffect(c, firm.firmDatabase, idempotency, 200, async () => {
      const { effect } = await deleteWaitingEntry(
        firm.firmDatabase,
        entryId as InOutEntryId,
        serviceOptions(userId),
      );
      return { body: { ok: true }, effect };
    });
    if (!outcome.ok) return outcome.problem;
    if (outcome.replayed) c.header("Idempotency-Replayed", "true");
    return c.json({ ok: true } as const, 200);
  });
}
