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
import type { ShownReaction } from "../client/reactions.svelte.ts";
import type {
  ConnectionQuality,
  MeetingClient,
  MeetingHostRole,
  MeetingParticipant,
} from "../client/meeting-client.svelte.ts";

/** One tile on the grid. */
export interface MeetingTileModel {
  /** Stable across re-renders, so a tile keeps its video element as the roster changes. */
  readonly key: string;
  /** Who this is, where the tile is a person. Null for a screen share, which is not one. */
  readonly participantId: string | null;
  /**
   * The MEMBER behind the stay, which is what a hosting act names — a grant is written for a person
   * at the firm, not for one visit to one room. Null for a tile that is not a person.
   */
  readonly userId: string | null;
  /** Who this is, as the roster states them. */
  readonly name: string;
  /** Whether they are running this meeting, and in which of the two ways. Null for most of a room. */
  readonly hostRole: MeetingHostRole | null;
  /**
   * Whether a host put them on every screen in the room.
   *
   * It is drawn rather than only ordered because the order alone does not say WHY somebody is first:
   * a member who sees a colleague jump to the front of their gallery should be able to tell a
   * spotlight from somebody who has just started talking.
   */
  readonly spotlighted: boolean;
  readonly stream: MediaStream | null;
  /** This browser's own preview, which plays silently. */
  readonly local: boolean;
  /** Their microphone is off; null for a tile that is not a person (a screen share). */
  readonly microphoneOff: boolean | null;
  /** Their microphone is carrying speech right now. */
  readonly speaking: boolean;
  /**
   * Their hand is up: they want the floor.
   *
   * It is on the tile as well as on the roster row and in the host's queue, because those are three
   * different readers — the gallery, the list that holds the whole room, and the person working
   * through it in order. A mark in only one of them is a hand most of the room never sees.
   */
  readonly handRaised: boolean;
  /**
   * What is rising off this tile right now.
   *
   * Empty for almost every tile almost always. Bounded where it is not, because a burst of
   * agreement must not cover the face it is about.
   */
  readonly reactions: readonly ShownReaction[];
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
  /**
   * How well this tile's media is getting through, as this browser's own connection measures it.
   *
   * On the local preview it is the UPLINK — what is going out — which is the one thing nobody else
   * in the room can tell this member and the one that explains why everybody else says they are
   * breaking up.
   */
  readonly quality: ConnectionQuality;
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

/** What is rising off one person's tile. The empty array is shared, so an unreacted tile is cheap. */
function reactionsOn(client: MeetingClient, participantId: string): readonly ShownReaction[] {
  return client.reactions.shown.get(participantId) ?? NO_REACTIONS;
}

const NO_REACTIONS: readonly ShownReaction[] = Object.freeze([]);

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
  const spotlit = client.roomState.spotlight?.participantId ?? null;
  const tiles: MeetingTileModel[] = [
    {
      key: client.participantId ?? "local",
      participantId: client.participantId,
      userId: own?.userId ?? null,
      name: localName,
      hostRole: own?.hostRole ?? null,
      spotlighted: spotlit !== null && spotlit === client.participantId,
      stream: client.localStream,
      local: true,
      microphoneOff: !client.microphoneOn,
      speaking: own !== undefined && client.presenceOf(own).speaking,
      // This browser's OWN hand is the client's own answer rather than the roster's: the control
      // has to answer the press at once, and the roster is a round trip behind it.
      handRaised: client.reactions.hand,
      reactions: client.participantId === null ? [] : reactionsOn(client, client.participantId),
      pinned: false,
      videoPulled: client.localStream !== null && client.localStream.getVideoTracks().length > 0,
      quality: client.diagnostics.quality,
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
      userId: participant.userId,
      name: participantName(participant),
      hostRole: participant.hostRole,
      spotlighted: spotlit === participantId,
      stream: client.remoteStreams.get(participantId) ?? null,
      local: false,
      microphoneOff: presence.muted || !publishesAudio(participant),
      speaking: presence.speaking,
      handRaised: presence.hand,
      reactions: reactionsOn(client, participantId),
      pinned: client.isPinned(participantId),
      videoPulled: withVideo.has(participantId),
      quality: client.qualityOf(participantId),
    });
  }
  return tiles;
}

/**
 * The one tile that takes the large slot in speaker view: whoever the plan puts first.
 *
 * It is the first of the page rather than a search for whoever is loudest, because the plan already
 * ranked the room — spotlit, then pinned, then sharing, then talking — and a second ranking here
 * would be a second answer to the same question. That ranking is also what puts a host's spotlight
 * in this slot without this function knowing there is such a thing.
 *
 * It is NOT called the spotlight tile, though it was until a host could spotlight somebody for the
 * room: one word meaning both "the large slot this member chose to look at" and "the person every
 * screen in the room is looking at" is a word a reader has to disambiguate from context.
 */
export function speakerViewTile(tiles: readonly MeetingTileModel[]): MeetingTileModel | null {
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
      userId: null,
      name: `Shared by ${localName}`,
      hostRole: null,
      spotlighted: false,
      stream: client.screenStream,
      local: true,
      microphoneOff: null,
      speaking: false,
      handRaised: false,
      reactions: [],
      pinned: false,
      videoPulled: true,
      // This browser's own share goes out on the same connection as its camera, so the uplink's
      // answer is the share's answer.
      quality: client.diagnostics.quality,
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
    userId: null,
    name: `Shared by ${participantName(sharer)}`,
    hostRole: null,
    spotlighted: false,
    stream: client.remoteScreens.get(sharer.participantId) ?? null,
    local: false,
    microphoneOff: null,
    speaking: false,
    handRaised: false,
    reactions: [],
    pinned: false,
    videoPulled: true,
    quality: client.qualityOf(sharer.participantId),
  };
}
