import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import { GuardedWriteRefusedError } from "@magna-carta/data-access/effect-batch";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type { MatterId, MeetingId, UserId } from "@magna-carta/identifiers/types";
import { MEETING_LOBBY_MODES } from "@magna-carta/meetings/lobby-types";
import {
  arriveAtPersonalRoom,
  ensurePersonalRoom,
  moveSessionToMatter,
  MOVE_DELETE_EVENT_GUARD,
  MOVE_TO_MATTER_GUARD,
  openPersonalRoom,
  readPersonalRoomAtLink,
  REPLACE_LINK_GUARD,
  replacePersonalRoomLink,
  updatePersonalRoomDefaults,
} from "@magna-carta/meetings/personal-room-service";
import {
  readPersonalRoomForOwner,
  readPersonalRoomOpenSession,
} from "@magna-carta/meetings/personal-room-statements";
import {
  MeetingPersonalRoomRefusedError,
  type MeetingPersonalRoomRow,
} from "@magna-carta/meetings/personal-room-types";
import { MEETING_MEDIA } from "@magna-carta/meetings/types";
import { MeetingValidationError } from "@magna-carta/meetings/validation";
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
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierPathParam } from "../../contracts/common.ts";
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";
import { meetingErrorResponse, meetingRoomFor } from "./meetings.ts";

// A MEMBER'S PERSONAL ROOM — the standing link, its owner's defaults, opening a session, what the link
// shows a colleague who follows it, and moving a session onto a matter.
//
// A session is an ordinary meeting on an ordinary event, written when the owner opens the room. So
// everything a member does INSIDE a session — joining, the door, hosting, chat, recording — goes
// through the meeting routes beside this file, unchanged. These routes only reach the room itself,
// and answer with the meeting to join.

const JOIN = "meetings:join" as const;
const HOST = "meetings:host" as const;

// The link code is an address inside the firm behind sign-in; the pattern only keeps a path that
// cannot be a code out of the handler, and the service answers an unknown one exactly as it answers
// a malformed one.
const linkCodeParam = z.object({
  linkCode: z
    .string()
    .regex(/^[a-z0-9]{10}$/)
    .openapi({ param: { name: "linkCode", in: "path" } }),
});

const PersonalRoom = z
  .object({
    id: z.string(),
    // The room's address inside the firm: `/meetings/rooms/{linkCode}`.
    linkCode: z.string(),
    // What a session opens with.
    medium: z.enum(MEETING_MEDIA),
    lobby: z.enum(MEETING_LOBBY_MODES),
    // The session open now, when there is one somebody is using; null when the room is closed.
    openMeetingId: z.string().nullable(),
  })
  .openapi("PersonalRoom");

const PersonalRoomResponse = z
  .object({ room: PersonalRoom.nullable() })
  .openapi("PersonalRoomResponse");

const UpdatePersonalRoomRequest = z
  .object({
    medium: z.enum(MEETING_MEDIA).optional(),
    lobby: z.enum(MEETING_LOBBY_MODES).optional(),
  })
  .openapi("UpdatePersonalRoomRequest");

const OpenPersonalRoomRequest = z
  .object({
    // The opener's own zone, which the session's event is written in.
    timeZone: z.string().min(1).max(64),
    // The matter the session is about, when it is known. Without one the session can be moved onto a
    // matter later.
    matterId: z.string().nullable().optional(),
  })
  .openapi("OpenPersonalRoomRequest");

const OpenPersonalRoomResponse = z
  .object({ meetingId: z.string(), created: z.boolean() })
  .openapi("OpenPersonalRoomResponse");

const PersonalRoomAtLinkResponse = z
  .object({
    // `closed` until the owner opens the room; then `open`, with the meeting to join.
    state: z.enum(["closed", "open"]),
    ownerDisplayName: z.string(),
    isOwner: z.boolean(),
    meetingId: z.string().nullable(),
  })
  .openapi("PersonalRoomAtLink");

