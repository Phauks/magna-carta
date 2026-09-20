/*
 * What is actually coming in, held against what the plan says should be.
 *
 * WHAT IS PULLED IS DECIDED BY A PURE FUNCTION, NEVER HERE. A room holds up to three hundred people
 * and a browser pulls at most sixteen cameras and twenty-four microphones, so "what should be coming
 * in" is a judgment over the roster, the presence facts, the pins and the gallery page —
 * `subscriptionPolicy` in subscription-policy.ts. This module only makes the answer true: it asks
 * for what the plan names and is not already coming in, closes what the plan no longer names, and
 * moves a simulcast layer where the plan changed it.
 *
 * SOMEBODY ELSE RECONNECTING IS ORDINARY, and this browser has to follow it. They come back with the
 * same attendance and the same track names on a NEW unit session, so what is already coming in is
 * counted by session AND name (`pulledTrackKey`), and a roster that stops naming a session is what
 * drops the tracks and the stream that went with it.
 */
import { MAX_LAYER_TRACKS } from "@magna-carta/meeting-protocol/frames";
import {
  namesAScreen,
  ownerOfTrackName,
  type MeetingParticipant,
  type SubscribedTrack,
} from "./signaling.ts";
import type { PreferredRid, SubscriptionPlan } from "./subscription-policy.ts";

/**
 * How often what this browser is pulling may be worked out afresh.
 *
 * Three hundred people arriving at the top of the hour is three hundred roster deltas in a few
 * seconds, and each one on its own would re-run the policy and send frames. The first change in a
 * burst is acted on at once — a member should see somebody arrive, not wait a quarter of a second
 * for it — and everything that follows inside the window is folded into one pass at the end of it.
 */
export const RECONCILE_DEBOUNCE_MILLISECONDS = 250;

/**
 * How a pulled track is keyed: the unit session it comes from, and then its name.
 *
 * The name on its own is not enough to say what is already coming in. A participant who drops and
 * comes back keeps their attendance, so their tracks keep their names, while the unit gives them a
 * NEW session — and a set keyed on the name alone reports those tracks as already pulled, never asks
 * for them, and leaves that person's tile black for as long as they stay in the room.
 */
export function pulledTrackKey(sessionId: string, trackName: string): string {
  return `${sessionId}:${trackName}`;
}

/** What this module needs of the client, stated so it needs nothing else of it. */
export interface SubscriptionHost {
  /** What should be coming in, as the policy decided it from the roster this instant. */
  plan(): SubscriptionPlan;
  /** Whether the meeting is live. Nothing is reconciled before it is or after it stops being. */
  isLive(): boolean;
  send(frame: Record<string, unknown>): void;
  /** Gather one arriving track into the stream its owner's tile draws. */
  attachRemoteTrack(participantId: string, trackName: string, track: MediaStreamTrack): void;
  /** Take one track out of that stream and stop it; the stream goes when it was the last. */
  detachRemoteTrack(
    participantId: string,
    screen: boolean,
    media: MediaStreamTrack | undefined,
  ): void;
  /** Stop holding a participant's incoming media altogether. */
  releaseRemote(participantId: string, screen: boolean): void;
  /** Whoever this browser is currently holding a stream for. */
  remoteOwners(screen: boolean): readonly string[];
}

/** One entry of what the plan wants, keyed the way what is already coming in is keyed. */
interface WantedTrack {
  readonly sessionId: string;
  readonly trackName: string;
  readonly participantId: string;
  readonly rid: PreferredRid | null;
}

export class MeetingSubscriptions {
  readonly #host: SubscriptionHost;

