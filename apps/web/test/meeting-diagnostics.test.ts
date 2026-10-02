/*
 * What the browser can say about its own connection, and what it must never say about it to anybody
 * else.
 *
 * Two halves. The first is that the marks a member reads are actually derived from the connection:
 * a sample is taken on the tick, this browser's own sending is judged, and each incoming stream is
 * traced back through its media section to the person whose picture it carries — which is the whole
 * reason the mark can sit on a tile rather than in a browser console.
 *
 * The second is the one that would be expensive to get wrong. The ring of events and the snapshot
 * built from it are the shape of something that will one day be POSTED to the room, and the room
 * keeps a record. So the case below reads the snapshot as text and asserts that nothing in it is a
 * name, a track, or a line of a session description — because redact-by-default
 * (docs/conventions/error-logging.md) is structural or it is nothing, and the moment to hold it is
 * before anything is being sent rather than after.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  MeetingClient,
  RECONCILE_DEBOUNCE_MILLISECONDS,
  type MeetingClientSeams,
} from "$lib/meetings/client/meeting-client.svelte.ts";
import {
  MeetingDiagnostics,
  type DiagnosticsTimer,
} from "$lib/meetings/client/diagnostics.svelte.ts";
import type { StatsEntry } from "$lib/meetings/client/connection-quality.ts";

/** Lets every queued step settle; each one is a handful of microtasks deep. */
async function settle(remaining = 20): Promise<void> {
  if (remaining === 0) return;
  await Promise.resolve();
  await settle(remaining - 1);
}

/** Waits out the reconciliation window, so a roster turns into a pull. */
async function reconciled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, RECONCILE_DEBOUNCE_MILLISECONDS + 20));
  await settle();
}

/** The sampling tick, driven by hand: a case about five-second samples cannot wait five seconds. */
class HandTimer implements DiagnosticsTimer {
  #tick: (() => void) | null = null;
  milliseconds = 0;

  every(milliseconds: number, tick: () => void): () => void {
    this.milliseconds = milliseconds;
    this.#tick = tick;
    return () => {
      this.#tick = null;
    };
  }

  /** One tick, and everything it set in motion. */
  async fire(): Promise<void> {
    this.#tick?.();
    await settle();
  }

  get running(): boolean {
    return this.#tick !== null;
  }
}

class FakeSocket {
  readonly sent: string[] = [];
  open = false;
  readonly #listeners = new Map<string, (event: { data: string }) => void>();

  addEventListener(name: string, handler: (event: { data: string }) => void): void {
    this.#listeners.set(name, handler);
  }

  send(frame: string): void {
    this.sent.push(frame);
  }

  close(): void {
    this.open = false;
    this.#listeners.get("close")?.({ data: "" });
  }

  accept(): void {
    this.open = true;
    this.#listeners.get("open")?.({ data: "" });
  }

  deliver(frame: Record<string, unknown>): void {
    this.#listeners.get("message")?.({ data: JSON.stringify(frame) });
  }
}

class FakeTrack {
  enabled = true;
  constructor(readonly kind: "audio" | "video") {}
  stop(): void {}
  addEventListener(): void {}
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
  removeTrack(): void {}
}

class FakeTransceiver {
  mid: string | null = null;
  receiver: { track: FakeTrack | null };
  constructor(track: FakeTrack | null) {
    this.receiver = { track };
  }
}

/** A connection that answers `getStats` with whatever a case put in front of it. */
class FakePeerConnection {
  readonly transceivers: FakeTransceiver[] = [];
  report: StatsEntry[] = [];
  #nextMid = 0;

  addTransceiver(track: FakeTrack): FakeTransceiver {
    const transceiver = new FakeTransceiver(track);
    this.transceivers.push(transceiver);
    return transceiver;
  }

  getTransceivers(): FakeTransceiver[] {
    return this.transceivers;
  }

  getStats(): Promise<StatsEntry[]> {
    return Promise.resolve(this.report);
  }

  createOffer(): Promise<{ type: string; sdp: string }> {
    return Promise.resolve({ type: "offer", sdp: "local-offer" });
  }

