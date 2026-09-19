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
  MeetingClient,
  refusalStatement,
  SUPERSEDED_REASON,
  type MeetingClientSeams,
  type MeetingMedium,
} from "$lib/meetings/meeting-client.svelte.ts";
import { meetingTiles, sharedScreenTile } from "$lib/meetings/meeting-tiles.ts";
import { leaveMeetingOnDeparture } from "$lib/api/departure-write.ts";

/** Lets every queued negotiation step settle; each one is a handful of microtasks deep. */
async function settle(remaining = 20): Promise<void> {
  if (remaining === 0) return;
  await Promise.resolve();
  await settle(remaining - 1);
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
}

class FakeTransceiver {
  mid: string | null = null;
  receiver: { track: FakeTrack | null };

  constructor(track: FakeTrack | null) {
    this.receiver = { track };
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

  addTransceiver(track: FakeTrack, init: { direction: string }): FakeTransceiver {
    expect(init.direction).toBe("sendonly");
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
}

/**
 * Every client a case opened. The keepalive is a real interval, so a case that does not leave would
 * hold the test process open past its own assertions; disposing here is what keeps a suite that
 * passes from also hanging.
 */
const opened: MeetingClient[] = [];

function harness(participantId = "attendance_1", medium: MeetingMedium = "video"): Harness {
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

  const seams = {
    createPeerConnection: () => peerConnection,
    openSocket: () => socket,
    getUserMedia: (constraints: MediaStreamConstraints) =>
      Promise.resolve(constraints.video === false ? audioOnly : captured),
    getDisplayMedia: () => Promise.resolve(displayed),
    createMediaStream: () => new FakeStream([]),
  } as unknown as MeetingClientSeams;

  const client = new MeetingClient(seams);
  opened.push(client);
  client.join({
    meetingId: "meeting_1",
    participantId,
    iceServers: [],
    socketUrl: "wss://example.test/api/v1/meetings/meeting_1/socket",
    medium,
  });
  socket.accept();
  socket.deliver({ v: 1, type: "welcome", participantId, roster: [] });

  return {
    client,
    socket,
    peerConnection,
    captured: medium === "audio" ? audioOnly : captured,
    displayed,
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
    expect(publish?.sessionDescription).toEqual({ type: "offer", sdp: "local-offer" });
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

    expect(peerConnection.remoteDescription).toEqual({ type: "answer", sdp: "unit-answer" });
  });
});

describe("the roster", () => {
  it("pulls a participant's tracks once, and never twice", () => {
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

    const [subscribe] = socket.framesOfType("subscribe");
    expect(subscribe?.tracks).toEqual([
      { sessionId: "session_2", trackName: "attendance_2:audio" },
      { sessionId: "session_2", trackName: "attendance_2:video" },
    ]);

    socket.deliver(roster);
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
    socket.deliver({
      v: 1,
      type: "subscribed",
      sessionDescription: { type: "offer", sdp: "unit-offer mids=7" },
      tracks: [{ sessionId: "session_2", trackName: "attendance_2:video", mid: "7" }],
    });
    await settle();

    const [renegotiate] = socket.framesOfType("renegotiate");
    expect(renegotiate?.sessionDescription).toEqual({ type: "answer", sdp: "local-answer" });
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
    socket.deliver(subscribedFrame("session_2"));
    await settle();
    expect(client.remoteStreams.get("attendance_2")?.getTracks()).toHaveLength(2);

    // Same person, same attendance, same track NAMES — and a session that is not the one those
    // tracks were pulled from. Keyed on the name alone this is silently "already coming in", and
    // their tile is black for the rest of the meeting.
    socket.deliver(rosterOf("session_3", HER_TRACKS));

    const subscribes = socket.framesOfType("subscribe");
    expect(subscribes).toHaveLength(2);
    expect(subscribes[1]?.tracks).toEqual([
      { sessionId: "session_3", trackName: "attendance_2:audio" },
      { sessionId: "session_3", trackName: "attendance_2:video" },
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
    expect(socket.framesOfType("subscribe")).toHaveLength(2);
  });

  it("un-marks them when the room says the pull needed no renegotiation", async () => {
    const { socket } = harness();
    socket.deliver(rosterOf("session_2", HER_TRACKS));
    socket.deliver(subscribedFrame("session_2", { requiresImmediateRenegotiation: false }));
    await settle();

    socket.deliver(rosterOf("session_2", HER_TRACKS));
    expect(socket.framesOfType("subscribe")).toHaveLength(2);
  });
});

describe("what the room refuses", () => {
  it("stays in the room, and states the refusal with the Error ID it carried", () => {
    const { client, socket } = harness();
    socket.deliver({ v: 1, type: "refused", reason: "malformed-frame", errorId: "err_7f3a" });

    expect(client.state).toBe("live");
    expect(client.lastRefusal).toEqual({ reason: "malformed-frame", errorId: "err_7f3a" });
  });

  it("ends the meeting for the two refusals that are the end of it", () => {
    const { client, socket } = harness();
    socket.deliver({ v: 1, type: "refused", reason: "not-a-participant" });

    expect(client.state).toBe("failed");
    expect(client.failureReason).toBe("not-a-participant");
  });

  it("asks again for the tracks a refused subscribe lost", () => {
    const { client, socket } = harness();
    socket.deliver(rosterOf("session_2", HER_TRACKS));
    expect(socket.framesOfType("subscribe")).toHaveLength(1);

    socket.deliver({ v: 1, type: "refused", reason: "sfu-unavailable" });
    expect(client.state).toBe("live");

    socket.deliver(rosterOf("session_2", HER_TRACKS));
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

  it("does not ask again for somebody else's tracks over a refusal about its own", () => {
    const { socket } = harness();
    socket.deliver(rosterOf("session_2", HER_TRACKS));
    expect(socket.framesOfType("subscribe")).toHaveLength(1);

    socket.deliver({ v: 1, type: "refused", reason: "track-limit-reached" });
    socket.deliver(rosterOf("session_2", HER_TRACKS));

    expect(socket.framesOfType("subscribe")).toHaveLength(1);
  });
});

describe("a participant whose media has gone quiet", () => {
  it("keeps their tile, with nothing in it, rather than taking the grid down", async () => {
    const { client, socket } = harness();
    socket.deliver(rosterOf("session_2", HER_TRACKS));
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

    socket.deliver({ v: 1, type: "ended", endedAt: "2026-09-18T15:00:00.000Z" });

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
