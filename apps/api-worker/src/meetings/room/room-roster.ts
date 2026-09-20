import {
  rosterDeltaFrame,
  rosterFrame,
  ROSTER_DELTA_THRESHOLD,
  type RosterParticipant,
} from "@magna-carta/meeting-protocol/frames";
import {
  broadcast,
  storedParticipants,
  type RoomContext,
  type StoredParticipant,
} from "./room-state.ts";

// WHO IS IN THE ROOM, AS EVERYBODY ELSE SEES IT — the projection from what storage holds to what the
// wire carries, and the decision about whether to state the whole list or only what changed.
//
// The two are one concern because the choice between them is made from the same read: the count is
// taken AFTER the change, from the map the caller already paid for, so a room crossing the threshold
// announces that change in the form the new size calls for rather than the old one. A client
// therefore has to accept both shapes at any size, which it must anyway — it cannot know how many
// people were in the room at the instant the room decided.

/**
 * What changed about the roster, in the shape a client applies to the list it is holding.
 *
 * Every path that changes the roster knows exactly who it changed — that is the whole reason a
 * difference can be sent at all — so this is built at the call site rather than computed by
 * comparing two lists, which would cost the room a second read of three hundred keys to learn what
 * it already knew.
 */
export interface RosterChange {
  readonly joined?: readonly RosterParticipant[];
  readonly left?: readonly string[];
  readonly updated?: readonly RosterParticipant[];
}

/** One roster entry as everybody else sees it, from the participant as the room stores them. */
export function rosterEntryFor(
  participantId: string,
  participant: StoredParticipant,
): RosterParticipant {
  return {
    participantId,
    userId: participant.userId,
    displayName: participant.displayName,
    sfuSessionId: participant.sfuSessionId,
    speaking: participant.speaking,
    muted: participant.muted,
    // The media section is the room's own handle for closing a track and is deliberately not on
    // the wire: a subscriber names a track by its publisher's session and its name, so a section
    // number would be a field every browser could read and none could use.
    tracks: participant.tracks.map((track) => ({
      trackName: track.trackName,
      kind: track.kind,
    })),
  };
}

export function rosterFrom(stored: ReadonlyMap<string, StoredParticipant>): RosterParticipant[] {
  return [...stored].map(([participantId, participant]) =>
    rosterEntryFor(participantId, participant),
  );
}

/**
 * Tells the room what changed — as the difference, or as the whole list in a room small enough
 * that the whole list is the cheaper of the two.
 */
export function announceRoster(
  room: RoomContext,
  stored: ReadonlyMap<string, StoredParticipant>,
  change: RosterChange,
  except?: WebSocket,
): void {
  const payload =
    stored.size > ROSTER_DELTA_THRESHOLD
      ? rosterDeltaFrame(change.joined ?? [], change.left ?? [], change.updated ?? [])
      : rosterFrame(rosterFrom(stored));
  broadcast(room, payload, except);
}

/** One participant's entry has changed — a session opened, a track published or stopped. */
export async function announceParticipantUpdated(
  room: RoomContext,
  attendanceId: string,
): Promise<void> {
  const stored = await storedParticipants(room);
  const participant = stored.get(attendanceId);
  // Gone between the write and this read — they left, or the meeting ended under them. Their
  // departure is announced by whichever path removed them, and announcing an update to an entry
  // that no longer exists would tell every browser to draw a tile for somebody who is not here.
  if (participant === undefined) return;
  announceRoster(room, stored, { updated: [rosterEntryFor(attendanceId, participant)] });
}

/**
 * Whether every (session, track) pair named here is one THIS room is carrying.
 *
 * THE ROSTER IS THE WHOLE OF WHAT MAY BE ASKED FOR. The routing service takes any session handle
 * from any caller holding this application's credential — it has no notion of a meeting — so a pair
 * that is not on this room's roster is either a browser working from a roster that has moved on, or
 * an attempt to pull somebody else's meeting into this one. Both are refused, and the WHOLE frame is
 * refused rather than the offending pair: a browser that got some of what it asked for and no word
 * about the rest has no way to tell which tile is missing.
 *
 * Taken over the one roster read the frame already paid for, rather than reading storage again.
 */
export function namesOnlyRosterTracks(
  attendanceId: string,
  stored: ReadonlyMap<string, StoredParticipant>,
  tracks: readonly { readonly sessionId: string; readonly trackName: string }[],
): boolean {
  const publishedTracks = new Map<string, Set<string>>();
  for (const participant of stored.values()) {
    if (participant.sfuSessionId === null) continue;
    publishedTracks.set(
      participant.sfuSessionId,
      new Set(participant.tracks.map((track) => track.trackName)),
    );
  }
  const ownSession = stored.get(attendanceId)?.sfuSessionId;
  for (const track of tracks) {
    // Naming one's own session is not a leak and is still refused: the browser already has that
    // media, the service answers it with a loop, and the only thing it can produce is echo.
    if (ownSession !== null && ownSession !== undefined && track.sessionId === ownSession) {
      return false;
    }
    if (publishedTracks.get(track.sessionId)?.has(track.trackName) !== true) return false;
  }
  return true;
}
