/*
 * The meeting client's state machine, driven against fakes for the four edges it reaches the
 * outside world through: the peer connection, the signaling socket, capture, and the empty stream
 * a participant's incoming tracks are gathered into.
 *
 * What is pinned here is the wire behaviour a real room depends on and no type can assert — that a
 * publish frame names one mid per captured track and reads those mids AFTER the local description
 * is set; that a roster naming somebody else's tracks turns into exactly one pull; that a pulled
 * track lands on a stream keyed by the participant who owns it; and that leaving stops the camera
 * rather than only telling the room about it.
 *
 * The second half of the file is the same question asked of what GOES WRONG, because every one of
 * these fails silently in a browser and looks identical from the outside — a tile that stays black.
 * A participant who comes back on a new unit session is pulled again; a pull the unit did not serve
 * stops counting as pulled; a refusal the room survives does not end the meeting and does not vanish
 * either; a publish cannot land inside somebody else's negotiation; and a connection that cannot
 * describe itself fails its step instead of sending an answer labelled as an offer.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DENIED_REASON,
  DENIED_STATEMENT,
  MeetingClient,
  PROTOCOL_MISMATCH_REASON,
  RECONCILE_DEBOUNCE_MILLISECONDS,
  refusalStatement,
  SUPERSEDED_REASON,
  waitingPlaceStatement,
  type MeetingClientSeams,
  type MeetingMedium,
} from "$lib/meetings/client/meeting-client.svelte.ts";
import { MAX_VIDEO_SUBSCRIPTIONS } from "$lib/meetings/client/subscription-policy.ts";
import type { SubscriptionPlan } from "$lib/meetings/client/subscription-policy.ts";
import { MeetingSubscriptions } from "$lib/meetings/client/subscriptions.ts";
import { SYNC_LATCH_MILLISECONDS } from "$lib/meetings/client/signaling.ts";
import { MAX_CLOSE_MIDS, MAX_SUBSCRIBE_TRACKS } from "@magna-carta/meeting-protocol/frames";
import { meetingTiles, sharedScreenTile } from "$lib/meetings/screen/meeting-tiles.ts";
import { leaveMeetingOnDeparture } from "$lib/api/departure-write.ts";
import {
  passThroughEffects,
  type EffectedCapture,
  type MediaEffectsStage,
} from "$lib/meetings/client/media-effects.ts";
import { MeetingPolls, type MeetingPollSeams } from "$lib/meetings/client/polls.svelte.ts";
import {
  MeetingQuestions,
  type MeetingQuestionSeams,
} from "$lib/meetings/client/questions.svelte.ts";

/** Lets every queued negotiation step settle; each one is a handful of microtasks deep. */
async function settle(remaining = 20): Promise<void> {
  if (remaining === 0) return;
  await Promise.resolve();
  await settle(remaining - 1);
}

/**
 * Waits out the reconciliation window.
 *
 * What the client pulls is worked out at most once every `RECONCILE_DEBOUNCE_MILLISECONDS`, so a
 * second roster arriving in the same breath as the first is folded into one pass at the end of the
 * window rather than acted on where it lands. A case that delivers two frames back to back is
 * asking about that second pass, and this is how it waits for it — real time, because the interval
 * the keepalive is also running on makes fake timers a second thing to keep in step.
 */
async function reconciled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, RECONCILE_DEBOUNCE_MILLISECONDS + 20));
  await settle();
}

/** The tracks a frame that carries them names, in the order it names them. */
function trackNamesOf(frame: Record<string, unknown> | undefined): string[] {
  return ((frame?.tracks ?? []) as { trackName: string }[]).map((track) => track.trackName);
}

/** How often the room is answered while a case is waiting out minutes on a fake clock. */
const PONG_EVERY_MILLISECONDS = 15_000;

/**
 * Lets minutes pass on a FAKE clock while the room stays connected.
 *
 * A case about a five-minute window cannot wait five real minutes, and the client's own reading of
 * the clock only moves on its tick — so time here is advanced rather than waited out. The pongs are
 * not decoration: the keepalive fails a socket that misses two pings in a row, so a room that went
 * unanswered for five minutes would be a closed socket rather than an idle meeting.
 */
async function minutesPassed(harnessed: Harness, milliseconds: number): Promise<void> {
  if (milliseconds <= 0) {
    await settle();
    return;
  }
  await vi.advanceTimersByTimeAsync(Math.min(milliseconds, PONG_EVERY_MILLISECONDS));
  harnessed.socket.deliver('{"type":"pong"}');
  await minutesPassed(harnessed, milliseconds - PONG_EVERY_MILLISECONDS);
}

class FakeTrack {
  enabled = true;
  stopped = false;
  readonly listeners = new Map<string, () => void>();

  constructor(readonly kind: "audio" | "video") {}

  stop(): void {
    this.stopped = true;
  }

  addEventListener(name: string, handler: () => void): void {
    this.listeners.set(name, handler);
  }
}

class FakeStream {
  constructor(readonly tracks: FakeTrack[] = []) {}

  getTracks(): FakeTrack[] {
    return this.tracks;
  }

  getAudioTracks(): FakeTrack[] {
    return this.tracks.filter((track) => track.kind === "audio");
  }

  getVideoTracks(): FakeTrack[] {
    return this.tracks.filter((track) => track.kind === "video");
  }

  addTrack(track: FakeTrack): void {
    this.tracks.push(track);
  }

  removeTrack(track: FakeTrack): void {
    const at = this.tracks.indexOf(track);
    if (at >= 0) this.tracks.splice(at, 1);
  }
}

/**
 * The browser's own measurement of whether the microphone is carrying speech, driven by hand.
 *
 * A real one is an AudioContext over a live track and cannot exist here; what the client depends on
 * is the shape — start, a callback on CHANGE only, stop — so a case says "she started talking" and
 * asserts what reached the room.
 */
class FakeAudioLevelMeter {
  #onSpeaking: ((speaking: boolean) => void) | null = null;
  started = false;
  stopped = false;

  start(onSpeaking: (speaking: boolean) => void): void {
    this.started = true;
    this.#onSpeaking = onSpeaking;
  }

  stop(): void {
    this.stopped = true;
    this.#onSpeaking = null;
  }

  /** The meter's answer changing, which is the only thing it ever reports. */
  say(speaking: boolean): void {
    this.#onSpeaking?.(speaking);
  }
}

class FakeTransceiver {
  mid: string | null = null;
  receiver: { track: FakeTrack | null };
  /**
   * The sending half, which is what a REUSED media section is reused through. A browser swaps what
   * a sender carries with `replaceTrack` and the section keeps its place in the description; the
   * fake carries it so a case can ask whether coming back after a host's mute reused the section
   * or added one.
   */
  sender: { track: FakeTrack | null; replaceTrack: (track: FakeTrack) => Promise<void> };
  direction = "sendonly";

  constructor(track: FakeTrack | null) {
    this.receiver = { track };
    this.sender = {
      track,
      replaceTrack: (replacement: FakeTrack) => {
        this.sender.track = replacement;
        return Promise.resolve();
      },
    };
  }
}

/**
 * A peer connection that behaves the way the client depends on: a transceiver has no mid until the
 * local description is set, and applying a remote OFFER is what makes the unit's media sections
 * appear as transceivers on this side. The fake reads those mids out of the offer's sdp
 * (`offer mids=2,3`) because a fake has to get them from somewhere and the sdp is where a browser
 * gets them from.
 */
class FakePeerConnection {
  readonly transceivers: FakeTransceiver[] = [];
  localDescription: { type: string; sdp: string } | null = null;
  remoteDescription: { type: string; sdp: string } | null = null;
  closed = false;
  /**
   * Every description applied, in the order it was applied. Two negotiations running at once
   * interleave here, which is the only way a test can see the collision the real browser reports as
   * an invalid-state error from whichever one lost.
   */
  readonly steps: string[] = [];
  /** The browser refusing the next local description — a step that fails mid-negotiation. */
  failNextLocalDescription = false;
  /** A connection that never reports a local description, as one that failed to set one does. */
  forgetsLocalDescription = false;
  #nextMid = 0;

  /** What each publish offered, so a case can ask how a camera was encoded. */
  readonly offered: {
    kind: string;
    sendEncodings: { rid: string; scale: number }[] | null;
  }[] = [];

  addTransceiver(
    track: FakeTrack,
    init: {
      direction: string;
      sendEncodings?: { rid?: string; scaleResolutionDownBy?: number }[];
    },
  ): FakeTransceiver {
    expect(init.direction).toBe("sendonly");
    this.offered.push({
      kind: track.kind,
      sendEncodings:
        init.sendEncodings?.map((encoding) => ({
          rid: encoding.rid ?? "",
          scale: encoding.scaleResolutionDownBy ?? 0,
        })) ?? null,
    });
    const transceiver = new FakeTransceiver(track);
    this.transceivers.push(transceiver);
    return transceiver;
  }

  getTransceivers(): FakeTransceiver[] {
    return this.transceivers;
  }

  createOffer(): Promise<{ type: string; sdp: string }> {
    return Promise.resolve({ type: "offer", sdp: "local-offer" });
  }

  createAnswer(): Promise<{ type: string; sdp: string }> {
    return Promise.resolve({ type: "answer", sdp: "local-answer" });
  }

  setLocalDescription(description: { type: string; sdp: string }): Promise<void> {
    if (this.failNextLocalDescription) {
      this.failNextLocalDescription = false;
      return Promise.reject(new Error("InvalidStateError"));
    }
    this.steps.push(`local:${description.type}`);
    if (!this.forgetsLocalDescription) this.localDescription = description;
    for (const transceiver of this.transceivers) {
      if (transceiver.mid === null) {
        transceiver.mid = String(this.#nextMid);
        this.#nextMid += 1;
      }
    }
    return Promise.resolve();
  }

  setRemoteDescription(description: { type: string; sdp: string }): Promise<void> {
    this.steps.push(`remote:${description.type}`);
    this.remoteDescription = description;
    if (description.type === "offer") {
      const declared = /mids=([\w,]+)/u.exec(description.sdp);
      for (const mid of declared?.[1]?.split(",") ?? []) {
        if (this.transceivers.some((transceiver) => transceiver.mid === mid)) continue;
        const transceiver = new FakeTransceiver(new FakeTrack("video"));
        transceiver.mid = mid;
        this.transceivers.push(transceiver);
      }
    }
    return Promise.resolve();
  }

  close(): void {
    this.closed = true;
  }
}

class FakeSocket {
  readonly sent: string[] = [];
  open = false;
  closed = false;
  readonly #listeners = new Map<string, (event: { data: string }) => void>();

  addEventListener(name: string, handler: (event: { data: string }) => void): void {
    this.#listeners.set(name, handler);
  }

  send(frame: string): void {
    this.sent.push(frame);
  }

  close(): void {
    this.closed = true;
    this.open = false;
    this.#listeners.get("close")?.({ data: "" });
  }

  /** The room accepting the upgrade. */
  accept(): void {
    this.open = true;
    this.#listeners.get("open")?.({ data: "" });
  }

  /** A frame arriving from the room. */
  deliver(frame: Record<string, unknown> | string): void {
    this.#listeners.get("message")?.({
      data: typeof frame === "string" ? frame : JSON.stringify(frame),
    });
  }

  frames(): Record<string, unknown>[] {
    return this.sent
      .filter((frame) => frame !== '{"type":"ping"}')
      .map((frame) => JSON.parse(frame) as Record<string, unknown>);
  }

  framesOfType(type: string): Record<string, unknown>[] {
    return this.frames().filter((frame) => frame.type === type);
  }
}

interface Harness {
  readonly client: MeetingClient;
  readonly socket: FakeSocket;
  readonly peerConnection: FakePeerConnection;
  readonly captured: FakeStream;
  readonly displayed: FakeStream;
  readonly meter: FakeAudioLevelMeter;
  /** Every capture the client asked for, in order, as it asked for it. */
  readonly askedFor: MediaStreamConstraints[];
}

