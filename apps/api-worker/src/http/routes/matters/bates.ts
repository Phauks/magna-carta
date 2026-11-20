import { z, type OpenAPIHono } from "@hono/zod-openapi";
import {
  BatesRangeList,
  RecordBatesStampedFileRequest,
  TakeBatesRangeRequest,
  TakenBatesRange,
} from "@magna-carta/bates/contract";
import { listBatesRanges } from "@magna-carta/bates/queries";
import {
  RANGE_OVERLAP_GUARD,
  recordStampedFile,
  takeBatesRange,
} from "@magna-carta/bates/range-service";
import { BatesValidationError } from "@magna-carta/bates/validation";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { GuardedWriteRefusedError } from "@magna-carta/data-access/effect-batch";
import { cursorQuery } from "@magna-carta/data-access/pagination-contract";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { identifierField } from "@magna-carta/identifiers/field";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type {
  BatesLogId,
  BatesRangeId,
  ExhibitSetId,
  FileId,
  MatterId,
} from "@magna-carta/identifiers/types";
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
import { identifierPathParam, idempotencyKeyHeader } from "../../contracts/common.ts";
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";

// A matter's Bates numbers: a stamp takes a range from one of the matter's Bates logs before it
// stamps, and records the saved copy after. The logs themselves are bates-logs.ts. Reading needs only
// sight of the matter; taking a range needs the right to add files to it, because a range exists to
// stamp a copy that is saved there.

const UPLOAD = "files:upload" as const;

/** How many times a take with no typed start re-plans after losing a race to another stamp. */
const MAX_TAKE_ATTEMPTS = 5;

const matterIdParam = z.object({ matterId: identifierPathParam("matter", "matterId") });
const rangeParams = z.object({
  matterId: identifierPathParam("matter", "matterId"),
  rangeId: identifierPathParam("batesRange", "rangeId"),
});

export function problem<Description extends string>(description: Description) {
  return { description, content: { "application/problem+json": { schema: Problem } } };
}

export const errors = {
  400: problem("Missing Idempotency-Key (this operation requires one)"),
  401: problem("No valid session"),
  403: problem("The session member lacks the required permission"),
  404: problem("The matter, Bates log, file, exhibit set or range is unknown on this matter"),
  409: problem(
    "Some number in the range is already stamped in that log, another log has that name, the " +
      "range's saved copy is already recorded, or a request with this Idempotency-Key is still in " +
      "progress",
  ),
  422: problem("The request is invalid"),
  429: problem("Rate limited"),
} as const;

export function readMeta(action: string): RouteMeta {
  return {
    operationId: `bates.${action}`,
    surface: "app",
    authenticated: true,
    permission: null,
    resource: "matter",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  };
}

