import { describe, expect, it } from "vitest";
import { cameraEncodingsFor } from "../src/lib/meetings/client/capture.ts";

// The camera's encodings after negotiation: the three layers held to their ceilings, only the quarter
// layer while nobody else is in the room, and a connection that took one layer held to the full
// layer's ceiling. Chrome was seen sending the full layer at 2.55 Mbit/s against a 1.2 Mbit/s ceiling.

const NEGOTIATED: RTCRtpEncodingParameters[] = [
  { rid: "f", active: true, scaleResolutionDownBy: 1 },
  { rid: "h", active: true, scaleResolutionDownBy: 2 },
  { rid: "q", active: true, scaleResolutionDownBy: 4 },
];

describe("the camera's send budget", () => {
  it("writes the ceilings back onto three layers that lost them", () => {
    const wanted = cameraEncodingsFor(NEGOTIATED, false);
    expect(wanted?.map((encoding) => [encoding.rid, encoding.active, encoding.maxBitrate])).toEqual(
      [
        ["f", true, 1_200_000],
        ["h", true, 350_000],
        ["q", true, 120_000],
      ],
    );
    expect(cameraEncodingsFor(wanted ?? [], false)).toBeNull();
  });

  it("sends only the quarter layer while alone, and all three when somebody arrives", () => {
    const alone = cameraEncodingsFor(NEGOTIATED, true);
    expect(alone?.map((encoding) => encoding.active)).toEqual([false, false, true]);
    const company = cameraEncodingsFor(alone ?? [], false);
    expect(company?.map((encoding) => encoding.active)).toEqual([true, true, true]);
  });

  it("holds a single encoding to the full ceiling, and to a quarter picture while alone", () => {
    const single: RTCRtpEncodingParameters[] = [{ active: true }];
    expect(cameraEncodingsFor(single, false)).toEqual([
      { active: true, scaleResolutionDownBy: 1, maxBitrate: 1_200_000 },
    ]);
    expect(cameraEncodingsFor(single, true)).toEqual([
      { active: true, scaleResolutionDownBy: 4, maxBitrate: 120_000 },
    ]);
    expect(cameraEncodingsFor([], true)).toBeNull();
  });
});
