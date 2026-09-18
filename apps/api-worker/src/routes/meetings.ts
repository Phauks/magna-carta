import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import type { BatchDatabase, EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type { MeetingId, UserId } from "@magna-carta/identifiers/types";
import {
  createMeeting,
  endMeeting,
  joinMeeting,
  leaveMeeting,
} from "@magna-carta/meetings/meeting-service";
import {
  listAttendance,
  readMeeting,
  readMeetingForEvent,
  readMeetingSummary,
  readOpenAttendance,
} from "@magna-carta/meetings/meeting-statements";
import { MEETING_EVENT_KINDS, type MeetingEventKind } from "@magna-carta/meetings/types";
import { MeetingValidationError } from "@magna-carta/meetings/validation";
import type { Context } from "hono";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierPathParam } from "../contracts/common.ts";
import { Problem, problemJson, type ProblemResponse } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../idempotency-conflict-problems.ts";
import { isWebSocketUpgrade } from "../progress/job-progress-sockets.ts";
import { meetingSocketRequest } from "../meetings/meeting-room.ts";
import { sfuClientForEnv } from "../meetings/sfu-client.ts";

// The meeting's HTTP surface: start a room on a calendar event, arrive, leave, close it, read who
// was in it, and upgrade into the room's signaling socket.
//
// WHAT THESE ROUTES RECORD AND WHAT THEY CANNOT. Identifiers and instants — that a gathering
// happened and who was in it. The audio, the video and the screen share are routed between browsers
// by the media service and never reach this platform at all, so there is nothing else for these
// routes to hold back.
//
// WHETHER MEETINGS ARE CONFIGURED is answered HERE rather than in the domain package, because it is
// a fact about this Worker's bindings: with no media routing credentials there is nowhere for a
// meeting's media to go, so starting or joining one answers 503 and a surface offers no way to try.
// It rides beside a summary rather than inside one, which is why `configured` is added here.
//
// ONE REFUSAL FOR EVERY WAY A ROOM IS OUT OF REACH. An unknown meeting handle, an unknown event, an
// event with no meeting on it and an event on a matter the member may not see are all 404: a meeting
// is reachable only through its event, so those are one question. Telling them apart would make
// these routes an existence oracle for a walled matter.

const JOIN = "meetings:join" as const;
const HOST = "meetings:host" as const;

// The relay credentials a browser is handed at join are short-lived on purpose: a relay
// authorization is billed to this account, so it lasts about as long as a meeting rather than
// indefinitely.
const RELAY_CREDENTIAL_TTL_SECONDS = 3600;

// The public resolution server a browser falls back on when this deployment mints no relay
// credentials for it. It carries no credential and routes no media — it only tells a browser what
// its own address looks like from outside, which is the minimum two peers need to find each other.
const PUBLIC_RESOLUTION_SERVER = { urls: "stun:stun.cloudflare.com:3478" } as const;

// ---- request/response contracts ----

const StartMeetingRequest = z
  .object({
    eventKind: z.enum(MEETING_EVENT_KINDS),
    // Not an identifier-typed field: the handle is a matter event's or a firm event's depending on
    // the kind beside it, and a schema that named one would refuse the other. The read through the
    // visibility gate is what decides whether it names anything at all.
    eventId: z.string().min(1).max(64),
  })
  .openapi("StartMeetingRequest");

const MeetingSummaryResponse = z
  .object({
    id: z.string(),
    eventKind: z.enum(MEETING_EVENT_KINDS),
    eventId: z.string(),
    // Null on a firm event, which belongs to no matter — the reason both permission keys bind the
    // firm rather than a matter.
    matterId: z.string().nullable(),
    // The event's own facts, resolved by the read rather than copied onto the meeting. A second copy
    // would be a second answer to a question the event already answers.
    title: z.string(),
    startsOn: z.string(),
    startsAtTime: z.string().nullable(),
    endsAtTime: z.string().nullable(),
    timeZone: z.string(),
    status: z.enum(["scheduled", "live", "ended"]),
    // When the FIRST person arrived, which is neither when the room was opened nor the hour the
    // event was scheduled for. Null on a room nobody has walked into.
    startedAt: z.string().nullable(),
    endedAt: z.string().nullable(),
    // How many people are in the room right now, counted off the open stays on every read.
    liveCount: z.number().int().min(0),
    // Whether this deployment can route a meeting's media at all. A fact about the deployment, not
    // about the meeting or the member — a surface reads it to decide whether to offer a way in.
    configured: z.boolean(),
  })
  .openapi("MeetingSummary");

