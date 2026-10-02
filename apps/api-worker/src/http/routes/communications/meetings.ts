import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { CIVIL_DATE_PATTERN } from "@magna-carta/civil-time/civil-date";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { decodeCursor, encodeCursor } from "@magna-carta/data-access/cursor-pagination";
import {
  GuardedWriteRefusedError,
  type BatchDatabase,
  type EffectWrite,
} from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type { MeetingId, UserId } from "@magna-carta/identifiers/types";
import {
  createMeeting,
  endMeeting,
  JOIN_CAPACITY_GUARD,
  JOIN_LOBBY_CAPACITY_GUARD,
  joinMeeting,
  leaveMeeting,
} from "@magna-carta/meetings/meeting-service";
import { isWaiting } from "@magna-carta/meetings/lobby-service";
import { MAX_MEETING_LOBBY, MEETING_LOBBY_MODES } from "@magna-carta/meetings/lobby-types";
import { readLiveHostGrant } from "@magna-carta/meetings/hosting-statements";
import {
  isMeetingPerEventConflict,
  isOpenStayConflict,
  listAttendance,
  listMeetings,
  MAX_ATTENDANCE_PAGE_SIZE,
  readMeeting,
  readMeetingForEvent,
  readMeetingSummary,
  readOpenAttendance,
} from "@magna-carta/meetings/meeting-statements";
import {
  MAX_MEETING_PARTICIPANTS,
  MEETING_DEPARTURE_REASONS,
  MEETING_EVENT_KINDS,
  MEETING_LIST_SCOPES,
  MEETING_MEDIA,
  MEETING_PARTICIPANT_KINDS,
} from "@magna-carta/meetings/types";
import { MeetingValidationError } from "@magna-carta/meetings/validation";
import type { MeetingParticipantHandle } from "@magna-carta/meetings/types";
import { identifierPattern } from "@magna-carta/identifiers/validate";
import type { Context } from "hono";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { isSameOriginUpgrade } from "../../chokepoint/same-origin-upgrade.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierPathParam } from "../../contracts/common.ts";
import { cursorQuery, paginated } from "@magna-carta/data-access/pagination-contract";
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";
import { isWebSocketUpgrade } from "../../../progress/job-progress-sockets.ts";
import { meetingSocketRequest } from "../../../meetings/meeting-room.ts";
import { sfuClientForEnv } from "../../../meetings/sfu/sfu-client.ts";
import { recordRealtimeFailure } from "../../../meetings/sfu/realtime-failure.ts";
import { generateIceServers } from "../../../meetings/sfu/turn-credentials.ts";

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

// One page of the meetings list. A firm's live meetings are a handful, and the recent window is
// thirty days of them, so this is a walk of a few pages at most rather than a bound anybody meets.
const MAX_MEETING_PAGE_SIZE = 50;

// How far back "recently ended" reaches. Long enough that a member coming back from a week away
// still finds the conference they need the attendance of; short enough that the list stays a list of
// what is happening rather than an archive, which is what the event's own record is for.
const RECENT_WINDOW_DAYS = 30;

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
    // Sound alone, or sound and pictures. Optional and defaulted to a video meeting, so a caller
    // that predates calls keeps getting what it always got. It is read ONLY when this request opens
    // the room: one meeting per event, so the first Start decides and a second one asking for the
    // other medium gets the room that exists rather than changing it under the people in it.
    medium: z.enum(MEETING_MEDIA).default("video"),
    // Whether arrivals wait at a door. Read on the same terms as the medium beside it — only when
    // this request opens the room — but UNLIKE the medium a host may change it afterwards: a medium
    // is what the people in the room agreed to, and a lobby is a standing decision about who may
    // come in. Off by default, because every participant today is a firm member arriving at an
    // event they are on.
    lobby: z.enum(MEETING_LOBBY_MODES).default("off"),
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
    // Sound alone, or sound and pictures, decided by whoever started it and fixed for its life.
    medium: z.enum(MEETING_MEDIA),
    // How many people are in the room right now, counted off the open stays on every read.
    liveCount: z.number().int().min(0),
    // WHETHER THE DOOR IS SHUT. A locked room refuses arrivals and touches nobody already in it, so
    // a Join control reads this and says so before the click rather than after it. There is
    // deliberately no "are you the host" beside it: that would put a per-caller subquery on every
    // row of a fifty-row list to answer a question only the room screen asks, and the room screen
    // has the answer on the wire.
    locked: z.boolean(),
    // WHETHER ARRIVALS WAIT AT A DOOR. Carried as the setting rather than as a boolean, because it
    // is a two-value vocabulary the write path also takes. Who is AT the door is a separate,
    // host-only read: it is a list of people a host has not yet decided about, and a fifty-row list
    // must not carry it.
    lobby: z.enum(MEETING_LOBBY_MODES),
    // Whether this deployment can route a meeting's media at all. A fact about the deployment, not
    // about the meeting or the member — a surface reads it to decide whether to offer a way in.
    configured: z.boolean(),
  })
  .openapi("MeetingSummary");