const MoveMeetingToMatterRequest = z
  .object({ matterId: z.string() })
  .openapi("MoveMeetingToMatterRequest");

const MoveMeetingToMatterResponse = z
  .object({ matterEventId: z.string() })
  .openapi("MoveMeetingToMatterResponse");

const problem = (description: string) => ({
  description,
  content: { "application/problem+json": { schema: Problem } },
});

const commonErrors = {
  401: problem("No valid session"),
  403: problem("The session member lacks the permission this route needs"),
  404: problem("The room, link, meeting or matter is not one the member can reach"),
  429: problem("Rate limit exceeded"),
};

const writeErrors = {
  ...commonErrors,
  400: problem("The Idempotency-Key header is missing on a write"),
  409: problem("Somebody else changed the room or the meeting first, or the request is in progress"),
  422: problem("The request body is invalid, or the Idempotency-Key was reused with a different body"),
};

function meta(
  operationId: string,
  permission: typeof JOIN | typeof HOST,
  write: boolean,
): RouteMeta {
  return {
    operationId,
    surface: "app",
    authenticated: true,
    permission,
    resource: "firm",
    audited: write,
    idempotency: write ? "required" : "optional",
    ...(write ? { idempotencyStore: "firm" as const } : {}),
    rateLimit: "default",
  };
}

const getRoute = defineOpenAPIRoute(meta("meetings.readPersonalRoom", HOST, false), {
  method: "get",
  path: "/api/v1/meetings/personal-room",
  description:
    "Reads the caller's personal room: its link, the medium and door its sessions open with, and " +
    "the session open now. `room` is null until the room is made.",
  responses: {
    200: {
      description: "The caller's room, or null",
      content: { "application/json": { schema: PersonalRoomResponse } },
    },
    ...commonErrors,
  },
});

const ensureRoute = defineOpenAPIRoute(meta("meetings.ensurePersonalRoom", HOST, true), {
  method: "post",
  path: "/api/v1/meetings/personal-room",
  description:
    "Makes the caller's personal room, or returns it when it exists. One room per member: two " +
    "requests together end with the same room.",
  request: { headers: idempotencyKeyHeader },
  responses: {
    200: {
      description: "The caller's room",
      content: { "application/json": { schema: PersonalRoomResponse } },
    },
    ...writeErrors,
  },
});

const updateRoute = defineOpenAPIRoute(meta("meetings.updatePersonalRoom", HOST, true), {
  method: "patch",
  path: "/api/v1/meetings/personal-room",
  description:
    "Changes what the caller's room opens its sessions with: sound alone or sound and pictures, and " +
    "whether arrivals wait at the door. A session already open keeps what it opened with.",
  request: {
    headers: idempotencyKeyHeader,
    body: { required: true, content: { "application/json": { schema: UpdatePersonalRoomRequest } } },
  },
  responses: {
    200: {
      description: "The caller's room after the change",
      content: { "application/json": { schema: PersonalRoomResponse } },
    },
    ...writeErrors,
  },
});

const replaceLinkRoute = defineOpenAPIRoute(
  meta("meetings.replacePersonalRoomLink", HOST, true),
  {
    method: "post",
    path: "/api/v1/meetings/personal-room/link",
    description:
      "Gives the caller's room a new link. The old link stops working at once; a session already " +
      "open is not touched.",
    request: { headers: idempotencyKeyHeader },
    responses: {
      200: {
        description: "The caller's room with its new link",
        content: { "application/json": { schema: PersonalRoomResponse } },
      },
      ...writeErrors,
    },
  },
);

const openRoute = defineOpenAPIRoute(meta("meetings.openPersonalRoom", HOST, true), {
  method: "post",
  path: "/api/v1/meetings/personal-room/open",
  description:
    "Opens a session in the caller's room: a calendar event starting now, in the caller's zone, " +
    "and a meeting on it that the caller hosts. Answers with the session already in use when there " +
    "is one (`created` false), so two tabs pressing Open land in one room. A session everybody had " +
    "left is ended at the moment the last person left, and a fresh one is opened.",
  request: {
    headers: idempotencyKeyHeader,
    body: { required: true, content: { "application/json": { schema: OpenPersonalRoomRequest } } },
  },
  responses: {
    200: {
      description: "The session to join",
      content: { "application/json": { schema: OpenPersonalRoomResponse } },
    },
    ...writeErrors,
  },
});