  createAnswer(): Promise<{ type: string; sdp: string }> {
    return Promise.resolve({ type: "answer", sdp: "local-answer" });
  }

  localDescription: { type: string; sdp: string } | null = null;

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
    if (description.type !== "offer") return Promise.resolve();
    const declared = /mids=([\w,]+)/u.exec(description.sdp);
    for (const mid of declared?.[1]?.split(",") ?? []) {
      if (this.transceivers.some((transceiver) => transceiver.mid === mid)) continue;
      const transceiver = new FakeTransceiver(new FakeTrack("video"));
      transceiver.mid = mid;
      this.transceivers.push(transceiver);
    }
    return Promise.resolve();
  }

  close(): void {}
}

interface Harness {
  readonly client: MeetingClient;
  readonly socket: FakeSocket;
  readonly peerConnection: FakePeerConnection;
  readonly diagnostics: MeetingDiagnostics;
  readonly timer: HandTimer;
}

const opened: MeetingClient[] = [];

function harness(): Harness {
  const socket = new FakeSocket();
  const peerConnection = new FakePeerConnection();
  const timer = new HandTimer();
  const diagnostics = new MeetingDiagnostics(timer);

  const seams = {
    createPeerConnection: () => peerConnection,
    openSocket: () => socket,
    getUserMedia: () => Promise.resolve(new FakeStream([new FakeTrack("audio")])),
    getDisplayMedia: () => Promise.resolve(new FakeStream([])),
    createMediaStream: () => new FakeStream([]),
    createAudioLevelMeter: () => ({ start: () => {}, stop: () => {} }),
  } as unknown as MeetingClientSeams;

  const client = new MeetingClient(seams, diagnostics);
  opened.push(client);
  client.join({
    meetingId: "meeting_1",
    participantId: "attendance_1",
    iceServers: [],
    socketUrl: "wss://example.test/api/v1/meetings/meeting_1/socket",
  });
  socket.accept();
  socket.deliver({
    v: 1,
    type: "welcome",
    participantId: "attendance_1",
    roster: [],
  });
  return { client, socket, peerConnection, diagnostics, timer };
}

