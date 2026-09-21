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
import type { MeetingAttendanceId, MeetingId, UserId } from "@magna-carta/identifiers/types";
import {
  grantHosting,
  HANDOVER_GUARD,
  LOCK_MEETING_GUARD,
  removeParticipant,
  REMOVE_PARTICIPANT_GUARD,
  revokeHosting,
  REVOKE_HOSTING_GUARD,
  setMeetingLocked,
  type MeetingHostingOptions,
} from "@magna-carta/meetings/hosting-service";
import { isHostGrantConflict, readLiveHostGrants } from "@magna-carta/meetings/hosting-statements";
import { MEETING_HOST_ROLES } from "@magna-carta/meetings/hosting-types";
import { readMeeting } from "@magna-carta/meetings/meeting-statements";
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

// WHO IS RUNNING A MEETING, and the acts that need somebody's name against them afterwards.
//
// THE SPLIT FROM THE FRAMES IS THE POINT OF THIS FILE. A host also mutes, asks somebody to unmute
// and spotlights a participant, and none of those is here: they are frames on the signaling socket
// (apps/api-worker/src/meetings/room/room-hosting.ts), because they are about this moment and leave
// nothing behind. What is here is the other rule — an act is a ROUTE with an audit row when somebody
// could later ask who did it. A member was put out of a meeting that is on a matter's record;
// arrivals were refused at a door somebody closed; the room changed hands. Each of those outlives
// the room, and the only honest answer to "who did that" is a row written through the firm-scoped
// data-access layer at the moment it happened.
//
// THE PERMISSION KEY IS NOT THE AUTHORITY. `meetings:host` says a firm lets this member convene
// meetings; it cannot say they are running THIS room, because that changes while the meeting runs.
// Every write here composes `requireHostGrant` inside the domain service, which is the one
// chokepoint for the question — so a sixth host act cannot be added without it.
//
// ONE REFUSAL FOR EVERY WAY A ROOM IS OUT OF REACH, exactly as the meetings routes hold it: an
// unknown meeting handle and a meeting on a matter the member may not see are both 404, because a
// meeting is reachable only through its calendar event.

const JOIN = "meetings:join" as const;
const HOST = "meetings:host" as const;

// ---- request/response contracts ----

const GrantHostingRequest = z
  .object({
    // The member the grant is for. Naming ONESELF is how a hostless room is claimed — the same
    // route, addressed to the caller, refused the moment anybody else holding a grant is in the
    // room.
    userId: z.string().min(1).max(64),
    role: z.enum(MEETING_HOST_ROLES),
  })
  .openapi("GrantMeetingHostingRequest");

const SetLockedRequest = z.object({ locked: z.boolean() }).openapi("SetMeetingLockedRequest");

const MeetingHostGrant = z
  .object({
    userId: z.string(),
    role: z.enum(MEETING_HOST_ROLES),
    grantedAt: z.string(),
  })
  .openapi("MeetingHostGrant");

// THE LIVE GRANTS AND NOTHING ELSE. The closed ones are the record — who was hosting when something
// happened — and are read from the audit log and the rows behind it rather than from a surface a
// room screen polls.
const MeetingHostGrants = z
  .object({ data: z.array(MeetingHostGrant) })
  .openapi("MeetingHostGrants");

const Acknowledged = z.object({ ok: z.literal(true) }).openapi("MeetingHostingAcknowledged");

const meetingIdParam = z.object({ meetingId: identifierPathParam("meeting", "meetingId") });

const hostParams = z.object({
  meetingId: identifierPathParam("meeting", "meetingId"),
  // A member handle rather than a stay: a grant is held by the person for the length of the
  // meeting, across as many connections as they make.
  userId: identifierPathParam("user", "userId"),
});

const participantParams = z.object({
  meetingId: identifierPathParam("meeting", "meetingId"),
  // THE STAY'S OWN HANDLE, which is what the roster names and what every frame carries. A member
  // handle would not distinguish two stays, and the room has never had one.
  participantId: identifierPathParam("meetingAttendance", "participantId"),
});

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
      "The meeting has ended, the member is not in it, another host act won the same instant, " +
      "or a request with this Idempotency-Key is in progress",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description: "The request body is not a shape this operation accepts",
    content: { "application/problem+json": { schema: Problem } },
  },
};

