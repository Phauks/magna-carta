import type { z } from "@hono/zod-openapi";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import { GuardedWriteRefusedError } from "@magna-carta/data-access/effect-batch";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type { UserId } from "@magna-carta/identifiers/types";
import type {
  PersonalRoomAtLinkResponse,
  PersonalRoomResponse,
} from "@magna-carta/meetings/personal-room-contract";
import type { PersonalRoomArrival } from "@magna-carta/meetings/personal-room-service";
import {
  MOVE_DELETE_EVENT_GUARD,
  MOVE_TO_MATTER_GUARD,
  RENAME_ROOM_GUARD,
  REPLACE_LINK_GUARD,
  RETIRE_ROOM_GUARD,
} from "@magna-carta/meetings/personal-room-service";
import {
  readMemberDisplayName,
  readPersonalRoomForOwner,
  readPersonalRoomOpenSession,
} from "@magna-carta/meetings/personal-room-statements";
import {
  MeetingPersonalRoomRefusedError,
  roomDisplayName,
  type MeetingPersonalRoomRow,
} from "@magna-carta/meetings/personal-room-types";
import { MeetingValidationError } from "@magna-carta/meetings/validation";
import type { Context } from "hono";
import type { Bindings } from "../../../bindings.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";
import { meetingErrorResponse } from "./meetings.ts";

// What the personal-room routes in `meeting-personal-rooms.ts` share: the service's options, the
// mapping from the room's refusals and its race guards to the answers a member reads, the one
// idempotent commit every write goes through, and the room as the routes answer with it.

export function serviceOptions(userId: string) {
  return {
    clock: { now: () => new Date().toISOString() },
    actorUserId: userId as UserId,
    randomSource: cryptoRandomSource,
    visibility: visibleMatterPredicate(),
  };
}

export function personalRoomErrorResponse(
  c: Context,
  caught: MeetingPersonalRoomRefusedError,
): ProblemResponse<403> | ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> {
  switch (caught.code) {
    case "personal-room-invalid-title":
      return problemJson(c, {
        type: "validation",
        title: "The room's name is not usable",
        status: 422,
        detail: caught.message,
      });
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
      break;
  }
  return problemJson(c, {
    type: "meeting-move-refused",
    title: "This meeting cannot be moved onto a matter",
    status: 409,
    detail: caught.message,
  });
}

const RACE_GUARDS = new Set([
  REPLACE_LINK_GUARD,
  MOVE_TO_MATTER_GUARD,
  MOVE_DELETE_EVENT_GUARD,
  RENAME_ROOM_GUARD,
  RETIRE_ROOM_GUARD,
]);

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

export async function commit<T>(
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
          detail:
            "The room or the meeting changed while this was being done. Look again and retry.",
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

export async function roomBody(
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
      addressName: room.address_name ?? room.link_code,
      name: roomDisplayName(
        room,
        (await readMemberDisplayName(database, room.owner_user_id)) ?? "",
      ),
      title: room.title,
      medium: room.medium,
      lobby: room.lobby,
      openMeetingId: inUse ? open.id : null,
    },
  };
}

/** A room's link as the routes answer with it. */
export function arrivalBody(
  arrival: PersonalRoomArrival,
): z.infer<typeof PersonalRoomAtLinkResponse> {
  return {
    state: arrival.state,
    ownerDisplayName: arrival.ownerDisplayName,
    isOwner: arrival.isOwner,
    addressName: arrival.addressName,
    roomName: arrival.roomName,
    kind: arrival.kind,
    mayOpen: arrival.mayOpen,
    meetingId: arrival.state === "open" ? arrival.meetingId : null,
  };
}
