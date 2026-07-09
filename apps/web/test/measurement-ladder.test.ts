/*
 * The ladder is Cloudflare's own, minus the packetLoss step. Packet loss needs a WebRTC TURN
 * server we do not run; leaving the step in makes the engine fail the ENTIRE run on a credential
 * error. This test is the guard against someone "restoring the defaults".
 */
import { describe, expect, it } from "vitest";
import {
  LADDER_WITH_PACKET_LOSS,
  MEASUREMENT_LADDER,
} from "../src/lib/tools/speed-test/measurement-ladder.ts";

describe("MEASUREMENT_LADDER", () => {
  it("never asks the engine to measure packet loss", () => {
    expect(MEASUREMENT_LADDER.some((step) => step.type === "packetLoss")).toBe(false);
  });

  it("keeps latency, download and upload phases", () => {
    const types = new Set(MEASUREMENT_LADDER.map((step) => step.type));
    expect(types).toEqual(new Set(["latency", "download", "upload"]));
  });

  it("climbs to Cloudflare's largest payloads so results stay comparable", () => {
    const downloadBytes = MEASUREMENT_LADDER.filter((s) => s.type === "download").map((s) =>
      "bytes" in s ? s.bytes : 0,
    );
    const uploadBytes = MEASUREMENT_LADDER.filter((s) => s.type === "upload").map((s) =>
      "bytes" in s ? s.bytes : 0,
    );
    expect(Math.max(...downloadBytes)).toBe(2.5e8);
    expect(Math.max(...uploadBytes)).toBe(5e7);
  });
});

describe("LADDER_WITH_PACKET_LOSS", () => {
  it("adds exactly one packet-loss phase and changes nothing else", () => {
    expect(LADDER_WITH_PACKET_LOSS.filter((step) => step.type === "packetLoss")).toHaveLength(1);
    const withoutPacketLoss = LADDER_WITH_PACKET_LOSS.filter((step) => step.type !== "packetLoss");
    expect(withoutPacketLoss).toEqual(MEASUREMENT_LADDER);
  });
});
