import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import {
  GuardedWriteRefusedError,
  type BatchDatabase,
  type EffectWrite,
} from "@magna-carta/data-access/effect-batch";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type { MeetingAttendanceId, MeetingId } from "@magna-carta/identifiers/types";
import type { MeetingHostingOptions } from "@magna-carta/meetings/hosting-service";
import {
  admitParticipants,
  ADMIT_PARTICIPANT_GUARD,
  denyParticipants,
  DENY_PARTICIPANT_GUARD,
  listMeetingLobby,
  setMeetingLobby,
} from "@magna-carta/meetings/lobby-service";
import {
  MAX_MEETING_LOBBY,
  MEETING_ADMISSION_OUTCOMES,
  MEETING_DENIAL_OUTCOMES,
  MEETING_LOBBY_MODES,
  type MeetingAdmissionOutcome,
  type MeetingDenialOutcome,
} from "@magna-carta/meetings/lobby-types";
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
import { meetingErrorResponse, meetingRoomFor } from "./meetings.ts";

// THE DOOR OF ONE MEETING: whether arrivals wait at it, who is at it, and a host's decision about
// each of them.
//
// ONE LOBBY PER MEETING AND NEVER ONE PER FIRM. A firm holds several meetings at once, so a
// firm-level door would put the people arriving at a partner's deposition in the same queue as the
// people arriving at a staff briefing, in front of a host who is in neither. Every path here is
// addressed to a meeting for that reason.
//
// EVERY ONE OF THESE IS A HOST ACT, INCLUDING THE READ, and that is the one place this file departs
// from the rest of the family. Who is running the meeting, who is in it and what was said are all
// reachable by anybody who may join; who is at the DOOR is not. It is a list of people a host has
// not yet decided about, and in a lobby that exists because somebody might arrive who should not,
// telling the room who is outside it is the leak the door was shut to prevent. The grant is checked
// in the domain service, on the standing rule: the key is the floor and the record is the authority.
//
// A file of its own rather than four more routes on `meetings.ts`, on the hosting routes' own
// precedent — one route file per resource.

const HOST = "meetings:host" as const;

// ---- request/response contracts ----

const SetLobbyRequest = z
  .object({ lobby: z.enum(MEETING_LOBBY_MODES) })
  .openapi("SetMeetingLobbyRequest");

// THE IDENTIFIERS THE HOST'S PANEL WAS SHOWING, and there is deliberately no server-side "all".
// Admit all sends this list. A server-side "all" would admit whoever arrived in the millisecond
// after the host looked at the screen, which is precisely the person the host did not decide about.
//
// Bounded by the door's own ceiling, so one request can name at most the whole lobby.
const LobbyDecisionRequest = z
  .object({
    participantIds: z
      .array(identifierPathParam("meetingAttendance", "participantId"))
      .min(1)
      .max(MAX_MEETING_LOBBY),
  })
  .openapi("MeetingLobbyDecisionRequest");

const MeetingLobbyEntry = z
  .object({
    // The STAY, which is what every frame on the signaling wire is addressed by and what an
    // admission names. A member handle would not distinguish two stays.
    participantId: z.string(),
    userId: z.string(),
    displayName: z.string(),
    waitingFrom: z.string(),
  })
  .openapi("MeetingLobbyEntry");

// WHO IS AT THE DOOR, whole. Bounded by construction rather than paged: the arrival's own guard
// holds `MAX_MEETING_LOBBY`, so this cannot exceed a hundred rows however long a meeting runs — and
// a page boundary through a host's decision list would let them admit some of the people waiting
// while believing it was all of them. Recorded with that reasoning in
// tooling/lint-list-pagination/unpaged-baseline.mjs.
const MeetingLobby = z.object({ data: z.array(MeetingLobbyEntry) }).openapi("MeetingLobby");

// ONE OUTCOME PER IDENTIFIER, so a batch that half-lands is legible rather than a single refusal for
// five people. `room-full` is per person on purpose: a host admitting five into two free seats
// learns which three did not get in.
const MeetingLobbyDecisions = z
  .object({
    data: z.array(
      z.object({
        participantId: z.string(),
        outcome: z.enum([...MEETING_ADMISSION_OUTCOMES, ...MEETING_DENIAL_OUTCOMES]),
      }),
    ),
  })
  .openapi("MeetingLobbyDecisions");

const Acknowledged = z.object({ ok: z.literal(true) }).openapi("MeetingLobbyAcknowledged");