const IceServer = z
  .object({
    urls: z.union([z.string(), z.array(z.string())]),
    username: z.string().optional(),
    credential: z.string().optional(),
  })
  .openapi("MeetingIceServer");

const JoinedMeeting = z
  .object({
    // The caller's own stay, which is what identifies them on the roster and in every signaling
    // frame. A member who rejoins after leaving gets a new one, because that is a new stay.
    participantId: z.string(),
    displayName: z.string(),
    // What the browser hands its own connection so two participants behind different networks can
    // find each other. Empty where this deployment mints none, in which case the browser uses
    // whatever it is configured with.
    iceServers: z.array(IceServer),
  })
  .openapi("JoinedMeeting");

const MeetingAttendanceEntry = z
  .object({
    id: z.string(),
    userId: z.string(),
    joinedAt: z.string(),
    // Null while the person is still in the room. Ending the meeting closes every open stay at ONE
    // instant, so nobody's stay runs forever because they closed a laptop.
    leftAt: z.string().nullable(),
  })
  .openapi("MeetingAttendanceEntry");

const MeetingAttendance = z
  .object({ data: z.array(MeetingAttendanceEntry) })
  .openapi("MeetingAttendance");

const StartedMeeting = z
  .object({
    id: z.string(),
    // True when this request opened the room, false when it found one already open. Two members
    // pressing Start on the same hearing is the ordinary case and not a race to be punished — what
    // they want is to be in the same room.
    created: z.boolean(),
  })
  .openapi("StartedMeeting");

const Acknowledged = z.object({ ok: z.literal(true) }).openapi("MeetingAcknowledged");

const meetingIdParam = z.object({ meetingId: identifierPathParam("meeting", "meetingId") });
const eventIdParam = z.object({ eventId: identifierPathParam("matterEvent", "eventId") });
const firmEventIdParam = z.object({
  firmEventId: identifierPathParam("firmEvent", "firmEventId"),
});

const commonErrors = {
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "The session member lacks the required permission",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description: "No meeting this member can reach at that address",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limited",
    content: { "application/problem+json": { schema: Problem } },
  },
};

const writeErrors = {
  400: {
    description: "Missing Idempotency-Key (this operation requires one)",
    content: { "application/problem+json": { schema: Problem } },
  },
  ...commonErrors,
  409: {
    description:
      "The meeting has ended, the room is full, or a request with this Idempotency-Key is in progress",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description: "The request body is not a shape this operation accepts",
    content: { "application/problem+json": { schema: Problem } },
  },
  503: {
    description: "This deployment cannot route a meeting's media",
    content: { "application/problem+json": { schema: Problem } },
  },
};

// ---- route metas ----

// BOTH KEYS BIND resource: "firm" rather than "matter". A meeting hangs from a calendar event, and a
// firm event belongs to no matter at all — so a matter cannot be the tenancy root for a record that
// need not have one. The matter question is still asked: every read composes the visible-matter
// predicate, which is what makes a walled matter's event unreachable. The binding decides which root
// the chokepoint resolves, not what a read returns. This is the line communications:* already sits on.
function readMeta(action: string): RouteMeta {
  return {
    operationId: `meetings.${action}`,
    surface: "app",
    authenticated: true,
    permission: JOIN,
    resource: "firm",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  };
}

function writeMeta(action: string, permission: typeof JOIN | typeof HOST): RouteMeta {
  return {
    operationId: `meetings.${action}`,
    surface: "app",
    authenticated: true,
    permission,
    resource: "firm",
    audited: true,
    // Required. A retried join must not open a second stay for one person — the roster would count
    // them twice against a room that holds twelve, and their record would say they were in the
    // meeting twice over without ever having left.
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

// ---- routes ----

const startRoute = defineOpenAPIRoute(writeMeta("start", HOST), {
  method: "post",
  path: "/api/v1/meetings",
  description:
    "Starts a meeting on a calendar event, or returns the one already on it. Answers 201 when this " +
    "request opened the room and 200 when it found one, so two members pressing Start on the same " +
    "hearing end up in the same place rather than in two rooms. Answers 503 where this deployment " +
    "cannot route a meeting's media.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: StartMeetingRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The event already had a meeting",
      content: { "application/json": { schema: StartedMeeting } },
    },
    201: {
      description: "The meeting was started",
      content: { "application/json": { schema: StartedMeeting } },
    },
    ...writeErrors,
  },
});