// Both writes are idempotency-keyed: a retried take must answer the range it took rather than take
// a second one, which would leave a gap in the numbers.
export function writeMeta(action: string): RouteMeta {
  return {
    operationId: `bates.${action}`,
    surface: "app",
    authenticated: true,
    permission: UPLOAD,
    resource: "matter",
    audited: true,
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

const listRangesRoute = defineOpenAPIRoute(readMeta("listBatesRanges"), {
  method: "get",
  path: "/api/v1/matters/{matterId}/bates-ranges",
  description:
    "Every range of Bates numbers taken on the matter, newest first, or in one log: the log, the " +
    "prefix and numbers, the file stamped, the saved copy if there is one, who took it and when.",
  request: {
    params: matterIdParam,
    query: cursorQuery.extend({ logId: identifierField("batesLog").optional() }),
  },
  responses: {
    200: {
      description: "The matter's Bates ranges",
      content: { "application/json": { schema: BatesRangeList } },
    },
    401: errors[401],
    403: errors[403],
    404: errors[404],
    429: errors[429],
  },
});

const takeRangeRoute = defineOpenAPIRoute(writeMeta("takeBatesRange"), {
  method: "post",
  path: "/api/v1/matters/{matterId}/bates-ranges",
  description:
    "Takes a range of Bates numbers from one of the matter's Bates logs for one stamp: one number " +
    "per page, under the log's prefix and padding. With no start number given it starts one past " +
    "the highest number stamped in the log (1 for a new log). Refused when any number in the range " +
    "is already stamped in the log.",
  request: {
    headers: idempotencyKeyHeader,
    params: matterIdParam,
    body: { content: { "application/json": { schema: TakeBatesRangeRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The range taken",
      content: { "application/json": { schema: TakenBatesRange } },
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

const recordStampedFileRoute = defineOpenAPIRoute(writeMeta("recordBatesStampedFile"), {
  method: "post",
  path: "/api/v1/matters/{matterId}/bates-ranges/{rangeId}/stamped-file",
  description:
    "Records the saved, stamped copy of a range: a file already on the matter. Once only; a range " +
    "stamps one document.",
  request: {
    headers: idempotencyKeyHeader,
    params: rangeParams,
    body: {
      content: { "application/json": { schema: RecordBatesStampedFileRequest } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "The copy is recorded",
      content: { "application/json": { schema: z.object({ id: z.string() }) } },
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

export type BatesProblem = ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422>;

export function batesErrorResponse(c: Context, caught: BatesValidationError): BatesProblem {
  const detail = caught.message;
  switch (caught.code) {
    case "bates-unknown-file":
    case "bates-unknown-log":
    case "bates-unknown-set":
    case "bates-unknown-range":
      return problemJson(c, { type: "not-found", title: "Not found", status: 404, detail });
    case "bates-range-taken":
      return problemJson(c, {
        type: "bates-range-taken",
        title: "Those numbers are already stamped",
        status: 409,
        detail,
      });
    case "bates-log-name-taken":
      return problemJson(c, {
        type: "bates-log-name-taken",
        title: "That name is taken",
        status: 409,
        detail,
      });
    case "bates-range-already-saved":
      return problemJson(c, {
        type: "conflict",
        title: "The stamped copy is already recorded",
        status: 409,
        detail,
      });
    case "bates-invalid-input":
      return problemJson(c, {
        type: "validation",
        title: "Bates request invalid",
        status: 422,
        detail,
      });
  }
}

export function serviceOptions(c: Context) {
  return {
    clock: { now: () => new Date().toISOString() },
    actorUserId: requireChokepointUserId(c),
    randomSource: cryptoRandomSource,
  };
}

export function registerBatesRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    { ...listRangesRoute, middleware: chokepointMiddleware(chokepoint, listRangesRoute) },
    async (c) => {
      const { matterId } = c.req.valid("param");
      const { cursor, logId } = c.req.valid("query");
      const database = requireChokepointFirmContext(c).firmDatabase;
      const page = await listBatesRanges(database, matterId as MatterId, {
        cursor,
        logId: logId as BatesLogId | undefined,
      });
      return c.json(
        { data: page.data.map((range) => ({ ...range })), nextCursor: page.nextCursor },
        200,
      );
    },
  );

  app.openapi(
    { ...takeRangeRoute, middleware: chokepointMiddleware(chokepoint, takeRangeRoute) },
    async (c) => {
      const { matterId } = c.req.valid("param");
      const body = c.req.valid("json");
      const firm = requireChokepointFirmContext(c);
      const idempotency = requireChokepointIdempotency(c);
      const options = serviceOptions(c);
      // A lost race leaves nothing behind (the refused batch carries the idempotency record with
      // it), so a take with no typed start plans again from the new highest number. A typed start
      // that lost is answered as the clash it is.
      for (let attempt = 1; ; attempt += 1) {
        try {
          const result = await runIdempotentEffect({
            database: firm.firmDatabase,
            key: idempotency.key,
            fingerprint: idempotency.fingerprint,
            now: () => new Date().toISOString(),
            effect: async () => {
              const taken = await takeBatesRange(
                firm.firmDatabase,
                {
                  matterId: matterId as MatterId,
                  logId: body.logId as BatesLogId,
                  pageCount: body.pageCount,
                  firstNumber: body.firstNumber,
                  purpose: body.purpose,
                  sourceFileId: (body.sourceFileId ?? null) as FileId | null,
                  exhibitSetId: (body.exhibitSetId ?? null) as ExhibitSetId | null,
                },
                options,
              );
              const responseBody = {
                id: taken.range.rangeId,
                logId: taken.range.logId,
                prefix: taken.range.prefix,
                digits: taken.range.digits,
                firstNumber: taken.range.firstNumber,
                lastNumber: taken.range.lastNumber,
              };
              return {
                write: taken.effect,
                responseCode: 201,
                responseBody: canonicalJsonStringify(responseBody),
              };
            },
          });
          if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
            return problemResponseForIdempotencyConflict(c, result);
          }
          if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
          return c.json(
            JSON.parse(result.responseBody ?? "{}") as z.infer<typeof TakenBatesRange>,
            201,
          );
        } catch (caught) {
          if (caught instanceof BatesValidationError) return batesErrorResponse(c, caught);
          const lostRace =
            caught instanceof GuardedWriteRefusedError && caught.guard === RANGE_OVERLAP_GUARD;
          if (!lostRace) throw caught;
          if (body.firstNumber !== undefined || attempt >= MAX_TAKE_ATTEMPTS) {
            return problemJson(c, {
              type: "bates-range-taken",
              title: "Those numbers are already stamped",
              status: 409,
              detail: "Another stamp took those numbers first. Ask for the next number again.",
            });
          }
        }
      }
    },
  );

  app.openapi(
    {
      ...recordStampedFileRoute,
      middleware: chokepointMiddleware(chokepoint, recordStampedFileRoute),
    },
    async (c) => {
      const { matterId, rangeId } = c.req.valid("param");
      const body = c.req.valid("json");
      const firm = requireChokepointFirmContext(c);
      const idempotency = requireChokepointIdempotency(c);
      const options = serviceOptions(c);
      try {
        const result = await runIdempotentEffect({
          database: firm.firmDatabase,
          key: idempotency.key,
          fingerprint: idempotency.fingerprint,
          now: () => new Date().toISOString(),
          effect: async () => {
            const recorded = await recordStampedFile(
              firm.firmDatabase,
              matterId as MatterId,
              rangeId as BatesRangeId,
              body.fileId as FileId,
              options,
            );
            return {
              write: recorded.effect,
              responseCode: 200,
              responseBody: canonicalJsonStringify({ id: rangeId }),
            };
          },
        });
        if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
          return problemResponseForIdempotencyConflict(c, result);
        }
        if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
        return c.json({ id: rangeId as string }, 200);
      } catch (caught) {
        if (caught instanceof BatesValidationError) return batesErrorResponse(c, caught);
        if (caught instanceof GuardedWriteRefusedError) {
          return problemJson(c, {
            type: "conflict",
            title: "The stamped copy is already recorded",
            status: 409,
            detail: "This range's stamped copy was recorded by another request.",
          });
        }
        throw caught;
      }
    },
  );
}