  /**
   * The tracks already asked for, keyed by session and name (`pulledTrackKey`), so a repeated roster
   * does not pull the same track twice and a reconnected participant's new session is pulled afresh.
   */
  readonly #pulledTracks = new Set<string>();
  /** The same keys, for the subscriptions the room has not answered yet. */
  readonly #pendingSubscriptions = new Set<string>();
  /** Which participant each pulled track belongs to, under the same key. */
  readonly #trackOwners = new Map<string, string>();
  /**
   * The media section each pulled track arrives on, as the room's `subscribed` named it. Closing a
   * track names its mid, so a track with no mid here is one that cannot be closed yet.
   */
  readonly #pulledMids = new Map<string, string>();
  /** The incoming track itself, so closing one takes it out of the stream it was gathered into. */
  readonly #pulledMediaTracks = new Map<string, MediaStreamTrack>();
  /** The simulcast layer last ASKED FOR per pulled track, so a layer frame is sent only on change. */
  readonly #askedRids = new Map<string, PreferredRid>();

  /** The window inside which further changes are folded into one reconciliation. */
  #window: ReturnType<typeof setTimeout> | undefined;
  /** Whether something changed while the window was open, so a pass is owed when it closes. */
  #owed = false;

  constructor(host: SubscriptionHost) {
    this.#host = host;
  }

  /**
   * Make the plan true: ask for what should be coming in and is not, close what should not, and
   * move the layer of anything the plan now wants at a different size.
   *
   * It is safe to call at any time and does nothing when nothing has changed, which is what lets
   * every arrival, departure, presence frame, pin and page turn go through the same one path
   * instead of each one deciding for itself what it implies.
   */
  reconcile(): void {
    if (!this.#host.isLive()) return;
    const plan = this.#host.plan();

    const wanted = new Map<string, WantedTrack>();
    for (const track of plan.video) {
      wanted.set(pulledTrackKey(track.sessionId, track.trackName), {
        sessionId: track.sessionId,
        trackName: track.trackName,
        participantId: track.participantId,
        rid: track.preferredRid,
      });
    }
    if (plan.screen !== null) {
      wanted.set(pulledTrackKey(plan.screen.sessionId, plan.screen.trackName), {
        ...plan.screen,
        rid: null,
      });
    }
    for (const track of plan.audio) {
      wanted.set(pulledTrackKey(track.sessionId, track.trackName), { ...track, rid: null });
    }

    this.#pullWhatIsMissing(wanted);
    this.#closeWhatIsNoLongerWanted(wanted);
    this.#moveLayersThatChanged(wanted);
  }

  /**
   * Reconcile now if the last pass was not just run, and otherwise once the window closes.
   *
   * Acting on the first change of a burst and folding the rest is what keeps a room of three
   * hundred responsive AND cheap: one person arriving is answered immediately, three hundred
   * arriving cost one pass every quarter second rather than three hundred passes.
   */
  schedule(): void {
    if (this.#window !== undefined) {
      this.#owed = true;
      return;
    }
    this.reconcile();
    this.#window = setTimeout(() => {
      this.#window = undefined;
      if (!this.#owed) return;
      this.#owed = false;
      this.schedule();
    }, RECONCILE_DEBOUNCE_MILLISECONDS);
  }