/**
 * Every client a case opened. The keepalive is a real interval, so a case that does not leave would
 * hold the test process open past its own assertions; disposing here is what keeps a suite that
 * passes from also hanging.
 */
const opened: MeetingClient[] = [];

function harness(
  participantId = "attendance_1",
  medium: MeetingMedium = "video",
  /**
   * Whether the room has said hello yet. False leaves the socket open and un-welcomed, which is the
   * window every browser is in for as long as the room takes to answer a join — and the window a
   * frame arriving early has to be judged in.
   */
  welcomed = true,
  /**
   * Whether the join put this stay at the DOOR rather than in the room. A waiting socket is never
   * sent a welcome, so a case that passes this passes `welcomed` as false beside it.
   */
  waiting = false,
  /** The effects stage to capture through. Left out, the client's own pass-through. */
  effects?: MediaEffectsStage,
): Harness {
  const socket = new FakeSocket();
  const peerConnection = new FakePeerConnection();
  /*
   * Capture answers what it was ASKED for, the way a browser does: a call asks for no camera, so a
   * call's stream carries a microphone and nothing else. A fake that handed back a camera either way
   * would let a client that forgot to ask correctly still pass.
   */
  const captured = new FakeStream([new FakeTrack("audio"), new FakeTrack("video")]);
  const audioOnly = new FakeStream([new FakeTrack("audio")]);
  const displayed = new FakeStream([new FakeTrack("video")]);

  const meter = new FakeAudioLevelMeter();
  const askedFor: MediaStreamConstraints[] = [];

  const seams = {
    createPeerConnection: () => peerConnection,
    openSocket: () => socket,
    getUserMedia: (constraints: MediaStreamConstraints) => {
      askedFor.push(constraints);
      return Promise.resolve(constraints.video === false ? audioOnly : captured);
    },
    getDisplayMedia: () => Promise.resolve(displayed),
    createMediaStream: () => new FakeStream([]),
    createAudioLevelMeter: () => meter,
    ...(effects === undefined ? {} : { createMediaEffects: () => effects }),
  } as unknown as MeetingClientSeams;

  const client = new MeetingClient(seams);
  opened.push(client);
  client.join({
    meetingId: "meeting_1",
    participantId,
    iceServers: [],
    socketUrl: "wss://example.test/api/v1/meetings/meeting_1/socket",
    medium,
    waiting,
  });
  socket.accept();
  if (welcomed) socket.deliver({ v: 1, type: "welcome", participantId, roster: [] });

  return {
    client,
    socket,
    peerConnection,
    captured: medium === "audio" ? audioOnly : captured,
    displayed,
    meter,
    askedFor,
  };
}

afterEach(() => {
  for (const client of opened.splice(0)) client.dispose();
  vi.useRealTimers();
});

describe("joining", () => {
  it("goes live on the room's welcome", () => {
    const { client } = harness();
    expect(client.state).toBe("live");
    expect(client.participantId).toBe("attendance_1");
  });

  it("fails with socket-closed when the signaling socket goes away on its own", () => {
    const { client, socket } = harness();
    socket.close();
    expect(client.state).toBe("failed");
    expect(client.failureReason).toBe("socket-closed");
  });
});

describe("publishing", () => {
  it("sends one mid per captured track, named for the participant", async () => {
    const { client, socket } = harness();
    await client.publish();

    const [publish] = socket.framesOfType("publish");
    expect(publish).toBeDefined();
    expect(publish?.v).toBe(1);
    expect(publish?.sessionDescription).toEqual({
      type: "offer",
      sdp: "local-offer",
    });
    expect(publish?.tracks).toEqual([
      { trackName: "attendance_1:audio", mid: "0", kind: "audio" },
      { trackName: "attendance_1:video", mid: "1", kind: "video" },
    ]);
  });

  it("names every track for the participant the join returned, whatever that is", async () => {
    // The room REFUSES a published track whose name does not begin with the caller's own
    // participant id, so this naming is a wire contract and not a convention: a rename here that
    // looked harmless would stop every publish, and nothing else in the browser would say why.
    const { client, socket } = harness("attendance_99");
    await client.publish();

    const [publish] = socket.framesOfType("publish");
    expect(publish).toBeDefined();
    const published = (publish?.tracks ?? []) as { trackName: string }[];
    const names = published.map((track) => track.trackName);
    expect(names).toEqual(["attendance_99:audio", "attendance_99:video"]);
    for (const name of names) expect(name.startsWith("attendance_99:")).toBe(true);
  });

  it("offers in the negotiation queue, so an incoming offer cannot land inside the publish", async () => {
    const { client, socket, peerConnection } = harness();
    // Delivered while the capture is still settling: this is the race the serialization exists for.
    const publishing = client.publish();
    socket.deliver({
      v: 1,
      type: "subscribed",
      sessionDescription: { type: "offer", sdp: "unit-offer mids=7" },
      tracks: [{ sessionId: "session_2", trackName: "attendance_2:video", mid: "7" }],
    });
    await publishing;
    await settle();

    // One negotiation, then the next — never a local description applied between the two halves of
    // the other, which is the invalid-state error the browser used to raise into a silent catch.
    expect(peerConnection.steps).toEqual(["remote:offer", "local:answer", "local:offer"]);
  });

  it("says a negotiation step did not finish rather than swallowing it", async () => {
    const { client, socket, peerConnection } = harness();
    peerConnection.failNextLocalDescription = true;

    await client.publish();

    expect(client.lastProblem).toBe("Your camera and microphone were not offered to the room.");
    expect(socket.framesOfType("publish")).toHaveLength(0);
    // A failed step is not the end of the meeting: the member is still in the room and the next
    // frame is still worth applying.
    expect(client.state).toBe("live");
  });

  it("offers sound alone in a call, and never asks for a camera", async () => {
    const { client, socket, peerConnection } = harness("attendance_1", "audio");
    await client.publish();

    const [publish] = socket.framesOfType("publish");
    expect(publish?.tracks).toEqual([{ trackName: "attendance_1:audio", mid: "0", kind: "audio" }]);
    // One media section, not two with one of them dark: a camera that is captured and muted still
    // lights the device's own indicator, and nobody who started a CALL agreed to that.
    expect(peerConnection.transceivers).toHaveLength(1);
    expect(client.cameraOn).toBe(false);
  });

  it("refuses a screen share in a call here, before anybody is asked to choose a screen", async () => {
    const { client, socket } = harness("attendance_1", "audio");
    await client.publish();
    const framesBefore = socket.framesOfType("publish").length;

    await client.shareScreen();

    expect(client.sharing).toBe(false);
    expect(client.screenStream).toBeNull();
    expect(socket.framesOfType("publish")).toHaveLength(framesBefore);
    expect(client.lastProblem).toContain("This is a call");
  });

  it("applies the answer the room sends back", async () => {
    const { client, socket, peerConnection } = harness();
    await client.publish();
    socket.deliver({
      v: 1,
      type: "published",
      sessionDescription: { type: "answer", sdp: "unit-answer" },
      tracks: [],
    });
    await settle();

    expect(peerConnection.remoteDescription).toEqual({
      type: "answer",
      sdp: "unit-answer",
    });
  });
});

describe("the roster", () => {
  it("pulls a participant's tracks once, and never twice", async () => {
    const { socket } = harness();
    const roster = {
      v: 1,
      type: "roster",
      participants: [
        {
          participantId: "attendance_1",
          userId: "user_1",
          displayName: "You",
          sfuSessionId: "session_1",
          tracks: [{ trackName: "attendance_1:audio", kind: "audio" }],
        },
        {
          participantId: "attendance_2",
          userId: "user_2",
          displayName: "Rosalind Chase",
          sfuSessionId: "session_2",
          tracks: [
            { trackName: "attendance_2:audio", kind: "audio" },
            { trackName: "attendance_2:video", kind: "video" },
          ],
        },
      ],
    };
    socket.deliver(roster);
    await reconciled();

    // The camera carries the layer this page is worth; the microphone has no layer to name.
    const [subscribe] = socket.framesOfType("subscribe");
    expect(subscribe?.tracks).toEqual([
      {
        sessionId: "session_2",
        trackName: "attendance_2:video",
        preferredRid: "f",
      },
      { sessionId: "session_2", trackName: "attendance_2:audio" },
    ]);

    socket.deliver(roster);
    await reconciled();
    expect(socket.framesOfType("subscribe")).toHaveLength(1);
  });

  it("states everybody in the room, and every other participant separately", () => {
    const { client, socket } = harness();
    socket.deliver({
      v: 1,
      type: "roster",
      participants: [
        {
          participantId: "attendance_1",
          userId: "user_1",
          displayName: "You",
          sfuSessionId: null,
          tracks: [],
        },
        {
          participantId: "attendance_2",
          userId: "user_2",
          displayName: "Rosalind Chase",
          sfuSessionId: null,
          tracks: [],
        },
      ],
    });

    expect(client.participants).toHaveLength(2);
    expect(client.others.map((participant) => participant.displayName)).toEqual(["Rosalind Chase"]);
  });
});

describe("subscribing", () => {
  it("answers the unit's offer and keys the incoming stream by its participant", async () => {
    const { client, socket } = harness();
    socket.deliver({
      v: 1,
      type: "roster",
      participants: [
        {
          participantId: "attendance_2",
          userId: "user_2",
          displayName: "Rosalind Chase",
          sfuSessionId: "session_2",
          tracks: [{ trackName: "attendance_2:video", kind: "video" }],
        },
      ],
    });
    await reconciled();
    socket.deliver({
      v: 1,
      type: "subscribed",
      sessionDescription: { type: "offer", sdp: "unit-offer mids=7" },
      tracks: [{ sessionId: "session_2", trackName: "attendance_2:video", mid: "7" }],
    });
    await settle();

    const [renegotiate] = socket.framesOfType("renegotiate");
    expect(renegotiate?.sessionDescription).toEqual({
      type: "answer",
      sdp: "local-answer",
    });
    expect([...client.remoteStreams.keys()]).toEqual(["attendance_2"]);
    expect(client.remoteStreams.get("attendance_2")?.getTracks()).toHaveLength(1);
  });
});

/** A roster naming one other participant, with whichever unit session and tracks a case needs. */
function rosterOf(
  sfuSessionId: string | null,
  tracks: { trackName: string; kind: string }[],
): Record<string, unknown> {
  return {
    v: 1,
    type: "roster",
    participants: [
      {
        participantId: "attendance_2",
        userId: "user_2",
        displayName: "Rosalind Chase",
        sfuSessionId,
        tracks,
      },
    ],
  };
}

const HER_TRACKS = [
  { trackName: "attendance_2:audio", kind: "audio" },
  { trackName: "attendance_2:video", kind: "video" },
];

/** The unit answering a pull: an offer, and the media section each track arrives on. */
function subscribedFrame(sessionId: string, extra: Record<string, unknown> = {}) {
  return {
    v: 1,
    type: "subscribed",
    sessionDescription: { type: "offer", sdp: "unit-offer mids=7,8" },
    tracks: [
      { sessionId, trackName: "attendance_2:audio", mid: "7" },
      { sessionId, trackName: "attendance_2:video", mid: "8" },
    ],
    ...extra,
  };
}

