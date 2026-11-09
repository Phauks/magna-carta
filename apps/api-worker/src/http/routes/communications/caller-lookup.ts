/*
 * Who is on the other end of a number — what the call record asks the moment a number is typed.
 *
 * TWO OPERATIONS, AND THE LINE BETWEEN THEM IS THE BILL. The first answers everything that costs
 * nothing: the Directory records that list the number, the region its area code was issued for, and
 * any caller ID the firm already paid for. It runs as the number is typed. The second is the paid
 * one — a caller-name query to the carriers' database — and runs only when a member presses for it;
 * its answer is kept (packages/communications/src/caller-identity.ts) so one number is paid for once.
 *
 * READ-SHAPED POSTS, AND THE REASON IS THE LOG. The first operation reads and writes nothing and
 * would be a GET anywhere else, but this Worker's invocation logging records every request's full
 * URL, and what is being sent is a client's telephone number. A body is not in that log. The same
 * reasoning the address lookup states (routes/directory/address-lookup.ts).
 *
 * GATED ON `communications:log`. Both operations answer a question only somebody recording a call
 * asks, on the same key the next-number preview uses. The Directory match needs no second key: any
 * member of the firm may already search the Directory by name, and this answers the same thing by
 * number — which records, and what to call them, and nothing they hold.
 */
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { areaCodeRegion } from "@magna-carta/caller-lookup/area-code";
import {
  CallerIdentityLookup,
  CallerLookup,
  CallerLookupRequest,
  KeptCallerIdentity,
} from "@magna-carta/caller-lookup/contract";
import {
  callerNameCovered,
  isCallerLineType,
  type CallerIdentity,
} from "@magna-carta/caller-lookup/port";
import {
  readCallerIdentity,
  recordCallerIdentity,
  type StoredCallerIdentity,
} from "@magna-carta/communications/caller-identity";
import { findEntitiesByPhoneNumber } from "@magna-carta/directory/phone-match";
import { structurePhoneNumber } from "@magna-carta/directory/phone-number";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type { UserId } from "@magna-carta/identifiers/types";
import type { Context } from "hono";
import type { Bindings } from "../../../bindings.ts";
import { resolveCallerLookupPort } from "../../../caller-lookup/caller-lookup-engine.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader } from "../../contracts/common.ts";
import { Problem, problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";

const PERMISSION = "communications:log" as const;

// ── Contract ────────────────────────────────────────────────────────────────
// The bodies live in @magna-carta/caller-lookup/contract; only the routes are declared here.

const problemResponse = (description: string) => ({
  description,
  content: { "application/problem+json": { schema: Problem } },
});

const commonResponses = {
  401: problemResponse("No valid session"),
  403: problemResponse("Authenticated, but the member lacks communications:log"),
  404: problemResponse("The firm is unreachable or the member is deactivated"),
  422: problemResponse("The request body failed validation"),
  429: problemResponse("Rate limit exceeded"),
};

function meta(action: string, write: boolean): RouteMeta {
  return {
    operationId: `communications.${action}`,
    surface: "app",
    authenticated: true,
    permission: PERMISSION,
    resource: "firm",
    audited: write,
    // Required on the paid one: a retried press must not pay twice. The idempotency gate replays
    // the stored answer without asking the network again.
    idempotency: write ? "required" : "optional",
    ...(write && { idempotencyStore: "firm" as const }),
    rateLimit: "default",
  };
}

export const callerLookupRoute = defineOpenAPIRoute(meta("callerLookup", false), {
  method: "post",
  path: "/api/v1/communications/caller-lookup",
  description:
    "Everything known about a number that costs nothing: the Directory records that list it, the " +
    "region its area code was issued for, and any caller ID the firm already looked up. A " +
    "read-shaped POST: it reads and writes nothing, and takes a body because what it is sent is a " +
    "client's telephone number.",
  request: {
    body: { content: { "application/json": { schema: CallerLookupRequest } }, required: true },
  },
  responses: {
    200: {
      description: "What is known about the number",
      content: { "application/json": { schema: CallerLookup } },
    },
    ...commonResponses,
  },
});

export const callerIdentityRoute = defineOpenAPIRoute(meta("callerIdentity", true), {
  method: "post",
  path: "/api/v1/communications/caller-lookup/caller-identity",
  description:
    "Asks the carriers' caller-name database who a number belongs to, and keeps the answer so the " +
    "number is never paid for twice. Each call that reaches the network is a billed query; a number " +
    "the firm already looked up is answered from the kept answer without one.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: CallerLookupRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The caller ID, or why there is none to ask for",
      content: { "application/json": { schema: CallerIdentityLookup } },
    },
    400: problemResponse("Missing Idempotency-Key (this operation requires one)"),
    409: problemResponse("A request with this Idempotency-Key is still in progress"),
    ...commonResponses,
    502: problemResponse(
      "The caller-name service did not answer, or refused. Nothing was kept; pressing again asks " +
        "again.",
    ),
  },
});

// ── Handlers ────────────────────────────────────────────────────────────────

type AppContext = Context<{ Bindings: Bindings; Variables: AppVariables }>;

