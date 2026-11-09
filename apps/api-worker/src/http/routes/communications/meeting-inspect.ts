// THE OPERATOR'S READ INTO ONE LIVE MEETING, and the only one there is.
//
// A meeting is the hardest thing in this platform to see into, and deliberately so: it holds no
// rows, its state is deleted as it goes, and the two ends that can see anything are a browser
// somebody else is sitting at and a Durable Object that hibernates between frames. Everything a
// support question about a meeting needs — is the roster what the member thinks it is, is their
// socket even open, is the alarm armed, is the room spotlighting somebody who left, is the browser
// itself reporting a connection that cannot carry a camera — is knowable only from inside the room.
//
// WHY IT IS THE PLATFORM-OPERATOR GUARD AND NOT A FIRM PERMISSION. Every other read of a meeting
// goes through the chokepoint's firm door, which resolves the session's firm and answers the
// reserved 404 for anything else. That door is right for a member and cannot serve this: the caller
// is diagnosing a firm's meeting from outside that firm, and a capability that let a member read
// the room's internals would be a capability to read a colleague's connection quality and their
// place in it. So the firm is named in the query and the authority is the platform's own — the same
// lane `routes/platform-status.ts` runs in, with `surface: "public"` meaning only that the
// per-firm chokepoint does not try to resolve a firm, never that the route is open.
//
// WHAT COMES BACK IS ARGUED OUT IN `meetings/room/room-inspect.ts` — handles, counts, instants and
// the browsers' own measurements, and never a session description, a display name or a track name.
// The route adds nothing to that set and must not.
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import { insertAuthAuditStatement } from "@magna-carta/data-access/auth-audit-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { AuthAuditId } from "@magna-carta/identifiers/types";
import { identifierPattern } from "@magna-carta/identifiers/validate";
import type { Bindings } from "../../../bindings.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { identifierPathParam } from "../../contracts/common.ts";
import { Problem } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { meetingRoomFor } from "./meetings.ts";
import { platformOperatorGuard } from "../shared/platform-operator-guard.ts";

const ClientSample = z
  .object({
    at: z.string(),
    quality: z.string().nullable(),
    roundTripMilliseconds: z.number().nullable(),
    lossFraction: z.number().nullable(),
    jitterMilliseconds: z.number().nullable(),
    outboundRid: z.string().nullable(),
    outboundWidth: z.number().nullable(),
    outboundHeight: z.number().nullable(),
    outboundBitsPerSecond: z.number().nullable(),
    inboundCount: z.number().nullable(),
  })
  .openapi("MeetingRoomClientSample");

const InspectedParticipant = z
  .object({
    participantId: z.string(),
    userId: z.string(),
    hostRole: z.enum(["host", "co-host"]).nullable(),
    speaking: z.boolean(),
    muted: z.boolean(),
    presenceDirty: z.boolean(),
    // When this person asked for the floor, or null while their hand is down. The room's one stored
    // half of the hand; the queue a host works through is every entry with one, oldest first.
    handRaisedAt: z.string().nullable(),
    connected: z.boolean(),
    socketLostAt: z.string().nullable(),
    sfuSessionId: z.string().nullable(),
    trackCount: z.number().int(),
    subscribedMidCount: z.number().int(),
    reportAt: z.string().nullable(),
    lastSample: ClientSample.nullable(),
  })
  .openapi("MeetingRoomInspectedParticipant");

const InspectedWaiting = z
  .object({
    participantId: z.string(),
    userId: z.string(),
    waitingFrom: z.string(),
    socketLostAt: z.string().nullable(),
  })
  .openapi("MeetingRoomInspectedWaiting");

const RoomInspection = z
  .object({
    firmId: z.string().nullable(),
    meetingId: z.string().nullable(),
    medium: z.string().nullable(),
    locked: z.boolean(),
    lobby: z.string(),
    spotlight: z.object({ participantId: z.string(), by: z.string(), at: z.string() }).nullable(),
    endedAt: z.string().nullable(),
    roster: z.array(InspectedParticipant),
    waiting: z.array(InspectedWaiting),
    sockets: z.object({
      count: z.number().int(),
      attendanceIds: z.array(z.string()),
      unreadable: z.number().int(),
      welcomed: z.number().int(),
    }),
    alarm: z.object({
      at: z.string().nullable(),
      pendingJobs: z.array(
        z.enum([
          "participant-grace",
          "door-grace",
          "presence-flush",
          "reaction-flush",
          "ended-marker-retirement",
        ]),
      ),
    }),
    storage: z.object({ keyCount: z.number().int(), approximateBytes: z.number().int() }),
    sfuSessionIds: z.array(z.string()),
  })
  .openapi("MeetingRoomInspection");