describe("a participant who leaves and comes back", () => {
  it("is pulled again when the roster gives them a new unit session", async () => {
    const { client, socket } = harness();
    socket.deliver(rosterOf("session_2", HER_TRACKS));
    await reconciled();
    socket.deliver(subscribedFrame("session_2"));
    await settle();
    expect(client.remoteStreams.get("attendance_2")?.getTracks()).toHaveLength(2);

    // Same person, same attendance, same track NAMES — and a session that is not the one those
    // tracks were pulled from. Keyed on the name alone this is silently "already coming in", and
    // their tile is black for the rest of the meeting.
    socket.deliver(rosterOf("session_3", HER_TRACKS));
    await reconciled();

    const subscribes = socket.framesOfType("subscribe");
    expect(subscribes).toHaveLength(2);
    expect(subscribes[1]?.tracks).toEqual([
      {
        sessionId: "session_3",
        trackName: "attendance_2:video",
        preferredRid: "f",
      },
      { sessionId: "session_3", trackName: "attendance_2:audio" },
    ]);
    // The stream the dead session fed is let go, so the fresh tracks land on a stream whose first
    // video track is one that is actually arriving.
    expect(client.remoteStreams.has("attendance_2")).toBe(false);
  });

  it("stops holding the media of somebody the roster no longer names", async () => {
    const { client, socket } = harness();
    socket.deliver(
      rosterOf("session_2", [...HER_TRACKS, { trackName: "attendance_2:screen", kind: "screen" }]),
    );
    await reconciled();
    socket.deliver(subscribedFrame("session_2"));
    await settle();
    // The fake behind the typed stream, so the case can ask what a MediaStreamTrack cannot be
    // asked: whether the track was actually stopped rather than merely dropped.
    const held = client.remoteStreams.get("attendance_2") as unknown as FakeStream | undefined;
    expect(held?.getTracks()).toHaveLength(2);

    socket.deliver({ v: 1, type: "roster", participants: [] });

    expect(client.remoteStreams.size).toBe(0);
    expect(client.remoteScreens.size).toBe(0);
    expect(held?.getTracks().every((track) => track.stopped)).toBe(true);
  });
});

describe("a pull the unit did not serve", () => {
  it("un-marks the tracks when the room sends no offer at all", async () => {
    const { socket } = harness();
    socket.deliver(rosterOf("session_2", HER_TRACKS));
    await reconciled();
    socket.deliver({
      v: 1,
      type: "subscribed",
      sessionDescription: null,
      tracks: [
        { sessionId: "session_2", trackName: "attendance_2:audio", mid: null },
        { sessionId: "session_2", trackName: "attendance_2:video", mid: null },
      ],
    });
    await settle();

    // The same roster again: the tracks are asked for a second time rather than being counted as
    // already coming in for the rest of the meeting.
    socket.deliver(rosterOf("session_2", HER_TRACKS));
    await reconciled();
    expect(socket.framesOfType("subscribe")).toHaveLength(2);
  });

  it("un-marks them when the room says the pull needed no renegotiation", async () => {
    const { socket } = harness();
    socket.deliver(rosterOf("session_2", HER_TRACKS));
    await reconciled();
    socket.deliver(subscribedFrame("session_2", { requiresImmediateRenegotiation: false }));
    await settle();

    socket.deliver(rosterOf("session_2", HER_TRACKS));
    await reconciled();
    expect(socket.framesOfType("subscribe")).toHaveLength(2);
  });
});

describe("what the room refuses", () => {
  it("stays in the room, and states the refusal with the Error ID it carried", () => {
    const { client, socket } = harness();
    socket.deliver({
      v: 1,
      type: "refused",
      reason: "malformed-frame",
      errorId: "err_7f3a",
    });

    expect(client.state).toBe("live");
    expect(client.lastRefusal).toEqual({
      reason: "malformed-frame",
      errorId: "err_7f3a",
    });
  });

  it("ends the meeting for the two refusals that are the end of it", () => {
    const { client, socket } = harness();
    socket.deliver({ v: 1, type: "refused", reason: "not-a-participant" });

    expect(client.state).toBe("failed");
    expect(client.failureReason).toBe("not-a-participant");
  });

  it("asks again for the tracks a refused subscribe lost", async () => {
    const { client, socket } = harness();
    socket.deliver(rosterOf("session_2", HER_TRACKS));
    await reconciled();
    expect(socket.framesOfType("subscribe")).toHaveLength(1);

    socket.deliver({ v: 1, type: "refused", reason: "sfu-unavailable" });
    expect(client.state).toBe("live");

    socket.deliver(rosterOf("session_2", HER_TRACKS));
    await reconciled();
    expect(socket.framesOfType("subscribe")).toHaveLength(2);
  });

  it("survives a refusal about what this browser published, and says what it cost", () => {
    for (const reason of ["foreign-track-name", "track-limit-reached"]) {
      const { client, socket } = harness();
      socket.deliver({ v: 1, type: "refused", reason });

      expect(client.state).toBe("live");
      expect(client.lastRefusal?.reason).toBe(reason);
      // Its own sentence, not the catch-all: each of these says what is not being sent, which is
      // the one thing the member can act on.
      const statement = refusalStatement({ reason, errorId: null });
      expect(statement).not.toBe(refusalStatement({ reason: "something-else", errorId: null }));
      expect(statement).toMatch(/\.$/u);
    }
  });

  it("ends this session when the same member opens a newer one, and says which is which", async () => {
    const { client, socket, captured } = harness();
    await client.publish();

    socket.deliver({ v: 1, type: "refused", reason: "superseded" });

    expect(client.state).toBe("failed");
    expect(client.failureReason).toBe(SUPERSEDED_REASON);
    // Torn down like any other ending: the camera stops here, because the tab that superseded this
    // one is the one in the room now.
    expect(captured.getTracks().every((track) => track.stopped)).toBe(true);
    // It is the one fatal reason a member caused, so it is the one with words of its own.
    expect(refusalStatement({ reason: SUPERSEDED_REASON, errorId: null })).toContain(
      "another tab or window",
    );
  });

  it("states a picture refused by a call without ending it", () => {
    const { client, socket } = harness("attendance_1", "audio");
    socket.deliver({ v: 1, type: "refused", reason: "track-kind-refused" });

    expect(client.state).toBe("live");
    expect(client.lastRefusal?.reason).toBe("track-kind-refused");
    expect(refusalStatement({ reason: "track-kind-refused", errorId: null })).toContain(
      "only sound",
    );
  });

  it("does not ask again for somebody else's tracks over a refusal about its own", async () => {
    const { socket } = harness();
    socket.deliver(rosterOf("session_2", HER_TRACKS));
    await reconciled();
    expect(socket.framesOfType("subscribe")).toHaveLength(1);

    socket.deliver({ v: 1, type: "refused", reason: "track-limit-reached" });
    socket.deliver(rosterOf("session_2", HER_TRACKS));
    await reconciled();

    expect(socket.framesOfType("subscribe")).toHaveLength(1);
  });
});

describe("a participant whose media has gone quiet", () => {
  it("keeps their tile, with nothing in it, rather than taking the grid down", async () => {
    const { client, socket } = harness();
    socket.deliver(rosterOf("session_2", HER_TRACKS));
    await reconciled();
    socket.deliver(subscribedFrame("session_2"));
    await settle();
    expect(client.remoteStreams.has("attendance_2")).toBe(true);

    // The room keeps a dropped participant on the roster for about a minute, so this is the
    // ordinary shape of somebody whose connection went away: still named, nothing arriving.
    socket.deliver(rosterOf(null, []));

    const tiles = meetingTiles(client, "You");
    const hers = tiles.find((tile) => tile.key === "attendance_2");
    expect(hers?.stream).toBeNull();
    expect(hers?.microphoneOff).toBe(true);
    expect(sharedScreenTile(client, "You")).toBeNull();
  });
});

describe("the local controls", () => {
  it("mutes and unmutes the captured audio without recapturing", async () => {
    const { client, captured } = harness();
    await client.publish();

    client.toggleMicrophone();
    expect(client.microphoneOn).toBe(false);
    expect(captured.getAudioTracks()[0]?.enabled).toBe(false);

    client.toggleMicrophone();
    expect(client.microphoneOn).toBe(true);
    expect(captured.getAudioTracks()[0]?.enabled).toBe(true);
  });

  it("publishes a screen track under the screen name and closes it by its mid", async () => {
    const { client, socket, displayed } = harness();
    await client.publish();
    await client.shareScreen();

    const publishes = socket.framesOfType("publish");
    expect(publishes).toHaveLength(2);
    expect(publishes[1]?.tracks).toEqual([
      { trackName: "attendance_1:screen", mid: "2", kind: "screen" },
    ]);
    expect(client.sharing).toBe(true);

    await client.stopSharing();
    expect(client.sharing).toBe(false);
    expect(client.screenStream).toBeNull();
    expect(displayed.getVideoTracks()[0]?.stopped).toBe(true);
    expect(socket.framesOfType("close")[0]?.mids).toEqual(["2"]);
  });
});

describe("leaving", () => {
  it("tells the room, stops every local track, and closes the connection", async () => {
    const { client, socket, peerConnection, captured } = harness();
    await client.publish();

    client.leave();

    expect(socket.framesOfType("leave")).toHaveLength(1);
    expect(captured.getTracks().every((track) => track.stopped)).toBe(true);
    expect(peerConnection.closed).toBe(true);
    expect(socket.closed).toBe(true);
    expect(client.state).toBe("ended");
    expect(client.localStream).toBeNull();
  });

  it("tears down when the room says the meeting ended", async () => {
    const { client, socket, peerConnection, captured } = harness();
    await client.publish();

    socket.deliver({
      v: 1,
      type: "ended",
      endedAt: "2026-09-18T15:00:00.000Z",
    });

    expect(client.state).toBe("ended");
    expect(captured.getTracks().every((track) => track.stopped)).toBe(true);
    expect(peerConnection.closed).toBe(true);
  });

  it("fails with the room's reason when it refuses the member's own standing", () => {
    const { client, socket } = harness();
    socket.deliver({ v: 1, type: "refused", reason: "meeting-ended" });
    expect(client.state).toBe("failed");
    expect(client.failureReason).toBe("meeting-ended");
  });
});

describe("answering the unit", () => {
  it("sends the description the connection actually holds", async () => {
    const { socket } = harness();
    socket.deliver({
      v: 1,
      type: "subscribed",
      sessionDescription: { type: "offer", sdp: "unit-offer mids=7" },
      tracks: [{ sessionId: "session_2", trackName: "attendance_2:video", mid: "7" }],
    });
    await settle();

    // An answer sent under the type "offer" is refused by the unit and takes the whole
    // renegotiation with it, so the type is read off the connection rather than assumed.
    expect(socket.framesOfType("renegotiate")[0]?.sessionDescription).toEqual({
      type: "answer",
      sdp: "local-answer",
    });
  });

  it("treats a connection that cannot describe itself as a failed step", async () => {
    const { client, socket, peerConnection } = harness();
    peerConnection.forgetsLocalDescription = true;

    socket.deliver({
      v: 1,
      type: "subscribed",
      sessionDescription: { type: "offer", sdp: "unit-offer mids=7" },
      tracks: [{ sessionId: "session_2", trackName: "attendance_2:video", mid: "7" }],
    });
    await settle();

    expect(socket.framesOfType("renegotiate")).toHaveLength(0);
    expect(client.lastProblem).toBe("Somebody else's picture and sound did not come in.");
  });
});

