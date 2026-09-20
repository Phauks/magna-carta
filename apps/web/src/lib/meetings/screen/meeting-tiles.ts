/*
 * What the grid draws, worked out from what the client holds.
 *
 * The grid is presentation and takes tiles; the client is a state machine and holds streams, a
 * roster and the plan over them. This is the one place the three are put together, so the grid can
 * be rendered from a fixed list under a test or in a gallery without a peer connection anywhere
 * near it.
 *
 * THE PAGE IS THE PLAN'S, NOT THE GRID'S. Which people are on screen is decided by the subscription
 * policy — it is the same answer as which cameras are pulled, and two answers to that would be a
 * tile drawing a picture nobody asked the unit for, or a picture arriving with no tile to put it
 * in. The grid draws `plan.shown`, in order, and nothing else.
 */
import type { MeetingClient, MeetingParticipant } from "../client/meeting-client.svelte.ts";

/** One tile on the grid. */
export interface MeetingTileModel {
  /** Stable across re-renders, so a tile keeps its video element as the roster changes. */
  readonly key: string;
  /** Who this is, where the tile is a person. Null for a screen share, which is not one. */
  readonly participantId: string | null;
  /** Who this is, as the roster states them. */
  readonly name: string;
  readonly stream: MediaStream | null;
  /** This browser's own preview, which plays silently. */
  readonly local: boolean;
  /** Their microphone is off; null for a tile that is not a person (a screen share). */
  readonly microphoneOff: boolean | null;
  /** Their microphone is carrying speech right now. */
  readonly speaking: boolean;
  /** This member is holding them on screen. */
  readonly pinned: boolean;
  /**
   * Whether this browser asked for their camera at all.
   *
   * False is the ordinary state of most of a large room and is not a fault: sixteen cameras is the
   * cap, so everybody else is a name. The tile says so rather than drawing a picture that is never
   * going to arrive.
   */
  readonly videoPulled: boolean;
}

/** The word a participant with no display name on the roster is drawn under. */
const UNNAMED_PARTICIPANT = "Joining";

/**
 * The letters a participant is drawn as where there is no picture of them: the initials of however
 * many words their name has, capped at two.
 *
 * It lives here rather than in either surface because BOTH draw them — the roster rail always, and
 * a tile in a call, which has no picture to draw at all — and two copies of this would be two
 * answers to "what is somebody called when you cannot see them".
 */
export function participantInitials(name: string): string {
  const letters = name
    .split(/\s+/u)
    .filter((word) => word !== "")
    .map((word) => word[0] ?? "")
    .join("");
  return letters.slice(0, 2).toUpperCase();
}

/** Who somebody is drawn as. */
export function participantName(participant: MeetingParticipant): string {
  return participant.displayName === "" ? UNNAMED_PARTICIPANT : participant.displayName;
}

/** Whether a participant is publishing an audio track at all. */
function publishesAudio(participant: MeetingParticipant): boolean {
  return participant.tracks.some((track) => track.kind === "audio");
}

/**
 * The tiles for this page of the room, this browser's own preview first.
 *
 * The local preview is pinned to the front rather than paged with the rest: a member looks for their
 * own picture in one place, and a preview that fell off page one as the room filled would be a
 * member with no way to see what they are showing.
 */
export function meetingTiles(client: MeetingClient, localName: string): MeetingTileModel[] {
  const own = client.participants.find(
    (participant) => participant.participantId === client.participantId,
  );
  const tiles: MeetingTileModel[] = [
    {
      key: client.participantId ?? "local",
      participantId: client.participantId,
      name: localName,
      stream: client.localStream,
      local: true,
      microphoneOff: !client.microphoneOn,
      speaking: own !== undefined && client.presenceOf(own).speaking,
      pinned: false,
      videoPulled: client.localStream !== null && client.localStream.getVideoTracks().length > 0,
    },
  ];

  const byIdentifier = new Map(
    client.participants.map((participant) => [participant.participantId, participant] as const),
  );
  const withVideo = new Set(client.plan.video.map((track) => track.participantId));

  for (const participantId of client.shown) {
    const participant = byIdentifier.get(participantId);
    if (participant === undefined) continue;
    // Whether a microphone is on is asked of the client rather than read off the roster row: the
    // presence frames are held beside the roster, so the row is only as current as the last roster.
    const presence = client.presenceOf(participant);
    tiles.push({
      key: participantId,
      participantId,
      name: participantName(participant),
      stream: client.remoteStreams.get(participantId) ?? null,
      local: false,
      microphoneOff: presence.muted || !publishesAudio(participant),
      speaking: presence.speaking,
      pinned: client.isPinned(participantId),
      videoPulled: withVideo.has(participantId),
    });
  }
  return tiles;
}

/**
 * The one tile that takes the large slot in speaker view: whoever the plan puts first.
 *
 * It is the first of the page rather than a search for whoever is loudest, because the plan already
 * ranked the room — pinned, then sharing, then talking — and a second ranking here would be a
 * second answer to the same question.
 */
export function spotlightTile(tiles: readonly MeetingTileModel[]): MeetingTileModel | null {
  return tiles.find((tile) => !tile.local) ?? null;
}

/**
 * The one tile that takes the large slot, where somebody is sharing a screen.
 *
 * This browser's own share wins over a remote one, because a member sharing needs to see what
 * everybody else is being shown. Null where nothing is being shared, which is the ordinary case and
 * is what puts the grid back to equal tiles.
 */
export function sharedScreenTile(
  client: MeetingClient,
  localName: string,
): MeetingTileModel | null {
  if (client.screenStream !== null) {
    return {
      key: "local-screen",
      participantId: null,
      name: `Shared by ${localName}`,
      stream: client.screenStream,
      local: true,
      microphoneOff: null,
      speaking: false,
      pinned: false,
      videoPulled: true,
    };
  }
  const shared = client.plan.screen;
  if (shared === null) return null;
  const sharer = client.participants.find(
    (participant) => participant.participantId === shared.participantId,
  );
  if (sharer === undefined) return null;
  return {
    key: `${sharer.participantId}-screen`,
    participantId: null,
    name: `Shared by ${participantName(sharer)}`,
    stream: client.remoteScreens.get(sharer.participantId) ?? null,
    local: false,
    microphoneOff: null,
    speaking: false,
    pinned: false,
    videoPulled: true,
  };
}