  /** Close the reconciliation window, so a torn-down client's last pass cannot fire after it. */
  stopScheduling(): void {
    if (this.#window !== undefined) clearTimeout(this.#window);
    this.#window = undefined;
    this.#owed = false;
  }

  /** Forget every track asked for that the room has not answered for yet. */
  forgetPending(): void {
    for (const key of this.#pendingSubscriptions) this.forgetTrack(key);
  }

  /**
   * Forget the tracks a `subscribed` frame was about. A frame that names none of them — or names
   * them without their session — is about whatever was outstanding, so everything still waiting is
   * forgotten rather than left marked for the rest of the meeting.
   */
  forgetSubscribed(tracks: readonly SubscribedTrack[]): void {
    const keys = tracks
      .map((track) =>
        track.sessionId === null ? null : pulledTrackKey(track.sessionId, track.trackName),
      )
      .filter((key): key is string => key !== null);
    if (keys.length === 0) {
      this.forgetPending();
      return;
    }
    for (const key of keys) this.forgetTrack(key);
  }

  /**
   * One track of a `subscribed` frame has arrived on the connection: stop waiting for it, remember
   * the media section closing it will name, and gather it into its owner's stream.
   *
   * Nothing here is knowable before the offer carrying it was applied — the transceivers the unit's
   * media sections map onto do not exist on this connection until then.
   */
  noteArrival(entry: SubscribedTrack, mid: string, track: MediaStreamTrack): void {
    const key = entry.sessionId === null ? null : pulledTrackKey(entry.sessionId, entry.trackName);
    if (key !== null) {
      this.#pendingSubscriptions.delete(key);
      this.#pulledMids.set(key, mid);
      this.#pulledMediaTracks.set(key, track);
    }
    const owner = key === null ? undefined : this.#trackOwners.get(key);
    this.#host.attachRemoteTrack(
      owner ?? ownerOfTrackName(entry.trackName),
      entry.trackName,
      track,
    );
  }

  /** A `subscribed` entry stops waiting even where no media came with it. */
  clearPending(entry: SubscribedTrack): void {
    if (entry.sessionId === null) return;
    this.#pendingSubscriptions.delete(pulledTrackKey(entry.sessionId, entry.trackName));
  }

  /**
   * The room's answer to a layer change.
   *
   * A track the room could not move is left recorded at the layer it was ASKED for rather than
   * being un-recorded, so the next pass does not ask again on the next roster frame, and the next
   * one after that: the picture stays at whatever size the unit is sending, and a genuine change —
   * a page turn, a pin, a different number of tiles — asks afresh.
   */
  noteLayered(entries: readonly { readonly mid: string; readonly preferredRid: PreferredRid }[]) {
    const byMid = new Map<string, string>();
    for (const [key, mid] of this.#pulledMids) byMid.set(mid, key);
    for (const entry of entries) {
      const key = byMid.get(entry.mid);
      if (key === undefined) continue;
      this.#askedRids.set(key, entry.preferredRid);
    }
  }

  /**
   * Drop what the roster has stopped naming: a track under a session that is no longer its
   * participant's, and everything held for somebody who has left the room.
   *
   * A forgotten track is asked for again as soon as the roster names it under its new session, which
   * is what puts a reconnected participant's picture back. Their old stream goes with it, because a
   * video element plays the first video track it was given and a dead one left in the stream is the
   * black tile the fresh subscription was supposed to end.
   */
  forgetWhatTheRosterNoLongerNames(participants: readonly MeetingParticipant[]): void {
    const named = new Set<string>();
    const present = new Set<string>();
    for (const participant of participants) {
      present.add(participant.participantId);
      const sessionId = participant.sfuSessionId;
      if (sessionId === null) continue;
      for (const track of participant.tracks) {
        named.add(pulledTrackKey(sessionId, track.trackName));
      }
    }
    // Forgetting the key currently being visited is what this loop does on almost every pass, and
    // that is defined: a set drops it from behind the iterator rather than from in front of it.
    for (const key of this.#pulledTracks) {
      if (named.has(key)) continue;
      const owner = this.#trackOwners.get(key);
      this.forgetTrack(key);
      if (owner !== undefined) this.#host.releaseRemote(owner, namesAScreen(key));
    }
    // The two below walk the owners as they stand NOW; releasing replaces the client's map with a
    // new one, and the walk is over the list this pass started on, which is the whole set to judge.
    for (const participantId of this.#host.remoteOwners(false)) {
      if (!present.has(participantId)) this.#host.releaseRemote(participantId, false);
    }
    for (const participantId of this.#host.remoteOwners(true)) {
      if (!present.has(participantId)) this.#host.releaseRemote(participantId, true);
    }
  }

  /** Stop counting a track as coming in, so the next pass asks for it again. */
  forgetTrack(key: string): void {
    this.#pulledTracks.delete(key);
    this.#pendingSubscriptions.delete(key);
    this.#trackOwners.delete(key);
    this.#pulledMids.delete(key);
    this.#pulledMediaTracks.delete(key);
    this.#askedRids.delete(key);
  }

  /** Forget everything, for a client being joined afresh. */
  clear(): void {
    this.#pulledTracks.clear();
    this.#pendingSubscriptions.clear();
    this.#trackOwners.clear();
    this.#pulledMids.clear();
    this.#pulledMediaTracks.clear();
    this.#askedRids.clear();
    this.stopScheduling();
  }

  /** Ask for the plan's tracks that are not already coming in, in one frame. */
  #pullWhatIsMissing(wanted: ReadonlyMap<string, WantedTrack>): void {
    const tracks: Record<string, unknown>[] = [];
    for (const [key, track] of wanted) {
      if (this.#pulledTracks.has(key)) continue;
      this.#pulledTracks.add(key);
      this.#pendingSubscriptions.add(key);
      this.#trackOwners.set(key, track.participantId);
      if (track.rid !== null) this.#askedRids.set(key, track.rid);
      tracks.push({
        sessionId: track.sessionId,
        trackName: track.trackName,
        ...(track.rid === null ? {} : { preferredRid: track.rid }),
      });
    }
    if (tracks.length > 0) this.#host.send({ type: "subscribe", tracks });
  }

  /**
   * Stop pulling what the plan no longer names, and take the media out of the stream it was
   * gathered into.
   *
   * Leaving a closed track in the stream is not harmless: a video element plays the first video
   * track it was given, so a tile that has stopped receiving would keep drawing the last frame of
   * somebody who is no longer on this page, which reads as a picture of a person sitting still.
   */
  #closeWhatIsNoLongerWanted(wanted: ReadonlyMap<string, unknown>): void {
    const mids: string[] = [];
    // A copy, because forgetting a key mutates the set this walks.
    for (const key of [...this.#pulledTracks]) {
      if (wanted.has(key)) continue;
      const mid = this.#pulledMids.get(key);
      // A track asked for and not yet answered has no media section to name, and forgetting it
      // here would leave the unit sending something nothing on this side is counting. It keeps its
      // place until the answer arrives, and the pass that follows the answer closes it properly.
      if (mid === undefined && this.#pendingSubscriptions.has(key)) continue;
      const owner = this.#trackOwners.get(key);
      const media = this.#pulledMediaTracks.get(key);
      this.forgetTrack(key);
      if (mid !== undefined) mids.push(mid);
      if (owner !== undefined) this.#host.detachRemoteTrack(owner, namesAScreen(key), media);
    }
    if (mids.length > 0) this.#host.send({ type: "close", mids });
  }

  /**
   * Ask the unit for a different layer of what is already coming in.
   *
   * Only where the mid is known: the layer is named on the subscribe itself, so a track still
   * waiting for its answer is already being pulled at the right size, and asking again by mid
   * before the unit has said which mid it is would name nothing.
   *
   * A frame carries at most `MAX_LAYER_TRACKS` tracks, which is what the room accepts.
   */
  #moveLayersThatChanged(wanted: ReadonlyMap<string, WantedTrack>): void {
    const changed: Record<string, unknown>[] = [];
    for (const [key, track] of wanted) {
      if (track.rid === null) continue;
      const mid = this.#pulledMids.get(key);
      if (mid === undefined) continue;
      if (this.#askedRids.get(key) === track.rid) continue;
      this.#askedRids.set(key, track.rid);
      changed.push({
        sessionId: track.sessionId,
        trackName: track.trackName,
        mid,
        preferredRid: track.rid,
      });
    }
    for (let from = 0; from < changed.length; from += MAX_LAYER_TRACKS) {
      this.#host.send({ type: "layer", tracks: changed.slice(from, from + MAX_LAYER_TRACKS) });
    }
  }
}
