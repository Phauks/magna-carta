import { z } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import {
  GuardedWriteRefusedError,
  type BatchDatabase,
  type EffectWrite,
} from "@magna-carta/data-access/effect-batch";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import type { ExhibitSetView } from "@magna-carta/exhibits/queries";
import { ExhibitValidationError } from "@magna-carta/exhibits/validation";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type { UserId } from "@magna-carta/identifiers/types";
import type { Context } from "hono";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import { identifierPathParam } from "../../contracts/common.ts";
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import type { RouteMeta } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";

// What the two exhibit route modules share: the permissions, the metas, the error mapping, and the
// one idempotent commit every write goes through. The package composes the effect; this module
// runs it under the request's Idempotency-Key and turns a refusal into its problem.

export const MANAGE = "exhibits:manage" as const;
export const ISSUE = "exhibits:issue" as const;

export const matterIdParam = z.object({ matterId: identifierPathParam("matter", "matterId") });
export const exhibitParams = z.object({
  matterId: identifierPathParam("matter", "matterId"),
  exhibitId: identifierPathParam("matterExhibit", "exhibitId"),
});
export const setParams = z.object({
  matterId: identifierPathParam("matter", "matterId"),
  setId: identifierPathParam("exhibitSet", "setId"),
});
export const memberParams = z.object({
  matterId: identifierPathParam("matter", "matterId"),
  setId: identifierPathParam("exhibitSet", "setId"),
  memberId: identifierPathParam("exhibitSetMember", "memberId"),
});

function problem<Description extends string>(description: Description) {
  return { description, content: { "application/problem+json": { schema: Problem } } };
}

export const errors = {
  400: problem("Missing Idempotency-Key (this operation requires one)"),
  401: problem("No valid session"),
  403: problem("The session member lacks the required permission"),
  404: problem("The matter, exhibit, set or member is unknown, or the member is deactivated"),
  409: problem(
    "The set has been issued (or is not issued yet), it changed since it was read, the reference " +
      "name is taken, or a request with this Idempotency-Key is still in progress",
  ),
  422: problem("The request is invalid, or the file has no clean version on this matter"),
  429: problem("Rate limited"),
} as const;

export const readErrors = {
  401: errors[401],
  403: errors[403],
  404: errors[404],
  429: errors[429],
} as const;

export function jsonBody<T extends z.ZodType>(schema: T) {
  return { content: { "application/json": { schema } }, required: true } as const;
}

export function readMeta(action: string): RouteMeta {
  return {
    operationId: `exhibits.${action}`,
    surface: "app",
    authenticated: true,
    permission: MANAGE,
    resource: "matter",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  };
}

// Every exhibit write is idempotency-keyed: a retried add must not put a document in a set twice,
// and a retried issue must answer with the labels it froze rather than refuse its own success.
export function writeMeta(
  action: string,
  permission: typeof MANAGE | typeof ISSUE = MANAGE,
): RouteMeta {
  return {
    operationId: `exhibits.${action}`,
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

export function serviceOptions(userId: UserId) {
  return {
    clock: { now: () => new Date().toISOString() },
    actorUserId: userId,
    randomSource: cryptoRandomSource,
  };
}

type ExhibitProblem = ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422>;

// Codes, never messages, drive the mapping.
export function exhibitErrorResponse(c: Context, caught: ExhibitValidationError): ExhibitProblem {
  const detail = caught.message;
  switch (caught.code) {
    case "exhibit-unknown-exhibit":
    case "exhibit-unknown-set":
    case "exhibit-unknown-member":
    case "exhibit-unknown-folder":
      return problemJson(c, { type: "not-found", title: "Not found", status: 404, detail });
    case "exhibit-set-issued":
      return problemJson(c, {
        type: "exhibit-set-issued",
        title: "This set has been issued",
        status: 409,
        detail,
      });
    case "exhibit-set-not-issued":
      return problemJson(c, {
        type: "exhibit-set-not-issued",
        title: "This set has not been issued",
        status: 409,
        detail,
      });
    case "exhibit-set-not-following":
      return problemJson(c, {
        type: "exhibit-set-not-following",
        title: "This set follows no folder",
        status: 409,
        detail,
      });
    case "exhibit-reference-name-taken":
      return problemJson(c, {
        type: "exhibit-reference-name-taken",
        title: "That reference name is taken",
        status: 409,
        detail,
      });
    case "exhibit-position-conflict":
    case "exhibit-set-already-superseded":
    case "exhibit-member-withdrawn":
      return problemJson(c, {
        type: "exhibit-set-changed",
        title: "The set changed",
        status: 409,
        detail,
      });
    case "exhibit-file-unavailable":
      return problemJson(c, {
        type: "exhibit-file-unavailable",
        title: "That file cannot be attached",
        status: 422,
        detail,
      });
    default:
      return problemJson(c, {
        type: "validation",
        title: "Exhibit request invalid",
        status: 422,
        detail,
      });
  }
}

// A write that lost a race: its guarded statement matched nothing, or a unique index refused the
// slot it took. Both mean the set moved under the caller, and both are answered the same way.
function isRaceLost(caught: unknown): boolean {
  if (caught instanceof GuardedWriteRefusedError) return true;
  return (
    caught instanceof Error &&
    /UNIQUE constraint failed: (exhibit_set_member|exhibit_set|matter_exhibit)\./.test(
      caught.message,
    )
  );
}

function raceLostResponse(c: Context): ProblemResponse<409> {
  return problemJson(c, {
    type: "exhibit-set-changed",
    title: "The set changed",
    status: 409,
    detail: "The set changed since it was read. Read it again and redo the change.",
  });
}

/** Runs a read that may refuse by code, answering the refusal as its problem. */
export async function readOrRefuse<T>(
  c: Context,
  read: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; problem: ExhibitProblem }> {
  try {
    return { ok: true, value: await read() };
  } catch (caught) {
    if (caught instanceof ExhibitValidationError) {
      return { ok: false, problem: exhibitErrorResponse(c, caught) };
    }
    throw caught;
  }
}

type Write<Body> = (
  database: BatchDatabase,
  options: ReturnType<typeof serviceOptions>,
) => Promise<{ readonly body: Body; readonly effect: EffectWrite }>;

/**
 * Composes the effect, commits it under the request's Idempotency-Key, and answers with the body the
 * write produced. A replay answers the stored body, so a retried issue returns the labels it froze.
 */
export async function idempotentWrite<Body extends object, Status extends 200 | 201>(
  c: Context,
  status: Status,
  write: Write<Body>,
) {
  const firm = requireChokepointFirmContext(c);
  const options = serviceOptions(requireChokepointUserId(c));
  const idempotency = requireChokepointIdempotency(c);
  let result;
  try {
    result = await runIdempotentEffect({
      database: firm.firmDatabase,
      key: idempotency.key,
      fingerprint: idempotency.fingerprint,
      now: () => new Date().toISOString(),
      effect: async () => {
        const { body, effect } = await write(firm.firmDatabase, options);
        return { write: effect, responseCode: status, responseBody: canonicalJsonStringify(body) };
      },
    });
  } catch (caught) {
    if (caught instanceof ExhibitValidationError) return exhibitErrorResponse(c, caught);
    if (isRaceLost(caught)) return raceLostResponse(c);
    throw caught;
  }
  if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
    return problemResponseForIdempotencyConflict(c, result);
  }
  if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
  return c.json(JSON.parse(result.responseBody ?? "{}") as Body, status);
}

/** The wire shape of a set and its members. */
export function setDetailBody(set: ExhibitSetView) {
  return { ...set, members: set.members.map((member) => ({ ...member })) };
}
