/*
 * What the connection's own statistics say, and the judgment made from them.
 *
 * EVERY CASE HERE IS A NUMBER A BROWSER WOULD REPORT. The report is built by hand, which is the
 * whole point of the module being pure: the thresholds that decide whether a member is told their
 * meeting is poor are argued with here, over numbers somebody can read, rather than by sitting in a
 * bad meeting and watching what the mark does.
 *
 * THE COUNTERS ARE THE SUBTLE PART. Almost everything a connection reports only ever climbs, so a
 * loss figure read straight off a report is a lifetime average that a twenty-minute meeting has
 * buried. The cases that deliver two reports are asking whether what is judged is the INTERVAL —
 * which is the difference between "this meeting had a bad minute an hour ago" and "this meeting is
 * failing right now".
 */
import { describe, expect, it } from "vitest";
import {
  inboundFacts,
  qualityOf,
  summarizeStats,
  uplinkFacts,
  type StatsEntry,
} from "$lib/meetings/client/connection-quality.ts";

/** The candidate pair actually carrying the media, with its round trip in seconds. */
function selectedPair(roundTripSeconds: number): StatsEntry {
  return {
    id: "pair-1",
    type: "candidate-pair",
    selected: true,
    state: "succeeded",
    currentRoundTripTime: roundTripSeconds,
  };
}

function inboundStream(
  id: string,
  kind: "audio" | "video",
  over: Partial<StatsEntry> = {},
): StatsEntry {
  return {
    id,
    type: "inbound-rtp",
    kind,
    mid: "7",
    packetsLost: 0,
    packetsReceived: 1000,
    jitter: 0.004,
    bytesReceived: 100_000,
    framesReceived: 300,
    framesDropped: 0,
    ...over,
  };
}

function outboundCamera(over: Partial<StatsEntry> = {}): StatsEntry {
  return {
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
    ...over,
  };
}

/** The unit's own report about what this browser sent it. */
function remoteReport(localId: string, packetsLost: number, jitterSeconds: number): StatsEntry {
  return {
    id: `remote-${localId}`,
    type: "remote-inbound-rtp",
    kind: "video",
    localId,
    packetsLost,
    jitter: jitterSeconds,
  };
}