/** The decisions body as it travels through the idempotency gate and back out onto the wire. */
interface LobbyDecisionsBody {
  readonly data: readonly {
    readonly participantId: string;
    readonly outcome: MeetingAdmissionOutcome | MeetingDenialOutcome;
  }[];
}

const meetingIdParam = z.object({ meetingId: identifierPathParam("meeting", "meetingId") });

const commonErrors = {
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "The session member lacks the required permission, or is not hosting this meeting",
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
      "The meeting has ended, somebody else's decision about one of these arrivals landed first, " +
      "or a request with this Idempotency-Key is in progress",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description: "The request body is not a shape this operation accepts",
    content: { "application/problem+json": { schema: Problem } },
  },
};

// ---- route metas ----

// `resource: "firm"` on all four, for the reason both meeting keys bind the firm: a meeting hangs
// from a calendar event and a firm event belongs to no matter at all. The matter question is still
// asked — every read composes the visible-matter predicate through the meeting.
function readMeta(action: string): RouteMeta {
  return {
    operationId: `meetings.${action}`,
    surface: "app",
    authenticated: true,
    // `meetings:host` rather than `meetings:join`, unlike every other read in this family. See the
    // header: the lobby list is the one read in the meetings subsystem that the room may not see.
    permission: HOST,
    resource: "firm",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  };
}

function writeMeta(action: string): RouteMeta {
  return {
    operationId: `meetings.${action}`,
    surface: "app",
    authenticated: true,
    permission: HOST,
    resource: "firm",
    audited: true,
    // Required. A retried admission must not write a second instant over the one somebody's record
    // already carries, and a retried denial must not write a second departure.
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

// ---- routes ----

const setLobbyRoute = defineOpenAPIRoute(writeMeta("setLobby"), {
  method: "post",
  path: "/api/v1/meetings/{meetingId}/lobby",
  description:
    "Opens or closes this meeting's lobby. While it is open, an arrival who is not hosting the " +
    "meeting waits at the door until a host admits them; a host or co-host of this meeting never " +
    "waits, and holding the permission key alone is not enough. Turning the lobby off does NOT " +
    "admit the people already waiting — they stay in the list until a host decides about each of " +
    "them, because a setting is not a decision about a named person. A meeting already in the " +
    "state asked for answers 200 unchanged.",
  request: {
    params: meetingIdParam,
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: SetLobbyRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The door is where the caller asked for it",
      content: { "application/json": { schema: Acknowledged } },
    },
    ...writeErrors,
  },
});

const lobbyRoute = defineOpenAPIRoute(readMeta("lobby"), {
  method: "get",
  path: "/api/v1/meetings/{meetingId}/lobby",
  description:
    "Who is waiting to be let into this meeting, oldest arrival first. Reachable only by a host " +
    "or co-host of this meeting — it is a list of people nobody has decided about yet, and the " +
    "people inside are not among those who need to see it. Returned whole: a lobby holds at most " +
    "a hundred arrivals by construction, and a page boundary through it would let a host admit " +
    "some of the people waiting while believing it was all of them.",
  request: { params: meetingIdParam },
  responses: {
    200: {
      description: "Who is at the door",
      content: { "application/json": { schema: MeetingLobby } },
    },
    ...commonErrors,
  },
});

const admitRoute = defineOpenAPIRoute(writeMeta("admitToLobby"), {
  method: "post",
  path: "/api/v1/meetings/{meetingId}/lobby/admissions",
  description:
    "Lets the named arrivals into the meeting: each stay is marked admitted, the room moves them " +
    "onto the roster, their socket is sent `admitted` and then the ordinary welcome, and everybody " +
    "already inside sees them join. One outcome per identifier — `admitted`, `not-waiting` or " +
    "`room-full` — so a batch that half-lands is legible: a host admitting five people into two " +
    "free seats learns which three did not get in. There is deliberately no server-side 'admit " +
    "everyone': Admit all sends the identifiers the panel was showing, because a server-side 'all' " +
    "would admit whoever arrived in the millisecond after the host looked at the list.",
  request: {
    params: meetingIdParam,
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: LobbyDecisionRequest } }, required: true },
  },
  responses: {
    200: {
      description: "What became of each named arrival",
      content: { "application/json": { schema: MeetingLobbyDecisions } },
    },
    ...writeErrors,
  },
});

