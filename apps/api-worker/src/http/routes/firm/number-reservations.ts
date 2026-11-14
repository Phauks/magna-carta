import { todayInUtc } from "@magna-carta/civil-time/civil-date";
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import {
  COMMUNICATION_NUMBERING_TABLES,
  communicationNumberDate,
} from "@magna-carta/communications/numbering";
import { CONFLICTS_CHECK_NUMBERING_TABLES } from "@magna-carta/conflicts/check-numbering";
import { CUSTODY_NUMBERING_TABLES } from "@magna-carta/custodian/numbering/counter-statements";
import { MATTER_NUMBERING_TABLES } from "@magna-carta/matters/numbering/counter-statements";
import type { SequenceNumberingTables } from "@magna-carta/sequence-numbering/counter-statements";
import { NumberingRenderError, type RenderContext } from "@magna-carta/sequence-numbering/render";
import { holdNumber, releaseNumber } from "@magna-carta/sequence-numbering/reservation";
import { NumberingSchemeMissingError } from "@magna-carta/sequence-numbering/scheme-draw";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { Problem } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";

// The draft number a create panel shows: held for that panel while it is open, given back when it
// is cancelled, and taken by the record when it is saved. The lifecycle and the two-people-at-once
// reasoning are @magna-carta/sequence-numbering/reservation; these routes are its HTTP edge.
//
// ONE ROUTE FOR EVERY RUN, because the only per-run facts are the counter tables and how the date the
// count runs under is read, both below. The rest of a number's context (a matter's office or type
// code) arrives from the panel as plain strings: it is a HINT. The record's own save renders from the
// record, and a hold that does not match the record's scope is simply not honoured — so a wrong hint
// costs the panel its draft number, never the run a gap or a duplicate.

// The runs a panel holds a draft number for: every segment-scoped run the register marks `held`.
// The invoice run is absent on purpose (it is numbered at finalize, in creation order), and so is
// the time entry run (captured in batches, with no panel to hold for).
const HELD_PURPOSES = [
  "matter",
  "consultation",
  "intake",
  "conflicts_check",
  "custody_packet",
  "communication",
] as const;
type HeldPurpose = (typeof HELD_PURPOSES)[number];

const TABLES: Record<HeldPurpose, SequenceNumberingTables> = {
  matter: MATTER_NUMBERING_TABLES,
  consultation: MATTER_NUMBERING_TABLES,
  intake: MATTER_NUMBERING_TABLES,
  conflicts_check: CONFLICTS_CHECK_NUMBERING_TABLES,
  custody_packet: CUSTODY_NUMBERING_TABLES,
  communication: COMMUNICATION_NUMBERING_TABLES,
};

const HoldRequest = z
  .object({
    purpose: z.enum(HELD_PURPOSES),
    // The panel's current hold. Kept and renewed where it is still this scope's; given back and
    // replaced where it is not.
    token: z.string().min(1).max(100).optional(),
    // The instant a call or text happened, which decides the day its number counts under. Absent
    // means now; every other run counts under today.
    occurredAt: z.string().datetime().optional(),
    // What else the firm's scheme may render, as the panel knows it so far.
    context: z
      .object({
        locationCode: z.string().max(64),
        matterTypeCode: z.string().max(64),
        clientCode: z.string().max(64),
        staffInitials: z.string().max(16),
        clientName: z.string().max(300),
      })
      .partial()
      .optional(),
  })
  .openapi("NumberReservationRequest");

const HoldResponse = z
  .object({
    // Null where nothing can be held yet: the run has no scheme in force, or the scheme needs a part
    // the panel has not supplied. The panel names the kind of record alone until it can.
    token: z.string().nullable(),
    number: z.string().nullable(),
    expiresAt: z.string().nullable(),
  })
  .openapi("NumberReservationResponse");

// Every member opens records that are numbered, so holding a draft number rides the key every
// default role carries for reading the firm's numbering. It writes no audit row: a hold is not an
// act on any record, and the record that takes it is audited when it is saved.
const PERMISSION = "matters:viewNumbering" as const;

export const holdDraftNumberMeta: RouteMeta = {
  operationId: "numbering.holdDraftNumber",
  surface: "app",
  authenticated: true,
  permission: PERMISSION,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

export const holdDraftNumberRoute = defineOpenAPIRoute(holdDraftNumberMeta, {
  method: "post",
  path: "/api/v1/number-reservations",
  description:
    "Holds the draft number a create panel shows, or renews the one it holds. The number is kept " +
    "for the panel until it saves (the record takes exactly that number), cancels (the number is " +
    "given back for the next record), or goes quiet for fifteen minutes (the hold lapses and the " +
    "number is given back). A run never keeps a gap: the next record in the scope takes the lowest " +
    "number given back before the counter moves.",
  request: {
    body: { content: { "application/json": { schema: HoldRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The number held, or nulls where nothing can be held yet",
      content: { "application/json": { schema: HoldResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The session member lacks matters:viewNumbering",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "The firm is unreachable or the member is deactivated",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export const releaseDraftNumberMeta: RouteMeta = {
  operationId: "numbering.releaseDraftNumber",
  surface: "app",
  authenticated: true,
  permission: PERMISSION,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
  // Holding a number again is the reversal: the number given back is the lowest free one in its
  // scope, so the next hold there takes it.
  reversal: { kind: "inverse", by: "numbering.holdDraftNumber" },
};

export const releaseDraftNumberRoute = defineOpenAPIRoute(releaseDraftNumberMeta, {
  method: "delete",
  path: "/api/v1/number-reservations/{token}",
  description:
    "Gives a held draft number back, because its panel was cancelled. Only the member holding it " +
    "can; a token already saved, already given back, or held by somebody else changes nothing.",
  request: { params: z.object({ token: z.string().min(1).max(100) }) },
  responses: {
    204: { description: "The number is no longer held by this member" },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The session member lacks matters:viewNumbering",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "The firm is unreachable or the member is deactivated",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

type NumberReservationApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

// A bearer for one hold. Random rather than an identifier handle: nothing references a hold, and
// the token is all a panel carries.
function newHoldToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function registerNumberReservationRoutes(
  app: NumberReservationApp,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    { ...holdDraftNumberRoute, middleware: chokepointMiddleware(chokepoint, holdDraftNumberRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const request = c.req.valid("json");
      const now = new Date().toISOString();
      // The day each run counts under, read exactly as its own save reads it: a call by the UTC day
      // it happened, everything else by the UTC day it is created.
      const openedDate =
        request.purpose === "communication"
          ? communicationNumberDate(request.occurredAt ?? now)
          : todayInUtc();
      const context: RenderContext = { ...request.context, openedDate };
      try {
        const held = await holdNumber(firm.firmDatabase, {
          purpose: request.purpose,
          tables: TABLES[request.purpose],
          context,
          holderUserId: userId,
          now,
          token: request.token,
          newToken: newHoldToken,
        });
        return c.json(held as z.infer<typeof HoldResponse>, 200);
      } catch (caught) {
        if (
          caught instanceof NumberingSchemeMissingError ||
          caught instanceof NumberingRenderError
        ) {
          if (request.token !== undefined) {
            await releaseNumber(firm.firmDatabase, request.token, userId);
          }
          return c.json({ token: null, number: null, expiresAt: null }, 200);
        }
        throw caught;
      }
    },
  );

  app.openapi(
    {
      ...releaseDraftNumberRoute,
      middleware: chokepointMiddleware(chokepoint, releaseDraftNumberRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const { token } = c.req.valid("param");
      await releaseNumber(firm.firmDatabase, token, userId);
      return c.body(null, 204);
    },
  );
}