/** The number's two parts, or null for an E.164 string the split cannot place. */
function numberParts(e164: string): { countryCallingCode: string; nationalNumber: string } | null {
  const structured = structurePhoneNumber(e164);
  if (structured.countryCallingCode === null || structured.nationalNumber === null) return null;
  return {
    countryCallingCode: structured.countryCallingCode,
    nationalNumber: structured.nationalNumber,
  };
}

function unplaceable(c: AppContext) {
  return problemJson(c, {
    type: "validation",
    status: 422,
    title: "Not a telephone number",
    detail: "The number could not be split into a country calling code and a national number.",
  });
}

function keptContract(stored: StoredCallerIdentity): z.infer<typeof KeptCallerIdentity> {
  return {
    callerName: stored.callerName,
    lineType:
      stored.lineType !== null && isCallerLineType(stored.lineType) ? stored.lineType : null,
    carrierName: stored.carrierName,
    lookedUpAt: stored.lookedUpAt,
  };
}

/** Thrown inside the idempotent effect so nothing is stored and a retry asks again. */
class CallerLookupFailed extends Error {
  constructor(readonly reason: string) {
    super(`caller-name lookup failed: ${reason}`);
    this.name = "CallerLookupFailed";
  }
}

export function registerCallerLookupRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  // POST /api/v1/communications/caller-lookup
  app.openapi(
    { ...callerLookupRoute, middleware: chokepointMiddleware(chokepoint, callerLookupRoute) },
    async (c) => {
      const number = numberParts(c.req.valid("json").number);
      if (number === null) return unplaceable(c);
      const database = requireChokepointFirmContext(c).firmDatabase;
      const [matches, kept] = await Promise.all([
        findEntitiesByPhoneNumber(database, number),
        readCallerIdentity(database, number),
      ]);
      const engine = resolveCallerLookupPort(c.env).engine;
      return c.json(
        {
          directoryMatches: matches.map((match) => ({
            entityId: match.entityId,
            entityKind: match.entityKind,
            displayName: match.displayName,
          })),
          areaCode: areaCodeRegion(number),
          callerIdentity: kept === null ? null : keptContract(kept),
          paidLookup: !callerNameCovered(number)
            ? ("not-covered" as const)
            : engine === "deferred"
              ? ("unavailable" as const)
              : ("available" as const),
        },
        200,
      );
    },
  );

  // POST /api/v1/communications/caller-lookup/caller-identity
  app.openapi(
    { ...callerIdentityRoute, middleware: chokepointMiddleware(chokepoint, callerIdentityRoute) },
    async (c) => {
      const number = numberParts(c.req.valid("json").number);
      if (number === null) return unplaceable(c);
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const port = resolveCallerLookupPort(c.env);
      const count = (outcome: string) =>
        c.get("logger")?.count("communications.caller_lookup", { engine: port.engine, outcome });

      // Neither of these asks the network, so neither needs the idempotency gate: there is nothing
      // to pay for twice.
      if (!callerNameCovered(number)) {
        count("not-covered");
        return c.json({ outcome: "not-covered" as const }, 200);
      }
      const kept = await readCallerIdentity(firm.firmDatabase, number);
      if (kept !== null) {
        count("cached");
        return c.json({ outcome: "found" as const, callerIdentity: keptContract(kept) }, 200);
      }
      if (port.engine === "deferred") {
        count("unavailable");
        return c.json({ outcome: "unavailable" as const }, 200);
      }

      const idempotency = requireChokepointIdempotency(c);
      let result;
      try {
        result = await runIdempotentEffect({
          database: firm.firmDatabase,
          key: idempotency.key,
          fingerprint: idempotency.fingerprint,
          now: () => new Date().toISOString(),
          effect: async () => {
            const answer = await port.lookUp(number);
            // Every outcome but `found` was ruled out above, except a refusal or a dropped
            // connection — thrown so nothing is stored and the next press asks again.
            if (answer.kind !== "found") throw new CallerLookupFailed(answer.kind);
            const identity: CallerIdentity = answer.identity;
            const { stored, effect } = recordCallerIdentity(
              firm.firmDatabase,
              number,
              identity,
              port.engine,
              {
                clock: { now: () => new Date().toISOString() },
                actorUserId: userId as UserId,
                randomSource: cryptoRandomSource,
              },
            );
            return {
              write: effect,
              responseCode: 200,
              responseBody: canonicalJsonStringify({
                outcome: "found",
                callerIdentity: keptContract(stored),
              }),
            };
          },
        });
      } catch (caught) {
        if (!(caught instanceof CallerLookupFailed)) throw caught;
        count("failed");
        return problemJson(c, {
          type: "service-unavailable",
          status: 502,
          title: "Caller ID is unavailable",
          detail: "The caller-name service did not answer. Nothing was kept; try again.",
        });
      }
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
        return problemResponseForIdempotencyConflict(c, result);
      }
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      else count("found");
      const body = JSON.parse(result.responseBody ?? "{}") as z.infer<typeof CallerIdentityLookup>;
      return c.json(body, 200);
    },
  );
}