describe("reading a statistics report", () => {
  it("takes the incoming streams, the outgoing camera and the path's round trip", () => {
    const sample = summarizeStats(
      [
        selectedPair(0.042),
        outboundCamera(),
        remoteReport("outbound-1", 12, 0.008),
        inboundStream("in-video", "video", { mid: "7", framesDropped: 4 }),
        inboundStream("in-audio", "audio", { mid: "8", framesReceived: 0 }),
      ],
      null,
      1000,
    );

    expect(sample.roundTripMilliseconds).toBe(42);
    expect(sample.uplink?.rid).toBe("f");
    expect(sample.uplink?.frameWidth).toBe(1280);
    expect(sample.uplink?.frameHeight).toBe(720);
    expect(sample.uplink?.framesSent).toBe(900);
    expect(sample.uplink?.jitterMilliseconds).toBe(8);
    expect(sample.inbound.map((entry) => entry.kind)).toEqual(["video", "audio"]);
    expect(sample.inbound[0]?.framesDropped).toBe(4);
    expect(sample.inbound[0]?.bytesReceived).toBe(100_000);
  });

  it("reads a browser's own report shape, which iterates as pairs", () => {
    const report = new Map<string, StatsEntry>([
      ["pair-1", selectedPair(0.1)],
      ["in-video", inboundStream("in-video", "video")],
    ]);

    const sample = summarizeStats(report, null, 1000);

    expect(sample.roundTripMilliseconds).toBe(100);
    expect(sample.inbound).toHaveLength(1);
  });

  it("reads the round trip of the pair in USE, not of one that failed", () => {
    const failed: StatsEntry = {
      id: "pair-0",
      type: "candidate-pair",
      state: "failed",
      currentRoundTripTime: 4,
    };

    const sample = summarizeStats([failed, selectedPair(0.05)], null, 1000);

    expect(sample.roundTripMilliseconds).toBe(50);
  });

  it("reports no rate at all on the first reading, rather than reporting zero", () => {
    const sample = summarizeStats(
      [selectedPair(0.05), outboundCamera(), remoteReport("outbound-1", 0, 0.002)],
      null,
      1000,
    );

    // Nothing has elapsed to measure over. Zero loss and zero bitrate would both be claims about a
    // connection nothing has watched yet.
    expect(sample.uplink?.lossFraction).toBeNull();
    expect(sample.uplink?.bitsPerSecond).toBeNull();
  });

  it("judges the loss over the interval, not over the meeting", () => {
    const first = summarizeStats(
      [
        inboundStream("in-video", "video", {
          packetsLost: 900,
          packetsReceived: 10_000,
        }),
      ],
      null,
      1000,
    );
    // Five seconds later: nine hundred packets lost long ago, and one hundred of the next hundred
    // and one arriving. The lifetime figure is still about eight per cent; the interval is one.
    const second = summarizeStats(
      [
        inboundStream("in-video", "video", {
          packetsLost: 901,
          packetsReceived: 10_100,
        }),
      ],
      first,
      6000,
    );

    expect(second.inbound[0]?.lossFraction).toBeCloseTo(1 / 101, 5);
  });

  it("works out what is going out from the bytes between two readings", () => {
    const first = summarizeStats([outboundCamera({ bytesSent: 0 })], null, 1000);
    const second = summarizeStats([outboundCamera({ bytesSent: 125_000 })], first, 6000);

    // 125,000 bytes in five seconds is a megabit a second.
    expect(second.uplink?.bitsPerSecond).toBe(200_000);
  });

  it("says nothing about a stream that carried no packets at all", () => {
    const first = summarizeStats([inboundStream("in-video", "video")], null, 1000);
    const second = summarizeStats([inboundStream("in-video", "video")], first, 6000);

    // Nothing arrived and nothing was lost. Zero loss here would report a dead track as healthy.
    expect(second.inbound[0]?.lossFraction).toBeNull();
  });

  it("names whose each incoming stream is, by the media section it arrives on", () => {
    const owners = new Map([
      ["7", "attendance_2"],
      ["8", "attendance_3"],
    ]);

    const sample = summarizeStats(
      [
        inboundStream("in-video", "video", { mid: "7" }),
        inboundStream("in-audio", "audio", { mid: "8" }),
        inboundStream("in-orphan", "audio", { mid: "99" }),
      ],
      null,
      1000,
      { ownerOfMid: (mid) => owners.get(mid) ?? null },
    );

    expect(sample.inbound.map((entry) => entry.participantId)).toEqual([
      "attendance_2",
      "attendance_3",
      null,
    ]);
  });
});

describe("telling the camera from the screen share", () => {
  it("leaves out the media section the share is going out on", () => {
    const share = outboundCamera({
      id: "outbound-screen",
      mid: "2",
      rid: null,
      frameWidth: 1920,
      frameHeight: 1080,
      bytesSent: 9_000_000,
    });

    const sample = summarizeStats([outboundCamera(), share], null, 1000, {
      screenMid: "2",
    });

    // The share sends far more than the camera does, so "whichever is busiest" would report a
    // member's screen resolution as their camera's for as long as they are sharing.
    expect(sample.uplink?.id).toBe("outbound-1");
    expect(sample.uplink?.frameWidth).toBe(1280);
  });

  it("takes the layered publication where nothing named the share", () => {
    const share = outboundCamera({
      id: "outbound-screen",
      mid: "2",
      rid: null,
      bytesSent: 9e6,
    });

    const sample = summarizeStats([share, outboundCamera()], null, 1000);

    // The camera is offered as three simulcast layers and a share as one, which is the only thing
    // in the report itself that tells them apart.
    expect(sample.uplink?.id).toBe("outbound-1");
  });

  it("takes the largest layer, which is the one describing what the room is being sent", () => {
    const quarter = outboundCamera({
      id: "outbound-q",
      rid: "q",
      bytesSent: 10_000,
    });
    const full = outboundCamera({
      id: "outbound-f",
      rid: "f",
      bytesSent: 900_000,
    });

    const sample = summarizeStats([quarter, full], null, 1000);

    expect(sample.uplink?.rid).toBe("f");
  });
});