describe("closing the tab", () => {
  it("closes the stay on a transport that survives the page, with the header a write needs", () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const send = ((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(new Response(null, { status: 200 }));
    }) as unknown as typeof fetch;

    leaveMeetingOnDeparture("meeting_1", send);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("/api/v1/meetings/meeting_1/leave");
    expect(calls[0]?.init.method).toBe("POST");
    // Without this the request is abandoned with the document, which is the whole reason a beacon
    // is not used — and a beacon could not carry the key below at all.
    expect(calls[0]?.init.keepalive).toBe(true);
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it("names the meeting in the path rather than letting it shape one", () => {
    const calls: string[] = [];
    const send = ((url: string) => {
      calls.push(url);
      return Promise.resolve(new Response(null, { status: 200 }));
    }) as unknown as typeof fetch;

    leaveMeetingOnDeparture("a/b", send);
    expect(calls[0]).toBe("/api/v1/meetings/a%2Fb/leave");
  });
});

describe("the keepalive", () => {
  it("sends the byte-exact ping on the interval and stays live while pongs come back", () => {
    vi.useFakeTimers();
    const { client, socket } = harness();

    vi.advanceTimersByTime(30_000);
    expect(socket.sent.filter((frame) => frame === '{"type":"ping"}')).toHaveLength(1);
    socket.deliver('{"type":"pong"}');

    vi.advanceTimersByTime(30_000);
    expect(socket.sent.filter((frame) => frame === '{"type":"ping"}')).toHaveLength(2);
    expect(client.state).toBe("live");
  });

  it("fails as socket-closed once pings go unanswered", () => {
    vi.useFakeTimers();
    const { client, socket } = harness();

    vi.advanceTimersByTime(30_000 * 3);
    expect(socket.sent.filter((frame) => frame === '{"type":"ping"}')).toHaveLength(2);
    expect(client.state).toBe("failed");
    expect(client.failureReason).toBe("socket-closed");
  });
});

/*
 * A large room: what it pulls, how it is told what changed, and who is talking. The four rules a
 * three-hundred-person meeting rests on, asserted one at a time.
 */

/** A roster of however many other people, each publishing a camera and a microphone. */
function many(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_unused, index) => {
    const participantId = `attendance_${index + 2}`;
    return {
      participantId,
      userId: `user_${index + 2}`,
      displayName: `Member ${index + 2}`,
      sfuSessionId: `session_${index + 2}`,
      tracks: [
        { trackName: `${participantId}:audio`, kind: "audio" },
        { trackName: `${participantId}:video`, kind: "video" },
      ],
    };
  });
}

/** One participant as a delta frame states them. */
function joiner(ordinal: number): Record<string, unknown> {
  const participantId = `attendance_${ordinal}`;
  return {
    participantId,
    userId: `user_${ordinal}`,
    displayName: `Member ${ordinal}`,
    sfuSessionId: `session_${ordinal}`,
    tracks: [{ trackName: `${participantId}:audio`, kind: "audio" }],
  };
}

/** The same participant with their hand up, as the roster carries it: the boolean and the instant. */
function withHand(
  participant: Record<string, unknown>,
  handRaisedAt: string,
): Record<string, unknown> {
  return { ...participant, hand: true, handRaisedAt };
}

/** A room of forty, with the first two cameras answered so their media sections are known. */
async function largeRoom(): Promise<Harness> {
  const harnessed = harness();
  harnessed.socket.deliver({ v: 1, type: "roster", participants: many(40) });
  await reconciled();
  harnessed.socket.deliver({
    v: 1,
    type: "subscribed",
    sessionDescription: { type: "offer", sdp: "unit-offer mids=7,8" },
    tracks: [
      { sessionId: "session_2", trackName: "attendance_2:video", mid: "7" },
      { sessionId: "session_3", trackName: "attendance_3:video", mid: "8" },
    ],
  });
  await settle();
  await reconciled();
  return harnessed;
}

describe("what a camera is published as", () => {
  it("offers three layers for the camera and one for the microphone", async () => {
    const { client, peerConnection } = harness();

    await client.publish();

    // A room of three hundred draws its tiles small, and the unit cannot make a small picture out
    // of a large one: the publisher sends all three sizes so each subscriber can name one.
    expect(peerConnection.offered).toEqual([
      { kind: "audio", sendEncodings: null },
      {
        kind: "video",
        sendEncodings: [
          { rid: "f", scale: 1 },
          { rid: "h", scale: 2 },
          { rid: "q", scale: 4 },
        ],
      },
    ]);
  });

  it("offers one layer for a screen share, because a quarter-size document is unreadable", async () => {
    const { client, peerConnection } = harness();
    await client.publish();

    await client.shareScreen();

    expect(peerConnection.offered[2]).toEqual({
      kind: "video",
      sendEncodings: null,
    });
  });
});

describe("a room that is told only what changed", () => {
  it("applies joined, updated and left, and lets go of the media of the departed", async () => {
    const { client, socket } = harness();
    socket.deliver(rosterOf("session_2", HER_TRACKS));
    await reconciled();
    socket.deliver(subscribedFrame("session_2"));
    await settle();
    expect(client.remoteStreams.has("attendance_2")).toBe(true);

    socket.deliver({
      v: 1,
      type: "roster-delta",
      joined: [joiner(3)],
      updated: [],
      left: [],
    });
    await reconciled();
    expect(client.participants.map((one) => one.participantId)).toEqual([
      "attendance_2",
      "attendance_3",
    ]);

    socket.deliver({
      v: 1,
      type: "roster-delta",
      joined: [],
      updated: [{ ...joiner(3), displayName: "Rosalind Chase" }],
      left: ["attendance_2"],
    });
    await reconciled();

    expect(client.participants.map((one) => one.displayName)).toEqual(["Rosalind Chase"]);
    expect(client.remoteStreams.has("attendance_2")).toBe(false);
  });

  it("asks for the whole roster once where a delta names somebody it has never heard of", async () => {
    const { socket } = harness();
    socket.deliver({ v: 1, type: "roster", participants: many(3) });
    await reconciled();
    // Nothing is asked for on the way in: `welcome` carried the whole room.
    expect(socket.framesOfType("sync")).toHaveLength(0);

    socket.deliver({
      v: 1,
      type: "roster-delta",
      joined: [],
      updated: [joiner(90)],
      left: [],
    });
    expect(socket.framesOfType("sync")).toHaveLength(1);

    // A second gap while the first is unanswered asks nothing: one hole and one question.
    socket.deliver({
      v: 1,
      type: "roster-delta",
      joined: [],
      updated: [],
      left: ["attendance_91"],
    });
    expect(socket.framesOfType("sync")).toHaveLength(1);

    // The full roster settles it, and the next gap is a fresh question.
    socket.deliver({ v: 1, type: "roster", participants: many(3) });
    socket.deliver({
      v: 1,
      type: "roster-delta",
      joined: [],
      updated: [],
      left: ["attendance_92"],
    });
    expect(socket.framesOfType("sync")).toHaveLength(2);
  });
});

describe("who is talking", () => {
  it("moves a speaker onto the first page, ahead of the roster's own order", async () => {
    const { client, socket } = harness();
    socket.deliver({ v: 1, type: "roster", participants: many(40) });
    await reconciled();
    expect(client.shown).not.toContain("attendance_39");

    socket.deliver({
      v: 1,
      type: "presence",
      participantId: "attendance_39",
      speaking: true,
      muted: false,
      at: "2026-09-20T15:00:00.000Z",
    });
    await reconciled();

    expect(client.shown[0]).toBe("attendance_39");
    // Who is talking is held BESIDE the roster rather than folded into it, so it is asked for
    // rather than read off a roster row — see the presence case further down.
    const speaker = client.participants.find((one) => one.participantId === "attendance_39");
    expect(speaker).toBeDefined();
    if (speaker === undefined) return;
    expect(client.presenceOf(speaker).speaking).toBe(true);
    // And their camera is now among the ones being pulled, which is the point of the re-ordering.
    const pulled = socket.framesOfType("subscribe").at(-1)?.tracks as {
      trackName: string;
    }[];
    expect(pulled.map((track) => track.trackName)).toContain("attendance_39:video");
  });

  it("tells the room when this browser starts and stops talking, and never twice over", async () => {
    const { client, socket, meter } = harness();
    await client.publish();
    expect(meter.started).toBe(true);

    meter.say(true);
    meter.say(true);
    meter.say(false);

    expect(socket.framesOfType("presence")).toEqual([
      { v: 1, type: "presence", speaking: true, muted: false },
      { v: 1, type: "presence", speaking: false, muted: false },
    ]);
  });

  it("says the microphone is off the moment it is muted, which nothing else could tell", async () => {
    const { client, socket, meter } = harness();
    await client.publish();
    meter.say(true);

    client.toggleMicrophone();
    client.toggleMicrophone();

    expect(socket.framesOfType("presence").slice(1)).toEqual([
      { v: 1, type: "presence", speaking: false, muted: true },
      { v: 1, type: "presence", speaking: false, muted: false },
    ]);
  });

  it("stops measuring when the meeting is left", async () => {
    const { client, meter } = harness();
    await client.publish();

    client.leave();

    expect(meter.stopped).toBe(true);
  });
});

describe("a raised hand on the wire", () => {
  it("rides the ORDINARY presence frame, stating all three facts", async () => {
    const { client, socket, meter } = harness();
    await client.publish();
    meter.say(true);

    expect(client.raiseHand()).toBe(true);

    // The three facts are measured by one browser about one person at one moment, so the hand does
    // not get a frame of its own — and the frame states the whole of what a presence frame is
    // about, rather than the one field that moved.
    expect(socket.framesOfType("presence").at(-1)).toEqual({
      v: 1,
      type: "presence",
      speaking: true,
      muted: false,
      hand: true,
    });
    expect(client.reactions.hand).toBe(true);
  });

  it("leaves the hand out of a frame that is only about the microphone", async () => {
    const { client, socket, meter } = harness();
    await client.publish();
    meter.say(true);

    // An ABSENT hand means "this browser has nothing to say about a hand", which is what keeps the
    // field additive: read as false, it would lower the hand of everybody who had not reloaded.
    expect(socket.framesOfType("presence").at(-1)).toEqual({
      v: 1,
      type: "presence",
      speaking: true,
      muted: false,
    });
  });

  it("names the stay a host lowers, and null for the whole room", () => {
    const { client, socket } = harness();

    client.lowerHands("attendance_2");
    client.lowerHands(null);

    // One act with different arguments rather than two frames whose invariants can drift apart.
    expect(socket.framesOfType("lower-hands")).toEqual([
      { v: 1, type: "lower-hands", participantId: "attendance_2" },
      { v: 1, type: "lower-hands", participantId: null },
    ]);
  });

  it("puts a host's OWN hand down with the rest, rather than sparing it", async () => {
    const { client } = harness();
    await client.publish();
    client.raiseHand();
    expect(client.reactions.hand).toBe(true);

    client.lowerHands(null);

    // The opposite of the mute-all rule, and deliberately so: mute-all exists so a host can speak,
    // and this exists so a host can start the queue again.
    expect(client.reactions.hand).toBe(false);
  });

  it("orders the queue by when each hand went up, never by roster order", () => {
    const { client, socket } = harness();
    socket.deliver({
      v: 1,
      type: "roster",
      participants: [
        withHand(joiner(2), "2026-09-20T15:05:00.000Z"),
        withHand(joiner(3), "2026-09-20T15:01:00.000Z"),
        joiner(4),
      ],
    });

    expect(client.raisedHands.map((hand) => hand.participantId)).toEqual([
      "attendance_3",
      "attendance_2",
    ]);
  });

  it("takes a hand off a presence frame and stamps it where the room stated none", () => {
    const { client, socket } = harness();
    socket.deliver({ v: 1, type: "roster", participants: [joiner(2)] });

    socket.deliver({
      v: 1,
      type: "presence",
      participantId: "attendance_2",
      speaking: false,
      muted: false,
      hand: true,
      at: "2026-09-20T15:00:00.000Z",
    });

    // The room's presence frame carries the boolean without the instant, so the queue is ordered
    // by the moment this browser learned of it rather than by nothing at all.
    expect(client.raisedHands.map((hand) => hand.participantId)).toEqual(["attendance_2"]);
    expect(client.raisedHands[0]?.handRaisedAt).not.toBeNull();
    // And a reader who cannot see the mark is told, because a hand is a request for the floor.
    expect(client.reactions.announcement).toBe("Member 2 raised their hand");
  });
});

