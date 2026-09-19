/*
 * What the grid draws, worked out from what the client holds.
 *
 * The grid is presentation and takes tiles; the client is a state machine and holds streams and a
 * roster. This is the one place the two are put together, so the grid can be rendered from a fixed
 * list under a test or in a gallery without a peer connection anywhere near it.
 */
import type { MeetingClient, MeetingParticipant } from "./meeting-client.svelte.ts";

/** One tile on the grid. */
export interface MeetingTileModel {
  /** Stable across re-renders, so a tile keeps its video element as the roster changes. */
  readonly key: string;
  /** Who this is, as the roster states them. */
  readonly name: string;
  readonly stream: MediaStream | null;
  /** This browser's own preview, which plays silently. */
  readonly local: boolean;
  /** Their microphone is off; null for a tile that is not a person (a screen share). */
  readonly microphoneOff: boolean | null;
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

function nameOf(participant: MeetingParticipant): string {
  return participant.displayName === "" ? UNNAMED_PARTICIPANT : participant.displayName;
}

/** Whether a participant is publishing an audio track at all. */
function publishesAudio(participant: MeetingParticipant): boolean {
  return participant.tracks.some((track) => track.kind === "audio");
}

/**
 * The tiles for everybody in the room, this browser's own preview first.
 *
 * The local preview is pinned to the front rather than sorted in with the rest: a member looks for
 * their own picture in one place, and a tile that moves as people join is a tile they have to find
 * again each time.
 */
export function meetingTiles(client: MeetingClient, localName: string): MeetingTileModel[] {
  const tiles: MeetingTileModel[] = [
    {
      key: client.participantId ?? "local",
      name: localName,
      stream: client.localStream,
      local: true,
      microphoneOff: !client.microphoneOn,
    },
  ];
  for (const participant of client.others) {
    tiles.push({
      key: participant.participantId,
      name: nameOf(participant),
      stream: client.remoteStreams.get(participant.participantId) ?? null,
      local: false,
      microphoneOff: !publishesAudio(participant),
    });
  }
  return tiles;
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
      name: `Shared by ${localName}`,
      stream: client.screenStream,
      local: true,
      microphoneOff: null,
    };
  }
  const sharer = client.others.find((participant) =>
    participant.tracks.some((track) => track.kind === "screen"),
  );
  if (sharer === undefined) return null;
  return {
    key: `${sharer.participantId}-screen`,
    name: `Shared by ${nameOf(sharer)}`,
    stream: client.remoteScreens.get(sharer.participantId) ?? null,
    local: false,
    microphoneOff: null,
  };
}
