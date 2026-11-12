/*
 * THE MEETING ROUTES' REQUEST AND ANSWER SHAPES THAT MORE THAN ONE ROUTE MODULE NAMES, or that grow
 * with the meeting's own facts: the relay credentials a join answers with, Start's request, and a
 * guest's arrival, which is the member join's shape plus a credential.
 */
import { z } from "@hono/zod-openapi";
import { MEETING_LOBBY_MODES } from "@magna-carta/meetings/lobby-types";
import { MEETING_EVENT_KINDS, MEETING_MEDIA } from "@magna-carta/meetings/types";

export const IceServer = z
  .object({
    urls: z.union([z.string(), z.array(z.string())]),
    username: z.string().optional(),
    credential: z.string().optional(),
  })
  .openapi("MeetingIceServer");

export const StartMeetingRequest = z
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
    // Whether the pictures and sound are sealed end to end. On by default, and honoured only where
    // this deployment opens meetings encrypted at all (otherwise the room opens in the clear, and the
    // summary says so). Read only when this request opens the room, and never changed afterwards.
    encrypted: z.boolean().default(true),
  })
  .openapi("StartMeetingRequest");

// A GUEST ARRIVING IS A MEMBER ARRIVING AT A LOBBY-ON ROOM, PLUS A CREDENTIAL — so the shape is the
// member join's, and the browser's meeting client takes it unchanged.
export const GuestArrival = z
  .object({
    // Always true: a guest waits at the door until a host admits them, whatever the lobby setting.
    waiting: z.boolean(),
    // The guest's own stay, which is what identifies them on the roster and in every frame.
    participantId: z.string(),
    // The name they gave at the door — the one the host reads and the room draws on their tile.
    displayName: z.string(),
    iceServers: z.array(IceServer),
    medium: z.enum(MEETING_MEDIA),
    // Whether the meeting's pictures and sound are sealed end to end, so the guest's browser joins
    // the key group and seals what it sends, as every member's does.
    encrypted: z.boolean(),
    // The key group's name, which every browser in it must give the same, or null in a meeting in
    // the clear. It is the meeting's handle: the group's welcome carries it to every member's engine
    // anyway, and the guest's own grant already names the meeting it admits them to.
    keyGroup: z.string().nullable(),
    // The credential every later guest request carries in the `x-meeting-guest` header, and the
    // socket upgrade carries as its second subprotocol after `meeting-guest`. Shorter-lived than the
    // link, and dead with the meeting.
    guestGrant: z.string(),
  })
  .openapi("GuestArrival");