// THE FIRM IS A QUERY PARAMETER, which every other meeting route would refuse to allow.
//
// Those routes address the room by the SESSION firm and never by a value the caller supplies,
// because a firm naming another firm's handle would be signaling into its meeting. That rule
// protects a firm from another firm, and it has nothing to say about a platform operator, who
// belongs to no firm and whose whole authority is the platform's. There is no session firm to read
// here, so the firm has to be named — and the guard, not the address, is what decides.
const inspectQuery = z.object({
  firmId: z
    .string()
    .regex(identifierPattern("firm"))
    .openapi({ param: { name: "firmId", in: "query" } }),
});

// surface: "public" is the platform-operator exception, on the precedent of platform-status.ts: the
// guard does the authentication and authorization, so the chokepoint skips the session/firm/RBAC
// gates and keeps the rate-limit gate. The route is a GET and names no permission, because every
// permission this platform has is firm-scoped and the caller holds none in the firm being read.
const inspectMeta: RouteMeta = {
  operationId: "meetings.inspect",
  surface: "public",
  authenticated: true,
  permission: null,
  resource: "firm",
  // A READ, AND AUDITED ANYWAY. Nothing else in this platform lets one person see into another
  // firm's live conversation — who is in it, who is at its door, how each of them is connected —
  // and an operator who looked leaves as much of a record as an operator who changed something.
  // The row goes to the control plane's own `auth_audit` beside the other platform-operator acts,
  // because the caller belongs to no firm and the firm being read must not be handed a row it
  // could neither explain nor attribute.
  audited: true,
  idempotency: "optional",
  rateLimit: "default",
};

export const inspectRoomRoute = defineOpenAPIRoute(inspectMeta, {
  method: "get",
  path: "/api/v1/meetings/{meetingId}/inspect",
  description:
    "A platform operator reads what one meeting's signaling room is holding: the roster with each " +
    "participant's hosting role, presence, track and subscription counts and last connection " +
    "report; who is at the door; the open sockets and which stay each carries; the alarm and which " +
    "of its deadlines are pending; the storage key count and approximate size; the routing " +
    "sessions; and the ended marker. It carries no session description, no display name and no " +
    "track name, and it changes nothing. Each participant is named by the stay and by the member " +
    "handle behind it: the stay is what every frame, every event and the member's own screen " +
    'correlate by, and the member handle is what joins a report of "my tile went black" — which ' +
    "arrives as a person, and often as the second of that person's two stays — to the room that " +
    "was serving them. Both are minted identifiers; neither says who anybody is. A room that has " +
    "never been addressed answers with empty lists rather than a refusal — that is itself the " +
    "finding.",
  request: {
    params: z.object({ meetingId: identifierPathParam("meeting", "meetingId") }),
    query: inspectQuery,
  },
  responses: {
    200: {
      description: "What the room is holding",
      content: { "application/json": { schema: RoomInspection } },
    },
    401: {
      description: "Not signed in",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "Not a platform operator, or 2FA not enabled",
      content: { "application/problem+json": { schema: Problem } },
    },
    422: {
      description: "The meeting or firm handle is not a well-formed identifier",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export function registerMeetingInspectRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    {
      ...inspectRoomRoute,
      middleware: chokepointMiddleware(chokepoint, inspectRoomRoute, [
        platformOperatorGuard as MiddlewareHandler,
      ]),
    },
    async (c) => {
      const { meetingId } = c.req.valid("param");
      const { firmId } = c.req.valid("query");
      // WRITTEN BEFORE THE ROOM IS READ, and awaited, so there is no ordering in which the answer
      // is served and the record is not there. It carries the operator, the firm and the meeting
      // and nothing else — who was in the room is what the answer is, and an audit row holding a
      // copy of it would be a second, permanent copy of the thing this route exists to show once.
      await insertAuthAuditStatement(c.env.DB_CONTROL, {
        id: newIdentifier("authAudit") as AuthAuditId,
        event: "meeting.room_inspected",
        userId: c.get("platformOperatorUserId") ?? null,
        metadata: { firmId, meetingId },
        now: new Date().toISOString(),
      }).run();
      // Addressed exactly as every other caller addresses it, through the one resolver — a second
      // way of naming the object would be a second answer to which room this is.
      const inspection = await meetingRoomFor(c.env, firmId, meetingId).inspect();
      // Copied out of its readonly shape rather than cast through it: the room states what it holds
      // as something nothing downstream may edit, and the contract's own type is the mutable body
      // this route serializes. A cast would make the two agree by assertion instead of by shape.
      return c.json(
        {
          ...inspection,
          roster: [...inspection.roster],
          waiting: [...inspection.waiting],
          sockets: {
            ...inspection.sockets,
            attendanceIds: [...inspection.sockets.attendanceIds],
          },
          alarm: { ...inspection.alarm, pendingJobs: [...inspection.alarm.pendingJobs] },
          sfuSessionIds: [...inspection.sfuSessionIds],
        },
        200,
      );
    },
  );
}
