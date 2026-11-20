import { z, type OpenAPIHono } from "@hono/zod-openapi";
import type { CustodyPacketId, InOutEntryId, UserId } from "@magna-carta/identifiers/types";
import {
  DropOffRequest,
  InOutEntry,
  InOutEntryCreated,
  InOutEntryListQuery,
  InOutEntryPage,
  MoveToCustodianRequest,
} from "@magna-carta/in-out-log/contract";
import {
  deleteWaitingEntry,
  recordDropOff,
  recordMovedToCustodian,
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
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { drawWithBoundedRetry } from "@magna-carta/sequence-numbering/bounded-retry";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader } from "../../contracts/common.ts";
import { problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute } from "../../contracts/route-meta.ts";
import {
  AcknowledgedResponse,
  commitEffect,
  entryIdParam,
  errors,
  readMeta,
  serviceOptions,
  writeErrors,
  writeMeta,
} from "./shared.ts";

// The In/Out Log's HTTP surface over @magna-carta/in-out-log: the front desk's record of copies,
// papers and files that are dropped off for somebody and then picked up, or moved into Custodian.
// Every write is one batch with its audit row; a Drop Off draws its number inside that batch.

const listRoute = defineOpenAPIRoute(readMeta("listEntries"), {
  method: "get",
  path: "/api/v1/in-out-entries",
  description:
    "The In/Out Log. `status=waiting` lists what is waiting for pickup, oldest first; otherwise the " +
    "whole log, newest first. A search matches the number, what it is, who it came from, who it is " +
    "to, and the matter's name.",
  request: { query: InOutEntryListQuery },
  responses: {
    200: {
      description: "One page of the log",
      content: { "application/json": { schema: InOutEntryPage } },
    },
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
    201: {
      description: "The entry and its number",
      content: { "application/json": { schema: InOutEntryCreated } },
    },
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
    200: {
      description: "Moved to Custodian",
      content: { "application/json": { schema: AcknowledgedResponse } },
    },
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
      200: {
        description: "Deleted",
        content: { "application/json": { schema: AcknowledgedResponse } },
      },
      ...writeErrors,
    },
  },
);

export function registerInOutLogRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  // GET /api/v1/in-out-entries
  app.openapi(
    { ...listRoute, middleware: chokepointMiddleware(chokepoint, listRoute) },
    async (c) => {
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
          data: rows.map((row) => presentEntry(row, recipients)),
          nextCursor: hasMore && last !== undefined ? encodeEntryCursor(last) : null,
        },
        200,
      );
    },
  );

  // GET /api/v1/in-out-entries/{entryId}
  app.openapi(
    { ...getRoute, middleware: chokepointMiddleware(chokepoint, getRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { entryId } = c.req.valid("param");
      const row = await readEntry(
        firm.firmDatabase,
        entryId as InOutEntryId,
        visibleMatterPredicate(),
      );
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
    },
  );

  // POST /api/v1/in-out-entries
  app.openapi(
    { ...dropOffRoute, middleware: chokepointMiddleware(chokepoint, dropOffRoute) },
    async (c) => {
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
            return {
              body: { id: created.entryId, number: created.number },
              effect: created.effect,
            };
          }),
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ id: String(outcome.body.id), number: String(outcome.body.number) }, 201);
    },
  );

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
  app.openapi(
    { ...deleteRoute, middleware: chokepointMiddleware(chokepoint, deleteRoute) },
    async (c) => {
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
    },
  );
}