const denyRoute = defineOpenAPIRoute(writeMeta("denyFromLobby"), {
  method: "post",
  path: "/api/v1/meetings/{meetingId}/lobby/denials",
  description:
    "Turns the named arrivals away: each stay closes as denied, their socket is refused and " +
    "closed, and they cannot rejoin while this meeting runs — a denial that did not bar would be " +
    "a button that does nothing, since the member would press Join again and be back at the front " +
    "of the queue. It is the meeting they are barred from and not the event. Nothing is announced " +
    "to the people in the room: they never knew somebody was at the door.",
  request: {
    params: meetingIdParam,
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: LobbyDecisionRequest } }, required: true },
  },
  responses: {
    200: {
      description: "What became of each named arrival",
      content: { "application/json": { schema: MeetingLobbyDecisions } },
    },
    ...writeErrors,
  },
});

// ---- helpers ----

function hostingOptions(
  c: Context<{ Bindings: Bindings; Variables: AppVariables }>,
): MeetingHostingOptions {
  return {
    clock: { now: () => new Date().toISOString() },
    actorUserId: requireChokepointUserId(c),
    randomSource: cryptoRandomSource,
    // The same predicate every calendar source composes, so a room a list read could not reach
    // cannot have its door opened by its handle.
    visibility: visibleMatterPredicate(),
  };
}

type LobbyOutcome<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      problem:
        | ProblemResponse<403>
        | ProblemResponse<404>
        | ProblemResponse<409>
        | ProblemResponse<422>;
    };

/**
 * Runs one lobby write through the idempotency gate, mapping the subsystem's refusals and the two
 * guards on the way out.
 *
 * A GUARD THAT MATCHED NO ROW IS A RACE THE CALLER RE-READS, and both of them mean the same thing
 * to a host: somebody else's decision about one of these arrivals landed first. The admission's
 * guard fires when the room filled or the stay closed inside the window; the denial's when the stay
 * closed. Neither is a fault, and neither is a state the caller can assume — so the whole batch
 * rolls back and the answer says to read the lobby again, rather than reporting outcomes for a
 * batch that did not land.
 *
 * The decisions are carried through the gate as the stored body, so a retry is told exactly what the
 * first call was told rather than re-deciding against a lobby that has moved.
 */
async function commitLobbyEffect<T>(
  c: Context,
  database: BatchDatabase,
  idempotency: { key: string | undefined; fingerprint: string },
  call: () => Promise<{ value: T; effect: EffectWrite }>,
): Promise<LobbyOutcome<T>> {
  let result;
  try {
    result = await runIdempotentEffect({
      database,
      key: idempotency.key,
      fingerprint: idempotency.fingerprint,
      now: () => new Date().toISOString(),
      effect: async () => {
        const { value, effect } = await call();
        return { write: effect, responseCode: 200, responseBody: canonicalJsonStringify(value) };
      },
    });
  } catch (caught) {
    if (caught instanceof MeetingValidationError) {
      return { ok: false, problem: meetingErrorResponse(c, caught) };
    }
    if (
      caught instanceof GuardedWriteRefusedError &&
      (caught.guard === ADMIT_PARTICIPANT_GUARD || caught.guard === DENY_PARTICIPANT_GUARD)
    ) {
      return { ok: false, problem: lostTheRace(c) };
    }
    throw caught;
  }
  if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
    return { ok: false, problem: problemResponseForIdempotencyConflict(c, result) };
  }
  return { ok: true, value: JSON.parse(result.responseBody ?? "{}") as T };
}

function notFound(c: Context): ProblemResponse<404> {
  return problemJson(c, {
    type: "meeting-not-found",
    title: "Not found",
    status: 404,
    detail: "No such meeting in this firm.",
  });
}

// An AUTHORITY answer rather than a permission one: the member holds `meetings:host`; what they do
// not hold is a grant on this room.
function notHost(c: Context, detail: string): ProblemResponse<403> {
  return problemJson(c, {
    type: "meeting-not-host",
    title: "You are not hosting this meeting",
    status: 403,
    detail,
    requestAccess: false,
  });
}

function lostTheRace(c: Context): ProblemResponse<409> {
  return problemJson(c, {
    type: "conflict",
    title: "Somebody else decided first",
    status: 409,
    detail:
      "Another host's decision about one of these arrivals landed first. Read the lobby again.",
  });
}

// ---- registration ----

