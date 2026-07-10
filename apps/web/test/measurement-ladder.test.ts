import { describe, expect, it } from "vitest";
import {
  LOW_DATA_DISCLOSED_CEILING_BYTES,
  LOW_DATA_MAX_BYTES,
  buildLadder,
} from "../src/lib/tools/speed-test/measurement-ladder.ts";

const bytesOf = (ladder: ReturnType<typeof buildLadder>) =>
  ladder.reduce((total, step) => ("bytes" in step ? total + step.bytes * step.count : total), 0);

describe("buildLadder", () => {
  it("never measures packet loss unless asked", () => {
    const ladder = buildLadder({ lowData: false, packetLoss: false });
    expect(ladder.some((step) => step.type === "packetLoss")).toBe(false);
  });

  it("adds exactly one packet-loss phase when asked", () => {
    const ladder = buildLadder({ lowData: false, packetLoss: true });
    expect(ladder.filter((step) => step.type === "packetLoss")).toHaveLength(1);
  });

  it("climbs to Cloudflare's largest payloads in full mode, so results stay comparable", () => {
    const ladder = buildLadder({ lowData: false, packetLoss: false });
    const downloads = ladder.filter((s) => s.type === "download");
    expect(Math.max(...downloads.map((s) => ("bytes" in s ? s.bytes : 0)))).toBe(2.5e8);
  });

  it("caps every payload in low-data mode", () => {
    const ladder = buildLadder({ lowData: true, packetLoss: false });
    for (const step of ladder) {
      if ("bytes" in step) expect(step.bytes).toBeLessThanOrEqual(LOW_DATA_MAX_BYTES);
    }
  });

  it("keeps latency, download and upload phases in low-data mode", () => {
    const types = new Set(buildLadder({ lowData: true, packetLoss: false }).map((s) => s.type));
    expect(types).toEqual(new Set(["latency", "download", "upload"]));
  });

  it("transfers far less in low-data mode", () => {
    const light = bytesOf(buildLadder({ lowData: true, packetLoss: false }));
    const full = bytesOf(buildLadder({ lowData: false, packetLoss: false }));
    expect(light).toBeLessThan(full / 10);
  });

  // The page prints "under 20 MB". That sentence is a promise; this test is what keeps it true if
  // the rounds ever change. The payload sum is ~15.8 MB, and the headroom covers protocol overhead.
  it("stays under the ceiling the page discloses", () => {
    expect(bytesOf(buildLadder({ lowData: true, packetLoss: true }))).toBeLessThan(
      LOW_DATA_DISCLOSED_CEILING_BYTES,
    );
  });

  it("still measures packet loss in low-data mode when asked — it is a few kilobytes", () => {
    const ladder = buildLadder({ lowData: true, packetLoss: true });
    expect(ladder.filter((s) => s.type === "packetLoss")).toHaveLength(1);
  });
});
