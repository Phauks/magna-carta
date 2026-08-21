/*
 * What the run is doing, said honestly. There is deliberately no "time remaining" and no
 * "data remaining": the engine stops climbing a bandwidth type once a single request grows slow,
 * so how much a run will transfer depends on the connection. Only data ALREADY used is knowable.
 */
import { describe, expect, it } from "vitest";
import {
  bytesInDirection,
  bytesTransferred,
  formatBytes,
  LONGEST_PHASE_LABEL,
  phaseLabel,
} from "../src/lib/tools/speed-test/run-progress.ts";

describe("phaseLabel", () => {
  it("names each phase in plain language", () => {
    expect(phaseLabel({ type: "latency", numPackets: 20 })).toBe("Measuring latency");
    expect(phaseLabel({ type: "download", bytes: 1e6, count: 8 })).toBe("Measuring download speed");
    expect(phaseLabel({ type: "upload", bytes: 1e6, count: 6 })).toBe("Measuring upload speed");
    expect(
      phaseLabel({
        type: "packetLoss",
        numPackets: 1e3,
        batchSize: 10,
        batchWaitTime: 10,
        responsesWaitTime: 3000,
      }),
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

describe("bytesInDirection", () => {
  it("sums one direction's payloads", () => {
    expect(bytesInDirection([{ bytes: 1e5 }, { bytes: 1e6 }])).toBe(1_100_000);
  });

  it("is zero before anything is measured", () => {
    expect(bytesInDirection([])).toBe(0);
  });
});

describe("bytesTransferred", () => {
  it("is the sum of both directions", () => {
    const download = [{ bytes: 1e6 }];
    const upload = [{ bytes: 5e5 }];
    expect(bytesTransferred(download, upload)).toBe(
      bytesInDirection(download) + bytesInDirection(upload),
    );
  });
});

describe("LONGEST_PHASE_LABEL", () => {
  it("is at least as long as every label the engine can produce", () => {
    const labels = [
      phaseLabel({ type: "latency", numPackets: 1 }),
      phaseLabel({ type: "download", bytes: 1e6, count: 1 }),
      phaseLabel({ type: "upload", bytes: 1e6, count: 1 }),
      phaseLabel({
        type: "packetLoss",
        numPackets: 1,
        batchSize: 1,
        batchWaitTime: 1,
        responsesWaitTime: 1,
      }),
    ];
    for (const label of labels) {
      expect(LONGEST_PHASE_LABEL.length).toBeGreaterThanOrEqual(label.length);
    }
  });

  it("is one of the labels, not an invented string", () => {
    expect(LONGEST_PHASE_LABEL).toBe("Measuring download speed");
  });
});
