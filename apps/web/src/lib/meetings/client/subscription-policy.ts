/*
 * What this browser asks the unit for, and what the gallery draws — decided in one pure function.
 *
 * A BROWSER NEVER PULLS EVERY TRACK. Three hundred people in a room is three hundred cameras and
 * three hundred microphones, and a browser that asked for all of them would spend its bandwidth and
 * its decoders on pictures nobody is looking at. So it pulls video for the tiles it is showing and
 * sound for the people who are talking, and everybody else is a name on a tile.
 *
 * IT IS A FUNCTION, NOT A METHOD, so the three-hundred-participant case is a unit test rather than a
 * rehearsal with three hundred browsers. Nothing here touches the client, the socket or the peer
 * connection: facts in, a plan out, and the client's job is to make the plan true.
 *
 * THIS BROWSER IS NOT IN THE PLAN. `self` is filtered out of everything below, because a browser
 * does not pull its own picture back from the unit — the local preview is the capture itself, and
 * the screen pins it beside whatever page is showing rather than paging it with the rest.
 */
import type { MeetingMedium, PreferredRid } from "@magna-carta/meeting-protocol/types";
import type { MeetingTrackKind } from "./signaling.ts";

/** The most cameras pulled at once, however many tiles a page holds. */
export const MAX_VIDEO_SUBSCRIPTIONS = 16;

/**
 * The most microphones pulled at once. It is larger than the video cap because sound is cheap
 * beside a picture and because the person who speaks next is usually somebody who spoke recently —
 * holding a few more voices than there are tiles is what stops the first word being cut off.
 */
export const MAX_AUDIO_SUBSCRIPTIONS = 24;

/** How many tiles a gallery page holds. */
export const GALLERY_PAGE_SIZE = 16;

/** The large tile plus the strip beside it, which is the whole of what speaker view shows. */
export const SPEAKER_VIEW_STRIP_SIZE = 5;
export const SPEAKER_VIEW_PAGE_SIZE = 1 + SPEAKER_VIEW_STRIP_SIZE;

/**
 * How long somebody stays a "recent speaker" for.
 *
 * Without a window, one word an hour ago outranks a colleague for the rest of the meeting and the
 * gallery never settles back to the roster's own order. Five minutes is long enough to cover a
 * pause for breath in a discussion and short enough that a room whose talkers have changed shows
 * the people now in it.
 */
export const SPEAKER_MEMORY_MILLISECONDS = 5 * 60 * 1000;

/**
 * Which simulcast layer a subscriber asks for: full, half or quarter resolution.
 *
 * Re-exported rather than restated — it is a value on the wire, so its one home is the protocol
 * package both ends import.
 */
export type { PreferredRid };

/*
 * The bands the gallery's order is built from, best first: what this member asked to keep on screen,
 * then what the room is looking at, then who has been talking, then everybody else.
 */
const PINNED_BAND = 0;
const SHARING_BAND = 1;
const SPEAKERS_BAND = 2;
const ROSTER_BAND = 3;

/** Up to this many tiles on a page, the full layer is worth its bandwidth. */
const FULL_LAYER_TILE_LIMIT = 4;
/** Up to this many, the half layer. Beyond it, the quarter. */
const HALF_LAYER_TILE_LIMIT = 9;

/** One published track, as the roster names it. */
export interface SubscriptionPolicyTrack {
  readonly trackName: string;
  readonly kind: MeetingTrackKind;
}

/** Somebody in the room, as the roster and the presence frames together state them. */
export interface SubscriptionPolicyParticipant {
  readonly participantId: string;
  /** The unit session they publish through. Null before they have published anything. */
  readonly sfuSessionId: string | null;
  readonly tracks: readonly SubscriptionPolicyTrack[];
  /** Their microphone is carrying speech right now, as their own browser measured it. */
  readonly speaking: boolean;
  /** Their microphone is off, so nothing is coming from it whatever the meter says. */
  readonly muted: boolean;
  /** When they last spoke, on this browser's clock. Null for somebody who has not. */
  readonly lastSpokeAt: number | null;
}

/** Everything the plan is decided from. */
export interface SubscriptionPolicyInput {
  /** What the room carries. A call has no picture in it, so it yields no video and no screen. */
  readonly medium: MeetingMedium;
  /** This browser's own participant, which is never subscribed to. */
  readonly self: string;
  readonly participants: readonly SubscriptionPolicyParticipant[];
  /** Participants this member has pinned, in the order they pinned them. Local to this browser. */
  readonly pinned: readonly string[];
  /** The gallery page being shown, counted from zero. Out of range is clamped, never refused. */
  readonly page: number;
  /** How many tiles the page holds: `GALLERY_PAGE_SIZE`, or speaker view's large tile and strip. */
  readonly pageSize: number;
  /** Now, on the same clock `lastSpokeAt` is stamped from. */
  readonly now: number;
}

