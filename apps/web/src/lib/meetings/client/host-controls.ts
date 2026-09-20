/*
 * Running a meeting from inside it, on the browser's side: the four directives a host sends, what
 * the room says back, and the facts the room states about itself.
 *
 * IT IS A MODULE AND NOT A SET OF FIELDS ON THE CLIENT, which is this directory's standing rule. The
 * client composes: it holds the runes state a screen renders from and wires one module's answer into
 * another's question. What a directive is called on the wire, what a room-state frame means, and what
 * a muted member is told all live here, where a unit test can reach them without a socket.
 *
 * A DIRECTIVE IS A FRAME AND NOT A REQUEST, and the reason is the instant. A mute is undone by the
 * member themselves a second later, a spotlight dies with the room, and a request to unmute is a tap
 * on the shoulder — none of them outlives the meeting, so none of them is written down, and none of
 * them should have a round trip and the idempotency gate between the press and the silence. The acts
 * somebody could later ask "who did that" about — a removal, a locked door, a room that changed hands
 * — are routes, and they live in ../meetings-api.ts.
 *
 * ASKING IS NOT UNMUTING. There is no frame here that opens somebody's microphone, and there is no
 * frame in the protocol that could: a platform able to do that from another member's click is a
 * listening device in a law firm. `ask-to-unmute` reaches the other browser as a request their screen
 * offers them, and nothing happens until they choose.
 */
import type {
  MeetingHostRole,
  MeetingLobbyMode,
  MeetingRoomState,
  MeetingSpotlight,
} from "@magna-carta/meeting-protocol/types";
import { isRecord, readString } from "./signaling.ts";

export type { MeetingHostRole, MeetingLobbyMode, MeetingRoomState, MeetingSpotlight };

/**
 * What is true of a room nothing has said anything about yet: nobody on every screen, the door open.
 *
 * A browser holds this from the moment it joins rather than holding null, because every surface that
 * reads it asks a question with an answer — "is the door shut" is false until somebody shuts it, not
 * unknown — and a null would make each of them write the same fallback.
 */
export const OPEN_ROOM_STATE: MeetingRoomState = Object.freeze({
  spotlight: null,
  locked: false,
  lobby: "off",
});

/** What a member is told when a host closes their microphone upstream. */
export const MUTED_BY_HOST_NOTICE = "A host muted you.";

/**
 * What a member is told when the room refuses a directive they are not holding a grant for.
 *
 * It is a NOTICE and not a failure band: nothing was refused about the meeting, the socket is open,
 * and the member is still in the room. Ordinarily they never see it at all — the menus that send
 * these frames are absent for somebody who is not hosting — so it is the answer to a grant withdrawn
 * between the menu opening and the item being pressed.
 */
export const NOT_HOSTING_NOTICE =
  "You are not running this meeting, so that did not happen. Somebody hosting it can hand it to you.";

/** Whose microphone a host is closing. The room answers them with `muted`. */
export function muteDirective(participantId: string): Record<string, unknown> {
  return { type: "mute", participantId };
}

/**
 * Everybody who is neither the caller nor a host or co-host.
 *
 * The room decides who that is, not this browser: a client that sent one `mute` per name off its own
 * roster would be sending a directive about people it may be a roster behind on, and would silence
 * the person pressing it.
 */
export function muteAllDirective(): Record<string, unknown> {
  return { type: "mute-all" };
}

/** A request the asked member answers. Nothing about their microphone changes until they do. */
export function askToUnmuteDirective(participantId: string): Record<string, unknown> {
  return { type: "ask-to-unmute", participantId };
}

/** One participant on every screen in the room, or null to clear whoever is on them. */
export function spotlightDirective(participantId: string | null): Record<string, unknown> {
  return { type: "spotlight", participantId };
}

/**
 * The room's own facts, as a `room-state` frame or a `welcome` states them.
 *
 * Read defensively and whole: the frame carries everything it is about rather than a change to it, so
 * a browser that receives one REPLACES what it holds and there is no ordering question to get wrong.
 * A field the room did not send reads as the open-room answer rather than as nothing, for the reason
 * `OPEN_ROOM_STATE` exists.
 */
export function readRoomState(value: unknown): MeetingRoomState {
  if (!isRecord(value)) return OPEN_ROOM_STATE;
  return {
    spotlight: readSpotlight(value.spotlight),
    locked: value.locked === true,
    // Held rather than drawn here: nothing in host controls asks whether arrivals wait at a door. It
    // is read so the frame is applied whole rather than losing a field the room states.
    lobby: readLobbyMode(value.lobby),
  };
}

/** Whether arrivals wait at a door, as the room states it. Anything else reads as an open door. */
function readLobbyMode(value: unknown): MeetingLobbyMode {
  return value === "on" ? "on" : "off";
}

/** Who the room is looking at, and who put them there. Null where nobody is spotlighted. */
function readSpotlight(value: unknown): MeetingSpotlight | null {
  if (!isRecord(value)) return null;
  const participantId = readString(value, "participantId");
  if (participantId === null) return null;
  return {
    participantId,
    by: readString(value, "by") ?? "",
    at: readString(value, "at") ?? "",
  };
}

/** A directive the room relayed: who sent it, and when the room passed it on. */
export interface MeetingDirective {
  /** The stay of the host who sent it, so a screen can say who asked. */
  readonly by: string;
  readonly at: string;
}

/** The two fields every relayed directive carries. Null where the frame carried neither. */
export function readDirective(frame: Record<string, unknown>): MeetingDirective {
  return { by: readString(frame, "by") ?? "", at: readString(frame, "at") ?? "" };
}

/** What a role may do, in the one place both the menus and the client ask it. */
export function mayRunTheMeeting(role: MeetingHostRole | null): boolean {
  return role !== null;
}

/**
 * Whether a co-host may act on this target at all.
 *
 * A co-host runs the meeting WITH the host and not over them: the removal route refuses a co-host
 * removing the host, and naming or withdrawing a co-host is the host's alone. A menu that offered any
 * of those would be offering an act the server has already decided to refuse, which the house rule
 * about a disabled control settles the other way — absent, not disabled.
 */
export function mayActOn(viewer: MeetingHostRole | null, target: MeetingHostRole | null): boolean {
  if (viewer === null) return false;
  return viewer === "host" || target !== "host";
}