const atLinkRoute = defineOpenAPIRoute(meta("meetings.readRoomLink", JOIN, false), {
  method: "get",
  path: "/api/v1/meetings/rooms/{linkCode}",
  description:
    "What a personal room's link shows: whose room it is, and whether a session is open. Writes " +
    "nothing. An unknown link and the room of somebody who has left the firm are the same 404.",
  request: { params: linkCodeParam },
  responses: {
    200: {
      description: "The room behind the link",
      content: { "application/json": { schema: PersonalRoomAtLinkResponse } },
    },
    ...commonErrors,
  },
});

const arriveRoute = defineOpenAPIRoute(meta("meetings.arriveAtRoom", JOIN, true), {
  method: "post",
  path: "/api/v1/meetings/rooms/{linkCode}/arrive",
  description:
    "Arrives at a personal room by its link. While a session is open, the caller is added to its " +
    "calendar event and answered with the meeting to join through the ordinary join route, which " +
    "decides the door. While the room is closed, writes nothing and answers `closed`.",
  request: { headers: idempotencyKeyHeader, params: linkCodeParam },
  responses: {
    200: {
      description: "The room behind the link, and the meeting to join when it is open",
      content: { "application/json": { schema: PersonalRoomAtLinkResponse } },
    },
    ...writeErrors,
  },
});

const moveRoute = defineOpenAPIRoute(meta("meetings.moveToMatter", HOST, true), {
  method: "post",
  path: "/api/v1/meetings/{meetingId}/move-to-matter",
  description:
    "Moves a personal-room session onto a matter, while it runs or after it ended. Its calendar " +
    "event becomes an event on the matter with the same title, times and participants, and the " +
    "meeting keeps everything that hangs from it. Only a session not yet on a matter moves, and " +
    "only the room's owner or whoever is running the session may move it.",
  request: {
    headers: idempotencyKeyHeader,
    params: z.object({ meetingId: identifierPathParam("meeting", "meetingId") }),
    body: {
      required: true,
      content: { "application/json": { schema: MoveMeetingToMatterRequest } },
    },
  },
  responses: {
    200: {
      description: "The matter event the session now hangs from",
      content: { "application/json": { schema: MoveMeetingToMatterResponse } },
    },
    ...writeErrors,
  },
});

type PersonalRoomApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

function serviceOptions(userId: string) {
  return {
    clock: { now: () => new Date().toISOString() },
    actorUserId: userId as UserId,
    randomSource: cryptoRandomSource,
    visibility: visibleMatterPredicate(),
  };
}

function personalRoomErrorResponse(
  c: Context,
  caught: MeetingPersonalRoomRefusedError,
): ProblemResponse<403> | ProblemResponse<404> | ProblemResponse<409> {
  switch (caught.code) {
    case "personal-room-unknown":
      return problemJson(c, {
        type: "personal-room-not-found",
        title: "Not found",
        status: 404,
        detail: caught.message,
      });
    case "personal-room-not-owner":
      return problemJson(c, {
        type: "personal-room-not-owner",
        title: "This is not your room",
        status: 403,
        detail: caught.message,
      });
    case "meeting-move-refused":
      return problemJson(c, {
        type: "meeting-move-refused",
        title: "This meeting cannot be moved onto a matter",
        status: 409,
        detail: caught.message,
      });
  }
}

const RACE_GUARDS = new Set([REPLACE_LINK_GUARD, MOVE_TO_MATTER_GUARD, MOVE_DELETE_EVENT_GUARD]);

type Outcome<T> =
  | { ok: true; value: T; executed: boolean }
  | {
      ok: false;
      problem:
        | ProblemResponse<403>
        | ProblemResponse<404>
        | ProblemResponse<409>
        | ProblemResponse<422>;
    };

