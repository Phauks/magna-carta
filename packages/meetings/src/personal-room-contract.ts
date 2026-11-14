import { z } from "zod";
import { MEETING_LOBBY_MODES } from "./lobby-types.ts";
import { MEETING_MEDIA } from "./types.ts";

// A personal room's contract: what its routes accept and answer, as plain zod named with
// `.meta({ id })`, which the contract emitter reads as the component's name. The routes are in
// apps/api-worker/src/http/routes/communications/meeting-personal-rooms.ts; the rule is in
// docs/conventions/api.md (_Where a contract shape lives_).

export const PersonalRoom = z
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
  .meta({ id: "PersonalRoom" });

export const PersonalRoomResponse = z
  .object({ room: PersonalRoom.nullable() })
  .meta({ id: "PersonalRoomResponse" });

export const UpdatePersonalRoomRequest = z
  .object({
    medium: z.enum(MEETING_MEDIA).optional(),
    lobby: z.enum(MEETING_LOBBY_MODES).optional(),
  })
  .meta({ id: "UpdatePersonalRoomRequest" });

export const OpenPersonalRoomRequest = z
  .object({
    // The opener's own zone, which the session's event is written in.
    timeZone: z.string().min(1).max(64),
    // The matter the session is about, when it is known. Without one the session can be moved onto a
    // matter later.
    matterId: z.string().nullable().optional(),
  })
  .meta({ id: "OpenPersonalRoomRequest" });

export const OpenPersonalRoomResponse = z
  .object({ meetingId: z.string(), created: z.boolean() })
  .meta({ id: "OpenPersonalRoomResponse" });

export const PersonalRoomAtLinkResponse = z
  .object({
    // `closed` until the owner opens the room; then `open`, with the meeting to join.
    state: z.enum(["closed", "open"]),
    ownerDisplayName: z.string(),
    isOwner: z.boolean(),
    meetingId: z.string().nullable(),
  })
  .meta({ id: "PersonalRoomAtLink" });

export const MoveMeetingToMatterRequest = z
  .object({ matterId: z.string() })
  .meta({ id: "MoveMeetingToMatterRequest" });

export const MoveMeetingToMatterResponse = z
  .object({ matterEventId: z.string() })
  .meta({ id: "MoveMeetingToMatterResponse" });

export const FirmRoom = z
  .object({
    userId: z.string(),
    name: z.string(),
    // Null while the member has not set a room up; the list still shows them.
    linkCode: z.string().nullable(),
    medium: z.enum(MEETING_MEDIA).nullable(),
    // The session open in the room, and how many people are in it now.
    openMeetingId: z.string().nullable(),
    inTheRoom: z.number().int().nonnegative(),
    isCaller: z.boolean(),
  })
  .meta({ id: "FirmRoom" });

export const FirmRoomsResponse = z
  .object({ rooms: z.array(FirmRoom) })
  .meta({ id: "FirmRoomsResponse" });