const getRoute = defineOpenAPIRoute(readMeta("get"), {
  method: "get",
  path: "/api/v1/meetings/{meetingId}",
  description:
    "One meeting: the room, the event's own title and times, how many people are in it right now, " +
    "and whether this deployment can route a meeting's media at all.",
  request: { params: meetingIdParam },
  responses: {
    200: {
      description: "The meeting",
      content: { "application/json": { schema: MeetingSummaryResponse } },
    },
    ...commonErrors,
  },
});

const getForEventRoute = defineOpenAPIRoute(readMeta("getForEvent"), {
  method: "get",
  path: "/api/v1/events/{eventId}/meeting",
  description:
    "The meeting on one case-calendar event, or 404 where the event has none — which is how an " +
    "event nobody has started is told apart from one that has.",
  request: { params: eventIdParam },
  responses: {
    200: {
      description: "The event's meeting",
      content: { "application/json": { schema: MeetingSummaryResponse } },
    },
    ...commonErrors,
  },
});

const getForFirmEventRoute = defineOpenAPIRoute(readMeta("getForFirmEvent"), {
  method: "get",
  path: "/api/v1/firm-events/{firmEventId}/meeting",
  description: "The meeting on one firm-calendar event, or 404 where the event has none.",
  request: { params: firmEventIdParam },
  responses: {
    200: {
      description: "The firm event's meeting",
      content: { "application/json": { schema: MeetingSummaryResponse } },
    },
    ...commonErrors,
  },
});

const joinRoute = defineOpenAPIRoute(writeMeta("join", JOIN), {
  method: "post",
  path: "/api/v1/meetings/{meetingId}/join",
  description:
    "Opens the caller's stay in a meeting and returns what their browser needs to connect: the " +
    "stay that identifies them on the roster, the name others see, and the servers their " +
    "connection resolves addresses through. A member already in the room gets their existing stay " +
    "back rather than a second one.",
  request: { params: meetingIdParam, headers: idempotencyKeyHeader },
  responses: {
    200: {
      description: "The caller is in the meeting",
      content: { "application/json": { schema: JoinedMeeting } },
    },
    ...writeErrors,
  },
});

const leaveRoute = defineOpenAPIRoute(writeMeta("leave", JOIN), {
  method: "post",
  path: "/api/v1/meetings/{meetingId}/leave",
  description:
    "Closes the caller's own stay and nothing else, and removes them from the room's roster. A " +
    "stay already closed is not closed again: that instant is in somebody's record of what happened.",
  request: { params: meetingIdParam, headers: idempotencyKeyHeader },
  responses: {
    200: {
      description: "The caller has left",
      content: { "application/json": { schema: Acknowledged } },
    },
    ...writeErrors,
  },
});

const endRoute = defineOpenAPIRoute(writeMeta("end", HOST), {
  method: "post",
  path: "/api/v1/meetings/{meetingId}/end",
  description:
    "Ends the meeting: every open stay closes at one instant, the room tells everybody still " +
    "connected, and every socket closes. A room nobody joined can be ended too — one meeting per " +
    "event is held by the database, so a room opened by mistake must be closable.",
  request: { params: meetingIdParam, headers: idempotencyKeyHeader },
  responses: {
    200: {
      description: "The meeting has ended",
      content: { "application/json": { schema: Acknowledged } },
    },
    ...writeErrors,
  },
});

const attendanceRoute = defineOpenAPIRoute(readMeta("attendance"), {
  method: "get",
  path: "/api/v1/meetings/{meetingId}/attendance",
  description:
    "Who was in the room and when, oldest arrival first — the record the meeting exists to leave. " +
    "One row per stay, so somebody whose connection dropped and who came back appears twice, which " +
    "is what happened.",
  request: { params: meetingIdParam },
  responses: {
    200: {
      description: "Every stay in this meeting",
      content: { "application/json": { schema: MeetingAttendance } },
    },
    ...commonErrors,
  },
});