// ---- route metas ----

// `resource: "firm"` on all five, for the reason both meeting keys bind the firm: a meeting hangs
// from a calendar event and a firm event belongs to no matter at all. The matter question is still
// asked — every read composes the visible-matter predicate through the meeting.
function readMeta(action: string): RouteMeta {
  return {
    operationId: `meetings.${action}`,
    surface: "app",
    authenticated: true,
    // THE GRANTS READ RIDES `meetings:join` rather than `meetings:host`. Everybody in the room needs
    // to know who is running it, and hiding that from the people it governs would be a strange kind
    // of privacy.
    permission: JOIN,
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
    // The key is the floor and the grant is the authority; the grant is checked in the domain
    // service, because the chokepoint answers a question about the firm's roles rather than about
    // this room.
    permission: HOST,
    resource: "firm",
    audited: true,
    // Required. A retried hand-over must not close the outgoing grant twice, and a retried removal
    // must not write a second departure over one somebody's record already carries.
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

// ---- routes ----

const grantsRoute = defineOpenAPIRoute(readMeta("hosts"), {
  method: "get",
  path: "/api/v1/meetings/{meetingId}/hosts",
  description:
    "Who is running this meeting right now: the host, and any co-hosts, with the instant each " +
    "grant opened. Reachable by anybody who may join the meeting — everybody in the room needs to " +
    "know who is running it. Closed grants are not returned; the record of who was hosting when " +
    "something happened is the audit log's.",
  request: { params: meetingIdParam },
  responses: {
    200: {
      description: "The live grants",
      content: { "application/json": { schema: MeetingHostGrants } },
    },
    ...commonErrors,
  },
});

const grantRoute = defineOpenAPIRoute(writeMeta("grantHosting"), {
  method: "post",
  path: "/api/v1/meetings/{meetingId}/hosts",
  description:
    "Hands hosting over, names a co-host, or claims a room nobody is running. One route because " +
    "they are one act with different arguments — writing or closing a grant — and the target must " +
    "be in the room: a running meeting is not handed to somebody who is not in it. Naming " +
    "yourself is the claim, and it is refused while anybody else holding a grant has an open stay; " +
    "it is recorded as a claim rather than as a hand-over, because nobody gave it. Only the host " +
    "may hand the room over or name a co-host.",
  request: {
    params: meetingIdParam,
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: GrantHostingRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The grants now standing",
      content: { "application/json": { schema: MeetingHostGrants } },
    },
    ...writeErrors,
  },
});

const revokeRoute = defineOpenAPIRoute(writeMeta("revokeHosting"), {
  method: "post",
  path: "/api/v1/meetings/{meetingId}/hosts/{userId}/revoke",
  description:
    "Withdraws a grant. Naming somebody else is the host's act and reaches only a co-host — a " +
    "co-host withdrawing the host's would be taking the room, which is what a hand-over is for. " +
    "Naming YOURSELF is a resignation and is anybody's to make, so a co-host can stop being one " +
    "without asking; the one refusal is the sole grant-holder, because a host resigning out of a " +
    "room where nobody else holds anything would leave a running meeting with nobody running it. A " +
    "member who holds no grant answers 200 unchanged: what the caller asked for is already true.",
  request: { params: hostParams, headers: idempotencyKeyHeader },
  responses: {
    200: {
      description: "The grants now standing",
      content: { "application/json": { schema: MeetingHostGrants } },
    },
    ...writeErrors,
  },
});

const removeRoute = defineOpenAPIRoute(writeMeta("removeParticipant"), {
  method: "post",
  path: "/api/v1/meetings/{meetingId}/participants/{participantId}/remove",
  description:
    "Puts somebody out of the room: their stay closes as removed, the room drops them from the " +
    "roster, their media stops and their socket is refused and closed. They cannot rejoin while " +
    "this meeting runs — it is the meeting they are barred from and not the event, so a new " +
    "meeting on the same event admits them. A co-host may not remove the host, and nobody removes " +
    "themselves through this control: leaving is how a person leaves.",
  request: { params: participantParams, headers: idempotencyKeyHeader },
  responses: {
    200: {
      description: "The member is out of the meeting",
      content: { "application/json": { schema: Acknowledged } },
    },
    ...writeErrors,
  },
});

const lockRoute = defineOpenAPIRoute(writeMeta("setLocked"), {
  method: "post",
  path: "/api/v1/meetings/{meetingId}/lock",
  description:
    "Shuts the door, or opens it again. A locked meeting refuses arrivals at the join route with " +
    "a sentence a late arrival can read, and touches nobody already in it; the meeting summary " +
    "carries `locked`, so a Join control says so before the click rather than after it. A room " +
    "already in the state asked for answers 200 unchanged rather than moving the instant and the " +
    "actor already on the record.",
  request: {
    params: meetingIdParam,
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: SetLockedRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The door is where the caller asked for it",
      content: { "application/json": { schema: Acknowledged } },
    },
    ...writeErrors,
  },
});