describe("a reaction on the wire", () => {
  it("draws the sender's own bubble at once, without waiting for the room", async () => {
    const { client, socket } = harness();
    await client.publish();

    expect(client.react("thumbs-up")).toBe(true);

    expect(socket.framesOfType("reaction")).toEqual([
      { v: 1, type: "reaction", name: "thumbs-up" },
    ]);
    // The room does not echo a reaction to its sender, which is what makes the control feel like a
    // button rather than a request.
    expect(client.reactions.shown.get("attendance_1")?.map((one) => one.name)).toEqual([
      "thumbs-up",
    ]);
  });

  it("puts a relayed reaction on the right tile, and on nobody else's", () => {
    const { client, socket } = harness();
    socket.deliver({ v: 1, type: "roster", participants: [joiner(2), joiner(3)] });

    socket.deliver({
      v: 1,
      type: "reaction",
      participantId: "attendance_2",
      name: "applause",
      at: "2026-09-20T15:00:00.000Z",
    });

    expect(client.reactions.shown.get("attendance_2")?.map((one) => one.name)).toEqual([
      "applause",
    ]);
    expect(client.reactions.shown.has("attendance_3")).toBe(false);
    expect(client.reactions.announcement).toBe("Member 2 reacted: Well said");
  });

  it("draws the counts strip and no bubble at all when the room coalesces", () => {
    const { client, socket } = harness();
    socket.deliver({ v: 1, type: "roster", participants: [joiner(2)] });

    socket.deliver({
      v: 1,
      type: "reactions",
      counts: { applause: 11, "thumbs-up": 3, laugh: 0 },
      at: "2026-09-20T15:00:00.000Z",
    });

    // Above the threshold a bubble on the right face is a promise a sixteen-tile gallery cannot
    // keep, so what the reader gets is the number, in the vocabulary's own order and never a zero.
    expect(client.reactions.counts).toEqual([
      { name: "thumbs-up", count: 3 },
      { name: "applause", count: 11 },
    ]);
    expect(client.reactions.shown.size).toBe(0);
    // And the strip is not announced: a stream of changing counts read out is noise.
    expect(client.reactions.announcement).toBe("");
  });

  it("drops a reaction naming something outside the vocabulary", () => {
    const { client, socket } = harness();
    socket.deliver({ v: 1, type: "roster", participants: [joiner(2)] });

    socket.deliver({
      v: 1,
      type: "reaction",
      participantId: "attendance_2",
      name: "shrug",
      at: "2026-09-20T15:00:00.000Z",
    });

    expect(client.reactions.shown.size).toBe(0);
  });
});

describe("coming back after a host's mute", () => {
  it("reuses the microphone's own media section rather than adding one per cycle", async () => {
    const { client, socket, peerConnection } = harness();
    await client.publish();
    const afterPublish = peerConnection.transceivers.length;

    /** A host muting this browser, and the member turning their microphone back on. */
    const mutedAndBack = async (by: string): Promise<void> => {
      socket.deliver({ v: 1, type: "muted", by, at: "2026-09-20T15:00:00.000Z" });
      client.toggleMicrophone();
      await settle();
    };

    // Three times, one after another: the point is what the third return costs, and three cycles
    // run in parallel would be three renegotiations racing rather than a meeting.
    await mutedAndBack("attendance_9");
    await mutedAndBack("attendance_8");
    await mutedAndBack("attendance_7");

    /*
     * A meeting where a host mutes the room every few minutes is a meeting where one member comes
     * back many times, and a media section per return grows the session description without bound
     * — with every renegotiation after it carrying the whole accumulated list. The mid is also what
     * every later frame addresses the sound by.
     */
    expect(peerConnection.transceivers.length).toBe(afterPublish);
    const republished = socket.framesOfType("publish").slice(1);
    expect(republished).toHaveLength(3);
    for (const frame of republished) {
      expect(frame.tracks).toEqual([{ trackName: "attendance_1:audio", mid: "0", kind: "audio" }]);
    }
  });
});

describe("what a large room pulls", () => {
  it("pulls the page it is showing and the voices it can hear, and no more", async () => {
    const { client, socket } = harness();
    socket.deliver({ v: 1, type: "roster", participants: many(40) });
    await reconciled();

    const asked = socket.framesOfType("subscribe")[0]?.tracks as {
      trackName: string;
    }[];
    const cameras = asked.filter((track) => track.trackName.endsWith(":video"));
    const microphones = asked.filter((track) => track.trackName.endsWith(":audio"));
    expect(cameras).toHaveLength(16);
    expect(microphones).toHaveLength(24);
    expect(client.shown).toHaveLength(16);
    expect(client.pages).toBe(3);
  });

  it("closes the cameras of the page it has left, by their media sections", async () => {
    const { client, socket } = await largeRoom();

    client.setPage(1);
    await reconciled();

    expect(socket.framesOfType("close").at(-1)?.mids).toEqual(["7", "8"]);
    const asked = socket.framesOfType("subscribe").at(-1)?.tracks as {
      trackName: string;
    }[];
    expect(asked).toHaveLength(16);
    // The page changed, not who is audible: sound is ranked by who has been talking, never by what
    // happens to be on screen.
    expect(asked.every((track) => track.trackName.endsWith(":video"))).toBe(true);
    expect(client.page).toBe(1);
  });

  it("asks for a larger layer when the page turns into fewer tiles", async () => {
    const { client, socket } = await largeRoom();

    client.toggleSpeakerView();
    await reconciled();

    expect(socket.framesOfType("layer").at(-1)?.tracks).toEqual([
      {
        sessionId: "session_2",
        trackName: "attendance_2:video",
        mid: "7",
        preferredRid: "h",
      },
      {
        sessionId: "session_3",
        trackName: "attendance_3:video",
        mid: "8",
        preferredRid: "h",
      },
    ]);
  });

  it("sends one layer frame per change, not one per pass", async () => {
    const { client, socket } = await largeRoom();
    client.toggleSpeakerView();
    await reconciled();
    expect(socket.framesOfType("layer")).toHaveLength(1);

    socket.deliver({
      v: 1,
      type: "layered",
      tracks: [
        { mid: "7", preferredRid: "h" },
        { mid: "8", preferredRid: "h" },
      ],
    });
    socket.deliver({ v: 1, type: "roster", participants: many(40) });
    await reconciled();

    expect(socket.framesOfType("layer")).toHaveLength(1);
  });

  it("brings a pinned participant to the front, and the gallery back to the first page", async () => {
    const { client, socket } = harness();
    socket.deliver({ v: 1, type: "roster", participants: many(40) });
    await reconciled();
    client.setPage(1);
    await reconciled();

    client.pin("attendance_39");
    await reconciled();

    expect(client.page).toBe(0);
    expect(client.shown[0]).toBe("attendance_39");
    expect(client.isPinned("attendance_39")).toBe(true);

    client.unpin("attendance_39");
    await reconciled();
    expect(client.shown[0]).not.toBe("attendance_39");
  });
});

describe("what the passing of time does on its own", () => {
  it("ages a speaker out of the band, and closes what was being pulled for them", async () => {
    /*
     * The five-minute window the policy ages speakers against is the one input to the plan that
     * nothing in the room changes. Read straight off the system clock as the plan is worked out, it
     * only ever closes when something ELSE happens — so in a room that has gone quiet the last
     * person to say anything holds the front of the gallery, and the camera pulled for them stays
     * pulled, for the rest of the meeting.
     */
    // The clock itself is faked as well as the timers: what decays here is a span between two
    // readings of `Date.now()`, so a fake interval over a real clock would tick five minutes' worth
    // of times and never move the window at all.
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    const harnessed = await (async (): Promise<Harness> => {
      const opening = harness();
      opening.socket.deliver({ v: 1, type: "roster", participants: many(40) });
      await minutesPassed(opening, RECONCILE_DEBOUNCE_MILLISECONDS + 20);
      return opening;
    })();
    const { client, socket } = harnessed;

    // Somebody far down the roster says something, and stops. Nothing but the recent-speakers band
    // puts them on the first page: the roster's own order has them thirty-eighth.
    socket.deliver({
      v: 1,
      type: "presence",
      participantId: "attendance_39",
      speaking: true,
      muted: false,
      at: "2026-09-20T15:00:00.000Z",
    });
    socket.deliver({
      v: 1,
      type: "presence",
      participantId: "attendance_39",
      speaking: false,
      muted: false,
      at: "2026-09-20T15:00:04.000Z",
    });
    await minutesPassed(harnessed, RECONCILE_DEBOUNCE_MILLISECONDS + 20);

    expect(client.shown[0]).toBe("attendance_39");
    expect(client.plan.video.map((track) => track.participantId)).toContain("attendance_39");

    // The room answers the pull, so the media section their picture arrives on is known — which is
    // what closing it will name.
    socket.deliver({
      v: 1,
      type: "subscribed",
      sessionDescription: { type: "offer", sdp: "unit-offer mids=41" },
      tracks: [
        {
          sessionId: "session_39",
          trackName: "attendance_39:video",
          mid: "41",
        },
      ],
    });
    await settle();
    await minutesPassed(harnessed, RECONCILE_DEBOUNCE_MILLISECONDS + 20);

    // Six minutes of nothing at all: no frame, no roster, no gesture. Only the clock.
    await minutesPassed(harnessed, 6 * 60 * 1000);

    expect(client.shown).not.toContain("attendance_39");
    expect(client.plan.video.map((track) => track.participantId)).not.toContain("attendance_39");
    const closed = socket.framesOfType("close").flatMap((frame) => frame.mids as string[]);
    expect(closed).toContain("41");
  });
});

describe("a presence frame and the roster it is about", () => {
  it("leaves the roster exactly as it was, and still says who is talking", async () => {
    // Three hundred fresh participant objects per presence frame is three hundred rows re-rendered
    // to carry two booleans about one person, many times a second in a discussion.
    const { client, socket } = harness();
    socket.deliver({ v: 1, type: "roster", participants: many(40) });
    await reconciled();
    const roster = client.participants;

    socket.deliver({
      v: 1,
      type: "presence",
      participantId: "attendance_9",
      speaking: true,
      muted: false,
      at: "2026-09-20T15:00:00.000Z",
    });
    await reconciled();

    expect(client.participants).toBe(roster);
    const speaker = client.participants.find((one) => one.participantId === "attendance_9");
    expect(speaker).toBeDefined();
    if (speaker === undefined) return;
    // The fact still reached everything that draws it, by the route beside the roster.
    expect(client.presenceOf(speaker).speaking).toBe(true);
    expect(client.shown[0]).toBe("attendance_9");
  });
});

describe("what arrives before the room has said hello", () => {
  it("is ignored, rather than read as a roster with a hole in it", () => {
    /*
     * A `presence` or a delta landing before `welcome` names somebody the empty roster does not
     * hold, which is exactly the shape of a frame gone missing — so the browser asks for the whole
     * list again. Every browser joining at the top of the hour does that at once, over a roster
     * that was always about to arrive.
     */
    const { client, socket } = harness("attendance_1", "video", false);

    socket.deliver({
      v: 1,
      type: "presence",
      participantId: "attendance_9",
      speaking: true,
      muted: false,
      at: "2026-09-20T15:00:00.000Z",
    });
    socket.deliver({
      v: 1,
      type: "roster-delta",
      joined: [],
      updated: [],
      left: ["attendance_9"],
    });

    expect(socket.framesOfType("sync")).toHaveLength(0);
    expect(client.state).toBe("joining");

    socket.deliver({
      v: 1,
      type: "welcome",
      participantId: "attendance_1",
      roster: many(3),
    });
    expect(client.state).toBe("live");
    expect(client.participants).toHaveLength(3);
  });

  it("lets through the frames that are about the socket rather than the room", () => {
    // A room that refuses the join, or that ends under a socket waiting for its welcome, has to be
    // heard: those are the reasons the welcome is never coming.
    const { client, socket } = harness("attendance_1", "video", false);
    socket.deliver({
      v: 1,
      type: "refused",
      reason: "not-a-participant",
      errorId: "err_1",
    });

    expect(client.state).toBe("failed");
    expect(client.failureReason).toBe("not-a-participant");
  });
});

