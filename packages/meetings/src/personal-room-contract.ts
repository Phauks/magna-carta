import { z } from "zod";
import { MEETING_LOBBY_MODES } from "./lobby-types.ts";
import { MEETING_ROOM_KINDS, MEETING_ROOM_TITLE_MAXIMUM } from "./personal-room-types.ts";
import { MEETING_MEDIA } from "./types.ts";

// A room's name as it is typed. The service trims it and refuses one that is empty or too long; the
// ceiling here is wider so a name with spaces to trim is not refused for them.
const roomTitle = z.string().max(MEETING_ROOM_TITLE_MAXIMUM * 2);

// A personal room's contract: what its routes accept and answer, as plain zod named with
// `.meta({ id })`, which the contract emitter reads as the component's name. The routes are in
// apps/api-worker/src/http/routes/communications/meeting-personal-rooms.ts; the rule is in
// docs/conventions/api.md (_Where a contract shape lives_).

export const PersonalRoom = z
  .object({
    id: z.string(),
    // The room's older code, kept on the record; no address reads it any more.
    linkCode: z.string(),
    // The room's address by name: `/room/{addressName}`.
    addressName: z.string(),
    // What the room is called: the name the owner gave it, or "<name>'s Room".
    name: z.string(),
    // The name the owner gave it, or null while it is called by theirs.
    title: z.string().nullable(),
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
    // A name for the room, or null to call it by the owner's name again. The room's address follows
    // the name, and the old address stops working.
    title: roomTitle.nullable().optional(),
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
  .object({
    meetingId: z.string(),
    // The nine digits the session is addressed by: /meeting/482-917-305.
    joinCode: z.string().nullable(),
    created: z.boolean(),
  })
  .meta({ id: "OpenPersonalRoomResponse" });

export const PersonalRoomAtLinkResponse = z
  .object({
    // `closed` until the owner opens the room; then `open`, with the meeting to join.
    state: z.enum(["closed", "open"]),
    ownerDisplayName: z.string(),
    isOwner: z.boolean(),
    // The room's address by name.
    addressName: z.string(),
    // What the room is called, and whether it is a member's or one the firm shares.
    roomName: z.string(),
    kind: z.enum(MEETING_ROOM_KINDS),
    // Whether the caller may open it: its owner for a member's room, anybody who may host meetings
    // for a shared one.
    mayOpen: z.boolean(),
    meetingId: z.string().nullable(),
    // The open session's nine-digit address; null while the room is closed.
    joinCode: z.string().nullable(),
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
    // The room's address by name, null with the link code.
    addressName: z.string().nullable(),
    // The name the member gave their room, or null while it is called by theirs.
    title: z.string().nullable(),
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

export const SharedRoom = z
  .object({
    id: z.string(),
    name: z.string(),
    addressName: z.string(),
    medium: z.enum(MEETING_MEDIA),
    lobby: z.enum(MEETING_LOBBY_MODES),
    // Who set the room up, by name.
    setUpBy: z.string(),
    openMeetingId: z.string().nullable(),
    inTheRoom: z.number().int().nonnegative(),
  })
  .meta({ id: "SharedRoom" });

export const SharedRoomsResponse = z
  .object({ rooms: z.array(SharedRoom) })
  .meta({ id: "SharedRoomsResponse" });

export const CreateSharedRoomRequest = z
  .object({
    title: roomTitle,
    medium: z.enum(MEETING_MEDIA).optional(),
    lobby: z.enum(MEETING_LOBBY_MODES).optional(),
  })
  .meta({ id: "CreateSharedRoomRequest" });

export const UpdateSharedRoomRequest = z
  .object({
    // A new name; the room's address follows it, and the old address stops working.
    title: roomTitle.optional(),
    medium: z.enum(MEETING_MEDIA).optional(),
    lobby: z.enum(MEETING_LOBBY_MODES).optional(),
  })
  .meta({ id: "UpdateSharedRoomRequest" });