/** A camera to pull, and which layer of it. */
export interface PlannedVideoTrack {
  readonly sessionId: string;
  readonly trackName: string;
  readonly participantId: string;
  readonly preferredRid: PreferredRid;
}

/** A track to pull at whatever layer it is published with: a microphone, or a screen share. */
export interface PlannedTrack {
  readonly sessionId: string;
  readonly trackName: string;
  readonly participantId: string;
}

/** What this browser should be pulling, and what the gallery should be drawing. */
export interface SubscriptionPlan {
  readonly video: readonly PlannedVideoTrack[];
  /** The one screen share, where somebody is sharing. At most one, whatever the roster holds. */
  readonly screen: PlannedTrack | null;
  readonly audio: readonly PlannedTrack[];
  /** The tiles on this page, in the order they are drawn. This browser is not among them. */
  readonly shown: readonly string[];
  /** How many pages the room takes. At least one, so an empty room still has a page to be on. */
  readonly pages: number;
}

/** Which layer a page of this many tiles is worth asking for. */
export function preferredRidForTileCount(tiles: number): PreferredRid {
  if (tiles <= FULL_LAYER_TILE_LIMIT) return "f";
  if (tiles <= HALF_LAYER_TILE_LIMIT) return "h";
  return "q";
}

function trackOfKind(
  participant: SubscriptionPolicyParticipant,
  kind: MeetingTrackKind,
): SubscriptionPolicyTrack | null {
  return participant.tracks.find((track) => track.kind === kind) ?? null;
}

/** Whether somebody's speech is recent enough to still order the gallery by. */
function spokeRecently(participant: SubscriptionPolicyParticipant, now: number): boolean {
  if (participant.speaking) return true;
  const spoke = participant.lastSpokeAt;
  return spoke !== null && now - spoke <= SPEAKER_MEMORY_MILLISECONDS;
}

/**
 * How recently somebody spoke, as a number that sorts descending. Somebody talking NOW outranks
 * everybody who has stopped, whatever their timestamps say; somebody who has never spoken sorts
 * behind everybody who has.
 */
function recency(participant: SubscriptionPolicyParticipant): number {
  if (participant.speaking) return Number.POSITIVE_INFINITY;
  return participant.lastSpokeAt ?? Number.NEGATIVE_INFINITY;
}

/**
 * Most recent first, and never NaN.
 *
 * Subtracting one recency from another is the obvious way to write this and is wrong at both ends:
 * two people talking at once, and two who have never spoken, both come out as `Infinity - Infinity`
 * — which is NaN, which a sort reads as "keep whatever order you had". The comparisons below say
 * what those two cases mean instead of asking arithmetic to.
 */
function byRecency(left: SubscriptionPolicyParticipant, right: SubscriptionPolicyParticipant) {
  const leftSpoke = recency(left);
  const rightSpoke = recency(right);
  if (leftSpoke === rightSpoke) return 0;
  if (leftSpoke === Number.POSITIVE_INFINITY || rightSpoke === Number.NEGATIVE_INFINITY) return -1;
  if (rightSpoke === Number.POSITIVE_INFINITY || leftSpoke === Number.NEGATIVE_INFINITY) return 1;
  return rightSpoke - leftSpoke;
}

/** Whoever is sharing a screen, where the room carries pictures at all. */
function screenSharer(
  input: SubscriptionPolicyInput,
  others: readonly SubscriptionPolicyParticipant[],
): SubscriptionPolicyParticipant | null {
  if (input.medium !== "video") return null;
  return (
    others.find(
      (participant) =>
        participant.sfuSessionId !== null && trackOfKind(participant, "screen") !== null,
    ) ?? null
  );
}

/**
 * Everybody but this browser, in the order the gallery draws them: pinned first, then whoever is
 * sharing a screen, then the people who have been talking, then the roster's own order.
 *
 * The order is what makes paging mean something. A member on page one sees the people the room is
 * about; somebody who starts talking on page twelve moves to page one rather than staying where the
 * roster happened to put them.
 */
