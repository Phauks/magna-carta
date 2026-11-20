import { z, type OpenAPIHono } from "@hono/zod-openapi";
import {
  BatesLogList,
  BatesLogRecord,
  CreateBatesLogRequest,
  RenameBatesLogRequest,
} from "@magna-carta/bates/contract";
import { createBatesLog, renameBatesLog, type BatesLog } from "@magna-carta/bates/log-service";
import { listBatesLogs } from "@magna-carta/bates/queries";
import { BatesValidationError } from "@magna-carta/bates/validation";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { GuardedWriteRefusedError, type EffectWrite } from "@magna-carta/data-access/effect-batch";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import type { BatesLogId, MatterId } from "@magna-carta/identifiers/types";
import type { Context } from "hono";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { identifierPathParam, idempotencyKeyHeader } from "../../contracts/common.ts";
import { problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";
import { batesErrorResponse, errors, readMeta, serviceOptions, writeMeta } from "./bates.ts";

// A matter's Bates logs: one per filing or production that wants numbers of its own, each with a
// name, a prefix and a padding. Listing needs only sight of the matter; starting or renaming a log
// needs the right to add files, the same right taking numbers from it needs.

const matterIdParam = z.object({ matterId: identifierPathParam("matter", "matterId") });
const logParams = z.object({
  matterId: identifierPathParam("matter", "matterId"),
  logId: identifierPathParam("batesLog", "logId"),
});

const listLogsRoute = defineOpenAPIRoute(readMeta("listBatesLogs"), {
  method: "get",
  path: "/api/v1/matters/{matterId}/bates-logs",
  description:
    "The matter's Bates logs, the one used most recently first, each with its prefix, padding, the " +
    "next number in it, and how many ranges and pages it holds.",
  request: { params: matterIdParam },
  responses: {
    200: {
      description: "The matter's Bates logs",
      content: { "application/json": { schema: BatesLogList } },
    },
    401: errors[401],
    403: errors[403],
    404: errors[404],
    429: errors[429],
  },
});

const createLogRoute = defineOpenAPIRoute(writeMeta("createBatesLog"), {
  method: "post",
  path: "/api/v1/matters/{matterId}/bates-logs",
  description:
    "Starts a Bates log on the matter with a name, a prefix and a padding. It counts from 1. Two " +
    "logs may share a prefix; no two share a name.",
  request: {
    headers: idempotencyKeyHeader,
    params: matterIdParam,
    body: { content: { "application/json": { schema: CreateBatesLogRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The log started",
      content: { "application/json": { schema: BatesLogRecord } },
    },
    400: errors[400],
    401: errors[401],
    403: errors[403],
    404: errors[404],
    409: errors[409],
    422: errors[422],
    429: errors[429],
  },
});

const renameLogRoute = defineOpenAPIRoute(writeMeta("renameBatesLog"), {
  method: "patch",
  path: "/api/v1/matters/{matterId}/bates-logs/{logId}",
  description: "Renames a Bates log. Its prefix and padding never change.",
  request: {
    headers: idempotencyKeyHeader,
    params: logParams,
    body: { content: { "application/json": { schema: RenameBatesLogRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The log renamed",
      content: { "application/json": { schema: BatesLogRecord } },
    },
    400: errors[400],
    401: errors[401],
    403: errors[403],
    404: errors[404],
    409: errors[409],
    422: errors[422],
    429: errors[429],
  },
});

/** Runs one log write under its idempotency key and answers the log, or the refusal. */
async function answerLogWrite<Status extends 200 | 201>(
  c: Context,
  status: Status,
  plan: () => Promise<{ log: BatesLog; effect: EffectWrite }>,
) {
  const firm = requireChokepointFirmContext(c);
  const idempotency = requireChokepointIdempotency(c);
  try {
    const result = await runIdempotentEffect({
      database: firm.firmDatabase,
      key: idempotency.key,
      fingerprint: idempotency.fingerprint,
      now: () => new Date().toISOString(),
      effect: async () => {
        const planned = await plan();
        return {
          write: planned.effect,
          responseCode: status,
          responseBody: canonicalJsonStringify({ ...planned.log }),
        };
      },
    });
    if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
      return problemResponseForIdempotencyConflict(c, result);
    }
    if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
    return c.json(
      JSON.parse(result.responseBody ?? "{}") as z.infer<typeof BatesLogRecord>,
      status,
    );
  } catch (caught) {
    if (caught instanceof BatesValidationError) return batesErrorResponse(c, caught);
    if (caught instanceof GuardedWriteRefusedError) {
      return problemJson(c, {
        type: "bates-log-name-taken",
        title: "That name is taken",
        status: 409,
        detail: "Another Bates log on this matter took that name first.",
      });
    }
    throw caught;
  }
}

export function registerBatesLogRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    { ...listLogsRoute, middleware: chokepointMiddleware(chokepoint, listLogsRoute) },
    async (c) => {
      const { matterId } = c.req.valid("param");
      const database = requireChokepointFirmContext(c).firmDatabase;
      const logs = await listBatesLogs(database, matterId as MatterId);
      return c.json({ data: logs.data.map((row) => ({ ...row })), capped: logs.capped }, 200);
    },
  );

  app.openapi(
    { ...createLogRoute, middleware: chokepointMiddleware(chokepoint, createLogRoute) },
    async (c) => {
      const { matterId } = c.req.valid("param");
      const body = c.req.valid("json");
      const database = requireChokepointFirmContext(c).firmDatabase;
      return answerLogWrite(c, 201, () =>
        createBatesLog(
          database,
          {
            matterId: matterId as MatterId,
            name: body.name,
            prefix: body.prefix,
            digits: body.digits,
          },
          serviceOptions(c),
        ),
      );
    },
  );

  app.openapi(
    { ...renameLogRoute, middleware: chokepointMiddleware(chokepoint, renameLogRoute) },
    async (c) => {
      const { matterId, logId } = c.req.valid("param");
      const body = c.req.valid("json");
      const database = requireChokepointFirmContext(c).firmDatabase;
      return answerLogWrite(c, 200, () =>
        renameBatesLog(
          database,
          matterId as MatterId,
          logId as BatesLogId,
          body.name,
          serviceOptions(c),
        ),
      );
    },
  );
}