export function registerMeetingLobbyRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  // POST /api/v1/meetings/{meetingId}/lobby
  app.openapi(
    { ...setLobbyRoute, middleware: chokepointMiddleware(chokepoint, setLobbyRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const firmId = requireChokepointFirmId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { meetingId } = c.req.valid("param");
      const { lobby } = c.req.valid("json");

      const outcome = await commitLobbyEffect<{ ok: true }>(
        c,
        firm.firmDatabase,
        idempotency,
        async () => ({
          value: { ok: true },
          effect: (
            await setMeetingLobby(
              firm.firmDatabase,
              meetingId as MeetingId,
              lobby,
              hostingOptions(c),
            )
          ).effect,
        }),
      );
      if (!outcome.ok) return outcome.problem;

      // AFTER the commit, on the standing precedent: nobody is told the door moved by a write that
      // then failed. The room rewrites its own copy and broadcasts the room state; it admits
      // nobody, because a setting is not a decision about a named person.
      await meetingRoomFor(c.env, firmId, meetingId).lobbyChanged(lobby);
      return c.json({ ok: true } as const, 200);
    },
  );

  // GET /api/v1/meetings/{meetingId}/lobby
  app.openapi(
    { ...lobbyRoute, middleware: chokepointMiddleware(chokepoint, lobbyRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { meetingId } = c.req.valid("param");
      try {
        const waiting = await listMeetingLobby(
          firm.firmDatabase,
          meetingId as MeetingId,
          hostingOptions(c),
        );
        return c.json({ data: [...waiting] }, 200);
      } catch (caught) {
        // THE TWO THIS READ CAN RAISE, mapped here rather than through the family's shared switch:
        // that one's answers span 403, 404 and 409, and a read whose contract declares no 409 must
        // not be able to produce one. `listMeetingLobby` reaches the meeting and then the grant, so
        // those two are the whole of it.
        if (caught instanceof MeetingValidationError) {
          return caught.code === "meeting-not-host" ? notHost(c, caught.message) : notFound(c);
        }
        throw caught;
      }
    },
  );

  // POST /api/v1/meetings/{meetingId}/lobby/admissions
  app.openapi(
    { ...admitRoute, middleware: chokepointMiddleware(chokepoint, admitRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const firmId = requireChokepointFirmId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { meetingId } = c.req.valid("param");
      const { participantIds } = c.req.valid("json");

      const outcome = await commitLobbyEffect<LobbyDecisionsBody>(
        c,
        firm.firmDatabase,
        idempotency,
        async () => {
          const admitted = await admitParticipants(
            firm.firmDatabase,
            meetingId as MeetingId,
            participantIds as MeetingAttendanceId[],
            hostingOptions(c),
          );
          return { value: { data: [...admitted.decisions] }, effect: admitted.effect };
        },
      );
      if (!outcome.ok) return outcome.problem;

      // AFTER the commit. The record now says these people are in the meeting, so the room may move
      // them off the door and onto the roster — and only the ones it actually admitted, because
      // telling the room to seat somebody who was refused for a full seat would put a tile on every
      // screen for a person whose stay says they are still outside.
      const admitted = outcome.value.data
        .filter((decision) => decision.outcome === "admitted")
        .map((decision) => decision.participantId);
      if (admitted.length > 0) {
        await meetingRoomFor(c.env, firmId, meetingId).participantsAdmitted(admitted);
      }
      return c.json({ data: [...outcome.value.data] }, 200);
    },
  );

  // POST /api/v1/meetings/{meetingId}/lobby/denials
  app.openapi(
    { ...denyRoute, middleware: chokepointMiddleware(chokepoint, denyRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const firmId = requireChokepointFirmId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { meetingId } = c.req.valid("param");
      const { participantIds } = c.req.valid("json");

      const outcome = await commitLobbyEffect<LobbyDecisionsBody>(
        c,
        firm.firmDatabase,
        idempotency,
        async () => {
          const denied = await denyParticipants(
            firm.firmDatabase,
            meetingId as MeetingId,
            participantIds as MeetingAttendanceId[],
            hostingOptions(c),
          );
          return { value: { data: [...denied.decisions] }, effect: denied.effect };
        },
      );
      if (!outcome.ok) return outcome.problem;

      const denied = outcome.value.data
        .filter((decision) => decision.outcome === "denied")
        .map((decision) => decision.participantId);
      if (denied.length > 0) {
        await meetingRoomFor(c.env, firmId, meetingId).participantsDenied(denied);
      }
      return c.json({ data: [...outcome.value.data] }, 200);
    },
  );
}
