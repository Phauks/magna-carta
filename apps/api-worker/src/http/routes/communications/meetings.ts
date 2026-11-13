import { endToEndEncryptionEnabled } from "../../../meetings/encryption-switch.ts";
import { IceServer, StartMeetingRequest } from "./meeting-schemas.ts";
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { CIVIL_DATE_PATTERN } from "@magna-carta/civil-time/civil-date";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { decodeCursor, encodeCursor } from "@magna-carta/data-access/cursor-pagination";
import {
  commitEffectBatch,
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
import { assertPermission } from "@magna-carta/access-control/registry";
import { readFirmSetting } from "@magna-carta/data-access/setting-statements";
import type {
  FileVersionId,
  FirmId,
  MatterId,
  MeetingRecordingId,
} from "@magna-carta/identifiers/types";
import {
  RECORDING_DOCUMENT_STATES,
  readRecordingDocumentFacts,
  readRecordingDocuments,
  recordingDocumentStateOf,
} from "@magna-carta/meetings/recording-document-state";
import {
  recordingFailedAuditStatement,
  STOP_RECORDING_GUARD,
  startMeetingRecording,
  stopMeetingRecording,
  stopRecordingAfterStartFailure,
  stopRecordingForMeetingEnd,
  toRecordingSummary,
} from "@magna-carta/meetings/recording-service";
import {
  failRecordingStatement,
  isRunningRecordingConflict,
  listRecordingNotices,
  listRecordingTracks,
  listRecordings,
  MAX_NOTICE_PAGE_SIZE,
  MAX_RECORDING_PAGE_SIZE,
  readRecording,
  readRecordingStatesOfRooms,
  recordRecorderUnreachableStatement,
} from "@magna-carta/meetings/recording-statements";
import {
  MEETING_RECORDING_NOTICE_REASONS,
  MEETING_RECORDING_STATES,
  MEETING_RECORDING_STOP_REASONS,
  type MeetingRecordingStateOfRoom,
  type MeetingRecordingStopReason,
  type MeetingRecordingSummary as MeetingRecordingSummaryValue,
} from "@magna-carta/meetings/recording-types";
import {
  recordedTrackCeilingDefinition,
  recordingEnabledDefinition,
} from "@magna-carta/meetings/settings";
import { MEETING_CONTRIBUTOR_KINDS } from "@magna-carta/meetings/types";
import { MeetingRecordingRefusedError } from "@magna-carta/meetings/validation";
import {
  listTranscriptSegments,
  MAX_TRANSCRIPT_SEGMENT_PAGE_SIZE,
  readTranscriptForRecording,
  readTranscriptMarks,
} from "@magna-carta/meetings/transcript-statements";
import { readSummaryMarks } from "@magna-carta/meetings/summary-statements";
import {
  MEETING_SUMMARY_REFUSAL_REASONS,
  MEETING_SUMMARY_STATES,
} from "@magna-carta/meetings/summary-types";
import { transcriptReadAuditStatement } from "@magna-carta/meetings/transcript-service";
import {
  MEETING_TRANSCRIPT_SEGMENT_KINDS,
  MEETING_TRANSCRIPT_STATES,
  MEETING_TRANSCRIPT_WITHHELD_REASONS,
  toTranscriptSummary,
  transcriptLinesWithheldBy,
  type MeetingTranscriptWithheldReason,
} from "@magna-carta/meetings/transcript-types";
import type { Context } from "hono";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import { trackBackgroundWork } from "../../deferred-work.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
  requireChokepointIdempotency,
  requireChokepointPermissions,
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
import type { RecorderStartInput } from "../../../meetings/meeting-recorder.ts";
import { sinkSigningKeyForEnv } from "../../../meetings/sink-token.ts";
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
const RECORD = "meetings:record" as const;

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

const MeetingSummaryResponse = z
  .object({
    id: z.string(),
    eventKind: z.enum(MEETING_EVENT_KINDS),
    eventId: z.string(),
    // Null on a firm event, which belongs to no matter — the reason both permission keys bind the
    // firm rather than a matter.
    matterId: z.string().nullable(),
    // The matter's title, so a list says where a meeting was filed in words. Null on a firm event.
    matterTitle: z.string().nullable(),
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
    // Whether this deployment can route meeting media at all, so a surface knows to offer a way in.
    configured: z.boolean(),
    // THE ROOM'S RECORDING, in one word: `none` when it has never been recorded, otherwise the state
    // of its most recent recording — so a list row can carry the mark and a room screen can tell a
    // running recording from one that is being composed. Read once per page, never per row.
    recordingState: z.enum(["none", ...MEETING_RECORDING_STATES]),
    // Whether a Record control should be offered at all: the deployment can record (routing
    // credentials, a sink signing key, a recorder bound) AND the firm has switched recording on. On
    // the precedent of `configured` beside it — a fact about configuration, read so the screen never
    // offers an act the route would answer 503.
    recordingConfigured: z.boolean(),
    // Whether live captions can be shown; always false until the captions slice lands.
    captionsAvailable: z.boolean(),
    // A personal-room session, which alone can be moved onto a matter while it runs or afterwards.
    personalRoomSession: z.boolean(),
    // WHETHER THE PICTURES AND SOUND ARE SEALED END TO END, fixed when the room was opened. A screen
    // says so before Join, and the room's browsers build their key group only where it is true.
    encrypted: z.boolean(),
  })
  .openapi("MeetingSummary");

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
  permission: typeof JOIN | typeof HOST | typeof RECORD,
  rateLimit: RouteMeta["rateLimit"] = "default",
  extra: Partial<RouteMeta> = {},
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
    ...extra,
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

// ---- the recording ----
//
// THE SERVER HALF OF RECORDING: start it, stop it, list a meeting's recordings, and read who was told.
// The audio itself never crosses these routes — it goes from the routing service to the recorder
// (meetings/meeting-recorder.ts) through the sink (routes/meeting-sink.ts) — and the consent record
// is written by the room as it announces each transition (meetings/room/room-recording.ts).
//
// START AND STOP ARE ROUTES, NEVER A FRAME: the permission check, the audit row and the recording row
// belong at the chokepoint, and the room is told by the route after the commit. A frame would put an
// authorization decision inside the socket protocol.

const MeetingRecordingActorSchema = z
  .object({ userId: z.string(), displayName: z.string() })
  .openapi("MeetingRecordingActor");

const MeetingRecordingSummarySchema = z
  .object({
    id: z.string(),
    meetingId: z.string(),
    // `recording` while audio is arriving; `composing` once it has stopped and is waiting to be mixed
    // into one document; `filed` once that document is on the matter; `failed` when nothing usable
    // was captured; `abandoned` when the recorder disappeared and a sweep closed what it left.
    state: z.enum(MEETING_RECORDING_STATES),
    startedBy: MeetingRecordingActorSchema,
    startedAt: z.string(),
    // Null while it runs, and when nobody stopped it — every track was lost, or the recorder vanished.
    // A union with null rather than `.nullable()` on the component: the latter is emitted as an
    // intersection of the component with a nullable object, which a generated client reads as the
    // actor ALWAYS present; the union is emitted as "the actor, or null", which is what it means.
    stoppedBy: z.union([MeetingRecordingActorSchema, z.null()]),
    stoppedAt: z.string().nullable(),
    stopReason: z.enum(MEETING_RECORDING_STOP_REASONS).nullable(),
    // Every track the recording held: open, closed and lost alike, so a screen can say how many of
    // the people in the room it could not hear.
    trackCount: z.number().int().min(0),
    // What a composite of the tracks could contain — never the wall-clock span. Null while it runs.
    capturedSeconds: z.number().int().min(0).nullable(),
    // The filed audio document, once the compose step has filed it.
    fileId: z.string().nullable(),
    // The recording's transcript, once the recording is filed and its transcript begun.
    transcriptId: z.string().nullable(),
    // Where the transcript's summary stands — `pending`, `ready`, `failed` or `refused` — once the
    // transcript is ready and its summary begun; null before. The list entry's `summary` says more.
    summaryState: z.enum(MEETING_SUMMARY_STATES).nullable(),
    // The Error ID the standard pipeline recorded when the recording failed — or a fault on the way
    // recorded against it while it was being composed — so a member can quote it to support. A handle,
    // never a message. Null unless the recording carries one.
    failureErrorId: z.string().nullable(),
  })
  .openapi("MeetingRecordingSummary");

// THE DOCUMENT A RECORDING FILED, AS THE LIST READS IT. Once a recording is `filed` its audio is a
// version in the file pipeline, and whether anybody can open it is that version's answer, not the
// recording's: the scan may still be running, may have held it, or a later version may have replaced
// it on the file. `versionId` names the version the recording filed; `state` is where it stands —
// `pending` until the scan answers, `available` when it is clean and still the file's current version
// (so the file's own download serves exactly it), `held` when the scan quarantined or flagged it,
// `replaced` when a later version is the file's current one, `removed` when the file is in the trash,
// and `unavailable` when the upload never completed or the file is on a matter the caller cannot see.
const MeetingRecordingDocumentSchema = z
  .object({
    versionId: z.string(),
    state: z.enum(RECORDING_DOCUMENT_STATES),
  })
  .openapi("MeetingRecordingDocument");

// WHERE A FILED RECORDING'S TRANSCRIPT STANDS, as the list reads it: its handle, `pending` while its
// tracks are being transcribed, `ready` once it is filed beside the audio (and then `fileId` is that
// document), or `failed`. Every filed recording has one; a recording not yet filed has none.
const MeetingTranscriptMarkSchema = z
  .object({
    id: z.string(),
    state: z.enum(MEETING_TRANSCRIPT_STATES),
    fileId: z.string().nullable(),
  })
  .openapi("MeetingTranscriptMark");

// WHERE A READY TRANSCRIPT'S SUMMARY STANDS, as the list reads it: its handle, `pending` while a model is
// writing it, `ready`, `failed` (a member may run it again), or `refused` — and then `refusalReason` says
// why: `disabled` (the firm has not switched summaries on), `not-eligible` (the firm's chosen model is a
// third-party one it has not allowed its content to reach) or `transcript-empty` (nobody was heard).
const MeetingSummaryMarkSchema = z
  .object({
    id: z.string(),
    state: z.enum(MEETING_SUMMARY_STATES),
    refusalReason: z.enum(MEETING_SUMMARY_REFUSAL_REASONS).nullable(),
  })
  .openapi("MeetingSummaryMark");

// One row of the list: the summary the start and stop routes answer with, the document it filed, its
// transcript and that transcript's summary. Only the list carries the document, the transcript and the
// summary — a start has filed nothing, and a stop hands the recording on to be composed — so the write
// routes' answer stays the recording summary alone. Each is null until the recording reaches it. A union
// with null for the reason `stoppedBy` is one.
const MeetingRecordingListEntrySchema = MeetingRecordingSummarySchema.extend({
  document: z.union([MeetingRecordingDocumentSchema, z.null()]),
  transcript: z.union([MeetingTranscriptMarkSchema, z.null()]),
  summary: z.union([MeetingSummaryMarkSchema, z.null()]),
}).openapi("MeetingRecordingListEntry");

const MeetingRecordingPage = paginated(MeetingRecordingListEntrySchema).openapi(
  "MeetingRecordingPage",
);

const MeetingRecordingNoticeEntry = z
  .object({
    id: z.string(),
    // Which kind of stay was told — a member's, a guest's, or a webinar attendee's — and its handle.
    participantKind: z.enum(MEETING_CONTRIBUTOR_KINDS),
    participantId: z.string(),
    // The member behind a member's stay; null for a guest, who was told exactly as a member was.
    userId: z.string().nullable(),
    // The member's name, or the name a guest typed at the door — read at the moment of asking.
    displayName: z.string(),
    // `start`, `arrival` (each arrival and each reconnect is another occasion) or `stop`.
    reason: z.enum(MEETING_RECORDING_NOTICE_REASONS),
    // The instant the room delivered the announcement to this stay — the server's, never a browser's.
    deliveredAt: z.string(),
  })
  .openapi("MeetingRecordingNoticeEntry");

const MeetingRecordingNoticePage = paginated(MeetingRecordingNoticeEntry).openapi(
  "MeetingRecordingNoticePage",
);

// ---- the transcript ----
//
// A FILED RECORDING'S TRANSCRIPT: its header, and its lines in reading order a page at a time. A
// transcript has no visibility rule of its own — it is reached through its recording, which is reached
// through its meeting, which is read through the visible-matter predicate — so a transcript of a
// recording on a walled matter is as absent as the meeting. The lines are content and are read here
// and nowhere else; the filed WebVTT document is the File Manager's, under its own matter access.
//
// THE LINES ARE A SECOND COPY OF THE FILED DOCUMENT, and they follow it: they are served only while the
// version the transcript filed exists, is not in the trash and is not held by the scan, and every page
// served writes an audit row as a download of the document does. A document taken off the matter takes
// its lines off this route with it.

const MeetingTranscriptSpeakerSchema = z
  .object({
    // Which kind of stay the line's track was — a member's or a guest's — and its handle.
    participantKind: z.enum(MEETING_CONTRIBUTOR_KINDS),
    participantId: z.string(),
    // The member behind a member's stay; null for a guest.
    userId: z.string().nullable(),
    // The member's name, or the name a guest typed at the door — read at the moment of asking.
    displayName: z.string(),
  })
  .openapi("MeetingTranscriptSpeaker");

const MeetingTranscriptSegmentSchema = z
  .object({
    id: z.string(),
    // The line's place in the transcript, from zero, in reading order.
    ordinal: z.number().int().min(0),
    // `speech` is something somebody said; `gap` is a span the transcript could not hear — a track that
    // was lost, refused at the recording's ceiling, or whose audio was missing — and carries no text.
    kind: z.enum(MEETING_TRANSCRIPT_SEGMENT_KINDS),
    // Milliseconds from the recording's start.
    startedMs: z.number().int().min(0),
    endedMs: z.number().int().min(0),
    text: z.string(),
    // Whose track the line came from; null on a gap that is nobody's (nothing at all was heard).
    speaker: z.union([MeetingTranscriptSpeakerSchema, z.null()]),
  })
  .openapi("MeetingTranscriptSegment");

const MeetingTranscriptSummarySchema = z
  .object({
    id: z.string(),
    recordingId: z.string(),
    // `pending` while it is being made, `ready` once filed, `failed` when it could not be finished.
    state: z.enum(MEETING_TRANSCRIPT_STATES),
    // The language the model reported, as it reported it; null until it has heard speech.
    language: z.string().nullable(),
    // Counted when it is ready; null before.
    segmentCount: z.number().int().min(0).nullable(),
    wordCount: z.number().int().min(0).nullable(),
    // The filed WebVTT document, once ready.
    fileId: z.string().nullable(),
    // The Error ID the standard pipeline recorded when it failed — a handle, never a message.
    failureErrorId: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("MeetingTranscriptSummary");

// THE HEADER AND ONE PAGE OF LINES. The lines are read only once the transcript is ready — while it is
// pending its lines have no settled order — so a pending or failed transcript answers its header with
// an empty page, and the screen says where it stands rather than reading a 409. A ready transcript whose
// filed document can no longer be opened answers its header with an empty page too, and `linesWithheld`
// says why: `removed` (the document is in the trash), `held` (the scan quarantined or flagged it) or
// `unavailable` (the version is gone, or the file was moved onto a matter the caller cannot see). It is
// null whenever the lines are not withheld — including for a pending or failed transcript, whose state
// already says why there are none.
const MeetingTranscriptPage = paginated(MeetingTranscriptSegmentSchema)
  .extend({
    transcript: MeetingTranscriptSummarySchema,
    linesWithheld: z.enum(MEETING_TRANSCRIPT_WITHHELD_REASONS).nullable(),
  })
  .openapi("MeetingTranscriptPage");

const recordingParams = z.object({
  meetingId: identifierPathParam("meeting", "meetingId"),
  recordingId: identifierPathParam("meetingRecording", "recordingId"),
});

const recordingWriteErrors = {
  400: {
    description: "Missing Idempotency-Key (this operation requires one)",
    content: { "application/problem+json": { schema: Problem } },
  },
  ...commonErrors,
  409: {
    description:
      "The meeting has ended, a recording is already running (or none is), the room has more " +
      "participants publishing audio than one recording may hear, or a request with this " +
      "Idempotency-Key is in progress",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description: "The meeting is on a firm event, which has no matter to file a recording into",
    content: { "application/problem+json": { schema: Problem } },
  },
  503: {
    description: "This deployment, or this firm, cannot record a meeting",
    content: { "application/problem+json": { schema: Problem } },
  },
};

// THE START'S REPLAY REACHES THE HANDLER. Its fingerprint is over the path alone — the request has no
// body, so nothing is lost by it — which is what takes the gate's own pre-decision away and lets a
// retry under the same key run the handler's commit path. That path answers the retry from the stored
// record, and FIRST finishes what the original request may not have lived to do: a start whose
// request was cancelled between the commit and the announcement left a recording that nobody was told
// about and nothing is capturing, and the gate replaying the stored reply verbatim would have answered
// "recording" over it forever.
const startRecordingRoute = defineOpenAPIRoute(
  { ...writeMeta("startRecording", RECORD), idempotencyFingerprint: "path" },
  {
    method: "post",
    path: "/api/v1/meetings/{meetingId}/recording",
    description:
      "Starts recording a meeting's audio. Needs the recording permission and a member running this " +
      "meeting: a member who is not hosting it is refused 403 meeting-not-host. Everybody in the " +
      "room — guests included — is told at once, and everybody who arrives while it runs is told on " +
      "arrival; who was told, and when, is recorded. Refused for a meeting on a firm event (there is " +
      "no matter to file the recording into), for a room already being recorded, and for a room " +
      "with more participants publishing audio than one recording may hear (counted by participant, " +
      "not by track). Answers 503 where this deployment or this firm cannot record.",
    request: { params: meetingIdParam, headers: idempotencyKeyHeader },
    responses: {
      201: {
        description: "The recording has started",
        content: { "application/json": { schema: MeetingRecordingSummarySchema } },
      },
      ...recordingWriteErrors,
    },
  },
);

// STOP IS ON meetings:join AT THE CHOKEPOINT, and that is not a weakening. Two kinds of member may
// stop a recording — one holding meetings:record, and one running this meeting, who can end it
// anyway — and a chokepoint gate on either key would refuse the other. The handler reads the key off
// the permission set and the service asks the grant; anybody holding neither is refused 403.
const stopRecordingRoute = defineOpenAPIRoute(
  writeMeta("stopRecording", JOIN, "default", {
    reversal: {
      kind: "none",
      reason:
        "A stopped recording is not resumed. Pressing Record again starts a new recording, with its " +
        "own announcement to the room and its own record of who was told.",
    },
  }),
  {
    method: "delete",
    path: "/api/v1/meetings/{meetingId}/recording",
    description:
      "Stops the meeting's running recording. A member holding the recording permission may stop " +
      "it, and so may a member running this meeting without it. Every adapter is closed, every " +
      "track's audio is kept, the room is told, and the recording moves on to be composed into one " +
      "document on the matter.",
    request: { params: meetingIdParam, headers: idempotencyKeyHeader },
    responses: {
      200: {
        description: "The recording has stopped",
        content: { "application/json": { schema: MeetingRecordingSummarySchema } },
      },
      ...recordingWriteErrors,
    },
  },
);

const listRecordingsRoute = defineOpenAPIRoute(readMeta("listRecordings"), {
  method: "get",
  path: "/api/v1/meetings/{meetingId}/recordings",
  description:
    "This meeting's recordings, newest first: who started and stopped each, what it captured, and " +
    "where it stands. The audio itself is a document on the matter once filed, reached through the " +
    "File Manager's own access; each filed recording names the version it filed and whether that " +
    "version is still being scanned, can be opened, is held, was replaced, or is gone.",
  request: { params: meetingIdParam, query: cursorQuery },
  responses: {
    200: {
      description: "One page of this meeting's recordings",
      content: { "application/json": { schema: MeetingRecordingPage } },
    },
    ...commonErrors,
  },
});

const recordingNoticesRoute = defineOpenAPIRoute(
  {
    operationId: "meetings.recordingNotices",
    surface: "app",
    authenticated: true,
    // THE CONSENT RECORD IS A HOST'S READ: who in the room was told, and when, is a list of people
    // and their movements in and out of a meeting, which is a question for whoever runs meetings
    // rather than for everybody who attended one.
    permission: HOST,
    resource: "firm",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  },
  {
    method: "get",
    path: "/api/v1/meetings/{meetingId}/recordings/{recordingId}/notices",
    description:
      "Who was told about one recording, and when: a row for every stay the room announced the " +
      "start to, every arrival told while it ran, and every stay told it stopped — guests " +
      "included. The consent record, oldest first.",
    request: { params: recordingParams, query: cursorQuery },
    responses: {
      200: {
        description: "One page of this recording's notices",
        content: { "application/json": { schema: MeetingRecordingNoticePage } },
      },
      ...commonErrors,
    },
  },
);

// AUDITED, as a download of the filed document is: the lines are the same words.
const recordingTranscriptRoute = defineOpenAPIRoute(
  { ...readMeta("recordingTranscript"), audited: true },
  {
    method: "get",
    path: "/api/v1/meetings/{meetingId}/recordings/{recordingId}/transcript",
    description:
      "The transcript of one filed recording: where it stands and, once it is ready, its lines in " +
      "order — each attributed to the participant whose microphone it came from, with a gap line " +
      "wherever somebody could not be heard. Paged by cursor. The lines are served only while the " +
      "transcript's filed document exists, is not in the trash and is not held by the scan; otherwise " +
      "the header is answered with no lines and linesWithheld says why. Every page of lines served is " +
      "audited, naming identifiers and never the words. A recording with no transcript, a recording " +
      "in another meeting, and a meeting the member cannot reach are all not found.",
    request: { params: recordingParams, query: cursorQuery },
    responses: {
      200: {
        description: "The transcript's header and one page of its lines",
        content: { "application/json": { schema: MeetingTranscriptPage } },
      },
      ...commonErrors,
    },
  },
);

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

/**
 * The recording's own refusal vocabulary, mapped once. None of these is a permission answer except
 * the stop by somebody holding neither the key nor a grant, which is.
 */
function recordingErrorResponse(
  c: Context,
  caught: MeetingRecordingRefusedError,
): ProblemResponse<403> | ProblemResponse<409> | ProblemResponse<422> {
  switch (caught.code) {
    case "meeting-recording-already-running":
      return problemJson(c, {
        type: "meeting-recording-already-running",
        title: "This meeting is already being recorded",
        status: 409,
        detail: caught.message,
      });
    case "meeting-recording-not-running":
      return problemJson(c, {
        type: "meeting-recording-not-running",
        title: "This meeting is not being recorded",
        status: 409,
        detail: caught.message,
      });
    case "meeting-recording-needs-matter":
      return problemJson(c, {
        type: "meeting-recording-needs-matter",
        title: "A meeting on a firm event cannot be recorded",
        status: 422,
        detail: caught.message,
      });
    case "meeting-recording-too-many-tracks":
      return problemJson(c, {
        type: "meeting-recording-too-many-tracks",
        title: "This room is too large to record",
        status: 409,
        detail: caught.message,
      });
    case "meeting-recording-not-permitted":
      return problemJson(c, {
        type: "permission-denied",
        title: "You cannot stop this recording",
        status: 403,
        detail: caught.message,
        // The recording permission is something an administrator can grant.
        requestAccess: true,
      });
  }
}

/** The 503 the start route answers where this deployment, or this firm, cannot record. */
function recordingNotConfigured(c: Context): ProblemResponse<503> {
  return problemJson(c, {
    type: "meeting-recording-not-configured",
    status: 503,
    title: "Recording is not available",
    detail: "This firm or this deployment cannot record a meeting.",
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
  // `executed` is false when the gate REPLAYED a stored answer: the act happened on an earlier
  // request, and anything that must happen once per act (telling the room) must not happen again.
  | { ok: true; value: T; responseCode: number; executed: boolean }
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
    if (caught instanceof MeetingRecordingRefusedError) {
      return { ok: false, problem: recordingErrorResponse(c, caught) };
    }
    // TWO MEMBERS PRESSED RECORD IN THE SAME INSTANT. Both read "nothing running"; the one-running
    // index refused the second insert, and what that member is told is what is true.
    if (isRunningRecordingConflict(caught)) {
      return {
        ok: false,
        problem: problemJson(c, {
          type: "meeting-recording-already-running",
          title: "This meeting is already being recorded",
          status: 409,
          detail: "This meeting is already being recorded.",
        }),
      };
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
    executed: result.kind === "executed",
  };
}

/**
 * WHETHER THIS DEPLOYMENT CAN RECORD AT ALL: media routing credentials, a key to sign each track's
 * sink address with, a recorder to hand the audio to, and an origin the routing service can dial
 * back. A fact about bindings, not about any firm or member.
 */
export function recordingDeploymentConfigured(env: Bindings): boolean {
  return (
    sfuClientForEnv(env) !== null &&
    sinkSigningKeyForEnv(env) !== null &&
    env.MEETING_RECORDER !== undefined &&
    // Without the queue a stopped recording's tracks could never be composed, transcribed or filed,
    // so a recording started then would be staged audio with nowhere to go.
    env.MEETING_RECORDING_COMPOSE !== undefined &&
    env.APP_BASE_URL !== undefined &&
    env.APP_BASE_URL !== ""
  );
}

/** The deployment can record AND this firm has switched recording on. */
async function recordingConfiguredFor(env: Bindings, database: SqlDatabase): Promise<boolean> {
  if (!recordingDeploymentConfigured(env)) return false;
  return await readFirmSetting(database, recordingEnabledDefinition);
}

/**
 * The three recording facts a meeting summary carries, for a page of meetings at once: one read of
 * the rooms' recording states and one of the firm's switch, never one per row.
 */
async function recordingFactsFor(
  env: Bindings,
  database: SqlDatabase,
  meetingIds: readonly MeetingId[],
): Promise<
  (meetingId: string) => {
    recordingState: MeetingRecordingStateOfRoom;
    recordingConfigured: boolean;
    captionsAvailable: boolean;
  }
> {
  const [states, recordingConfigured] = await Promise.all([
    readRecordingStatesOfRooms(database, meetingIds),
    recordingConfiguredFor(env, database),
  ]);
  return (meetingId) => ({
    recordingState: states.get(meetingId as MeetingId) ?? "none",
    recordingConfigured,
    captionsAvailable: false,
  });
}

/**
 * One meeting's recorder, addressed by the SESSION firm id and the recording's handle — never a path
 * value — so a firm reaches its own recorders and no other's.
 */
function meetingRecorderFor(env: Bindings, firmId: string, recordingId: string) {
  const recorders = env.MEETING_RECORDER;
  if (recorders === undefined) return null;
  return recorders.get(recorders.idFromName(`${firmId}:${recordingId}`));
}

/** One stored recording as the wire carries it, with the two names read at the moment of asking. */
async function recordingSummaryFor(
  database: SqlDatabase,
  meetingId: MeetingId,
  recordingId: MeetingRecordingId,
): Promise<MeetingRecordingSummaryValue | undefined> {
  const row = await readRecording(database, meetingId, recordingId);
  if (row === undefined) return undefined;
  const [startedBy, stoppedBy] = await Promise.all([
    displayNameOf(database, row.started_by_user_id),
    row.stopped_by_user_id === null
      ? Promise.resolve(null)
      : displayNameOf(database, row.stopped_by_user_id),
  ]);
  return toRecordingSummary(row, { startedBy, stoppedBy });
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

/**
 * WORK THAT FOLLOWS A COMMIT AND MUST NOT DIE WITH THE REQUEST.
 *
 * Once a recording's start or stop has committed, the recorder and the room have to be told — and a
 * request the runtime cancels after the commit (the browser navigated away, the connection dropped)
 * would otherwise stop those calls mid-way: a recording in the record with no announcement and no
 * recorder behind it, or a stop the recorder never heard about. So the work is handed to the request's
 * `waitUntil`, which keeps it running past a cancelled response, and the handler still awaits it, so
 * an ordinary request answers with what the work actually produced.
 *
 * The work never rejects for a reason the caller could act on: each step records its own failure
 * through the standard pipeline. A harness that built the request without an execution context gets
 * the same awaited work and no keep-alive.
 */
function outliveTheRequest<T>(c: MeetingContext, work: Promise<T>): Promise<T> {
  const tracked = trackBackgroundWork(work);
  try {
    c.executionCtx.waitUntil(tracked);
  } catch {
    void tracked.catch(() => {});
  }
  return work;
}

// HOW MANY TIMES AN ENDING IS COMPOSED when a recording keeps stopping under it. Each attempt reads the
// running recording afresh, so the second finds the one that stopped in the first one's window already
// stopped and composes no stop for it; a third would need a NEW recording to start and stop inside the
// second's window, on a meeting that is ending.
const ENDING_ATTEMPTS = 3;

/**
 * AN ENDING WHOSE RECORDING STOPPED UNDER IT. The end reads the running recording and composes its stop
 * into the ending's own batch a round trip before the batch commits; a member pressing Stop, or the
 * recorder stopping itself, in that window makes the stop's guard refuse — and the whole batch, the
 * ending and its idempotency record included, rolls back. That is not a fault: the recording is
 * already stopped, by somebody whose stop the record now keeps, and the ending is composed again from
 * what is true now, which stops nothing. Any other refusal is somebody else's, and propagates.
 */
async function commitThroughARacingStop<T>(commit: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await commit();
    } catch (caught) {
      const stoppedUnderIt =
        caught instanceof GuardedWriteRefusedError && caught.guard === STOP_RECORDING_GUARD;
      if (!stoppedUnderIt || attempt >= ENDING_ATTEMPTS) throw caught;
    }
  }
}

// HOW MANY TIMES THE RECORDER IS ASKED TO LET GO before the room is told without it. Twice: a call
// into another object can fail once for reasons of the moment (the object was being moved, a
// connection reset), and a second attempt is cheap beside a stop the recorder never heard about. Not
// more, because everybody in the room is waiting on the announcement that it stopped.
const RECORDER_STOP_ATTEMPTS = 2;

/**
 * A RECORDING HAS STOPPED in the record: the recorder lets go of it (every adapter closed, every
 * staged upload completed) and THEN the room tells everybody, so nothing is captured after the stop is
 * announced.
 *
 * The recorder is asked twice before it is given up on, each time through a fresh stub because a stub
 * that has thrown may stay broken. A recorder that acknowledged has stopped capturing, and the room is
 * told. One that could not be reached is still announced as stopped — the record already says so, and
 * a mark left lit on a recording that has stopped would be a lie — but the failure is recorded with an
 * Error ID through the standard pipeline AND on the recording's own row, so the record says a fault
 * happened at the stop; the recorder lets go of the recording itself on its next pass, once it reads
 * that the record is no longer `recording`.
 */
async function settleStoppedRecording(
  c: MeetingContext,
  database: SqlDatabase & BatchDatabase,
  stop: {
    readonly firmId: string;
    readonly meetingId: string;
    readonly recordingId: MeetingRecordingId;
    readonly stopReason: MeetingRecordingStopReason;
    readonly at: string;
    readonly by: { readonly userId: string; readonly displayName: string } | null;
  },
): Promise<void> {
  let acknowledged = false;
  let failure: unknown = new Error("no recorder is bound");
  for (let attempt = 1; attempt <= RECORDER_STOP_ATTEMPTS && !acknowledged; attempt += 1) {
    const recorder = meetingRecorderFor(c.env, stop.firmId, stop.recordingId);
    if (recorder === null) break;
    try {
      await recorder.stop(stop.stopReason);
      acknowledged = true;
    } catch (caught) {
      failure = caught;
    }
  }
  if (!acknowledged) {
    const failureErrorId = recordRealtimeFailure(
      c.get("logger"),
      "meetings.recording.stop-recorder",
      failure,
      c.get("correlationId"),
    );
    try {
      const now = () => new Date().toISOString();
      await commitEffectBatch(
        database,
        {
          statements: [
            recordRecorderUnreachableStatement(database, {
              id: stop.recordingId,
              failureErrorId,
              now: now(),
            }),
          ],
          outboxMessages: [],
        },
        { now },
      );
    } catch (caught) {
      recordRealtimeFailure(
        c.get("logger"),
        "meetings.recording.record-stop-failure",
        caught,
        c.get("correlationId"),
      );
    }
  }
  try {
    await meetingRoomFor(c.env, stop.firmId, stop.meetingId).recordingStopped({
      firmId: stop.firmId,
      meetingId: stop.meetingId,
      recordingId: stop.recordingId,
      at: stop.at,
      by: stop.by,
    });
  } catch (caught) {
    recordRealtimeFailure(
      c.get("logger"),
      "meetings.recording.announce-stop",
      caught,
      c.get("correlationId"),
    );
  }
}

/**
 * A START THAT COULD NOT BE CARRIED OUT — the room could not be told, could not write down everybody
 * it told, or the recorder could not take the recording. Nobody's voice may be captured without the
 * announcement and its record, and a recording row left `recording` with nothing behind it would
 * light a mark over nothing, so the recording is stopped (`start-failed`) and failed in the record
 * with the Error ID of what went wrong, in one batch with ONE failed audit row; the recorder is let go
 * of, and the room is told it stopped. A recorder that did take the recording and settles it with
 * nothing captured writes no second failure: the record already holds this one
 * (`recordingFailedAuditStatement`).
 *
 * A recording somebody else stopped in the meantime is left to that stop, which has its own settling.
 */
async function failStartedRecording(
  c: MeetingContext,
  database: SqlDatabase & BatchDatabase,
  start: {
    readonly firmId: string;
    readonly meetingId: string;
    readonly recordingId: MeetingRecordingId;
    readonly failureErrorId: string;
  },
): Promise<void> {
  const now = () => new Date().toISOString();
  const system = { clock: { now }, randomSource: cryptoRandomSource };
  const stopped = await stopRecordingAfterStartFailure(database, start.recordingId, system);
  if (stopped === undefined) return;
  await commitEffectBatch(
    database,
    {
      statements: [
        ...stopped.effect.statements,
        // The guarded stop above moves the row from `recording` to `composing` in this same batch, or
        // rolls the batch back, so this write always finds the row it fails.
        // fitness:unguarded-write — the stop in this batch is the guard.
        failRecordingStatement(database, {
          id: start.recordingId,
          failureErrorId: start.failureErrorId,
          now: now(),
        }),
        recordingFailedAuditStatement(
          database,
          {
            recordingId: start.recordingId,
            meetingId: start.meetingId as MeetingId,
            failureErrorId: start.failureErrorId,
          },
          system,
        ),
      ],
      outboxMessages: [],
    },
    { now },
  );
  await settleStoppedRecording(c, database, {
    firmId: start.firmId,
    meetingId: start.meetingId,
    recordingId: start.recordingId,
    stopReason: "start-failed",
    at: stopped.recording.stopped_at ?? now(),
    by: null,
  });
}

/** Everything the room and the recorder are handed when a committed recording is carried out. */
interface RecordingToCarryOut {
  readonly firmId: string;
  readonly meetingId: string;
  readonly matterId: MatterId;
  readonly recordingId: MeetingRecordingId;
  readonly startedAt: string;
  readonly ceiling: number;
  readonly tracks: RecorderStartInput["tracks"];
  readonly by: { readonly userId: string; readonly displayName: string };
  // Whether the room is already holding this recording — a replay that finds the announcement was
  // made, and only the recorder may still be missing it.
  readonly announced: boolean;
}

/**
 * TOLD FIRST, CAPTURED SECOND. The room announces the recording to every welcomed socket and writes
 * who was told before a single adapter is opened, so nobody's voice is captured before the
 * announcement reached them — and the room's answer is checked before the recorder is started: a
 * notice count below the count of stays the frame was handed to is somebody told with no record that
 * they were, which is a consent record that cannot be produced later, so the start fails rather than
 * capturing. A room that cannot be told at all, or a recorder that cannot take the recording, fails it
 * the same way.
 */
async function carryOutRecordingStart(
  c: MeetingContext,
  database: SqlDatabase & BatchDatabase,
  start: RecordingToCarryOut,
): Promise<void> {
  try {
    if (!start.announced) {
      const told = await meetingRoomFor(c.env, start.firmId, start.meetingId).recordingStarted({
        firmId: start.firmId,
        meetingId: start.meetingId,
        recordingId: start.recordingId,
        at: start.startedAt,
        by: start.by,
      });
      if (told.noticeCount < told.recipientCount) {
        throw new Error(
          `the room told ${String(told.recipientCount)} stays and recorded ` +
            `${String(told.noticeCount)} of them`,
        );
      }
      // The recording was stopped, or the meeting ended, before its start reached the room. The stop
      // already settled the record, so there is nothing to fail and nothing for a recorder to capture:
      // starting one would record a room whose mark says it is not being recorded.
      if (told.stopped === true) return;
    }
    const recorder = meetingRecorderFor(c.env, start.firmId, start.recordingId);
    if (recorder === null) throw new Error("no recorder is bound");
    const input: RecorderStartInput = {
      firmId: start.firmId as FirmId,
      meetingId: start.meetingId as MeetingId,
      matterId: start.matterId,
      recordingId: start.recordingId,
      startedAt: start.startedAt,
      ceiling: start.ceiling,
      tracks: start.tracks,
    };
    // A second call for a recording the recorder already holds changes nothing, which is what lets a
    // replay ask again without knowing whether the first request got this far.
    await recorder.start(input);
  } catch (caught) {
    const failureErrorId = recordRealtimeFailure(
      c.get("logger"),
      "meetings.recording.start",
      caught,
      c.get("correlationId"),
    );
    await failStartedRecording(c, database, {
      firmId: start.firmId,
      meetingId: start.meetingId,
      recordingId: start.recordingId,
      failureErrorId,
    });
  }
}

/**
 * A REPLAYED START WHOSE FIRST REQUEST MAY NOT HAVE FINISHED. The idempotency record and the
 * recording committed together, so a replay knows the recording exists; it cannot know whether the
 * request that committed it lived long enough to tell the room and hand the recording to the
 * recorder. When the recording is still `recording`, the room is asked: one not holding it was never
 * told, and is told now — the announcement, its notices and only then the recorder — and one holding
 * it has the recorder asked again, which changes nothing when it already has the recording.
 *
 * The tracks are the recording's own rows, with the routing session each is published in read off the
 * room now: a track the room no longer carries is left to the recorder's own pass, which admits a
 * participant when they publish again.
 */
async function resumeRecordingStart(
  c: MeetingContext,
  database: SqlDatabase & BatchDatabase,
  located: {
    readonly firmId: string;
    readonly meetingId: string;
    readonly recordingId: MeetingRecordingId;
  },
): Promise<void> {
  const recording = await readRecording(
    database,
    located.meetingId as MeetingId,
    located.recordingId,
  );
  if (recording === undefined || recording.state !== "recording") return;
  const room = meetingRoomFor(c.env, located.firmId, located.meetingId);
  const [held, candidates, rows, ceiling, displayName] = await Promise.all([
    room.runningRecording(),
    room.recordingCandidates(),
    listRecordingTracks(database, recording.id),
    readFirmSetting(database, recordedTrackCeilingDefinition),
    displayNameOf(database, recording.started_by_user_id),
  ]);
  const sessions = new Map(candidates.map((track) => [track.trackName, track.sessionId]));
  const tracks: RecorderStartInput["tracks"] = rows.flatMap((row) => {
    const sessionId = sessions.get(row.track_name);
    if (row.state !== "open" || sessionId === undefined) return [];
    return [
      {
        trackId: row.id,
        trackName: row.track_name,
        sessionId,
        participantKind: row.participant_kind,
        participantId: row.participant_id,
        userId: row.user_id,
      },
    ];
  });
  await carryOutRecordingStart(c, database, {
    firmId: located.firmId,
    meetingId: located.meetingId,
    matterId: recording.matter_id,
    recordingId: recording.id,
    startedAt: recording.started_at,
    ceiling,
    tracks,
    by: { userId: recording.started_by_user_id, displayName },
    announced: held?.recordingId === recording.id,
  });
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
      const { eventKind, eventId, medium, lobby, encrypted } = c.req.valid("json");

      let outcome;
      try {
        outcome = await commitEffect<z.infer<typeof StartedMeeting>>(
          c,
          firm.firmDatabase,
          idempotency,
          async () => {
            const started = await createMeeting(
              firm.firmDatabase,
              {
                eventKind: eventKind,
                eventId,
                medium,
                lobby,
                encrypted: encrypted && endToEndEncryptionEnabled(c.env),
              },
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
      const recordingFacts = await recordingFactsFor(
        c.env,
        firm.firmDatabase,
        rows.map((row) => row.summary.id),
      );
      return c.json(
        {
          data: rows.map((row) => ({
            ...row.summary,
            configured,
            ...recordingFacts(row.summary.id),
          })),
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
      const recordingFacts = await recordingFactsFor(c.env, firm.firmDatabase, [summary.id]);
      return c.json(
        {
          ...summary,
          configured: sfuClientForEnv(c.env) !== null,
          ...recordingFacts(summary.id),
        },
        200,
      );
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
      const recordingFacts = await recordingFactsFor(c.env, firm.firmDatabase, [summary.id]);
      return c.json(
        {
          ...summary,
          configured: sfuClientForEnv(c.env) !== null,
          ...recordingFacts(summary.id),
        },
        200,
      );
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
      const recordingFacts = await recordingFactsFor(c.env, firm.firmDatabase, [summary.id]);
      return c.json(
        {
          ...summary,
          configured: sfuClientForEnv(c.env) !== null,
          ...recordingFacts(summary.id),
        },
        200,
      );
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
          executed: false,
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

      const outcome = await commitThroughARacingStop(() =>
        commitEffect<{ endedAt: string; stoppedRecordingId: string | null }>(
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
            // A RECORDING RUNNING IN THE ROOM STOPS WITH IT, in the end's own batch — `meeting-ended`,
            // attributed to the member ending the meeting — so the record can never say a recording
            // ran on in a meeting that had finished.
            const stopped = await stopRecordingForMeetingEnd(
              firm.firmDatabase,
              meetingId as MeetingId,
              {
                ...options,
                clock: { now: () => endedAt },
              },
            );
            return {
              value: { endedAt, stoppedRecordingId: stopped?.recording.id ?? null },
              responseCode: 200,
              effect: {
                statements: [...ended.effect.statements, ...(stopped?.effect.statements ?? [])],
                outboxMessages: [...ended.effect.outboxMessages],
              },
            };
          },
        ),
      );
      if (!outcome.ok) return outcome.problem;

      // THE RECORDER STOPS BEFORE THE ROOM CLOSES ITS SOCKETS, so the stop is announced to everybody
      // still there and a stop notice is written for each of them. Only on the request that ended the
      // meeting: a replay must not tell the room twice.
      //
      // After the commit, for the same reason leaving is: a participant must never be told the
      // meeting ended by a write that did not land. And kept alive past the request, because a
      // meeting that has ended in the record must end in the room even when the browser that asked
      // has gone (`outliveTheRequest`).
      const stoppedRecordingId = (outcome.value.stoppedRecordingId ??
        null) as MeetingRecordingId | null;
      const endedAt = outcome.value.endedAt;
      await outliveTheRequest(
        c,
        (async () => {
          if (outcome.executed && stoppedRecordingId !== null) {
            await settleStoppedRecording(c, firm.firmDatabase, {
              firmId,
              meetingId,
              recordingId: stoppedRecordingId,
              stopReason: "meeting-ended",
              at: endedAt,
              by: { userId, displayName: await displayNameOf(firm.firmDatabase, userId) },
            });
          }
          await meetingRoomFor(c.env, firmId, meetingId).end(endedAt);
        })(),
      );
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

  // POST /api/v1/meetings/{meetingId}/recording
  app.openapi(
    { ...startRecordingRoute, middleware: chokepointMiddleware(chokepoint, startRecordingRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      // A deployment that cannot record, or a firm that has not switched it on, is answered before
      // anything is read about the meeting — the same posture `meetings-not-configured` takes.
      if (!(await recordingConfiguredFor(c.env, firm.firmDatabase))) {
        return recordingNotConfigured(c);
      }
      const firmId = requireChokepointFirmId(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { meetingId } = c.req.valid("param");

      // What the room is carrying NOW is what the recording starts with and what the ceiling is
      // counted against; a track published a moment later is admitted by the recorder's own pass.
      const [candidates, ceiling, displayName] = await Promise.all([
        meetingRoomFor(c.env, firmId, meetingId).recordingCandidates(),
        readFirmSetting(firm.firmDatabase, recordedTrackCeilingDefinition),
        displayNameOf(firm.firmDatabase, userId),
      ]);

      let started: Awaited<ReturnType<typeof startMeetingRecording>> | undefined;
      const outcome = await commitEffect<MeetingRecordingSummaryValue>(
        c,
        firm.firmDatabase,
        idempotency,
        async () => {
          started = await startMeetingRecording(
            firm.firmDatabase,
            meetingId as MeetingId,
            { tracks: candidates, ceiling },
            serviceOptions(userId),
          );
          return {
            value: toRecordingSummary(started.recording, {
              startedBy: displayName,
              stoppedBy: null,
            }),
            responseCode: 201,
            effect: started.effect,
          };
        },
      );
      if (!outcome.ok) return outcome.problem;
      const recordingId = outcome.value.id;
      if (!outcome.executed || started === undefined) {
        // A REPLAY IS ANSWERED WITH WHAT IS TRUE NOW, after making sure the first request's work was
        // done: a request cancelled between the commit and the announcement would otherwise leave a
        // recording in the record that nobody was told about and nothing is capturing.
        await outliveTheRequest(
          c,
          resumeRecordingStart(c, firm.firmDatabase, { firmId, meetingId, recordingId }),
        );
      } else {
        const recording = started.recording;
        await outliveTheRequest(
          c,
          carryOutRecordingStart(c, firm.firmDatabase, {
            firmId,
            meetingId,
            matterId: recording.matter_id,
            recordingId: recording.id,
            startedAt: recording.started_at,
            ceiling,
            tracks: started.tracks,
            by: { userId, displayName },
            announced: false,
          }),
        );
      }
      const summary = await recordingSummaryFor(
        firm.firmDatabase,
        meetingId as MeetingId,
        recordingId,
      );
      return c.json(summary ?? outcome.value, 201);
    },
  );

  // DELETE /api/v1/meetings/{meetingId}/recording
  app.openapi(
    { ...stopRecordingRoute, middleware: chokepointMiddleware(chokepoint, stopRecordingRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const firmId = requireChokepointFirmId(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { meetingId } = c.req.valid("param");
      // The key is read here; the grant is asked by the service, because it is a fact in the firm's
      // database rather than in the session.
      const mayRecord = requireChokepointPermissions(c).has(assertPermission(RECORD));

      const outcome = await commitEffect<MeetingRecordingSummaryValue>(
        c,
        firm.firmDatabase,
        idempotency,
        async () => {
          const stopped = await stopMeetingRecording(
            firm.firmDatabase,
            meetingId as MeetingId,
            { mayRecord },
            serviceOptions(userId),
          );
          const [startedBy, stoppedBy] = await Promise.all([
            displayNameOf(firm.firmDatabase, stopped.recording.started_by_user_id),
            displayNameOf(firm.firmDatabase, userId),
          ]);
          return {
            value: toRecordingSummary(stopped.recording, { startedBy, stoppedBy }),
            responseCode: 200,
            effect: stopped.effect,
          };
        },
      );
      if (!outcome.ok) return outcome.problem;
      if (!outcome.executed) return c.json(outcome.value, 200);

      const stopped = outcome.value;
      await outliveTheRequest(
        c,
        settleStoppedRecording(c, firm.firmDatabase, {
          firmId,
          meetingId,
          recordingId: stopped.id,
          stopReason: stopped.stopReason === "host" ? "host" : "member",
          at: stopped.stoppedAt ?? new Date().toISOString(),
          by: { userId, displayName: stopped.stoppedBy?.displayName ?? "" },
        }),
      );
      // Read back after the recorder settled, so the answer says what was actually captured — and
      // `failed` when nothing was.
      const summary = await recordingSummaryFor(
        firm.firmDatabase,
        meetingId as MeetingId,
        stopped.id,
      );
      return c.json(summary ?? stopped, 200);
    },
  );

  // GET /api/v1/meetings/{meetingId}/recordings
  app.openapi(
    { ...listRecordingsRoute, middleware: chokepointMiddleware(chokepoint, listRecordingsRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { meetingId } = c.req.valid("param");
      // Through the meeting read first, so the recordings of a room behind a matter the caller may
      // not see are as absent as the room itself.
      const meeting = await readMeeting(
        firm.firmDatabase,
        meetingId as MeetingId,
        visibleMatterPredicate(),
      );
      if (meeting === undefined) return notFound(c);
      const { cursor } = c.req.valid("query");
      const found = await listRecordings(firm.firmDatabase, meetingId as MeetingId, {
        cursor: decodeCursor(cursor),
        limit: MAX_RECORDING_PAGE_SIZE,
      });
      const hasMore = found.length > MAX_RECORDING_PAGE_SIZE;
      const rows = hasMore ? found.slice(0, MAX_RECORDING_PAGE_SIZE) : found;
      const last = rows.at(-1);
      // One read for the page's filed versions, gated on each file's own matter, one for the page's
      // transcripts and one for their summaries.
      const [documents, transcripts, summaries] = await Promise.all([
        readRecordingDocuments(firm.firmDatabase, rows, visibleMatterPredicate()),
        readTranscriptMarks(
          firm.firmDatabase,
          rows.map((row) => row.id),
        ),
        readSummaryMarks(
          firm.firmDatabase,
          rows.map((row) => row.id),
        ),
      ]);
      return c.json(
        {
          // The recording summary is built fresh for each row, so the document, the transcript and the
          // transcript's summary are added in place.
          data: rows.map((row) => {
            const transcript = transcripts.get(row.id) ?? null;
            const summary = summaries.get(row.id) ?? null;
            return Object.assign(
              toRecordingSummary(
                row,
                {
                  startedBy: row.started_by_display_name,
                  stoppedBy: row.stopped_by_display_name,
                },
                transcript?.id ?? null,
                summary?.state ?? null,
              ),
              { document: documents.get(row) ?? null, transcript, summary },
            );
          }),
          nextCursor: hasMore && last !== undefined ? encodeCursor(last.started_at, last.id) : null,
        },
        200,
      );
    },
  );

  // GET /api/v1/meetings/{meetingId}/recordings/{recordingId}/notices
  app.openapi(
    {
      ...recordingNoticesRoute,
      middleware: chokepointMiddleware(chokepoint, recordingNoticesRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { meetingId, recordingId } = c.req.valid("param");
      const meeting = await readMeeting(
        firm.firmDatabase,
        meetingId as MeetingId,
        visibleMatterPredicate(),
      );
      if (meeting === undefined) return notFound(c);
      // A recording is reachable only through its meeting: one in another room is as absent as one
      // that names nothing, by the same answer.
      const recording = await readRecording(
        firm.firmDatabase,
        meetingId as MeetingId,
        recordingId as MeetingRecordingId,
      );
      if (recording === undefined) return notFound(c);
      const { cursor } = c.req.valid("query");
      const found = await listRecordingNotices(firm.firmDatabase, recording.id, {
        cursor: decodeCursor(cursor),
        limit: MAX_NOTICE_PAGE_SIZE,
      });
      const hasMore = found.length > MAX_NOTICE_PAGE_SIZE;
      const rows = hasMore ? found.slice(0, MAX_NOTICE_PAGE_SIZE) : found;
      const last = rows.at(-1);
      return c.json(
        {
          data: rows.map((row) => ({
            id: row.id,
            participantKind: row.participant_kind,
            participantId: row.participant_id,
            userId: row.user_id,
            displayName: row.display_name,
            reason: row.reason,
            deliveredAt: row.delivered_at,
          })),
          nextCursor:
            hasMore && last !== undefined ? encodeCursor(last.delivered_at, last.id) : null,
        },
        200,
      );
    },
  );

  // GET /api/v1/meetings/{meetingId}/recordings/{recordingId}/transcript
  app.openapi(
    {
      ...recordingTranscriptRoute,
      middleware: chokepointMiddleware(chokepoint, recordingTranscriptRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { meetingId, recordingId } = c.req.valid("param");
      // Through the meeting first, then the recording within it: a transcript of a recording on a
      // walled matter, or of a recording in another room, is as absent as one that names nothing.
      const meeting = await readMeeting(
        firm.firmDatabase,
        meetingId as MeetingId,
        visibleMatterPredicate(),
      );
      if (meeting === undefined) return notFound(c);
      const recording = await readRecording(
        firm.firmDatabase,
        meetingId as MeetingId,
        recordingId as MeetingRecordingId,
      );
      if (recording === undefined) return notFound(c);
      const transcript = await readTranscriptForRecording(firm.firmDatabase, recording.id);
      if (transcript === undefined) return notFound(c);
      if (transcript.state !== "ready") {
        return c.json(
          {
            transcript: toTranscriptSummary(transcript),
            data: [],
            nextCursor: null,
            linesWithheld: null,
          },
          200,
        );
      }
      // THE FILED DOCUMENT DECIDES whether its words are read here: the version the transcript filed,
      // read from the file pipeline's own record of it and gated on the file's own matter.
      const withheld = await transcriptLinesWithheld(firm.firmDatabase, transcript.file_version_id);
      if (withheld !== null) {
        return c.json(
          {
            transcript: toTranscriptSummary(transcript),
            data: [],
            nextCursor: null,
            linesWithheld: withheld,
          },
          200,
        );
      }
      const { cursor } = c.req.valid("query");
      // The cursor is the last line's ordinal; one that is not a whole number is the first page.
      const decoded = decodeCursor(cursor);
      const decodedOrdinal = decoded === undefined ? -1 : Number(decoded.createdAt);
      const afterOrdinal =
        Number.isInteger(decodedOrdinal) && decodedOrdinal >= 0 ? decodedOrdinal : -1;
      const found = await listTranscriptSegments(firm.firmDatabase, transcript.id, {
        afterOrdinal,
        limit: MAX_TRANSCRIPT_SEGMENT_PAGE_SIZE,
      });
      const hasMore = found.length > MAX_TRANSCRIPT_SEGMENT_PAGE_SIZE;
      const rows = hasMore ? found.slice(0, MAX_TRANSCRIPT_SEGMENT_PAGE_SIZE) : found;
      const last = rows.at(-1);
      // The read is recorded before the words leave, as a download is: who, which transcript and
      // document, where the page began and how many lines — never a word or a name.
      const now = new Date().toISOString();
      await commitEffectBatch(
        firm.firmDatabase,
        {
          statements: [
            transcriptReadAuditStatement(
              firm.firmDatabase,
              {
                transcript,
                actorUserId: requireChokepointUserId(c),
                afterOrdinal,
                lineCount: rows.length,
              },
              { clock: { now: () => now }, randomSource: cryptoRandomSource },
            ),
          ],
          outboxMessages: [],
        },
        { now: () => now },
      );
      return c.json(
        {
          transcript: toTranscriptSummary(transcript),
          linesWithheld: null,
          data: rows.map((row) => ({
            id: row.id,
            ordinal: row.ordinal,
            kind: row.kind,
            startedMs: row.started_ms,
            endedMs: row.ended_ms,
            text: row.text,
            speaker:
              row.participant_kind === null || row.participant_id === null
                ? null
                : {
                    participantKind: row.participant_kind,
                    participantId: row.participant_id,
                    userId: row.user_id,
                    displayName: row.display_name ?? "",
                  },
          })),
          nextCursor:
            hasMore && last !== undefined ? encodeCursor(String(last.ordinal), last.id) : null,
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
          encrypted: meeting.encrypted === 1,
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

/**
 * Why a ready transcript's lines may not be read, from where the version it filed stands — or null when
 * they may. A version this read cannot see (gone, or its file moved behind a wall) is `unavailable`.
 * Exported because the summary is held to the same document: its words are derived from the lines.
 */
export async function transcriptLinesWithheld(
  database: Parameters<typeof readRecordingDocumentFacts>[0],
  fileVersionId: FileVersionId | null,
): Promise<MeetingTranscriptWithheldReason | null> {
  if (fileVersionId === null) return "unavailable";
  const facts = (
    await readRecordingDocumentFacts(database, [fileVersionId], visibleMatterPredicate())
  ).get(fileVersionId);
  return facts === undefined
    ? "unavailable"
    : transcriptLinesWithheldBy(recordingDocumentStateOf(facts));
}