describe("a room speaking a protocol this page does not", () => {
  it("stops, rather than reading every frame after it against the wrong shape", () => {
    const { client, socket } = harness();

    socket.deliver({ v: 2, type: "roster", participants: many(3) });

    expect(client.state).toBe("failed");
    expect(client.failureReason).toBe(PROTOCOL_MISMATCH_REASON);
    // Nothing of the frame was applied. A field that moved reads as a field that is missing, so a
    // roster read against the wrong shape is worse than no roster at all.
    expect(client.participants).toHaveLength(0);
  });
});

describe("a frame the room could not read", () => {
  it("un-marks the tracks it asked for, so the next roster asks again", async () => {
    const { client, socket } = harness();
    socket.deliver({ v: 1, type: "roster", participants: many(3) });
    await reconciled();
    const first = socket.framesOfType("subscribe");
    expect(first).toHaveLength(1);

    // The room could not read the frame, so nothing it named is coming. Left marked as pulled,
    // those tiles stay black for the rest of the meeting and nothing asks again.
    socket.deliver({
      v: 1,
      type: "refused",
      reason: "malformed-frame",
      errorId: "err_1",
    });
    expect(client.state).toBe("live");

    socket.deliver({ v: 1, type: "roster", participants: many(3) });
    await reconciled();

    const asked = socket.framesOfType("subscribe");
    expect(asked).toHaveLength(2);
    expect(trackNamesOf(asked[1])).toEqual(trackNamesOf(first[0]));
  });
});

describe("keeping people on screen", () => {
  it("refuses a pin past the camera cap rather than pinning somebody nothing will draw", async () => {
    // A seventeenth pin is somebody the first page cannot draw and the connection will not fetch:
    // they would sit pinned, off every page, with nothing coming in — which reads as the control
    // having silently failed.
    const { client, socket } = harness();
    socket.deliver({ v: 1, type: "roster", participants: many(40) });
    await reconciled();

    for (let ordinal = 2; ordinal < 2 + MAX_VIDEO_SUBSCRIPTIONS; ordinal += 1) {
      client.pin(`attendance_${ordinal}`);
    }
    expect(client.pinned).toHaveLength(MAX_VIDEO_SUBSCRIPTIONS);
    expect(client.lastProblem).toBeNull();

    client.pin("attendance_30");
    expect(client.pinned).toHaveLength(MAX_VIDEO_SUBSCRIPTIONS);
    expect(client.pinned).not.toContain("attendance_30");
    expect(client.lastProblem).toContain("kept on screen");
  });
});

/*
 * A frame the room will not take is a frame that did nothing, and every track it named is a tile
 * that stays black for the rest of the meeting. The room caps a `subscribe` at
 * `MAX_SUBSCRIBE_TRACKS` and a `close` at `MAX_CLOSE_MIDS` and refuses a larger one WHOLE, so the
 * caps are held here rather than being trusted to stay comfortably out of reach — which is exactly
 * what a page turn in a full room stops being.
 *
 * It is driven against the subscriptions module directly rather than through the client, because
 * the policy caps what this browser can ever want at sixteen cameras and twenty-four microphones:
 * a client can never be made to want seventy tracks, and a cap nothing can reach is a cap nothing
 * tests.
 */
describe("a frame larger than the room will take", () => {
  /** A plan of however many cameras, which is more than any policy would ever produce. */
  function planOf(count: number): SubscriptionPlan {
    return {
      video: Array.from({ length: count }, (_unused, index) => ({
        sessionId: `session_${index}`,
        trackName: `attendance_${index}:video`,
        participantId: `attendance_${index}`,
        preferredRid: "f" as const,
      })),
      screen: null,
      audio: [],
      shown: [],
      pages: 1,
    };
  }

  function driven(plan: SubscriptionPlan): {
    subscriptions: MeetingSubscriptions;
    frames: Record<string, unknown>[];
  } {
    const frames: Record<string, unknown>[] = [];
    let current = plan;
    const subscriptions = new MeetingSubscriptions({
      plan: () => current,
      isLive: () => true,
      send: (frame) => frames.push(frame),
      attachRemoteTrack: () => {},
      detachRemoteTrack: () => {},
      releaseRemote: () => {},
      remoteOwners: () => [],
    });
    return {
      subscriptions: Object.assign(subscriptions, {
        want: (next: SubscriptionPlan) => {
          current = next;
        },
      }),
      frames,
    };
  }

  it("asks for seventy tracks in two frames, and names every one of them", () => {
    const { subscriptions, frames } = driven(planOf(70));

    subscriptions.reconcile();

    const asked = frames.filter((frame) => frame.type === "subscribe");
    expect(asked).toHaveLength(2);
    expect((asked[0]?.tracks as unknown[]).length).toBe(MAX_SUBSCRIBE_TRACKS);
    expect((asked[1]?.tracks as unknown[]).length).toBe(70 - MAX_SUBSCRIBE_TRACKS);
    const named = asked.flatMap((frame) => trackNamesOf(frame));
    expect(new Set(named).size).toBe(70);
  });

  it("closes seventy media sections in two frames", () => {
    const { subscriptions, frames } = driven(planOf(70));
    subscriptions.reconcile();
    // The room answers, so every track has a media section that closing it can name.
    for (let index = 0; index < 70; index += 1) {
      subscriptions.noteArrival(
        {
          sessionId: `session_${index}`,
          trackName: `attendance_${index}:video`,
          mid: String(index),
        },
        String(index),
        { stop: () => {} } as unknown as MediaStreamTrack,
      );
    }

    (subscriptions as unknown as { want: (plan: SubscriptionPlan) => void }).want(planOf(0));
    subscriptions.reconcile();

    const closed = frames.filter((frame) => frame.type === "close");
    expect(closed).toHaveLength(2);
    expect((closed[0]?.mids as string[]).length).toBe(MAX_CLOSE_MIDS);
    expect((closed[1]?.mids as string[]).length).toBe(70 - MAX_CLOSE_MIDS);
  });
});

describe("a layer change the room never answered", () => {
  it("is asked for again, because a frame sent is not a frame applied", async () => {
    // The room drops a `layer` frame that follows too closely on the last one. Recorded as settled
    // the moment it went out, that dropped frame is never sent again and the tile sits at the wrong
    // size until something unrelated happens to move it.
    const { client, socket } = await largeRoom();

    client.toggleSpeakerView();
    await reconciled();
    expect(socket.framesOfType("layer")).toHaveLength(1);

    // Nothing answered. The next pass asks again.
    socket.deliver({ v: 1, type: "roster", participants: many(40) });
    await reconciled();
    expect(socket.framesOfType("layer")).toHaveLength(2);

    // The room says what it is now sending, which is what settles it.
    socket.deliver({
      v: 1,
      type: "layered",
      tracks: [
        { mid: "7", preferredRid: "h" },
        { mid: "8", preferredRid: "h" },
      ],
    });
    socket.deliver({ v: 1, type: "roster", participants: many(40) });
    await reconciled();
    expect(socket.framesOfType("layer")).toHaveLength(2);
  });
});

describe("a sync the room never answered", () => {
  it("lets the next gap ask again, rather than being latched shut for the meeting", () => {
    // The room drops a `sync` that follows too closely on the last one, so three hundred browsers
    // meeting one missing frame cannot ask for three hundred rosters at once. A latch cleared only
    // by the roster that answers is then permanent for exactly that case.
    vi.useFakeTimers();
    const { socket } = harness();

    socket.deliver({
      v: 1,
      type: "roster-delta",
      joined: [],
      updated: [],
      left: ["attendance_90"],
    });
    expect(socket.framesOfType("sync")).toHaveLength(1);

    // A second gap inside the window still asks nothing: one hole, one question.
    socket.deliver({
      v: 1,
      type: "roster-delta",
      joined: [],
      updated: [],
      left: ["attendance_91"],
    });
    expect(socket.framesOfType("sync")).toHaveLength(1);

    vi.advanceTimersByTime(SYNC_LATCH_MILLISECONDS + 100);
    socket.deliver({
      v: 1,
      type: "roster-delta",
      joined: [],
      updated: [],
      left: ["attendance_92"],
    });
    expect(socket.framesOfType("sync")).toHaveLength(2);
  });
});

describe("a roster row about somebody who has rejoined", () => {
  it("is taken as current, so a stale speaking mark cannot outlive the frame that set it", async () => {
    /*
     * The room composes a roster row out of the presence it holds at the instant it sends it, and
     * on a rejoin it RESETS what it was holding. Held apart and never overwritten, the browser's
     * own `speaking: true` from before the drop kept that person at the front of the gallery, with
     * their microphone pulled, for the rest of the meeting — which is the failure the presence map
     * exists to avoid, arriving by the other door.
     */
    const { client, socket } = harness();
    socket.deliver({ v: 1, type: "roster", participants: many(3) });
    await reconciled();

    socket.deliver({
      v: 1,
      type: "presence",
      participantId: "attendance_2",
      speaking: true,
      muted: false,
      at: "2026-09-20T15:00:00.000Z",
    });
    const speaker = client.participants.find((one) => one.participantId === "attendance_2");
    expect(speaker).toBeDefined();
    if (speaker === undefined) return;
    expect(client.presenceOf(speaker).speaking).toBe(true);

    socket.deliver({
      v: 1,
      type: "roster-delta",
      joined: [],
      updated: [{ ...joiner(2), speaking: false, muted: true }],
      left: [],
    });
    await reconciled();

    const rejoined = client.participants.find((one) => one.participantId === "attendance_2");
    expect(rejoined).toBeDefined();
    if (rejoined === undefined) return;
    expect(client.presenceOf(rejoined).speaking).toBe(false);
    expect(client.presenceOf(rejoined).muted).toBe(true);
  });

  it("leaves everybody the frame did not name exactly as they were", async () => {
    // A delta carries only what joined or changed; the rest of the merged list is rows from an
    // earlier frame. Reading those as fresh would wipe live presence with minutes-old booleans
    // every time anybody in a three-hundred-person room arrived.
    const { client, socket } = harness();
    socket.deliver({ v: 1, type: "roster", participants: many(3) });
    await reconciled();
    socket.deliver({
      v: 1,
      type: "presence",
      participantId: "attendance_2",
      speaking: true,
      muted: false,
      at: "2026-09-20T15:00:00.000Z",
    });

    socket.deliver({
      v: 1,
      type: "roster-delta",
      joined: [joiner(9)],
      updated: [],
      left: [],
    });
    await reconciled();

    const talking = client.participants.find((one) => one.participantId === "attendance_2");
    expect(talking).toBeDefined();
    if (talking === undefined) return;
    expect(client.presenceOf(talking).speaking).toBe(true);
  });
});

/*
 * RUNNING THE MEETING FROM INSIDE IT.
 *
 * Every case below is about a directive that reaches somebody else's browser, or about what this
 * one does when a directive reaches it — which is the half that cannot be got right by inspection.
 * A host's mute closes the track at the routing service, so coming back is a republish and not a
 * flag; a request to unmute must change nothing at all until the member answers it; and a removal
 * is the end of this browser's meeting with no way back in.
 */

/** A roster naming this browser and one other person, with whatever grants a case is about. */
function rosterWithRoles(
  own: "host" | "co-host" | null,
  hers: "host" | "co-host" | null = null,
): Record<string, unknown> {
  return {
    v: 1,
    type: "roster",
    participants: [
      {
        participantId: "attendance_1",
        userId: "user_1",
        displayName: "You",
        sfuSessionId: "session_1",
        tracks: [],
        hostRole: own,
      },
      {
        participantId: "attendance_2",
        userId: "user_2",
        displayName: "Rosalind Chase",
        sfuSessionId: "session_2",
        tracks: HER_TRACKS,
        hostRole: hers,
      },
    ],
  };
}