async function commit<T>(
  c: Context<{ Bindings: Bindings; Variables: AppVariables }>,
  call: () => Promise<{ value: T; effect: EffectWrite }>,
): Promise<Outcome<T>> {
  const firm = requireChokepointFirmContext(c);
  const idempotency = requireChokepointIdempotency(c);
  let result;
  try {
    result = await runIdempotentEffect({
      database: firm.firmDatabase,
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
    if (caught instanceof MeetingPersonalRoomRefusedError) {
      return { ok: false, problem: personalRoomErrorResponse(c, caught) };
    }
    // Somebody else replaced the link or moved the session between the read and the write; what they
    // did stands, and the caller is told so rather than handed an Error ID.
    if (caught instanceof GuardedWriteRefusedError && RACE_GUARDS.has(caught.guard)) {
      return {
        ok: false,
        problem: problemJson(c, {
          type: "personal-room-changed",
          title: "Somebody changed this first",
          status: 409,
          detail: "The room or the meeting changed while this was being done. Look again and retry.",
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
    executed: result.kind === "executed",
  };
}

async function roomBody(
  database: Parameters<typeof readPersonalRoomForOwner>[0],
  room: MeetingPersonalRoomRow | undefined,
): Promise<z.infer<typeof PersonalRoomResponse>> {
  if (room === undefined) return { room: null };
  const open = await readPersonalRoomOpenSession(database, room.id);
  const inUse = open !== undefined && (open.status === "scheduled" || open.present_count > 0);
  return {
    room: {
      id: room.id,
      linkCode: room.link_code,
      medium: room.medium,
      lobby: room.lobby,
      openMeetingId: inUse ? open.id : null,
    },
  };
}

export function registerMeetingPersonalRoomRoutes(
  app: PersonalRoomApp,
  chokepoint: Chokepoint,
): void {
  // GET /api/v1/meetings/personal-room
  app.openapi(
    { ...getRoute, middleware: chokepointMiddleware(chokepoint, getRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c) as UserId;
      const room = await readPersonalRoomForOwner(firm.firmDatabase, userId);
      return c.json(await roomBody(firm.firmDatabase, room), 200);
    },
  );

  // POST /api/v1/meetings/personal-room
  app.openapi(
    { ...ensureRoute, middleware: chokepointMiddleware(chokepoint, ensureRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c) as UserId;
      const outcome = await commit(c, async () => {
        const { effect } = await ensurePersonalRoom(firm.firmDatabase, serviceOptions(userId));
        return { value: { made: true }, effect };
      });
      if (!outcome.ok) return outcome.problem;
      const room = await readPersonalRoomForOwner(firm.firmDatabase, userId);
      return c.json(await roomBody(firm.firmDatabase, room), 200);
    },
  );

  // PATCH /api/v1/meetings/personal-room
  app.openapi(
    { ...updateRoute, middleware: chokepointMiddleware(chokepoint, updateRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c) as UserId;
      const body = c.req.valid("json");
      const outcome = await commit(c, async () => {
        const { effect } = await updatePersonalRoomDefaults(
          firm.firmDatabase,
          body,
          serviceOptions(userId),
        );
        return { value: { updated: true }, effect };
      });
      if (!outcome.ok) return outcome.problem;
      const room = await readPersonalRoomForOwner(firm.firmDatabase, userId);
      return c.json(await roomBody(firm.firmDatabase, room), 200);
    },
  );

  // POST /api/v1/meetings/personal-room/link
  app.openapi(
    { ...replaceLinkRoute, middleware: chokepointMiddleware(chokepoint, replaceLinkRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c) as UserId;
      const outcome = await commit(c, async () => {
        const { effect } = await replacePersonalRoomLink(firm.firmDatabase, serviceOptions(userId));
        return { value: { replaced: true }, effect };
      });
      if (!outcome.ok) return outcome.problem;
      const room = await readPersonalRoomForOwner(firm.firmDatabase, userId);
      return c.json(await roomBody(firm.firmDatabase, room), 200);
    },
  );

  // POST /api/v1/meetings/personal-room/open
  app.openapi(
    { ...openRoute, middleware: chokepointMiddleware(chokepoint, openRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const firmId = requireChokepointFirmId(c);
      const userId = requireChokepointUserId(c) as UserId;
      const body = c.req.valid("json");
      const outcome = await commit<{
        meetingId: string;
        created: boolean;
        endedMeetingId: string | null;
      }>(c, async () => {
        const opened = await openPersonalRoom(
          firm.firmDatabase,
          { timeZone: body.timeZone, matterId: (body.matterId ?? null) as MatterId | null },
          serviceOptions(userId),
        );
        return {
          value: {
            meetingId: opened.meetingId,
            created: opened.created,
            endedMeetingId: opened.endedMeetingId,
          },
          effect: opened.effect,
        };
      });
      if (!outcome.ok) return outcome.problem;
      // A session everybody had left was ended on the way; its signaling room is told after the
      // commit, once, so nothing lingers in it.
      const ended = outcome.value.endedMeetingId;
      if (outcome.executed && ended !== null) {
        await meetingRoomFor(c.env, firmId, ended).end(new Date().toISOString());
      }
      return c.json({ meetingId: outcome.value.meetingId, created: outcome.value.created }, 200);
    },
  );

  // GET /api/v1/meetings/rooms/{linkCode}
  app.openapi(
    { ...atLinkRoute, middleware: chokepointMiddleware(chokepoint, atLinkRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c) as UserId;
      const { linkCode } = c.req.valid("param");
      try {
        const arrival = await readPersonalRoomAtLink(
          firm.firmDatabase,
          linkCode,
          serviceOptions(userId),
        );
        return c.json(
          {
            state: arrival.state,
            ownerDisplayName: arrival.ownerDisplayName,
            isOwner: arrival.isOwner,
            meetingId: arrival.state === "open" ? arrival.meetingId : null,
          },
          200,
        );
      } catch (caught) {
        // Reading a link can only fail one way: it names no room the caller can follow.
        if (caught instanceof MeetingPersonalRoomRefusedError) {
          return problemJson(c, {
            type: "personal-room-not-found",
            title: "Not found",
            status: 404,
            detail: caught.message,
          });
        }
        throw caught;
      }
    },
  );

  // POST /api/v1/meetings/rooms/{linkCode}/arrive
  app.openapi(
    { ...arriveRoute, middleware: chokepointMiddleware(chokepoint, arriveRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c) as UserId;
      const { linkCode } = c.req.valid("param");
      const outcome = await commit<z.infer<typeof PersonalRoomAtLinkResponse>>(c, async () => {
        const { arrival, effect } = await arriveAtPersonalRoom(
          firm.firmDatabase,
          linkCode,
          serviceOptions(userId),
        );
        return {
          value: {
            state: arrival.state,
            ownerDisplayName: arrival.ownerDisplayName,
            isOwner: arrival.isOwner,
            meetingId: arrival.state === "open" ? arrival.meetingId : null,
          },
          effect,
        };
      });
      if (!outcome.ok) return outcome.problem;
      return c.json(outcome.value, 200);
    },
  );

  // POST /api/v1/meetings/{meetingId}/move-to-matter
  app.openapi(
    { ...moveRoute, middleware: chokepointMiddleware(chokepoint, moveRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c) as UserId;
      const { meetingId } = c.req.valid("param");
      const { matterId } = c.req.valid("json");
      const outcome = await commit<{ matterEventId: string }>(c, async () => {
        const moved = await moveSessionToMatter(
          firm.firmDatabase,
          meetingId as MeetingId,
          matterId as MatterId,
          serviceOptions(userId),
        );
        return { value: { matterEventId: moved.matterEventId }, effect: moved.effect };
      });
      if (!outcome.ok) return outcome.problem;
      return c.json(outcome.value, 200);
    },
  );
}