function galleryOrder(
  input: SubscriptionPolicyInput,
  others: readonly SubscriptionPolicyParticipant[],
  sharer: SubscriptionPolicyParticipant | null,
): SubscriptionPolicyParticipant[] {
  const rosterIndex = new Map<string, number>();
  others.forEach((participant, index) => rosterIndex.set(participant.participantId, index));

  const pinnedIndex = new Map<string, number>();
  input.pinned.forEach((participantId, index) => {
    if (!pinnedIndex.has(participantId)) pinnedIndex.set(participantId, index);
  });

  /** Which band a participant sorts into. Lower comes first. */
  const band = (participant: SubscriptionPolicyParticipant): number => {
    if (pinnedIndex.has(participant.participantId)) return PINNED_BAND;
    if (sharer !== null && participant.participantId === sharer.participantId) return SHARING_BAND;
    if (spokeRecently(participant, input.now)) return SPEAKERS_BAND;
    return ROSTER_BAND;
  };

  return [...others].toSorted((left, right) => {
    const leftBand = band(left);
    const bands = leftBand - band(right);
    if (bands !== 0) return bands;
    const pinnedLeft = pinnedIndex.get(left.participantId);
    const pinnedRight = pinnedIndex.get(right.participantId);
    if (pinnedLeft !== undefined && pinnedRight !== undefined) return pinnedLeft - pinnedRight;
    // Recency orders the speakers' band and only that one. Applied to everybody it would hold
    // somebody who said one word an hour ago on page one for the rest of the meeting, which is the
    // window's whole reason for existing.
    if (leftBand === SPEAKERS_BAND) {
      const spoken = byRecency(left, right);
      if (spoken !== 0) return spoken;
    }
    return (rosterIndex.get(left.participantId) ?? 0) - (rosterIndex.get(right.participantId) ?? 0);
  });
}

/**
 * Who this browser pulls sound from: whoever is talking, then whoever talked most recently, capped.
 *
 * It is ranked separately from the gallery on purpose. Sound is not about what is on screen — a
 * member reading a shared document with the gallery on page four still has to hear the person
 * answering them — so the ranking here is recency and nothing else.
 */
function audioPlan(input: SubscriptionPolicyInput): PlannedTrack[] {
  const rosterIndex = new Map<string, number>();
  input.participants.forEach((participant, index) =>
    rosterIndex.set(participant.participantId, index),
  );

  const candidates = input.participants.filter((participant) => {
    if (participant.participantId === input.self) return false;
    if (participant.sfuSessionId === null) return false;
    if (trackOfKind(participant, "audio") === null) return false;
    // Somebody speaking is pulled whatever their muted flag says: the two disagree only while a
    // presence frame is in flight, and the wrong answer there is the one that cuts off a word.
    return !participant.muted || participant.speaking;
  });

  candidates.sort((left, right) => {
    const spoken = byRecency(left, right);
    if (spoken !== 0) return spoken;
    return (rosterIndex.get(left.participantId) ?? 0) - (rosterIndex.get(right.participantId) ?? 0);
  });

  const planned: PlannedTrack[] = [];
  for (const participant of candidates) {
    if (planned.length >= MAX_AUDIO_SUBSCRIPTIONS) break;
    const track = trackOfKind(participant, "audio");
    if (track === null || participant.sfuSessionId === null) continue;
    planned.push({
      sessionId: participant.sfuSessionId,
      trackName: track.trackName,
      participantId: participant.participantId,
    });
  }
  return planned;
}

/**
 * What to pull and what to draw, from the roster, the presence facts, the pins and the page.
 *
 * Everything it reads is a fact about the room; nothing it returns is a decision the client is free
 * to second-guess. A track in the plan is pulled, a track not in it is closed, and a layer named
 * here is the layer asked for.
 */
export function subscriptionPolicy(input: SubscriptionPolicyInput): SubscriptionPlan {
  const others = input.participants.filter(
    (participant) => participant.participantId !== input.self,
  );
  const sharer = screenSharer(input, others);
  const ordered = galleryOrder(input, others, sharer);
  const pageSize = Math.max(1, Math.floor(input.pageSize));
  const pages = Math.max(1, Math.ceil(ordered.length / pageSize));
  const page = Math.min(Math.max(0, Math.floor(input.page)), pages - 1);
  const onThisPage = ordered.slice(page * pageSize, page * pageSize + pageSize);
  const shown = onThisPage.map((participant) => participant.participantId);

  if (input.medium !== "video") {
    // A call carries sound and nothing else, so there is no picture to rank, page or ask a layer
    // for — the tiles are still paged, because three hundred names do not fit on one screen either.
    return { video: [], screen: null, audio: audioPlan(input), shown, pages };
  }

  const preferredRid = preferredRidForTileCount(onThisPage.length);
  const video: PlannedVideoTrack[] = [];
  for (const participant of onThisPage) {
    if (video.length >= MAX_VIDEO_SUBSCRIPTIONS) break;
    const sessionId = participant.sfuSessionId;
    const track = trackOfKind(participant, "video");
    if (sessionId === null || track === null) continue;
    video.push({
      sessionId,
      trackName: track.trackName,
      participantId: participant.participantId,
      preferredRid,
    });
  }

  const screenTrack = sharer === null ? null : trackOfKind(sharer, "screen");
  const screen =
    sharer === null || screenTrack === null || sharer.sfuSessionId === null
      ? null
      : {
          sessionId: sharer.sfuSessionId,
          trackName: screenTrack.trackName,
          participantId: sharer.participantId,
        };

  return { video, screen, audio: audioPlan(input), shown, pages };
}
