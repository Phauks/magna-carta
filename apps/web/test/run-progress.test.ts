/*
 * What the run is doing, said honestly. There is deliberately no "time remaining" and no
 * "data remaining": the engine stops climbing a bandwidth type once a single request grows slow,
 * so how much a run will transfer depends on the connection. Only data ALREADY used is knowable.
 */
import { describe, expect, it } from "vitest";
import { bytesTransferred, formatBytes, phaseLabel } from "../src/lib/tools/speed-test/run-progress.ts";

describe("phaseLabel", () => {
  it("names each phase in plain language", () => {
    expect(phaseLabel({ type: "latency", numPackets: 20 })).toBe("Measuring latency");
    expect(phaseLabel({ type: "download", bytes: 1e6, count: 8 })).toBe("Measuring download speed");
    expect(phaseLabel({ type: "upload", bytes: 1e6, count: 6 })).toBe("Measuring upload speed");
    expect(
      phaseLabel({ type: "packetLoss", numPackets: 1e3, batchSize: 10, batchWaitTime: 10, responsesWaitTime: 3000 }),
    ).toBe("Measuring packet loss");
  });
});

describe("formatBytes", () => {
  it("renders megabytes without false precision", () => {
    expect(formatBytes(84_000_000)).toBe("84 MB");
  });

  it("renders under a megabyte in kilobytes", () => {
    expect(formatBytes(100_000)).toBe("100 kB");
  });

  it("renders nothing used as zero", () => {
    expect(formatBytes(0)).toBe("0 kB");
  });
});

describe("bytesTransferred", () => {
  it("sums both directions", () => {
    expect(bytesTransferred([{ bytes: 100 }, { bytes: 200 }], [{ bytes: 50 }])).toBe(350);
  });

  it("is zero before anything is measured", () => {
    expect(bytesTransferred([], [])).toBe(0);
  });
});