// ---- helpers ----

function notFound(c: Context): ProblemResponse<404> {
  return problemJson(c, {
    type: "meeting-not-found",
    title: "Not found",
    status: 404,
    detail: "No such meeting in this firm.",
  });
}

function hostingOptions(
  c: Context<{ Bindings: Bindings; Variables: AppVariables }>,
): MeetingHostingOptions {
  return {
    clock: { now: () => new Date().toISOString() },
    actorUserId: requireChokepointUserId(c),
    randomSource: cryptoRandomSource,
    // The same predicate every calendar source composes, so a room a list read could not reach
    // cannot be taken over by its handle.
    visibility: visibleMatterPredicate(),
  };
}

type HostingOutcome =
  | { ok: true; admittedAttendanceId: string | null }
  | {
      ok: false;
      problem:
        | ProblemResponse<403>
        | ProblemResponse<404>
        | ProblemResponse<409>
        | ProblemResponse<422>;
    };

/**
 * Runs one hosting write through the idempotency gate, mapping the subsystem's refusals and the two
 * races the database settles on the way out.
 *
 * A GUARD THAT MATCHED NO ROW IS NOT ALWAYS A FAILURE, and which it is depends on what was asked
 * for. A withdrawal or a lock that lost its race asked for a state that is now true anyway, and
 * telling the caller otherwise would report a failure that did not happen. A HAND-OVER that lost its
 * race is different: somebody else's hand-over landed, this one did not, and the room is not where
 * the caller left it — so that one is a conflict the caller re-reads and decides about.
 */
