import { endToEndEncryptionEnabled } from "../../../meetings/encryption-switch.ts";
import { type OpenAPIHono, z } from "@hono/zod-openapi";
import type { MatterId, MeetingPersonalRoomId } from "@magna-carta/identifiers/types";
import {
  createSharedRoom,
  openRoomAtAddress,
  renameRoom,
  retireSharedRoom,
  updateSharedRoomDefaults,
} from "@magna-carta/meetings/personal-room-service";
import { listSharedRooms } from "@magna-carta/meetings/personal-room-statements";
import { roomDisplayName, type SharedRoomRow } from "@magna-carta/meetings/personal-room-types";
import {
  CreateSharedRoomRequest,
  OpenPersonalRoomRequest,
  OpenPersonalRoomResponse,
  SharedRoomsResponse,
  UpdateSharedRoomRequest,
} from "@magna-carta/meetings/personal-room-contract";
import { assertPermission } from "@magna-carta/access-control/registry";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
  requireChokepointPermissions,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { commit, serviceOptions } from "./meeting-personal-room-commit.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierPathParam } from "../../contracts/common.ts";
import { Problem } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { meetingRoomFor } from "./meetings.ts";

// THE FIRM'S SHARED ROOMS — "Red Room", "Large Conference Room" — and opening any room at its
// address. A shared room is a row beside the members' own rooms (`kind = 'shared'`) and every session
// in it is an ordinary meeting, so joining, the door, hosting and recording go through the meeting
// routes unchanged. Anybody who may host meetings sets one up, renames it, changes what it opens with,
// takes it off the list, and opens it; anybody who may join sees the list and follows the link.

const JOIN = "meetings:join" as const;
const HOST = "meetings:host" as const;

const problem = (description: string) => ({
  description,
  content: { "application/problem+json": { schema: Problem } },
});

const commonErrors = {
  401: problem("No valid session"),
  403: problem("The session member lacks the permission this route needs"),
  404: problem("The room is not one the member can reach"),
  429: problem("Rate limit exceeded"),
};

