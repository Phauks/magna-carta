import {
  rosterDeltaFrame,
  rosterFrame,
  ROSTER_DELTA_THRESHOLD,
  type MeetingParticipantKind,
  type RosterParticipant,
} from "@magna-carta/meeting-protocol/frames";
import {
  broadcastPerViewer,
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

/**
 * One roster entry as everybody else sees it, from the participant as the room stores them.
 *
 * `viewer` is WHO IS READING IT, and it is the room's half of the guest redaction: a guest's socket
 * is sent every entry with `userId: null`, because somebody from outside the firm sees names, tiles
 * and who is talking and never a firm's user identifiers. A guest's own entry carries null to every
 * reader, because a guest has no user id to carry. The browser hides the field as well; this is the
 * half it cannot undo.
 */
export function rosterEntryFor(
  participantId: string,
  participant: StoredParticipant,
  viewer: MeetingParticipantKind = "member",
): RosterParticipant {
  const kind = participant.participantKind ?? "member";
  return {
    participantId,
    userId: kind === "guest" || viewer === "guest" ? null : participant.userId,
    kind,
    displayName: participant.displayName,
    sfuSessionId: participant.sfuSessionId,
    speaking: participant.speaking,
    muted: participant.muted,
    // Read off the STORED record, which is the room's one authority on who is running the meeting —
    // so a badge every browser draws and an authority check the room makes can never disagree.
    // Older entries, written before hosting existed, carry nothing and read as nobody.
    hostRole: participant.hostRole ?? null,
    // TWO WIRE FIELDS FROM ONE STORED FACT, projected HERE and nowhere else. The room stores the
    // instant alone; `hand` is the comparison against null, carried because every tile, roster row
    // and badge branches on the boolean and none of them wants to compare against null, while only
    // the hands panel wants the instant. Written in one place so the two can never say different
    // things about one person. Entries written before hands existed carry no stamp, which reads as
    // a hand that is down.
    hand: (participant.handRaisedAt ?? null) !== null,
    handRaisedAt: participant.handRaisedAt ?? null,
    // The media section is the room's own handle for closing a track and is deliberately not on
    // the wire: a subscriber names a track by its publisher's session and its name, so a section
    // number would be a field every browser could read and none could use.
    tracks: participant.tracks.map((track) => ({
      trackName: track.trackName,
      kind: track.kind,
    })),
  };
}

export function rosterFrom(
  stored: ReadonlyMap<string, StoredParticipant>,
  viewer: MeetingParticipantKind = "member",
): RosterParticipant[] {
  return [...stored].map(([participantId, participant]) =>
    rosterEntryFor(participantId, participant, viewer),
  );
}

/**
 * Entries built for a member, re-shaped for whoever is reading them — the identifiers taken out for a
 * guest's socket. For the call sites that build a change once, before they know who it goes to.
 */
export function rosterEntriesFor(
  entries: readonly RosterParticipant[],
  viewer: MeetingParticipantKind,
): RosterParticipant[] {
  return viewer === "guest" ? entries.map((entry) => ({ ...entry, userId: null })) : [...entries];
}

/**
 * Tells the room what changed — as the difference, or as the whole list in a room small enough
 * that the whole list is the cheaper of the two. Built once per KIND of reader, so a guest's socket
 * receives the same change with the identifiers taken out.
 */
export function announceRoster(
  room: RoomContext,
  stored: ReadonlyMap<string, StoredParticipant>,
  change: RosterChange,
  except?: WebSocket,
): void {
  broadcastPerViewer(
    room,
    (viewer) =>
      stored.size > ROSTER_DELTA_THRESHOLD
        ? rosterDeltaFrame(
            rosterEntriesFor(change.joined ?? [], viewer),
            change.left ?? [],
            rosterEntriesFor(change.updated ?? [], viewer),
          )
        : rosterFrame(rosterFrom(stored, viewer)),
    except,
  );
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
