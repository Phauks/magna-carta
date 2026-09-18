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
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { MeetingClient, type MeetingClientSeams } from "$lib/meetings/meeting-client.svelte.ts";

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
    this.localDescription = description;
    for (const transceiver of this.transceivers) {
      if (transceiver.mid === null) {
        transceiver.mid = String(this.#nextMid);
        this.#nextMid += 1;
      }
    }
    return Promise.resolve();
  }

  setRemoteDescription(description: { type: string; sdp: string }): Promise<void> {
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

function harness(): Harness {
  const socket = new FakeSocket();
  const peerConnection = new FakePeerConnection();
  const captured = new FakeStream([new FakeTrack("audio"), new FakeTrack("video")]);
  const displayed = new FakeStream([new FakeTrack("video")]);

  const seams = {
    createPeerConnection: () => peerConnection,
    openSocket: () => socket,
    getUserMedia: () => Promise.resolve(captured),
    getDisplayMedia: () => Promise.resolve(displayed),
    createMediaStream: () => new FakeStream([]),
  } as unknown as MeetingClientSeams;

  const client = new MeetingClient(seams);
  opened.push(client);
  client.join({
    meetingId: "meeting_1",
    participantId: "attendance_1",
    iceServers: [],
    socketUrl: "wss://example.test/api/v1/meetings/meeting_1/socket",
  });
  socket.accept();
  socket.deliver({ v: 1, type: "welcome", participantId: "attendance_1", roster: [] });

  return { client, socket, peerConnection, captured, displayed };
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

  it("fails with the room's reason when it refuses", () => {
    const { client, socket } = harness();
    socket.deliver({ v: 1, type: "refused", reason: "meeting-room-full" });
    expect(client.state).toBe("failed");
    expect(client.failureReason).toBe("meeting-room-full");
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