const writeErrors = {
  ...commonErrors,
  400: problem("The Idempotency-Key header is missing on a write"),
  409: problem("Somebody else changed the room first, or the request is in progress"),
  422: problem(
    "The body is invalid, the room's name is empty or too long, or the Idempotency-Key was reused " +
      "with a different body",
  ),
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

const roomIdParam = z.object({ roomId: identifierPathParam("meetingPersonalRoom", "roomId") });
const addressParam = z.object({
  linkCode: z
    .string()
    .regex(/^[a-z0-9-]{1,40}$/)
    .openapi({ param: { name: "linkCode", in: "path" } }),
});

const sharedRoomsResponse = {
  description: "The firm's shared rooms",
  content: { "application/json": { schema: SharedRoomsResponse } },
};

const listRoute = defineOpenAPIRoute(meta("meetings.listSharedRooms", JOIN, false), {
  method: "get",
  path: "/api/v1/meetings/shared-rooms",
  description:
    "The firm's shared rooms by name, with who set each up and how many people are in the session " +
    "it has open. Names no matter.",
  responses: { 200: sharedRoomsResponse, ...commonErrors },
});

const createRoute = defineOpenAPIRoute(meta("meetings.createSharedRoom", HOST, true), {
  method: "post",
  path: "/api/v1/meetings/shared-rooms",
  description:
    "Sets up a room the firm shares, such as a conference room, addressed by its name " +
    "(`/room/red-room`, numbered where another room has it). Answers with the whole list.",
  request: {
    headers: idempotencyKeyHeader,
    body: { required: true, content: { "application/json": { schema: CreateSharedRoomRequest } } },
  },
  responses: { 200: sharedRoomsResponse, ...writeErrors },
});

const updateRoute = defineOpenAPIRoute(meta("meetings.updateSharedRoom", HOST, true), {
  method: "patch",
  path: "/api/v1/meetings/shared-rooms/{roomId}",
  description:
    "Renames a shared room or changes what its sessions open with. A new name moves the room's " +
    "address with it, and the old address stops working. Answers with the whole list.",
  request: {
    headers: idempotencyKeyHeader,
    params: roomIdParam,
    body: { required: true, content: { "application/json": { schema: UpdateSharedRoomRequest } } },
  },
  responses: { 200: sharedRoomsResponse, ...writeErrors },
});

const retireRoute = defineOpenAPIRoute(
  {
    ...meta("meetings.retireSharedRoom", HOST, true),
    reversal: {
      kind: "none",
      reason:
        "A room taken off the list is not put back. Setting up a room with the same name gives it " +
        "the same address again, and the old room's sessions stay on the record either way.",
    },
  },
  {
    method: "delete",
    path: "/api/v1/meetings/shared-rooms/{roomId}",
    description:
      "Takes a shared room off the firm's list. Its address stops working at once and is free for " +
      "another room; a session open in it carries on, and its past sessions stay on the record.",
    request: { headers: idempotencyKeyHeader, params: roomIdParam },
    responses: { 200: sharedRoomsResponse, ...writeErrors },
  },
);

const openRoute = defineOpenAPIRoute(meta("meetings.openRoomAtAddress", HOST, true), {
  method: "post",
  path: "/api/v1/meetings/rooms/{linkCode}/open",
  description:
    "Opens a session in the room at an address: the caller's own room, or a shared room, which " +
    "anybody who may host opens. The session's calendar event is the caller's and they host it. " +
    "Answers with the session already in use when there is one (`created` false).",
  request: {
    headers: idempotencyKeyHeader,
    params: addressParam,
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

type SharedRoomApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

function sharedRoomBody(rows: readonly SharedRoomRow[]): z.infer<typeof SharedRoomsResponse> {
  return {
    rooms: rows.map((row) => ({
      id: row.id,
      name: roomDisplayName({ kind: "shared", title: row.title }, row.set_up_by),
      addressName: row.address_name ?? "",
      medium: row.medium,
      lobby: row.lobby,
      setUpBy: row.set_up_by,
      openMeetingId: row.open_meeting_id,
      inTheRoom: row.live_count,
    })),
  };
}

export function registerMeetingSharedRoomRoutes(app: SharedRoomApp, chokepoint: Chokepoint): void {
  // GET /api/v1/meetings/shared-rooms
  app.openapi(
    { ...listRoute, middleware: chokepointMiddleware(chokepoint, listRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      return c.json(sharedRoomBody(await listSharedRooms(firm.firmDatabase)), 200);
    },
  );

  // POST /api/v1/meetings/shared-rooms
  app.openapi(
    { ...createRoute, middleware: chokepointMiddleware(chokepoint, createRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const body = c.req.valid("json");
      const outcome = await commit(c, async () => {
        const made = await createSharedRoom(firm.firmDatabase, body, serviceOptions(userId));
        return { value: { roomId: made.roomId }, effect: made.effect };
      });
      if (!outcome.ok) return outcome.problem;
      return c.json(sharedRoomBody(await listSharedRooms(firm.firmDatabase)), 200);
    },
  );

  // PATCH /api/v1/meetings/shared-rooms/{roomId}
  app.openapi(
    { ...updateRoute, middleware: chokepointMiddleware(chokepoint, updateRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const roomId = c.req.valid("param").roomId as MeetingPersonalRoomId;
      const body = c.req.valid("json");
      const outcome = await commit(c, async () => {
        const options = serviceOptions(userId);
        const defaults = await updateSharedRoomDefaults(
          firm.firmDatabase,
          roomId,
          { medium: body.medium, lobby: body.lobby },
          options,
        );
        const renamed =
          body.title === undefined
            ? undefined
            : await renameRoom(firm.firmDatabase, roomId, body.title, options);
        return {
          value: { updated: true },
          effect: {
            statements: [...defaults.effect.statements, ...(renamed?.effect.statements ?? [])],
            outboxMessages: [],
          },
        };
      });
      if (!outcome.ok) return outcome.problem;
      return c.json(sharedRoomBody(await listSharedRooms(firm.firmDatabase)), 200);
    },
  );

  // DELETE /api/v1/meetings/shared-rooms/{roomId}
  app.openapi(
    { ...retireRoute, middleware: chokepointMiddleware(chokepoint, retireRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const roomId = c.req.valid("param").roomId as MeetingPersonalRoomId;
      const outcome = await commit(c, async () => {
        const { effect } = await retireSharedRoom(
          firm.firmDatabase,
          roomId,
          serviceOptions(userId),
        );
        return { value: { retired: true }, effect };
      });
      if (!outcome.ok) return outcome.problem;
      return c.json(sharedRoomBody(await listSharedRooms(firm.firmDatabase)), 200);
    },
  );

  // POST /api/v1/meetings/rooms/{linkCode}/open
  app.openapi(
    { ...openRoute, middleware: chokepointMiddleware(chokepoint, openRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const firmId = requireChokepointFirmId(c);
      const userId = requireChokepointUserId(c);
      const { linkCode } = c.req.valid("param");
      const body = c.req.valid("json");
      const outcome = await commit<{
        meetingId: string;
        joinCode: string | null;
        created: boolean;
        endedMeetingId: string | null;
      }>(c, async () => {
        const opened = await openRoomAtAddress(
          firm.firmDatabase,
          linkCode,
          {
            timeZone: body.timeZone,
            matterId: (body.matterId ?? null) as MatterId | null,
            encrypted: endToEndEncryptionEnabled(c.env),
          },
          {
            ...serviceOptions(userId),
            mayHost: requireChokepointPermissions(c).has(assertPermission(HOST)),
          },
        );
        return {
          value: {
            meetingId: opened.meetingId,
            joinCode: opened.joinCode,
            created: opened.created,
            endedMeetingId: opened.endedMeetingId,
          },
          effect: opened.effect,
        };
      });
      if (!outcome.ok) return outcome.problem;
      // A session everybody had left was ended on the way; its signaling room is told once.
      const ended = outcome.value.endedMeetingId;
      if (outcome.executed && ended !== null) {
        await meetingRoomFor(c.env, firmId, ended).end(new Date().toISOString());
      }
      return c.json(
        {
          meetingId: outcome.value.meetingId,
          joinCode: outcome.value.joinCode,
          created: outcome.value.created,
        },
        200,
      );
    },
  );
}