async function commitHostingEffect(
  c: Context,
  database: BatchDatabase,
  idempotency: { key: string | undefined; fingerprint: string },
  call: () => Promise<{ write: EffectWrite; admittedAttendanceId?: string | null }>,
): Promise<HostingOutcome> {
  let result;
  try {
    result = await runIdempotentEffect({
      database,
      key: idempotency.key,
      fingerprint: idempotency.fingerprint,
      now: () => new Date().toISOString(),
      effect: async () => {
        const { write, admittedAttendanceId } = await call();
        return {
          write,
          responseCode: 200,
          // Who is running the room is read back off the record afterwards rather than replayed
          // from here, so a retry and a first call are told the same thing. The one thing that IS
          // carried through the gate is the stay a grant admitted at the door: it is a fact about
          // what this batch did, and a retry has to move the same person into the room.
          responseBody: canonicalJsonStringify({
            ok: true,
            admittedAttendanceId: admittedAttendanceId ?? null,
          }),
        };
      },
    });
  } catch (caught) {
    if (caught instanceof MeetingValidationError) {
      return { ok: false, problem: meetingErrorResponse(c, caught) };
    }
    if (caught instanceof GuardedWriteRefusedError) {
      if (caught.guard === REVOKE_HOSTING_GUARD || caught.guard === LOCK_MEETING_GUARD) {
        return { ok: true, admittedAttendanceId: null };
      }
      if (caught.guard === REMOVE_PARTICIPANT_GUARD) {
        // The stay closed under the removal — the member left, or the meeting ended in the window.
        return {
          ok: false,
          problem: problemJson(c, {
            type: "meeting-not-joined",
            title: "You are not in this meeting",
            status: 409,
            detail: "That member is no longer in this meeting.",
          }),
        };
      }
      if (caught.guard === HANDOVER_GUARD) return { ok: false, problem: lostTheRace(c) };
    }
    // THE OTHER HALF OF THE SAME RACE, arrived at through the index rather than through a guard:
    // two members handing the room to two different people in the same instant, where the loser's
    // insert meets the one-live-host index. One live host per meeting is held there rather than by
    // any read this route could make.
    if (isHostGrantConflict(caught)) return { ok: false, problem: lostTheRace(c) };
    throw caught;
  }
  if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
    return { ok: false, problem: problemResponseForIdempotencyConflict(c, result) };
  }
  const body = JSON.parse(result.responseBody ?? "{}") as { admittedAttendanceId?: string | null };
  return { ok: true, admittedAttendanceId: body.admittedAttendanceId ?? null };
}

function lostTheRace(c: Context): ProblemResponse<409> {
  return problemJson(c, {
    type: "conflict",
    title: "Somebody else changed who is hosting",
    status: 409,
    detail: "Another host act landed first. Read who is hosting and try again.",
  });
}

/**
 * The live grants, read back after the write and handed to the room.
 *
 * ONE READ SERVES BOTH, and the order is the existing `participantLeft` / `end` precedent: the room
 * is told what is true only after the record says it, so nobody is told the room changed hands by a
 * write that then failed. The room rewrites the role on each stored participant from this, which is
 * what makes a withdrawn co-host stop being able to mute people on their next frame.
 */
async function announceGrants(
  c: Context<{ Bindings: Bindings; Variables: AppVariables }>,
  database: BatchDatabase,
  meetingId: string,
): Promise<z.infer<typeof MeetingHostGrant>[]> {
  const grants = (await readLiveHostGrants(database, meetingId as MeetingId)).map((grant) => ({
    userId: grant.user_id,
    role: grant.role,
    grantedAt: grant.granted_at,
  }));
  await meetingRoomFor(c.env, requireChokepointFirmId(c), meetingId).hostingChanged(grants);
  return grants;
}

// ---- registration ----