export const IceServer = z
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
    // WHETHER THE STAY IS AT THE DOOR. True means a host has not admitted them yet: their socket
    // opens into the lobby state, receives `lobby` rather than `welcome`, and captures no media.
    //
    // The relay credentials below are minted either way, and deliberately. They last an hour, which
    // covers any wait anybody will sit through, and minting one for somebody who is later denied
    // costs nothing that matters — a mint is not the billed unit, relay traffic is, and a denied
    // member relays nothing. Minting at admission instead would need a second round trip at the
    // exact moment a member is being let into a meeting that has started without them.
    waiting: z.boolean(),
    // What the browser hands its own connection so two participants behind different networks can
    // find each other. Empty where this deployment mints none, in which case the browser uses
    // whatever it is configured with.
    iceServers: z.array(IceServer),
  })
  .openapi("JoinedMeeting");

const MeetingAttendanceEntry = z
  .object({
    // The STAY's own handle — a member's `meetingAttendance_` or a guest's `meetingGuestStay_`.
    id: z.string(),
    // WHICH KIND OF STAY, because there are two tables and one record: a firm member's attendance,
    // or an external guest's stay on a signed link. Every reader says what it does with each.
    participantKind: z.enum(MEETING_PARTICIPANT_KINDS),
    // The firm member behind the stay, and NULL for a guest, who has none. Widened rather than a
    // parallel guest list, so a reader cannot quietly under-report the meeting by reading one of two.
    userId: z.string().nullable(),
    // The member's name, or for a guest the name they gave at the door.
    displayName: z.string(),
    // A guest's only: the Directory entity the link was minted for, and its name at mint — so a
    // reader sees at a glance when the person who attended is not the person who was invited. Null
    // for a member.
    entityId: z.string().nullable(),
    invitedName: z.string().nullable(),
    joinedAt: z.string(),
    // Null while the person is still in the room. Ending the meeting closes every open stay at ONE
    // instant, so nobody's stay runs forever because they closed a laptop.
    leftAt: z.string().nullable(),
    // The door, in two instants: when this stay reached it (null for somebody who never waited —
    // a guest always waits), and when a host let them in (null while they were still outside).
    waitingFrom: z.string().nullable(),
    admittedAt: z.string().nullable(),
    // How the stay ended — left, the connection went, removed, or denied at the door. Null while it
    // is open, and on a stay the meeting's ending closed.
    endedReason: z.enum(MEETING_DEPARTURE_REASONS).nullable(),
  })
  .openapi("MeetingAttendanceEntry");

const MeetingAttendancePage = paginated(MeetingAttendanceEntry).openapi("MeetingAttendancePage");

const MeetingSummaryPage = paginated(MeetingSummaryResponse).openapi("MeetingSummaryPage");

// THE DAY COMES FROM THE CALLER, and that is the whole reason this parameter exists. A civil date is
// a day in a PLACE: the server holds instants and has no zone to read one out of, so a "today"
// derived here would be UTC's — and a member in Honolulu asking at nine in the evening would lose
// the meeting they have at eleven, because the server's day had already turned over. The reader's
// browser knows its own zone and nothing else does. Standard: docs/conventions/dates.md.
const listMeetingsQuery = cursorQuery.extend({
  scope: z.enum(MEETING_LIST_SCOPES),
  today: z.string().regex(CIVIL_DATE_PATTERN).optional(),
});

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

/**
 * A STAY'S HANDLE, WHICHEVER KIND — the one validator for every route that names somebody in a
 * meeting by their stay (the removal's path, the lobby's decisions).
 *
 * A member's stay is a `meetingAttendance_` handle and a guest's a `meetingGuestStay_` one, and the
 * room has always treated the handle as opaque; the SERVICE resolves which table it names by the
 * prefix. One helper named once, rather than a guest-shaped copy of every host route. As a path
 * parameter when `name` is given, as a body field otherwise.
 */