describe("the directives a host sends", () => {
  it("names the stay on the wire, one frame per act", () => {
    const { client, socket } = harness();

    client.mute("attendance_2");
    client.muteAll();
    client.askToUnmute("attendance_2");
    client.spotlight("attendance_2");
    client.spotlight(null);

    expect(socket.framesOfType("mute")).toEqual([
      { v: 1, type: "mute", participantId: "attendance_2" },
    ]);
    expect(socket.framesOfType("mute-all")).toEqual([{ v: 1, type: "mute-all" }]);
    expect(socket.framesOfType("ask-to-unmute")).toEqual([
      { v: 1, type: "ask-to-unmute", participantId: "attendance_2" },
    ]);
    // Clearing is the same frame with nothing named, rather than a second frame type: the room
    // holds one fact and this replaces it.
    expect(socket.framesOfType("spotlight")).toEqual([
      { v: 1, type: "spotlight", participantId: "attendance_2" },
      { v: 1, type: "spotlight", participantId: null },
    ]);
  });
});

describe("who is running the meeting", () => {
  it("is read off the roster, so a grant written mid-meeting arrives with the next one", () => {
    const { client, socket } = harness();
    expect(client.myRole).toBeNull();
    expect(client.hosting).toBe(false);

    socket.deliver(rosterWithRoles("co-host", "host"));

    expect(client.myRole).toBe("co-host");
    expect(client.hosting).toBe(true);
    expect(client.others[0]?.hostRole).toBe("host");

    // Withdrawn, and the badge and every menu behind it go on the next roster rather than on a
    // reload: the room rewrites its stored roles and broadcasts.
    socket.deliver(rosterWithRoles(null, "host"));
    expect(client.myRole).toBeNull();
    expect(client.hosting).toBe(false);
  });
});

describe("what the room says about itself", () => {
  it("arrives on the welcome, because a new socket has nothing to apply a change to", () => {
    const socket = new FakeSocket();
    const seams = {
      createPeerConnection: () => new FakePeerConnection(),
      openSocket: () => socket,
      getUserMedia: () => Promise.resolve(new FakeStream([])),
      getDisplayMedia: () => Promise.resolve(new FakeStream([])),
      createMediaStream: () => new FakeStream([]),
      createAudioLevelMeter: () => new FakeAudioLevelMeter(),
    } as unknown as MeetingClientSeams;
    const client = new MeetingClient(seams);
    opened.push(client);
    client.join({
      meetingId: "meeting_1",
      participantId: "attendance_1",
      iceServers: [],
      socketUrl: "wss://example.test/socket",
    });
    socket.accept();
    socket.deliver({
      v: 1,
      type: "welcome",
      participantId: "attendance_1",
      roster: [],
      roomState: {
        spotlight: {
          participantId: "attendance_2",
          by: "attendance_9",
          at: "2026-09-20T10:00:00.000Z",
        },
        locked: true,
      },
    });

    expect(client.roomState.locked).toBe(true);
    expect(client.roomState.spotlight?.participantId).toBe("attendance_2");
  });

  it("is replaced whole by each room-state frame, and orders the gallery by it", async () => {
    const { client, socket } = harness();
    socket.deliver(rosterOf("session_2", HER_TRACKS));
    await reconciled();

    socket.deliver({
      v: 1,
      type: "room-state",
      spotlight: {
        participantId: "attendance_2",
        by: "attendance_1",
        at: "2026-09-20T10:00:00.000Z",
      },
      locked: false,
    });

    expect(client.roomState.spotlight?.participantId).toBe("attendance_2");
    expect(client.shown[0]).toBe("attendance_2");
    // The mark the tile draws comes from the same fact, so the order and the mark cannot disagree.
    expect(
      meetingTiles(client, "You").find((tile) => tile.key === "attendance_2")?.spotlighted,
    ).toBe(true);

    socket.deliver({ v: 1, type: "room-state", spotlight: null, locked: true });

    expect(client.roomState.spotlight).toBeNull();
    expect(client.roomState.locked).toBe(true);
  });
});

describe("a host muting this browser", () => {
  it("says what happened rather than leaving a microphone dead with nothing on screen", async () => {
    const { client, captured, socket } = harness();
    await client.publish();
    expect(client.microphoneOn).toBe(true);

    socket.deliver({ v: 1, type: "muted", by: "attendance_9", at: "2026-09-20T10:00:00.000Z" });

    expect(client.microphoneOn).toBe(false);
    expect(client.lastNotice).toBe("A host muted you.");
    expect(client.mutedBy?.by).toBe("attendance_9");
    // The device stops feeding a track that no longer goes anywhere.
    expect(captured.getAudioTracks()[0]?.enabled).toBe(false);
    // And the room is told this browser is muted, which is what every other tile draws from.
    expect(socket.framesOfType("presence").at(-1)).toMatchObject({ speaking: false, muted: true });
  });

  it("REPUBLISHES on the way back, because the track is gone and not merely silent", async () => {
    const { client, socket, captured } = harness();
    await client.publish();
    expect(socket.framesOfType("publish")).toHaveLength(1);

    socket.deliver({ v: 1, type: "muted", by: "attendance_9", at: "2026-09-20T10:00:00.000Z" });
    client.toggleMicrophone();
    await settle();

    // A second offer naming this browser's own microphone, on the media section it always went up.
    // A client that only flipped `enabled` would sit showing itself as sending with nobody able to
    // hear it for the rest of the meeting, and nothing anywhere would say so — and a client that
    // ADDED a section per return would grow the description for as long as the meeting ran.
    const publishes = socket.framesOfType("publish");
    expect(publishes).toHaveLength(2);
    expect(publishes[1]?.tracks).toEqual([
      { trackName: "attendance_1:audio", mid: "0", kind: "audio" },
    ]);
    expect(client.microphoneOn).toBe(true);
    expect(captured.getAudioTracks()[0]?.enabled).toBe(true);
    expect(client.lastNotice).toBeNull();

    // And the member's OWN mute afterwards is still the cheap one: nothing renegotiates.
    client.toggleMicrophone();
    client.toggleMicrophone();
    await settle();
    expect(socket.framesOfType("publish")).toHaveLength(2);
  });
});

describe("a host asking this browser to unmute", () => {
  it("changes nothing at all until the member answers", async () => {
    const { client, socket, captured } = harness();
    await client.publish();
    client.toggleMicrophone();
    expect(client.microphoneOn).toBe(false);

    socket.deliver({
      v: 1,
      type: "unmute-requested",
      by: "attendance_9",
      at: "2026-09-20T10:00:00.000Z",
    });

    // The question is on the screen and the microphone is exactly where the member left it. There
    // is no frame in this protocol that could do otherwise, and that absence is the design.
    expect(client.unmuteRequest?.by).toBe("attendance_9");
    expect(client.microphoneOn).toBe(false);
    expect(captured.getAudioTracks()[0]?.enabled).toBe(false);

    client.declineUnmuteRequest();
    expect(client.unmuteRequest).toBeNull();
    expect(client.microphoneOn).toBe(false);
  });

  it("is answered by the ordinary control, which clears the question", async () => {
    const { client, socket } = harness();
    await client.publish();
    client.toggleMicrophone();
    socket.deliver({
      v: 1,
      type: "unmute-requested",
      by: "attendance_9",
      at: "2026-09-20T10:00:00.000Z",
    });

    client.toggleMicrophone();

    expect(client.microphoneOn).toBe(true);
    expect(client.unmuteRequest).toBeNull();
  });
});

describe("a directive from somebody holding no grant", () => {
  it("is a notice and not the end of anything, and not a fault in the wire either", () => {
    const { client, socket } = harness();

    socket.deliver({ v: 1, type: "refused", reason: "not-host" });

    expect(client.state).toBe("live");
    expect(client.lastNotice).toContain("not running this meeting");
    // Deliberately NOT the band that reports a frame the room could not read: nothing is wrong with
    // this browser, and the member is still in the meeting.
    expect(client.lastRefusal).toBeNull();
  });
});

describe("a host putting this member out of the meeting", () => {
  it("ends it here, and there is nothing to retry", async () => {
    const { client, socket, peerConnection, captured } = harness();
    await client.publish();

    socket.deliver({ v: 1, type: "refused", reason: "removed" });

    expect(client.state).toBe("failed");
    expect(client.failureReason).toBe("removed");
    // Torn down like any other ending: the record says they are not in the room, and the join path
    // refuses them while the meeting runs.
    expect(captured.getTracks().every((track) => track.stopped)).toBe(true);
    expect(peerConnection.closed).toBe(true);
  });
});

/*
 * WAITING AT THE DOOR.
 *
 * The case that cannot be got right by inspection is the camera: a browser that captured while
 * somebody stood outside a room would light the device's own indicator for a person who is not in
 * any meeting, and nothing on their screen would say why. So the door's own standing is asserted
 * first, and the publish that follows an admission is asserted to be the one that was refused at it.
 */

/** A waiting stay: the socket is open, the room has said nothing but where they stand. */
function atTheDoor(): Harness {
  return harness("attendance_1", "video", false, true);
}

describe("a join that put this stay at the door", () => {
  it("opens the socket and captures NOTHING", async () => {
    const { client, socket } = atTheDoor();

    expect(client.state).toBe("waiting");
    await client.publish();

    // No capture, no offer, no media section. The screen asks for a publish on every arrival, so
    // the refusal has to live here rather than in a branch some surface remembers to write.
    expect(client.localStream).toBeNull();
    expect(socket.framesOfType("publish")).toHaveLength(0);
  });

  it("takes its place from the lobby frame, and states who is ahead", () => {
    const { client, socket } = atTheDoor();

    socket.deliver({
      v: 1,
      type: "lobby",
      position: 3,
      waiting: 4,
      at: "2026-09-20T15:00:00.000Z",
    });

    expect(client.waiting).toEqual({
      position: 3,
      waiting: 4,
      at: "2026-09-20T15:00:00.000Z",
    });
    expect(waitingPlaceStatement(client.waiting)).toBe("2 people are ahead of you.");

    // Re-sent whole as the queue moves, and replaced rather than merged.
    socket.deliver({
      v: 1,
      type: "lobby",
      position: 1,
      waiting: 1,
      at: "2026-09-20T15:01:00.000Z",
    });
    expect(client.waiting?.position).toBe(1);
    // Nobody is ahead of the person at the front, and a line saying so says nothing.
    expect(waitingPlaceStatement(client.waiting)).toBeNull();
  });

  it("publishes on the welcome that follows an admission, as if it had just joined", async () => {
    const { client, socket } = atTheDoor();
    socket.deliver({
      v: 1,
      type: "lobby",
      position: 1,
      waiting: 1,
      at: "2026-09-20T15:00:00.000Z",
    });

    socket.deliver({ v: 1, type: "admitted", at: "2026-09-20T15:02:00.000Z" });
    // Two frames with one job each, so the welcome handler is the handler it has always been.
    socket.deliver({ v: 1, type: "welcome", participantId: "attendance_1", roster: [] });
    await settle();

    expect(client.state).toBe("live");
    expect(client.waiting).toBeNull();
    const [publish] = socket.framesOfType("publish");
    expect(publish?.tracks).toEqual([
      { trackName: "attendance_1:audio", mid: "0", kind: "audio" },
      { trackName: "attendance_1:video", mid: "1", kind: "video" },
    ]);
  });

  it("may still give up, which is one of the two frames a waiting socket may send", () => {
    const { client, socket } = atTheDoor();

    client.leave();

    expect(socket.framesOfType("leave")).toHaveLength(1);
    expect(client.state).toBe("ended");
  });
});