export function registerMeetingHostingRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  // GET /api/v1/meetings/{meetingId}/hosts
  app.openapi(
    { ...grantsRoute, middleware: chokepointMiddleware(chokepoint, grantsRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { meetingId } = c.req.valid("param");
      // Through the meeting read FIRST, so the grants on a room behind a matter the caller may not
      // see are as absent as the room itself. That read is where the walled-matter question is
      // answered; nothing here re-states it.
      const meeting = await readMeeting(
        firm.firmDatabase,
        meetingId as MeetingId,
        visibleMatterPredicate(),
      );
      if (meeting === undefined) return notFound(c);
      const grants = await readLiveHostGrants(firm.firmDatabase, meetingId as MeetingId);
      return c.json(
        {
          data: grants.map((grant) => ({
            userId: grant.user_id,
            role: grant.role,
            grantedAt: grant.granted_at,
          })),
        },
        200,
      );
    },
  );

  // POST /api/v1/meetings/{meetingId}/hosts
  app.openapi(
    { ...grantRoute, middleware: chokepointMiddleware(chokepoint, grantRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const idempotency = requireChokepointIdempotency(c);
      const { meetingId } = c.req.valid("param");
      const { userId, role } = c.req.valid("json");

      const outcome = await commitHostingEffect(c, firm.firmDatabase, idempotency, async () => {
        const granted = await grantHosting(
          firm.firmDatabase,
          meetingId as MeetingId,
          { userId: userId as UserId, role },
          hostingOptions(c),
        );
        return {
          write: granted.effect,
          admittedAttendanceId: granted.admittedAttendanceId,
        };
      });
      if (!outcome.ok) return outcome.problem;

      // A HOST DOES NOT WAIT IN THEIR OWN LOBBY. A grant written for somebody whose stay was at the
      // door admitted that stay in the same batch, so the room moves them onto the roster BEFORE it
      // is told who is running it — otherwise the claimer's own socket would still be in the lobby
      // state when `hostingChanged` rewrote a participant record that does not exist yet.
      if (outcome.admittedAttendanceId !== null) {
        await meetingRoomFor(c.env, requireChokepointFirmId(c), meetingId).participantsAdmitted([
          outcome.admittedAttendanceId,
        ]);
      }
      return c.json({ data: await announceGrants(c, firm.firmDatabase, meetingId) }, 200);
    },
  );

  // POST /api/v1/meetings/{meetingId}/hosts/{userId}/revoke
  app.openapi(
    { ...revokeRoute, middleware: chokepointMiddleware(chokepoint, revokeRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const idempotency = requireChokepointIdempotency(c);
      const { meetingId, userId } = c.req.valid("param");

      const outcome = await commitHostingEffect(c, firm.firmDatabase, idempotency, async () => ({
        write: (
          await revokeHosting(
            firm.firmDatabase,
            meetingId as MeetingId,
            userId as UserId,
            hostingOptions(c),
          )
        ).effect,
      }));
      if (!outcome.ok) return outcome.problem;
      return c.json({ data: await announceGrants(c, firm.firmDatabase, meetingId) }, 200);
    },
  );

  // POST /api/v1/meetings/{meetingId}/participants/{participantId}/remove
  app.openapi(
    { ...removeRoute, middleware: chokepointMiddleware(chokepoint, removeRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const firmId = requireChokepointFirmId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { meetingId, participantId } = c.req.valid("param");

      const outcome = await commitHostingEffect(c, firm.firmDatabase, idempotency, async () => ({
        write: (
          await removeParticipant(
            firm.firmDatabase,
            meetingId as MeetingId,
            participantId as MeetingAttendanceId,
            hostingOptions(c),
          )
        ).effect,
      }));
      if (!outcome.ok) return outcome.problem;

      // AFTER the commit. The record now says they are not in the meeting, so the room may drop
      // them, stop their media and refuse their socket — and the grants are re-announced because a
      // removed co-host's grant closed in the same batch.
      const room = meetingRoomFor(c.env, firmId, meetingId);
      await room.participantRemoved(participantId);
      await announceGrants(c, firm.firmDatabase, meetingId);
      return c.json({ ok: true } as const, 200);
    },
  );

  // POST /api/v1/meetings/{meetingId}/lock
  app.openapi(
    { ...lockRoute, middleware: chokepointMiddleware(chokepoint, lockRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const firmId = requireChokepointFirmId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { meetingId } = c.req.valid("param");
      const { locked } = c.req.valid("json");

      // Whether the write moved anything, kept from inside the effect: it decides whether the room
      // is told, and the commit hands back only what it was given.
      let changed = false;
      const outcome = await commitHostingEffect(c, firm.firmDatabase, idempotency, async () => {
        const set = await setMeetingLocked(
          firm.firmDatabase,
          meetingId as MeetingId,
          locked,
          hostingOptions(c),
        );
        changed = set.changed;
        return { write: set.effect };
      });
      if (!outcome.ok) return outcome.problem;

      // ONLY WHEN THE DOOR ACTUALLY MOVED. Locking a room that is already locked produces no
      // statements, so there is nothing anybody needs telling: a room-state broadcast to three
      // hundred sockets to restate what each of them already draws is a frame that says nothing, and
      // a screen redrawing its door reports an event that did not happen. A replayed request takes
      // the same path, because it commits nothing either.
      if (changed) await meetingRoomFor(c.env, firmId, meetingId).roomStateChanged(locked);
      return c.json({ ok: true } as const, 200);
    },
  );
}