describe("the judgment", () => {
  it("says nothing where nothing has been measured", () => {
    expect(
      qualityOf({
        roundTripMilliseconds: null,
        lossFraction: null,
        jitterMilliseconds: null,
      }),
    ).toBe("unknown");
  });

  it("reads a comfortable connection as good", () => {
    expect(
      qualityOf({
        roundTripMilliseconds: 60,
        lossFraction: 0.001,
        jitterMilliseconds: 8,
      }),
    ).toBe("good");
  });

  it("lets the WORST dimension decide, so a fine round trip cannot hide heavy loss", () => {
    expect(
      qualityOf({
        roundTripMilliseconds: 20,
        lossFraction: 0.2,
        jitterMilliseconds: 2,
      }),
    ).toBe("poor");
    expect(
      qualityOf({
        roundTripMilliseconds: 20,
        lossFraction: 0.05,
        jitterMilliseconds: 2,
      }),
    ).toBe("fair");
  });

  it("judges each dimension on its own edges", () => {
    expect(
      qualityOf({
        roundTripMilliseconds: 350,
        lossFraction: null,
        jitterMilliseconds: null,
      }),
    ).toBe("fair");
    expect(
      qualityOf({
        roundTripMilliseconds: 900,
        lossFraction: null,
        jitterMilliseconds: null,
      }),
    ).toBe("poor");
    expect(
      qualityOf({
        roundTripMilliseconds: null,
        lossFraction: null,
        jitterMilliseconds: 45,
      }),
    ).toBe("fair");
  });
});

describe("the facts a mark is made from", () => {
  it("judges this browser's own sending on the path and what the far end reports", () => {
    const first = summarizeStats(
      [
        selectedPair(0.6),
        outboundCamera({ bytesSent: 0, packetsSent: 0 }),
        remoteReport("outbound-1", 0, 0.01),
      ],
      null,
      1000,
    );
    const second = summarizeStats(
      [
        selectedPair(0.6),
        outboundCamera({ bytesSent: 100_000, packetsSent: 1000 }),
        remoteReport("outbound-1", 200, 0.01),
      ],
      first,
      6000,
    );

    const facts = uplinkFacts(second);
    expect(facts.roundTripMilliseconds).toBe(600);
    expect(facts.lossFraction).toBeCloseTo(200 / 1200, 5);
    expect(qualityOf(facts)).toBe("poor");
  });

  it("judges one person on the worst of their streams, never on the average", () => {
    const owners = new Map([
      ["7", "attendance_2"],
      ["8", "attendance_2"],
    ]);
    const first = summarizeStats(
      [
        selectedPair(0.02),
        inboundStream("in-video", "video", {
          mid: "7",
          packetsLost: 0,
          packetsReceived: 0,
        }),
        inboundStream("in-audio", "audio", {
          mid: "8",
          packetsLost: 0,
          packetsReceived: 0,
        }),
      ],
      null,
      1000,
      { ownerOfMid: (mid) => owners.get(mid) ?? null },
    );
    const second = summarizeStats(
      [
        selectedPair(0.02),
        // Their picture is perfect and their voice is losing one packet in five.
        inboundStream("in-video", "video", {
          mid: "7",
          packetsLost: 0,
          packetsReceived: 1000,
        }),
        inboundStream("in-audio", "audio", {
          mid: "8",
          packetsLost: 200,
          packetsReceived: 800,
        }),
      ],
      first,
      6000,
      { ownerOfMid: (mid) => owners.get(mid) ?? null },
    );

    const facts = inboundFacts(second, "attendance_2");
    expect(facts.lossFraction).toBeCloseTo(0.2, 5);
    expect(qualityOf(facts)).toBe("poor");
    // Somebody nobody is pulling anything from has nothing measured about them, which is not the
    // same answer as a good connection.
    expect(qualityOf(inboundFacts(second, "attendance_9"))).toBe("unknown");
  });
});
