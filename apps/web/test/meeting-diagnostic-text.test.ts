import { describe, expect, it } from "vitest";
import { diagnosticText } from "../src/lib/meetings/client/diagnostic-text.ts";
import type {
  ConnectionSample,
  InboundSample,
} from "../src/lib/meetings/client/connection-quality.ts";

function picture(over: Partial<InboundSample>): InboundSample {
  return {
    id: "in-1",
    mid: "3",
    participantId: "attendance_2",
    kind: "video",
    packetsLost: 0,
    packetsReceived: 0,
    bytesReceived: 0,
    framesReceived: 0,
    framesDropped: 0,
    roundTripMilliseconds: null,
    lossFraction: null,
    jitterMilliseconds: 12,
    ...over,
  };
}

function sample(at: number, inbound: InboundSample): ConnectionSample {
  return { at, roundTripMilliseconds: 40, uplink: null, inbound: [inbound] };
}

const environment = {
  userAgent: "Test",
  processors: 8,
  background: "blur",
  layout: "speaker",
  copiedAt: new Date("2026-11-13T23:00:00Z"),
};

describe("diagnosticText", () => {
  it("states what a picture did over the window, so a stutter that passed is still in it", () => {
    const text = diagnosticText(
      [
        sample(
          0,
          picture({
            framesReceived: 100,
            framesDecoded: 100,
            freezeCount: 1,
            totalFreezesDuration: 0.5,
            packetsReceived: 1000,
            packetsLost: 0,
          }),
        ),
        sample(
          60_000,
          picture({
            framesReceived: 1900,
            framesDecoded: 1850,
            framesDropped: 30,
            freezeCount: 4,
            totalFreezesDuration: 2.5,
            packetsReceived: 2900,
            packetsLost: 100,
            frameWidth: 1280,
            frameHeight: 720,
            framesPerSecond: 28,
          }),
        ),
      ],
      [],
      environment,
    );
    expect(text).toContain("over 60 s: frames received 1800, decoded 1750, dropped 30");
    expect(text).toContain("freezes 3 totalling 2 s");
    expect(text).toContain("packets lost 5.0%");
    expect(text).toContain("picture 1280x720 at 28 fps");
    expect(text).toContain("background blur, layout speaker");
  });

  it("says so where nothing has been measured", () => {
    expect(diagnosticText([], [], environment)).toContain("No measurements yet");
  });
});