const socketRoute = defineOpenAPIRoute(readMeta("socket"), {
  method: "get",
  path: "/api/v1/meetings/{meetingId}/socket",
  description:
    "Opens the meeting's signaling socket. The server sends a welcome carrying the caller's own " +
    "participant handle and the current roster, then a roster frame on every change; the client " +
    'publishes, subscribes, renegotiates and closes tracks over it, and { "type": "ping" } is a ' +
    "keepalive. Requires an Upgrade: websocket request and an open stay in the meeting — join first.",
  request: { params: meetingIdParam },
  responses: {
    101: { description: "The signaling socket is open; frames follow" },
    ...commonErrors,
    409: {
      description: "The meeting has ended, or the caller has not joined it",
      content: { "application/problem+json": { schema: Problem } },
    },
    426: {
      description: "The request did not ask to upgrade to a WebSocket",
      content: { "application/problem+json": { schema: Problem } },
    },
    503: {
      description: "This deployment cannot route a meeting's media",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

// ---- refusals ----

function meetingErrorResponse(
  c: Context,
  caught: MeetingValidationError,
): ProblemResponse<404> | ProblemResponse<409> {
  switch (caught.code) {
    // The one refusal for every way a room is out of reach, kept indistinguishable on purpose.
    case "meeting-unknown-event":
      return problemJson(c, {
        type: "meeting-not-found",
        title: "Not found",
        status: 404,
        detail: caught.message,
      });
    case "meeting-already-ended":
      return problemJson(c, {
        type: "meeting-ended",
        title: "This meeting has ended",
        status: 409,
        detail: caught.message,
      });
    case "meeting-room-full":
      return problemJson(c, {
        type: "meeting-room-full",
        title: "This meeting is full",
        status: 409,
        detail: caught.message,
      });
    // Both say the same thing to the person in front of the screen: they are not in this meeting.
    // A room nobody has walked into is a room the caller has not joined either, and a second problem
    // type for it would be a distinction only the server can act on.
    case "meeting-not-live":
    case "meeting-not-joined":
      return problemJson(c, {
        type: "meeting-not-joined",
        title: "You are not in this meeting",
        status: 409,
        detail: caught.message,
      });
  }
}

function notConfigured(c: Context): ProblemResponse<503> {
  return problemJson(c, {
    type: "meetings-not-configured",
    status: 503,
    title: "Meetings are not configured",
    detail: "This deployment cannot route a meeting's audio and video.",
  });
}

function notFound(c: Context): ProblemResponse<404> {
  return problemJson(c, {
    type: "meeting-not-found",
    title: "Not found",
    status: 404,
    detail: "No such meeting in this firm.",
  });
}

// ---- helpers ----

function serviceOptions(userId: string) {
  return {
    clock: { now: () => new Date().toISOString() },
    actorUserId: userId as UserId,
    randomSource: cryptoRandomSource,
    // The same predicate every calendar source composes, so an id-addressed write cannot reach a
    // room a list read could not.
    visibility: visibleMatterPredicate(),
  };
}

type EffectOutcome<T> =
  | { ok: true; value: T; responseCode: number }
  | { ok: false; problem: ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> };

/**
 * Runs one meeting write through the idempotency gate, mapping the subsystem's refusals on the way
 * out. The stored body IS the wire body: the gate replays it verbatim, so a retried join answers
 * with the same stay rather than opening another.
 */
async function commitEffect<T>(
  c: Context,
  database: BatchDatabase,
  idempotency: { key: string | undefined; fingerprint: string },
  call: () => Promise<{ value: T; responseCode: number; effect: EffectWrite }>,
): Promise<EffectOutcome<T>> {
  let result;
  try {
    result = await runIdempotentEffect({
      database,
      key: idempotency.key,
      fingerprint: idempotency.fingerprint,
      now: () => new Date().toISOString(),
      effect: async () => {
        const { value, responseCode, effect } = await call();
        return { write: effect, responseCode, responseBody: canonicalJsonStringify(value) };
      },
    });
  } catch (caught) {
    if (caught instanceof MeetingValidationError) {
      return { ok: false, problem: meetingErrorResponse(c, caught) };
    }
    throw caught;
  }
  if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
    return { ok: false, problem: problemResponseForIdempotencyConflict(c, result) };
  }
  return {
    ok: true,
    value: JSON.parse(result.responseBody ?? "{}") as T,
    responseCode: result.responseCode,
  };
}

/** The name colleagues see on the roster, read from the firm's own member row. */
async function displayNameOf(database: SqlDatabase, userId: string): Promise<string> {
  const { results } = await database
    .prepare("SELECT display_name AS displayName FROM member WHERE user_id = ?1")
    .bind(userId)
    .all<{ displayName: string | null }>();
  return results[0]?.displayName ?? "";
}

/**
 * The servers a browser resolves its own address through, minted per join.
 *
 * A JOIN NEVER FAILS OVER THIS. Two participants on the same network find each other without any of
 * it, and one behind a strict network is better served by trying and failing to connect than by
 * being refused entry to a meeting that is otherwise working. So a relay service that will not
 * answer degrades to the public resolution server, which carries no credential and routes nothing —
 * it only tells a browser what its address looks like from outside.
 *
 * A deployment that mints no relay credentials at all answers with an empty list, which is a
 * different statement: nothing was attempted, so the browser uses whatever it is configured with.
 */
async function iceServersFor(env: Bindings): Promise<z.infer<typeof IceServer>[]> {
  const keyId = env.REALTIME_TURN_TOKEN_ID;
  const apiToken = env.REALTIME_TURN_TOKEN_SECRET;
  if (!keyId || !apiToken) return [];

  try {
    const upstream = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${apiToken}`, "content-type": "application/json" },
        body: JSON.stringify({ ttl: RELAY_CREDENTIAL_TTL_SECONDS }),
      },
    );
    // Never surfaced and never logged: the body can echo the key id.
    if (!upstream.ok) return [PUBLIC_RESOLUTION_SERVER];
    const parsed = iceServersFrom(await upstream.json());
    return parsed.length === 0 ? [PUBLIC_RESOLUTION_SERVER] : parsed;
  } catch {
    return [PUBLIC_RESOLUTION_SERVER];
  }
}

// Parsed defensively rather than trusted: the answer crosses a version boundary this Worker does not
// control, and a malformed entry handed to a browser fails inside its connection machinery, far from
// anything that could name the cause.
function iceServersFrom(payload: unknown): z.infer<typeof IceServer>[] {
  if (payload === null || typeof payload !== "object") return [];
  const servers = (payload as { iceServers?: unknown }).iceServers;
  const entries = Array.isArray(servers) ? servers : [servers];
  const parsed: z.infer<typeof IceServer>[] = [];
  for (const entry of entries) {
    if (entry === null || typeof entry !== "object") continue;
    const { urls, username, credential } = entry as {
      urls?: unknown;
      username?: unknown;
      credential?: unknown;
    };
    const addresses =
      typeof urls === "string"
        ? urls
        : Array.isArray(urls) && urls.every((one) => typeof one === "string")
          ? (urls as string[])
          : null;
    if (addresses === null) continue;
    parsed.push({
      urls: addresses,
      ...(typeof username === "string" ? { username } : {}),
      ...(typeof credential === "string" ? { credential } : {}),
    });
  }
  return parsed;
}

function roomFor(env: Bindings, firmId: string, meetingId: string) {
  // Addressed by the SESSION firm id, never a path value — a firm can no more signal into another
  // firm's meeting than it can read one.
  return env.MEETING_ROOM.get(env.MEETING_ROOM.idFromName(`${firmId}:${meetingId}`));
}

// ---- registration ----

export function registerMeetingsRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  // POST /api/v1/meetings
  app.openapi(
    { ...startRoute, middleware: chokepointMiddleware(chokepoint, startRoute) },
    async (c) => {
      if (sfuClientForEnv(c.env) === null) return notConfigured(c);
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { eventKind, eventId } = c.req.valid("json");

      const outcome = await commitEffect<z.infer<typeof StartedMeeting>>(
        c,
        firm.firmDatabase,
        idempotency,
        async () => {
          const started = await createMeeting(
            firm.firmDatabase,
            { eventKind: eventKind as MeetingEventKind, eventId },
            serviceOptions(userId),
          );
          return {
            value: { id: started.meetingId, created: started.created },
            // The code carries the answer a caller branches on, and it is stored with the body, so a
            // retry of the request that opened the room still reads 201.
            responseCode: started.created ? 201 : 200,
            effect: started.effect,
          };
        },
      );
      if (!outcome.ok) return outcome.problem;
      return outcome.responseCode === 201 ? c.json(outcome.value, 201) : c.json(outcome.value, 200);
    },
  );

  // GET /api/v1/meetings/{meetingId}
  app.openapi(
    { ...getRoute, middleware: chokepointMiddleware(chokepoint, getRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { meetingId } = c.req.valid("param");
      const summary = await readMeetingSummary(
        firm.firmDatabase,
        meetingId as MeetingId,
        visibleMatterPredicate(),
      );
      if (summary === undefined) return notFound(c);
      return c.json({ ...summary, configured: sfuClientForEnv(c.env) !== null }, 200);
    },
  );

  // GET /api/v1/events/{eventId}/meeting
  app.openapi(
    { ...getForEventRoute, middleware: chokepointMiddleware(chokepoint, getForEventRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { eventId } = c.req.valid("param");
      const summary = await readMeetingForEvent(
        firm.firmDatabase,
        "matter",
        eventId,
        visibleMatterPredicate(),
      );
      if (summary === undefined) return notFound(c);
      return c.json({ ...summary, configured: sfuClientForEnv(c.env) !== null }, 200);
    },
  );

  // GET /api/v1/firm-events/{firmEventId}/meeting
  app.openapi(
    { ...getForFirmEventRoute, middleware: chokepointMiddleware(chokepoint, getForFirmEventRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { firmEventId } = c.req.valid("param");
      const summary = await readMeetingForEvent(
        firm.firmDatabase,
        "firm",
        firmEventId,
        visibleMatterPredicate(),
      );
      if (summary === undefined) return notFound(c);
      return c.json({ ...summary, configured: sfuClientForEnv(c.env) !== null }, 200);
    },
  );

  // POST /api/v1/meetings/{meetingId}/join
  app.openapi(
    { ...joinRoute, middleware: chokepointMiddleware(chokepoint, joinRoute) },
    async (c) => {
      if (sfuClientForEnv(c.env) === null) return notConfigured(c);
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { meetingId } = c.req.valid("param");

      const outcome = await commitEffect<{ participantId: string }>(
        c,
        firm.firmDatabase,
        idempotency,
        async () => {
          const joined = await joinMeeting(
            firm.firmDatabase,
            meetingId as MeetingId,
            serviceOptions(userId),
          );
          return {
            value: { participantId: joined.attendanceId },
            responseCode: 200,
            effect: joined.effect,
          };
        },
      );
      if (!outcome.ok) return outcome.problem;

      // Both are read AFTER the stay is committed and neither can fail the join: the name is what
      // colleagues see on a tile, and the resolution servers are what the browser's own connection
      // uses. A member who is in the meeting stays in it either way.
      const [displayName, iceServers] = await Promise.all([
        displayNameOf(firm.firmDatabase, userId),
        iceServersFor(c.env),
      ]);
      return c.json({ participantId: outcome.value.participantId, displayName, iceServers }, 200);
    },
  );

  // POST /api/v1/meetings/{meetingId}/leave
  app.openapi(
    { ...leaveRoute, middleware: chokepointMiddleware(chokepoint, leaveRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const firmId = requireChokepointFirmId(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { meetingId } = c.req.valid("param");

      // The stay the write is about to close, read before it closes: the room's roster is keyed by
      // it, and after the commit there is nothing left to name.
      const open = await readOpenAttendance(
        firm.firmDatabase,
        meetingId as MeetingId,
        userId as UserId,
      );

      const outcome = await commitEffect<{ ok: true }>(
        c,
        firm.firmDatabase,
        idempotency,
        async () => {
          const left = await leaveMeeting(
            firm.firmDatabase,
            meetingId as MeetingId,
            serviceOptions(userId),
          );
          return { value: { ok: true }, responseCode: 200, effect: left.effect };
        },
      );
      if (!outcome.ok) return outcome.problem;

      // Told AFTER the record commits, so nobody is dropped from a room by a write that then failed.
      if (open !== undefined) {
        await roomFor(c.env, firmId, meetingId).participantLeft(open.id);
      }
      return c.json({ ok: true } as const, 200);
    },
  );

  // POST /api/v1/meetings/{meetingId}/end
  app.openapi(
    { ...endRoute, middleware: chokepointMiddleware(chokepoint, endRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const firmId = requireChokepointFirmId(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { meetingId } = c.req.valid("param");

      const outcome = await commitEffect<{ endedAt: string }>(
        c,
        firm.firmDatabase,
        idempotency,
        async () => {
          const options = serviceOptions(userId);
          const endedAt = options.clock.now();
          const ended = await endMeeting(firm.firmDatabase, meetingId as MeetingId, {
            ...options,
            // One instant for the whole act: the stays, the meeting row and what every participant
            // is told all carry the same one, because the meeting ended once.
            clock: { now: () => endedAt },
          });
          return { value: { endedAt }, responseCode: 200, effect: ended.effect };
        },
      );
      if (!outcome.ok) return outcome.problem;

      // After the commit, for the same reason leaving is: a participant must never be told the
      // meeting ended by a write that did not land.
      await roomFor(c.env, firmId, meetingId).end(outcome.value.endedAt);
      return c.json({ ok: true } as const, 200);
    },
  );

  // GET /api/v1/meetings/{meetingId}/attendance
  app.openapi(
    { ...attendanceRoute, middleware: chokepointMiddleware(chokepoint, attendanceRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { meetingId } = c.req.valid("param");
      // Through the meeting read first, so the attendance of a room behind a matter the caller may
      // not see is as absent as the room itself.
      const meeting = await readMeeting(
        firm.firmDatabase,
        meetingId as MeetingId,
        visibleMatterPredicate(),
      );
      if (meeting === undefined) return notFound(c);
      const rows = await listAttendance(firm.firmDatabase, meetingId as MeetingId);
      return c.json(
        {
          data: rows.map((row) => ({
            id: row.id,
            userId: row.user_id,
            joinedAt: row.joined_at,
            leftAt: row.left_at,
          })),
        },
        200,
      );
    },
  );

  // GET /api/v1/meetings/{meetingId}/socket
  app.openapi(
    { ...socketRoute, middleware: chokepointMiddleware(chokepoint, socketRoute) },
    async (c) => {
      if (sfuClientForEnv(c.env) === null) return notConfigured(c);
      const firm = requireChokepointFirmContext(c);
      const firmId = requireChokepointFirmId(c);
      const userId = requireChokepointUserId(c);
      const { meetingId } = c.req.valid("param");

      const meeting = await readMeeting(
        firm.firmDatabase,
        meetingId as MeetingId,
        visibleMatterPredicate(),
      );
      if (meeting === undefined) return notFound(c);
      if (meeting.status === "ended") {
        return problemJson(c, {
          type: "meeting-ended",
          title: "This meeting has ended",
          status: 409,
          detail: "This meeting has ended.",
        });
      }

      // THE OPEN STAY IS THE TICKET. Signaling on a meeting the caller has not joined would put them
      // on the roster without a record of their being there, and the cap is counted over stays — so
      // a socket that did not need one would be a way past it.
      const open = await readOpenAttendance(
        firm.firmDatabase,
        meetingId as MeetingId,
        userId as UserId,
      );
      if (open === undefined) {
        return problemJson(c, {
          type: "meeting-not-joined",
          title: "You are not in this meeting",
          status: 409,
          detail: "Join the meeting before opening its signaling socket.",
        });
      }

      if (!isWebSocketUpgrade(c.req.raw)) {
        return problemJson(c, {
          type: "websocket-upgrade-required",
          status: 426,
          title: "WebSocket upgrade required",
          detail: "This endpoint serves the meeting's signaling socket. Send Upgrade: websocket.",
        });
      }

      // Built from server-derived values only and never by re-wrapping the caller's request, so no
      // cookie and no caller-supplied header travels on to the room.
      return await roomFor(c.env, firmId, meetingId).fetch(
        meetingSocketRequest({
          firmId,
          meetingId,
          userId,
          attendanceId: open.id,
          displayName: await displayNameOf(firm.firmDatabase, userId),
        }),
      );
    },
  );
}