describe("a host turning somebody away at the door", () => {
  it("is fatal, and says so in words of its own", () => {
    const { client, socket } = atTheDoor();

    socket.deliver({ v: 1, type: "refused", reason: DENIED_REASON });

    expect(client.state).toBe("failed");
    expect(client.failureReason).toBe(DENIED_REASON);
    // The twin of a removal and barred on the same terms, so the sentence has to say there is no
    // way back in rather than reading as one more thing the room refused.
    expect(refusalStatement({ reason: DENIED_REASON, errorId: null })).toBe(DENIED_STATEMENT);
    expect(DENIED_STATEMENT).toContain("cannot come back");
  });
});

describe("a frame from a socket that is still waiting", () => {
  it("is a notice, and leaves them exactly where they were", () => {
    const { client, socket } = atTheDoor();

    socket.deliver({ v: 1, type: "refused", reason: "not-admitted" });

    expect(client.state).toBe("waiting");
    expect(client.lastNotice).toContain("still waiting");
    // Deliberately NOT the band that reports a frame the room could not read: nothing is wrong with
    // this browser, and the door may still open.
    expect(client.lastRefusal).toBeNull();
  });
});

describe("who is at the door, for a host", () => {
  it("rides on the welcome and is replaced whole by each waiting frame", () => {
    const { client, socket } = harness("attendance_1", "video", false);

    socket.deliver({
      v: 1,
      type: "welcome",
      participantId: "attendance_1",
      roster: [],
      waiting: [
        {
          participantId: "attendance_7",
          userId: "usr_7",
          displayName: "Rosalind Chase",
          waitingFrom: "2026-09-20T15:00:00.000Z",
        },
      ],
    });
    expect(client.lobbyList.map((one) => one.displayName)).toEqual(["Rosalind Chase"]);

    socket.deliver({
      v: 1,
      type: "waiting",
      participants: [
        {
          participantId: "attendance_7",
          userId: "usr_7",
          displayName: "Rosalind Chase",
          waitingFrom: "2026-09-20T15:00:00.000Z",
        },
        {
          participantId: "attendance_8",
          userId: "usr_8",
          displayName: "Theodore Vance",
          waitingFrom: "2026-09-20T15:01:00.000Z",
        },
      ],
    });
    expect(client.lobbyList).toHaveLength(2);

    // Whole rather than as a difference: an emptied door is an empty list, not an absent frame.
    socket.deliver({ v: 1, type: "waiting", participants: [] });
    expect(client.lobbyList).toHaveLength(0);
  });

  it("takes a read of the door as well, for a grant written after the last arrival", () => {
    // A member named co-host at the twentieth minute is sent the roster that says so and nothing
    // about the people already standing outside, because the room sends the list as they ARRIVE.
    const { client } = harness();

    client.noteWhoIsWaiting([
      {
        participantId: "attendance_7",
        userId: "usr_7",
        displayName: "Rosalind Chase",
        waitingFrom: "2026-09-20T15:00:00.000Z",
        kind: "member",
        invitedName: null,
      },
    ]);

    expect(client.lobbyList).toHaveLength(1);
  });
});

/**
 * A stage that captures with the pass-through's constraints and does what the case says with the
 * stream, so a case can ask what the client did with whatever the stage handed back.
 */
function stageThat(apply: (stream: MediaStream) => Promise<EffectedCapture>): MediaEffectsStage {
  const passing = passThroughEffects();
  return {
    captureConstraints: (medium, settings) => passing.captureConstraints(medium, settings),
    applyEffects: (stream) => apply(stream),
  };
}

describe("capture, then effects, then publish", () => {
  it("asks for the microphone's treatment by name, as plain booleans", async () => {
    const { client, askedFor } = harness();
    await client.publish();

    expect(askedFor).toHaveLength(1);
    expect(askedFor[0]?.audio).toEqual({
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: true,
    });
    expect(JSON.stringify(askedFor[0])).not.toContain("exact");
  });

  it("asks a call for no camera", async () => {
    const { client, askedFor } = harness("attendance_1", "audio");
    await client.publish();
    expect(askedFor[0]?.video).toBe(false);
  });

  it("captures with the member's own choice where they changed it before the capture", async () => {
    const { client, askedFor } = harness();
    await client.changeEffects({ background: "none", reduceNoise: false });
    await client.publish();
    expect(askedFor[0]?.audio).toHaveProperty("noiseSuppression", false);
  });

  it("publishes what the stage handed back, not what was captured", async () => {
    const processedAudio = new FakeTrack("audio");
    const processedVideo = new FakeTrack("video");
    const processed = new FakeStream([processedAudio, processedVideo]);
    const stage = stageThat(async () => ({
      stream: processed as unknown as MediaStream,
      applied: {
        audio: {
          noiseSuppression: true,
          echoCancellation: true,
          autoGainControl: true,
          voiceIsolation: null,
        },
        blur: "on",
        platformBlur: null,
        refusal: null,
      },
      update: () => Promise.reject(new Error("not asked")),
      setSourceEnabled: () => {},
      close: () => {},
    }));
    const { client, socket, peerConnection } = harness("attendance_1", "video", true, false, stage);

    await client.publish();

    expect(client.localStream).toBe(processed);
    expect(client.appliedEffects?.blur).toBe("on");
    // The connection carries the stage's tracks: what the room is offered is what was processed.
    expect(peerConnection.transceivers.map((transceiver) => transceiver.sender.track)).toEqual([
      processedAudio,
      processedVideo,
    ]);
    expect(socket.framesOfType("publish")).toHaveLength(1);
  });

  it("publishes the capture unprocessed where the stage throws, rather than not at all", async () => {
    const stage = stageThat(() => Promise.reject(new Error("the stage fell over")));
    const { client, socket, captured } = harness("attendance_1", "video", true, false, stage);

    await client.publish();

    expect(client.localStream).toBe(captured);
    expect(client.captureRefusal).toBeNull();
    expect(client.appliedEffects?.refusal).toBe(
      "Your sound and picture are being sent as captured, without the effects you chose.",
    );
    expect(socket.framesOfType("publish")).toHaveLength(1);
  });

  it("asks the capture to change, and shows what the tracks said rather than what was asked", async () => {
    const asked: unknown[] = [];
    const reported = {
      audio: {
        noiseSuppression: true,
        echoCancellation: true,
        autoGainControl: true,
        voiceIsolation: null,
      },
      blur: "unavailable" as const,
      platformBlur: null,
      refusal: "Your browser did not change how it treats your microphone.",
    };
    const stage = stageThat(async (stream) => {
      const passing = await passThroughEffects().applyEffects(stream, {
        background: "none",
        reduceNoise: true,
      });
      return {
        ...passing,
        stream: passing.stream,
        applied: passing.applied,
        update: (settings) => {
          asked.push(settings);
          return Promise.resolve(reported);
        },
      };
    });
    const { client } = harness("attendance_1", "video", true, false, stage);
    await client.publish();

    await client.changeEffects({ background: "none", reduceNoise: false });

    expect(asked).toEqual([{ background: "none", reduceNoise: false }]);
    expect(client.effectSettings).toEqual({ background: "none", reduceNoise: false });
    // The track kept its noise suppression, and the panel is told so.
    expect(client.appliedEffects).toEqual(reported);
  });

  it("lets go of what was applied when the member leaves", async () => {
    const { client } = harness();
    await client.publish();
    expect(client.appliedEffects).not.toBeNull();

    client.leave();

    expect(client.appliedEffects).toBeNull();
  });
});

/** A write nobody expected a case to make. */
function refuse(): Promise<never> {
  return Promise.reject(new Error("not asked"));
}

/** Seams for the two records that reach nothing: every read is empty and nothing is ticking. */
function quietPollSeams(): MeetingPollSeams {
  return {
    list: () => Promise.resolve({ kind: "ok", value: { polls: [], nextCursor: null } }),
    open: refuse,
    answer: refuse,
    close: refuse,
    answers: refuse,
    every: () => () => {},
  };
}

function quietQuestionSeams(): MeetingQuestionSeams {
  return {
    list: () => Promise.resolve({ kind: "ok", value: { questions: [], nextCursor: null } }),
    ask: refuse,
    upvote: refuse,
    withdrawUpvote: refuse,
    markAnswered: refuse,
    redact: refuse,
    every: () => () => {},
  };
}

describe("a poll and a question on the wire", () => {
  const snapshot = {
    id: "meetingPoll_1",
    meetingId: "meeting_1",
    askedByUserId: "usr_1",
    question: "Which date works?",
    anonymous: false,
    maxChoices: 1,
    openedAt: "2026-09-20T15:00:00.000Z",
    closedAt: null,
    closedByUserId: null,
    options: [
      { optionId: "meetingPollOption_2", position: 1, label: "Friday", count: 0 },
      { optionId: "meetingPollOption_1", position: 0, label: "Thursday", count: 0 },
    ],
    respondents: 0,
  };

  it("hands an opened poll to the polls the screen holds, in the order the room was shown", () => {
    const { client, socket } = harness();
    const polls = new MeetingPolls(quietPollSeams());
    client.relayPollsTo(polls);

    socket.deliver({ v: 1, type: "poll-opened", poll: snapshot });

    expect(polls.polls).toHaveLength(1);
    expect(polls.polls[0]?.options.map((option) => option.label)).toEqual(["Thursday", "Friday"]);
    // Nobody has been asked whether this member answered; the frame is the same for every socket.
    expect(polls.waitingForAnswer).toBe(1);
  });

  it("moves the bars on a tally and settles them on a close", () => {
    const { client, socket } = harness();
    const polls = new MeetingPolls(quietPollSeams());
    client.relayPollsTo(polls);
    socket.deliver({ v: 1, type: "poll-opened", poll: snapshot });

    socket.deliver({
      v: 1,
      type: "poll-tally",
      pollId: "meetingPoll_1",
      counts: [
        { optionId: "meetingPollOption_1", count: 3 },
        { optionId: "meetingPollOption_2", count: 1 },
      ],
      respondents: 4,
      at: "2026-09-20T15:00:05.000Z",
    });
    expect(polls.polls[0]?.respondents).toBe(4);
    expect(polls.polls[0]?.options[0]?.count).toBe(3);

    socket.deliver({
      v: 1,
      type: "poll-closed",
      pollId: "meetingPoll_1",
      closedAt: "2026-09-20T15:02:00.000Z",
      counts: [
        { optionId: "meetingPollOption_1", count: 5 },
        { optionId: "meetingPollOption_2", count: 2 },
      ],
      respondents: 7,
    });
    expect(polls.polls[0]?.closedAt).toBe("2026-09-20T15:02:00.000Z");
    expect(polls.polls[0]?.respondents).toBe(7);
    expect(polls.waitingForAnswer).toBe(0);
  });

  it("hands a question, its new state and its count to the queue the screen holds", () => {
    const { client, socket } = harness();
    const questions = new MeetingQuestions(quietQuestionSeams());
    client.relayQuestionsTo(questions);
    const question = {
      id: "meetingQuestion_1",
      meetingId: "meeting_1",
      participantKind: "member",
      participantId: "attendance_2",
      userId: "usr_2",
      body: "When is the filing due?",
      askedAt: "2026-09-20T15:00:00.000Z",
      answeredAt: null,
      answeredByUserId: null,
      redactedAt: null,
      redactedByUserId: null,
      upvotes: 0,
    };

    socket.deliver({ v: 1, type: "question-asked", question });
    expect(questions.waiting).toBe(1);

    socket.deliver({
      v: 1,
      type: "question-tally",
      questions: [{ questionId: "meetingQuestion_1", upvotes: 4 }],
      at: "2026-09-20T15:00:01.000Z",
    });
    expect(questions.questions[0]?.upvotes).toBe(4);

    socket.deliver({
      v: 1,
      type: "question-updated",
      question: {
        ...question,
        answeredAt: "2026-09-20T15:01:00.000Z",
        answeredByUserId: "usr_1",
        upvotes: 4,
      },
    });
    expect(questions.waiting).toBe(0);
  });
});
