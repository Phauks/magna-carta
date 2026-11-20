import { z } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import type { BatchDatabase, EffectWrite } from "@magna-carta/data-access/effect-batch";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { GuardedWriteRefusedError } from "@magna-carta/database/guarded-write";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type { UserId } from "@magna-carta/identifiers/types";
import { InOutValidationError } from "@magna-carta/in-out-log/validation";
import type { Context } from "hono";
import { identifierPathParam } from "../../contracts/common.ts";
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import type { RouteMeta } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";

// What the In/Out Log's route files share: the two permissions, the route meta, the error table,
// and the one way a write is committed (one idempotent batch, its refusals mapped to problems).

export const READ = "inOutLog:read" as const;
export const MANAGE = "inOutLog:manage" as const;

export const AcknowledgedResponse = z.object({ ok: z.literal(true) }).openapi("InOutAcknowledged");
export const entryIdParam = z.object({ entryId: identifierPathParam("inOutEntry", "entryId") });

const problem = (description: string) => ({
  description,
  content: { "application/problem+json": { schema: Problem } },
});
export const errors = {
  400: problem("Missing Idempotency-Key (this operation requires one)"),
  401: problem("No valid session"),
  403: problem("The session member lacks the required permission"),
  404: problem("The firm is unreachable, or the entry is not one this member can see"),
  409: problem(
    "The entry has already been picked up or moved to Custodian, or a retry is in progress",
  ),
  422: problem("The request body is not a shape this operation accepts"),
  429: problem("Rate limited"),
} as const;
export const writeErrors = {
  400: errors[400],
  401: errors[401],
  403: errors[403],
  404: errors[404],
  409: errors[409],
  422: errors[422],
  429: errors[429],
};

export function readMeta(action: string): RouteMeta {
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

export function writeMeta(action: string): RouteMeta {
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

export function serviceOptions(userId: string) {
  return {
    clock: { now: () => new Date().toISOString() },
    actorUserId: userId as UserId,
    randomSource: cryptoRandomSource,
    visibility: visibleMatterPredicate(),
  };
}

export function inOutErrorResponse(
  c: Context,
  caught: InOutValidationError,
): ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> {
  switch (caught.code) {
    case "in-out-unknown-entry":
      return problemJson(c, {
        type: "not-found",
        title: "Not found",
        status: 404,
        detail: caught.message,
      });
    case "in-out-not-waiting":
      return problemJson(c, {
        type: "conflict",
        title: "Already handled",
        status: 409,
        detail: caught.message,
      });
    default:
      return problemJson(c, {
        type: "validation",
        title: "In/Out Log request invalid",
        status: 422,
        detail: caught.message,
      });
  }
}

export type EffectOutcome =
  | { ok: true; body: Record<string, unknown>; replayed: boolean }
  | { ok: false; problem: ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> };

export async function commitEffect(
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
          detail: "somebody else picked that entry up or moved it to Custodian first",
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
