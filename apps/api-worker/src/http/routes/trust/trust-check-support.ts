import { todayInUtc } from "@magna-carta/civil-time/civil-date";
import type { z } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import type { UserId } from "@magna-carta/identifiers/types";
import type { CheckStock } from "@magna-carta/trust/check-contract";
import {
  isTrustCheckNumberConflict,
  type TrustCheckStockSnapshot,
} from "@magna-carta/trust/checks";
import { TrustValidationError } from "@magna-carta/trust/trust-validation";
import type { Context } from "hono";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import type { RouteMeta } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";

// What the check-printing route modules share: the route meta, the problem answers, the stock as a
// response, and the one way a check write commits (idempotently, retrying once when two prints read
// the same next number). trust-checks.ts holds the queue and register; trust-check-stock.ts the stock
// and its scan.

export const READ = "trust:read" as const;
export const MANAGE = "trust:manage" as const;

const problem = (description: string) => ({
  description,
  content: { "application/problem+json": { schema: Problem } },
});

export const trustCheckErrors = {
  400: problem("Missing Idempotency-Key (this operation requires one)"),
  401: problem("No valid session"),
  403: problem("The session member lacks the capability"),
  404: problem("The trust account or check is unknown"),
  409: problem("The check was already answered, or the Idempotency-Key is still in progress"),
  422: problem("The trust rules refuse this"),
  429: problem("Rate limit exceeded"),
} as const;

export function trustCheckWriteMeta(operationId: string): RouteMeta {
  return {
    operationId,
    surface: "app",
    authenticated: true,
    permission: MANAGE,
    resource: "firm",
    audited: true,
    // A retried print that numbered its checks twice would put two numbers on one payment.
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

export function trustCheckReadMeta(operationId: string): RouteMeta {
  return {
    operationId,
    surface: "app",
    authenticated: true,
    permission: READ,
    resource: "firm",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  };
}

export const trustCheckOptions = () => ({
  clock: {
    now: () => new Date().toISOString(),
    today: () => todayInUtc(),
  },
});

export function trustCheckStockRecord(stock: TrustCheckStockSnapshot): z.infer<typeof CheckStock> {
  return {
    trustCheckStockId: stock.id,
    version: stock.version,
    name: stock.name,
    pageLayout: stock.pageLayout,
    fields: stock.fields.map((field) => ({ ...field })),
    shiftXMils: stock.shiftXMils,
    shiftYMils: stock.shiftYMils,
    startingCheckNumber: stock.startingCheckNumber,
    hasScan: stock.scanObjectKey !== null,
    savedBy: stock.savedBy,
    savedAt: stock.savedAt,
  };
}

export function trustCheckErrorResponse(
  c: Context,
  error: TrustValidationError,
): ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> {
  if (error.code === "unknown-trust-account" || error.code === "unknown-trust-check") {
    return problemJson(c, {
      type: "not-found",
      title: "Not found",
      status: 404,
      detail: error.message,
    });
  }
  if (error.code === "check-already-answered") {
    return problemJson(c, {
      type: "trust-check-already-answered",
      title: "That check has already been answered",
      status: 409,
      detail: error.message,
    });
  }
  return problemJson(c, {
    type: "trust-check-refused",
    title: "The trust rules refuse this",
    status: 422,
    detail: error.message,
  });
}

export async function commitTrustCheckWrite<Body>(
  c: Context,
  compose: (actor: UserId) => Promise<{ write: EffectWrite; body: Body }>,
) {
  const firm = requireChokepointFirmContext(c);
  const userId = requireChokepointUserId(c);
  const idempotency = requireChokepointIdempotency(c);
  const attempt = () =>
    runIdempotentEffect({
      database: firm.firmDatabase,
      key: idempotency.key,
      fingerprint: idempotency.fingerprint,
      now: () => new Date().toISOString(),
      effect: async () => {
        const composed = await compose(userId);
        return {
          write: composed.write,
          responseCode: 201,
          responseBody: canonicalJsonStringify(composed.body),
        };
      },
    });
  let result;
  try {
    try {
      result = await attempt();
    } catch (caught) {
      // Two people printing at once read the same next number; the loser's batch aborted whole
      // on the unique index, so reading again gives it the numbers after the winner's.
      if (!isTrustCheckNumberConflict(caught)) throw caught;
      result = await attempt();
    }
  } catch (caught) {
    if (caught instanceof TrustValidationError) return trustCheckErrorResponse(c, caught);
    if (isTrustCheckNumberConflict(caught)) {
      return problemJson(c, {
        type: "trust-check-number-taken",
        title: "Someone else is printing checks on this account",
        status: 409,
        detail: "Another print took the same check numbers. Print again.",
      });
    }
    throw caught;
  }
  if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
    return problemResponseForIdempotencyConflict(c, result);
  }
  if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
  return c.json(JSON.parse(result.responseBody ?? "{}") as Body, 201);
}