/** The roster naming one other person who is publishing a camera and a microphone. */
const HER_ROSTER = {
  v: 1,
  type: "roster",
  participants: [
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

/** The unit answering the pull, so the media sections her tracks arrive on are known. */
const HER_SUBSCRIBED = {
  v: 1,
  type: "subscribed",
  sessionDescription: { type: "offer", sdp: "v=0\r\na=unit-offer mids=7,8" },
  tracks: [
    { sessionId: "session_2", trackName: "attendance_2:video", mid: "7" },
    { sessionId: "session_2", trackName: "attendance_2:audio", mid: "8" },
  ],
};

/** Her media arriving, with however much of it is going missing. */
function herStreams(packetsLost: number, packetsReceived: number): StatsEntry[] {
  return [
    {
      id: "in-video",
      type: "inbound-rtp",
      kind: "video",
      mid: "7",
      packetsLost,
      packetsReceived,
      jitter: 0.004,
      bytesReceived: 100_000,
      framesReceived: 300,
      framesDropped: 0,
    },
    {
      id: "in-audio",
      type: "inbound-rtp",
      kind: "audio",
      mid: "8",
      packetsLost: 0,
      packetsReceived,
      jitter: 0.004,
      bytesReceived: 20_000,
      framesReceived: 0,
      framesDropped: 0,
    },
  ];
}

function pathOf(roundTripSeconds: number): StatsEntry {
  return {
    id: "pair-1",
    type: "candidate-pair",
    selected: true,
    state: "succeeded",
    currentRoundTripTime: roundTripSeconds,
  };
}

/** Every diagnostic report this socket has been given, read back off the wire. */
function reports(socket: FakeSocket): Record<string, unknown>[] {
  return socket.sent
    .map((frame) => JSON.parse(frame) as Record<string, unknown>)
    .filter((frame) => frame.type === "diagnostic-report");
}

/** A room where her tracks are coming in, so the media sections have owners. */
async function roomWithHer(): Promise<Harness> {
  const harnessed = harness();
  harnessed.socket.deliver(HER_ROSTER);
  await reconciled();
  harnessed.socket.deliver(HER_SUBSCRIBED);
  await settle();
  return harnessed;
}

afterEach(() => {
  for (const client of opened.splice(0)) client.dispose();
});

describe("sampling a live meeting", () => {
  it("judges this browser's own sending off the path it is actually using", async () => {
    const { client, peerConnection, timer } = harness();
    expect(client.diagnostics.quality).toBe("unknown");

    peerConnection.report = [pathOf(0.03)];
    await timer.fire();
    expect(client.diagnostics.quality).toBe("good");

    // Six hundred milliseconds each way is a conversation people talk over each other in.
    peerConnection.report = [pathOf(0.6)];
    await timer.fire();
    expect(client.diagnostics.quality).toBe("poor");
  });

  it("samples on the interval the module names, and stops when the meeting does", async () => {
    const { client, timer } = harness();
    expect(timer.milliseconds).toBe(5000);
    expect(timer.running).toBe(true);

    client.leave();
    expect(timer.running).toBe(false);
    // What was measured goes with the connection it was about: a client joining a second meeting
    // must not open it holding the last one's numbers.
    expect(client.diagnostics.latest).toBeNull();
    expect(client.diagnostics.quality).toBe("unknown");
  });

  it("names whose media is arriving, through the media sections the pull recorded", async () => {
    const { client, peerConnection, timer } = await roomWithHer();

    peerConnection.report = [pathOf(0.02), ...herStreams(0, 0)];
    await timer.fire();
    // The second reading is what a rate can be measured over: one in five of her packets is going
    // missing between the two.
    peerConnection.report = [pathOf(0.02), ...herStreams(250, 1000)];
    await timer.fire();

    expect(client.qualityOf("attendance_2")).toBe("poor");
    // Somebody nothing is being pulled from has nothing measured about them, which is its own
    // answer and not a good connection.
    expect(client.qualityOf("attendance_9")).toBe("unknown");
  });

  it("carries on rather than ending a meeting over a connection that will not answer", async () => {
    const { client, peerConnection, timer } = harness();
    peerConnection.getStats = () => Promise.reject(new Error("InvalidStateError"));

    await timer.fire();

    expect(client.state).toBe("live");
    expect(client.diagnostics.quality).toBe("unknown");
  });
});

describe("what happened on the wire", () => {
  it("records the room's refusal with the handle support is quoted", () => {
    const { client, socket } = harness();

    socket.deliver({
      v: 1,
      type: "refused",
      reason: "malformed-frame",
      errorId: "err_7f3a",
    });

    const refusal = client.diagnostics.recent.at(-1);
    expect(refusal?.kind).toBe("refused");
    expect(refusal?.detail).toBe("malformed-frame");
    expect(refusal?.errorId).toBe("err_7f3a");
  });

  it("records joining, the room's hello and what this browser asked for", async () => {
    const { client } = await roomWithHer();

    const kinds = client.diagnostics.recent.map((event) => event.kind);
    expect(kinds.slice(0, 2)).toEqual(["join", "welcome"]);
    expect(kinds).toContain("subscribe");
    expect(kinds).toContain("subscribed");
    // A count is a shape; a track name is not, and nothing in the ring may carry one.
    const asked = client.diagnostics.recent.find((event) => event.kind === "subscribe");
    expect(asked?.detail).toBe("2 tracks");
  });

  it("tells a supersession from a fault, because one of them is not one", () => {
    const { client, socket } = harness();

    socket.deliver({ v: 1, type: "refused", reason: "superseded" });

    expect(client.diagnostics.recent.at(-1)?.kind).toBe("superseded");
  });
});

describe("the snapshot a report would carry", () => {
  it("holds no session description, no names and no track names", async () => {
    const { client, peerConnection, timer } = await roomWithHer();
    peerConnection.report = [
      pathOf(0.05),
      {
        id: "outbound-1",
        type: "outbound-rtp",
        kind: "video",
        mid: "1",
        rid: "f",
        frameWidth: 1280,
        frameHeight: 720,
        bytesSent: 500_000,
        packetsSent: 4000,
        framesSent: 900,
      },
      ...herStreams(0, 1000),
    ];
    await timer.fire();

    const report = client.diagnostics.report();
    const written = JSON.stringify(report);

    // The two things a room's record must never gain from a diagnostic post: what was said about
    // the connection in SDP, and who was in the room by name.
    expect(written).not.toContain("Rosalind");
    expect(written).not.toContain("v=0");
    expect(written).not.toContain("sdp");
    expect(written).not.toContain("attendance_2:video");
    // What it DOES carry is the handles a room already holds, which is what makes it correlatable.
    expect(report.participantId).toBe("attendance_1");
    expect(report.participants.map((entry) => entry.participantId)).toEqual(["attendance_2"]);
    expect(report.uplink?.rid).toBe("f");
    expect(report.roundTripMilliseconds).toBe(50);
  });

  it("sends nothing before anything has been measured", () => {
    const { client, socket } = harness();
    const before = socket.sent.length;

    client.diagnostics.sendReport();

    // A report of nothing is a claim about a connection nobody has read yet, and the room would
    // record it as the latest thing known about this member.
    expect(reports(socket)).toHaveLength(0);
    expect(socket.sent).toHaveLength(before);
  });
});

describe("the measurement the room is sent", () => {
  it("carries the numbers of the sample it was built from, once per window", async () => {
    const { peerConnection, timer, socket } = await roomWithHer();
    peerConnection.report = [
      pathOf(0.05),
      {
        id: "outbound-1",
        type: "outbound-rtp",
        kind: "video",
        mid: "1",
        rid: "h",
        frameWidth: 640,
        frameHeight: 360,
        bytesSent: 500_000,
        packetsSent: 4000,
        framesSent: 900,
      },
      ...herStreams(0, 1000),
    ];
    await timer.fire();
    await timer.fire();

    // TWO TICKS, ONE REPORT. The room takes one per participant per window and drops the rest, so
    // the second reading in the same window is measured and kept rather than spent on a frame
    // nothing would read.
    const sent = reports(socket);
    expect(sent).toHaveLength(1);
    const sample = sent[0]?.sample as Record<string, unknown>;
    expect(sample.roundTripMilliseconds).toBe(50);
    expect(sample.quality).toBe("good");
    expect(sample.inboundCount).toBe(2);
    expect(sample.outbound).toEqual({
      rid: "h",
      width: 640,
      height: 360,
      // Nothing has been sent between two readings of the same stream yet, so there is no rate to
      // state and the field is absent rather than zero.
    });
  });

  it("carries no session description, no name and no track name", async () => {
    const { peerConnection, timer, socket } = await roomWithHer();
    peerConnection.report = [pathOf(0.05), ...herStreams(0, 1000)];
    await timer.fire();

    const written = JSON.stringify(reports(socket));
    expect(written).not.toContain("Rosalind");
    expect(written).not.toContain("v=0");
    expect(written).not.toContain("sdp");
    expect(written).not.toContain("attendance_2");
  });

  it("says nothing from the door, where the only frames allowed are the keepalive and giving up", async () => {
    const socket = new FakeSocket();
    const peerConnection = new FakePeerConnection();
    const timer = new HandTimer();
    const client = new MeetingClient(
      {
        createPeerConnection: () => peerConnection,
        openSocket: () => socket,
        getUserMedia: () => Promise.resolve(new FakeStream([])),
        getDisplayMedia: () => Promise.resolve(new FakeStream([])),
        createMediaStream: () => new FakeStream([]),
        createAudioLevelMeter: () => ({ start: () => {}, stop: () => {} }),
      } as unknown as MeetingClientSeams,
      new MeetingDiagnostics(timer),
    );
    opened.push(client);
    client.join({
      meetingId: "meeting_1",
      participantId: "attendance_1",
      iceServers: [],
      socketUrl: "wss://example.test/api/v1/meetings/meeting_1/socket",
      waiting: true,
    });
    socket.accept();

    peerConnection.report = [pathOf(0.05)];
    await timer.fire();

    expect(reports(socket)).toHaveLength(0);
  });
});
