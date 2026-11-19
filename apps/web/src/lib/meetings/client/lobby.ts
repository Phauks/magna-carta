/*
 * The door, on the browser's side: what somebody standing at it holds, what a host running the room
 * is shown about it, and the two answers a room gives a socket that is not through it yet.
 *
 * IT IS A MODULE AND NOT A SET OF FIELDS ON THE CLIENT, which is this directory's standing rule. The
 * client composes: it holds the runes state a screen renders from and wires one module's answer into
 * another's question. What a `lobby` frame means, what a waiting list is made of, and the two
 * sentences somebody at the door reads all live here, where a unit test can reach them without a
 * socket.
 *
 * A WAITING SOCKET IS NOT A HALF-JOINED ONE. It is never sent a `welcome`, a `roster` or a
 * `roster-delta` — the room stores a waiter under a different key entirely, so the read every roster
 * and broadcast is built from cannot include them — and it may send only a keepalive and a `leave`.
 * The browser half of that is the rule the client keeps: nothing is captured until `admitted`
 * arrives, because a browser that lit the camera indicator for somebody standing at a door would be
 * taking a picture nobody asked for.
 *
 * BEING TURNED AWAY IS FATAL AND BEING TOO EARLY IS NOT. `denied` is a host's decision about a named
 * person, the join path refuses them while the meeting runs, and the socket closes behind it;
 * `not-admitted` is the room saying this socket asked for something the door has not opened for yet,
 * and it leaves everything exactly where it was.
 */
import type {
  MeetingLobbyMode,
  MeetingParticipantKind,
  WaitingParticipant as WaitingParticipantOnTheWire,
} from "@magna-carta/meeting-protocol/types";
import { isRecord, readString } from "./signaling.ts";

export type { MeetingLobbyMode, MeetingParticipantKind };

/**
 * Somebody at the door, as a host's screen holds them: the wire's entry with its two optional
 * fields settled, so no surface has to decide what an absent kind means.
 *
 * TWO NAMES FOR A GUEST, AND BOTH ARE KEPT. `displayName` is what the person typed at the door;
 * `invitedName` is the Directory name the link was minted for. The difference between the two is
 * the whole of what a forwarded link leaves behind, and the lobby is the one moment it is still
 * cheap to act on — so a host reads both before deciding, and neither ever replaces the other.
 * A member has no invitation, so their `invitedName` is null and their `kind` is `member`.
 */
export interface WaitingParticipant extends Omit<
  WaitingParticipantOnTheWire,
  "userId" | "kind" | "invitedName"
> {
  /** The member behind the stay, or empty for a guest, who has no member identity at all. */
  readonly userId: string;
  readonly kind: MeetingParticipantKind;
  /** The Directory name a guest's link was minted for. Null for a member. */
  readonly invitedName: string | null;
}

/**
 * Where somebody stands at the door, as the room last stated it.
 *
 * `position` is one-based and `waiting` is how many are at the door, so a screen can say how many
 * people are ahead of somebody without a second frame. Re-sent whenever the queue in front of them
 * moves, and replaced whole rather than applied as a change.
 */
export interface MeetingWaitingPlace {
  readonly position: number;
  readonly waiting: number;
  readonly at: string;
}

/**
 * A host turned this member away at the door. Fatal, and there is no way back in from this screen:
 * the join path refuses a member barred from this meeting, and offering a way to try again would be
 * the screen inviting somebody to be told no.
 */
export const DENIED_REASON = "denied";

/**
 * A frame from a socket that is still waiting. The socket STAYS OPEN — they are at the door and the
 * door may open — so this is a notice rather than the end of anything.
 */
export const NOT_ADMITTED_REASON = "not-admitted";

/** What somebody reads when a host turns them away. */
export const DENIED_STATEMENT =
  "A host didn't let you into this meeting. You can't come back in. The meeting's record shows when you arrived and when you left.";

/** What somebody at the door reads when the room refuses something they asked for. */
export const NOT_ADMITTED_NOTICE =
  "You're still waiting to be let in, so that didn't happen. A host has to admit you first.";

/**
 * A count off the wire, or zero where the frame carried something that is not one.
 *
 * Zero is read by every surface as "nothing to say about the queue" rather than as a number, which
 * is what keeps a malformed frame from putting a nonsense place on somebody's screen.
 */
function readCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) return 0;
  return Math.floor(value);
}

/** Where a `lobby` frame says this browser stands. */
export function readWaitingPlace(frame: Record<string, unknown>): MeetingWaitingPlace {
  return {
    position: readCount(frame.position),
    waiting: readCount(frame.waiting),
    at: readString(frame, "at") ?? "",
  };
}

/**
 * Who is at the door, as a `waiting` frame, a host's own `welcome`, or the lobby read carries them.
 *
 * Read defensively and whole: the frame is the list rather than a change to it, so a browser that
 * receives one REPLACES what it holds and there is no ordering question to get wrong. An entry with
 * no stay on it is dropped — admitting somebody is addressed to the stay, so a row nothing can be
 * addressed to is a row no control could act on.
 */
export function readWaitingParticipants(value: unknown): readonly WaitingParticipant[] {
  if (!Array.isArray(value)) return [];
  const waiting: WaitingParticipant[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const participantId = readString(entry, "participantId");
    if (participantId === null) continue;
    // A row that does not say it is a guest is a member: every list the room sent before guests
    // existed meant exactly that, and reading an absent kind as a guest would mark a colleague as a
    // stranger at the one moment a host is deciding whether to let them in.
    const kind: MeetingParticipantKind = entry.kind === "guest" ? "guest" : "member";
    waiting.push({
      participantId,
      userId: readString(entry, "userId") ?? "",
      displayName: readString(entry, "displayName") ?? "",
      waitingFrom: readString(entry, "waitingFrom") ?? "",
      kind,
      invitedName: kind === "guest" ? readString(entry, "invitedName") : null,
    });
  }
  return waiting;
}

/**
 * How many people are ahead of somebody at the door, in the words they read. Null where nobody is.
 *
 * It counts PEOPLE AHEAD rather than stating an ordinal, because "second of three" asks a reader to
 * work out what it means for them and "one person is ahead of you" does not. Null at the front of
 * the queue: a line saying nobody is ahead of you is a line that says nothing.
 */
export function waitingPlaceStatement(place: MeetingWaitingPlace | null): string | null {
  if (place === null) return null;
  const ahead = place.position - 1;
  if (ahead < 1) return null;
  return ahead === 1 ? "1 person is ahead of you." : `${ahead} people are ahead of you.`;
}

/** Whether arrivals wait at a door, as a string off the wire states it. Anything else is an open door. */
export function readLobbyMode(value: unknown): MeetingLobbyMode {
  return value === "on" ? "on" : "off";
}