export function meetingParticipantHandle(
  name?: string,
): z.ZodType<MeetingParticipantHandle, string> {
  const pattern = new RegExp(
    `(?:${identifierPattern("meetingAttendance").source})|(?:${identifierPattern("meetingGuestStay").source})`,
  );
  const field = z.string().regex(pattern);
  return (name === undefined
    ? field
    : field.openapi({ param: { name, in: "path" } })) as unknown as z.ZodType<
    MeetingParticipantHandle,
    string
  >;
}

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

function writeMeta(
  action: string,
  permission: typeof JOIN | typeof HOST,
  rateLimit: RouteMeta["rateLimit"] = "default",
): RouteMeta {
  return {
    operationId: `meetings.${action}`,
    surface: "app",
    authenticated: true,
    permission,
    resource: "firm",
    audited: true,
    // Required. A retried join must not open a second stay for one person — the roster would count
    // them twice against the room's ceiling, and their record would say they were in the meeting
    // twice over without ever having left.
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit,
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

const listRoute = defineOpenAPIRoute(readMeta("list"), {
  method: "get",
  path: "/api/v1/meetings",
  description:
    "The meetings a member can reach, in one of three scopes: `live` (in progress, longest-running " +
    "first), `upcoming` (started but not yet joined, soonest first, from the caller's own day " +
    "onward) and `recent` (ended in the last thirty days, newest first). `today` is the caller's " +
    "civil date and is required by the upcoming scope — a day is a day in a place and the server " +
    "has no zone to derive one in.",
  request: { query: listMeetingsQuery },
  responses: {
    200: {
      description: "One page of meetings in this scope",
      content: { "application/json": { schema: MeetingSummaryPage } },
    },
    ...commonErrors,
    422: {
      description: "The upcoming scope was asked for without the caller's own day",
      content: { "application/problem+json": { schema: Problem } },
    },
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

// JOIN STAYS ON THE DEFAULT BUCKET, and that is a decision rather than an omission. It is the one
// costly write here — it mints a relay credential against this account's Realtime key — so the
// stricter `expensive` bucket looks like its home. It is not: that bucket is ten requests a minute,
// calibrated for a measurement somebody takes by hand, and a join is what a browser repeats every
// time a connection drops and comes back. A member reconnecting through a bad stretch of network
// would be locked out of the meeting by the limiter, which is the failure the whole grace period
// above exists to prevent. The mint is also not the billed unit — relay TRAFFIC is, and that is
// bounded by the credential's own short life rather than by how many were minted. A bucket between
// the two (the default is a hundred a minute) would be the right answer and is a change to the
// shared bucket table rather than to this route.
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
    "is what happened. Paged from the beginning of the gathering.",
  request: { params: meetingIdParam, query: cursorQuery },
  responses: {
    200: {
      description: "One page of this meeting's stays",
      content: { "application/json": { schema: MeetingAttendancePage } },
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
    "keepalive. Requires an Upgrade: websocket request and an open stay in the meeting — join " +
    "first. An upgrade carrying another site's Origin is refused: a browser will open a socket " +
    "cross-origin with the member's cookie, where it would refuse to let that page read any other " +
    "call here.",
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

/**
 * The meeting family's refusal vocabulary, mapped once for every route that can raise it.
 *
 * Exported because there are three route files over one domain now — the room, its chat and its
 * hosting — and a second copy of this switch is a second answer to what a member is told. The
 * indistinguishability rules below are the reason it has to be one copy: they only hold if every
 * door gives the same answer.
 */
export function meetingErrorResponse(
  c: Context,
  caught: MeetingValidationError,
): ProblemResponse<403> | ProblemResponse<404> | ProblemResponse<409> {
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
    // AN AUTHORITY ANSWER RATHER THAN A PERMISSION ONE. The member holds `meetings:host`; what they
    // do not hold is a grant on this room, and the remedy is somebody handing it to them — or, in a
    // room nobody is running, claiming it.
    case "meeting-not-host":
      return problemJson(c, {
        type: "meeting-not-host",
        title: "You are not hosting this meeting",
        status: 403,
        detail: caught.message,
        // Not a request-access case: nothing an administrator can grant produces this.
        requestAccess: false,
      });
    case "meeting-locked":
      return problemJson(c, {
        type: "meeting-locked",
        title: "This meeting is locked",
        status: 409,
        detail: caught.message,
      });
    case "meeting-removed":
      return problemJson(c, {
        type: "meeting-removed",
        title: "You were removed from this meeting",
        status: 409,
        detail: caught.message,
      });
    // The door's own two. `meeting-lobby-full` is deliberately NOT `meeting-room-full`: the two
    // ceilings answer different questions and the remedies differ — a full room needs somebody to
    // leave, a full lobby needs a host to look at the list.
    case "meeting-lobby-full":
      return problemJson(c, {
        type: "meeting-lobby-full",
        title: "This meeting's lobby is full",
        status: 409,
        detail: caught.message,
      });
    // The twin of `meeting-removed`, and its own type because a screen has to say the right thing:
    // one is being put out of the room, the other is never having been let in.
    case "meeting-not-admitted":
      return problemJson(c, {
        type: "meeting-not-admitted",
        title: "A host did not admit you to this meeting",
        status: 409,
        detail: caught.message,
      });
    // THE GUEST LINK'S OWN CODES, which only the guest routes and the host's guest routes raise and
    // which those routes answer through their own mapping (routes/meetings-guest.ts), with the 410s
    // and 422s their contracts declare. No member route can raise one — none of them reaches the
    // guest trio — so if one ever arrived here it is answered as the conflict it would be rather than
    // as a fault with an Error ID.
    case "guest-link-not-valid":
    case "guest-link-expired":
    case "guest-link-revoked":
    case "guest-link-exhausted":
    case "guest-not-invitable":
    case "guest-name-not-valid":
      return problemJson(c, {
        type: "conflict",
        title: "This cannot be done here",
        status: 409,
        detail: caught.message,
      });
  }
}

/** The 503 every meeting route answers where this deployment cannot route a meeting's media. */
export function notConfigured(c: Context): ProblemResponse<503> {
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

/** The request context these handlers actually run in, so a stashed logger reads as one. */
type MeetingContext = Context<{ Bindings: Bindings; Variables: AppVariables }>;

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
  | {
      ok: false;
      problem:
        | ProblemResponse<403>
        | ProblemResponse<404>
        | ProblemResponse<409>
        | ProblemResponse<422>;
    };

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
    // THE SAME REFUSAL THE SERVICE'S OWN COUNT PRODUCES, arrived at the other way. The count is a
    // round trip ahead of the write, so a dozen browsers joining together all read a seat free; the
    // insert's guard is what refuses the thirteenth, and a member who lost that race is told the
    // room is full rather than handed an Error ID for a batch they cannot see.
    if (caught instanceof GuardedWriteRefusedError && caught.guard === JOIN_CAPACITY_GUARD) {
      return {
        ok: false,
        problem: problemJson(c, {
          type: "meeting-room-full",
          title: "This meeting is full",
          status: 409,
          detail: `This meeting is full; it holds ${String(MAX_MEETING_PARTICIPANTS)} people.`,
        }),
      };
    }
    // THE DOOR'S OWN CEILING, arrived at the same way and answered as a different thing. A hundred
    // rows is what a queue may hold; the remedy is a host looking at the list rather than somebody
    // leaving the room.
    if (caught instanceof GuardedWriteRefusedError && caught.guard === JOIN_LOBBY_CAPACITY_GUARD) {
      return {
        ok: false,
        problem: problemJson(c, {
          type: "meeting-lobby-full",
          title: "This meeting's lobby is full",
          status: 409,
          detail: `This meeting's lobby is full; it holds ${String(MAX_MEETING_LOBBY)} people.`,
        }),
      };
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
 * A deployment that mints no relay credentials at all answers with the public resolution server
 * alone, never an empty list: a browser handed no servers at all gathers only its local addresses,
 * and one behind a home router would then never learn how it looks from outside.
 */
export async function iceServersFor(c: MeetingContext): Promise<z.infer<typeof IceServer>[]> {
  const mint = await generateIceServers(c.env, RELAY_CREDENTIAL_TTL_SECONDS);
  if (mint.kind === "minted") return [...mint.servers];
  if (mint.kind === "failed") {
    // Recorded even though the join succeeds. A relay that stopped answering shows up to members as
    // "some calls do not connect" and to nobody as a failure at all, which is precisely the shape of
    // fault that runs for weeks; the trace is the only thing that names it. The upstream body never
    // reaches the record — it can echo the key id.
    recordRealtimeFailure(
      c.get("logger"),
      "realtime.turnCredentials.meetingJoin",
      new Error(`relay credentials could not be minted (${mint.cause})`),
      c.get("correlationId"),
    );
  }
  return [PUBLIC_RESOLUTION_SERVER];
}

/**
 * The signaling room for one meeting, addressed by the SESSION firm id and never by a path value —
 * a firm can no more signal into another firm's meeting than it can read one.
 *
 * Exported because the hosting routes call the room back after their own writes commit, on the same
 * `participantLeft` / `end` precedent, and a second way of addressing it would be a second answer to
 * which object a firm reaches.
 */
export function meetingRoomFor(env: Bindings, firmId: string, meetingId: string) {
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
      const { eventKind, eventId, medium, lobby } = c.req.valid("json");

      let outcome;
      try {
        outcome = await commitEffect<z.infer<typeof StartedMeeting>>(
          c,
          firm.firmDatabase,
          idempotency,
          async () => {
            const started = await createMeeting(
              firm.firmDatabase,
              { eventKind: eventKind, eventId, medium, lobby },
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
      } catch (caught) {
        // THE OTHER MEMBER WON, in the instant the read-then-insert does not span. One meeting per
        // event is held by a partial unique index, so the loser's batch aborts on a raw constraint —
        // which reached the member as a 500 for pressing a button at the same moment as a colleague.
        // What they asked for was to be in the same room, and they now are: their answer is the
        // winner's room with `created: false`, exactly as the ordinary second Start reads.
        if (!isMeetingPerEventConflict(caught)) throw caught;
        const existing = await readMeetingForEvent(
          firm.firmDatabase,
          eventKind,
          eventId,
          visibleMatterPredicate(),
        );
        // Nothing to hand back means the constraint was not the one this read can see through — the
        // fault is real and belongs on the error pipeline rather than dressed as a success.
        if (existing === undefined) throw caught;
        return c.json({ id: existing.id, created: false }, 200);
      }
      if (!outcome.ok) return outcome.problem;
      return outcome.responseCode === 201 ? c.json(outcome.value, 201) : c.json(outcome.value, 200);
    },
  );

  // GET /api/v1/meetings
  app.openapi(
    { ...listRoute, middleware: chokepointMiddleware(chokepoint, listRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { scope, cursor, today } = c.req.valid("query");

      if (scope === "upcoming" && today === undefined) {
        // REFUSED RATHER THAN GUESSED. Falling back to the server's day would answer a different
        // question than the one asked — and would answer it wrongly for exactly the member whose
        // day has not turned over yet, which is the case the parameter exists for.
        return problemJson(c, {
          type: "validation",
          status: 422,
          title: "The upcoming scope needs the caller's own day",
          detail: "Send today as a civil date (YYYY-MM-DD) read from the caller's own time zone.",
        });
      }

      const found = await listMeetings(firm.firmDatabase, {
        scope,
        visibility: visibleMatterPredicate(),
        limit: MAX_MEETING_PAGE_SIZE,
        cursor: decodeCursor(cursor),
        today,
        // AN INSTANT, which the server may derive and a day is not: two instants compare the same
        // in every zone, so "ended within the last thirty days" needs no zone to be true.
        since: new Date(Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString(),
      });
      const hasMore = found.length > MAX_MEETING_PAGE_SIZE;
      const rows = hasMore ? found.slice(0, MAX_MEETING_PAGE_SIZE) : found;
      const last = rows.at(-1);
      const configured = sfuClientForEnv(c.env) !== null;
      return c.json(
        {
          data: rows.map((row) => ({ ...row.summary, configured })),
          // Keyed on the sort key the read itself ordered by, whichever scope minted it, so the
          // walk cannot skip or repeat.
          nextCursor:
            hasMore && last !== undefined ? encodeCursor(last.sortKey, last.summary.id) : null,
        },
        200,
      );
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

      let outcome;
      try {
        outcome = await commitEffect<{ participantId: string; waiting: boolean }>(
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
              value: { participantId: joined.attendanceId, waiting: joined.waiting },
              responseCode: 200,
              effect: joined.effect,
            };
          },
        );
      } catch (caught) {
        // ONE MEMBER, TWO JOINS IN FLIGHT — a double-clicked button, under two idempotency keys, so
        // the gate sees two different requests. The service's read finds no open stay on either, and
        // the partial unique index refuses the second insert. There is nothing to refuse the member
        // over: the stay the other request opened is theirs, and handing it back is the same answer
        // the ordinary second join gives.
        if (!isOpenStayConflict(caught)) throw caught;
        const open = await readOpenAttendance(firm.firmDatabase, meetingId as MeetingId, userId);
        if (open === undefined) throw caught;
        outcome = {
          ok: true as const,
          // Whichever side of the door the stay the other request opened is on — read off the row
          // rather than assumed, because the loser of this race cannot know which branch the winner
          // took.
          value: { participantId: open.id, waiting: isWaiting(open) },
          responseCode: 200,
        };
      }
      if (!outcome.ok) return outcome.problem;

      // Both are read AFTER the stay is committed and neither can fail the join: the name is what
      // colleagues see on a tile, and the resolution servers are what the browser's own connection
      // uses. A member who is in the meeting stays in it either way.
      const [displayName, iceServers] = await Promise.all([
        displayNameOf(firm.firmDatabase, userId),
        iceServersFor(c),
      ]);
      return c.json(
        {
          participantId: outcome.value.participantId,
          waiting: outcome.value.waiting,
          displayName,
          iceServers,
        },
        200,
      );
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
      const open = await readOpenAttendance(firm.firmDatabase, meetingId as MeetingId, userId);

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
        await meetingRoomFor(c.env, firmId, meetingId).participantLeft(open.id);
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
      await meetingRoomFor(c.env, firmId, meetingId).end(outcome.value.endedAt);
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
      const { cursor } = c.req.valid("query");
      const found = await listAttendance(firm.firmDatabase, meetingId as MeetingId, {
        cursor: decodeCursor(cursor),
        limit: MAX_ATTENDANCE_PAGE_SIZE,
      });
      // The read asks for one row past the page, and that row is the answer to "is there more"
      // rather than part of the page.
      const hasMore = found.length > MAX_ATTENDANCE_PAGE_SIZE;
      const rows = hasMore ? found.slice(0, MAX_ATTENDANCE_PAGE_SIZE) : found;
      const last = rows.at(-1);
      return c.json(
        {
          data: rows.map((row) => ({
            id: row.id,
            participantKind: row.participant_kind,
            userId: row.user_id,
            displayName: row.display_name,
            entityId: row.entity_id,
            invitedName: row.invited_name,
            joinedAt: row.joined_at,
            leftAt: row.left_at,
            waitingFrom: row.waiting_from,
            admittedAt: row.admitted_at,
            endedReason: row.ended_reason,
          })),
          // Keyed on the same expression the list is ordered by, so the walk cannot skip or repeat.
          nextCursor: hasMore && last !== undefined ? encodeCursor(last.joined_at, last.id) : null,
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

      // Asked before anything is read, because it is a question about the REQUEST rather than about
      // the meeting: an answer that varied with whether the meeting exists would tell a foreign page
      // that much by timing alone.
      if (!isSameOriginUpgrade(c.req.raw, c.env.APP_BASE_URL)) {
        return problemJson(c, {
          type: "permission-denied",
          status: 403,
          title: "Cross-origin signaling is refused",
          detail: "Open the meeting from this application.",
        });
      }

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
      const open = await readOpenAttendance(firm.firmDatabase, meetingId as MeetingId, userId);
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
      const [displayName, grant] = await Promise.all([
        displayNameOf(firm.firmDatabase, userId),
        // The caller's live grant, read here so the room's stored record starts out right. It is a
        // SEED and never the authority: the room re-reads its own record for every host frame,
        // because a socket's attachment is frozen at upgrade and hosting is exactly the thing that
        // changes during a meeting.
        readLiveHostGrant(firm.firmDatabase, meetingId as MeetingId, userId),
      ]);
      return await meetingRoomFor(c.env, firmId, meetingId).fetch(
        meetingSocketRequest({
          // The room is told what kind of gathering it is, off the meeting row the caller was just
          // authorized against — so a browser cannot name its own medium and publish a camera into
          // a call.
          medium: meeting.medium,
          firmId,
          meetingId,
          userId,
          attendanceId: open.id,
          displayName,
          hostRole: grant?.role ?? null,
          // Off the same row, so the room can say what is true of itself on the welcome without
          // asking the firm's database once per socket.
          locked: meeting.locked_at !== null,
          lobby: meeting.lobby,
          // DERIVED FROM THE STAY THE UPGRADE WAS JUST AUTHORIZED AGAINST, never named by the
          // browser: the row says whether this person is at the door or in the room, and it is what
          // sends the socket into the lobby state rather than into the room.
          waiting: isWaiting(open),
          // The instant off the stay itself, so the room repeats the record rather than stamping a
          // second answer of its own.
          waitingFrom: open.waiting_from ?? "",
        }),
      );
    },
  );
}
