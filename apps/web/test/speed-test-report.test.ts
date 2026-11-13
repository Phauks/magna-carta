/*
 * The report is the run, written down. It must never invent a measurement: an absent value reads
 * as "not measured", never as zero, and the packet-loss line states WHY it is absent.
 */
import { describe, expect, it } from "vitest";
import { renderReport, reportFilename } from "../src/lib/tools/speed-test/speed-test-report.ts";

const AT = new Date("2026-07-09T20:40:21.000Z");

const FULL = {
  finishedAt: AT,
  downloadBps: 138_000_000,
  uploadBps: 68_100_000,
  latencyMs: 29.2,
  jitterMs: 12.5,
  packetLoss: { measured: false as const, reason: "Sign in to measure packet loss." },
  scores: { streaming: "good", gaming: "average", rtc: "average" },
  server: {
    clientIp: "203.0.113.10",
    asOrganization: "Cox Communications Inc.",
    asn: 22773,
    coloCity: "Las Vegas",
    coloIata: "LAS",
  },
  roundTrip: { reachable: false as const, note: "You are not signed in." },
  bytesDown: 118_000_000,
  bytesUp: 24_000_000,
  lowData: false,
};

describe("reportFilename", () => {
  it("is sortable and names the tool", () => {
    expect(reportFilename(AT)).toMatch(/^network-speed-test-2026-07-09T\d{2}-\d{2}-\d{2}\.txt$/);
  });
});

describe("renderReport", () => {
  it("states every measured value", () => {
    const text = renderReport(FULL);
    expect(text).toContain("Download: 138 Mbps");
    expect(text).toContain("Upload: 68.1 Mbps");
    expect(text).toContain("Latency: 29.2 ms");
    expect(text).toContain("Jitter: 12.5 ms");
  });

  it("says why packet loss is absent rather than printing a zero", () => {
    const text = renderReport(FULL);
    expect(text).toContain("Packet loss: not measured");
    expect(text).toContain("Sign in to measure packet loss.");
    expect(text).not.toMatch(/Packet loss: 0/);
  });

  it("records the measurement server and the data the test spent", () => {
    const text = renderReport(FULL);
    expect(text).toContain("Las Vegas (LAS)");
    expect(text).toContain("Cox Communications Inc. (AS22773)");
    expect(text).toContain("Downloaded: 118 MB");
    expect(text).toContain("Uploaded: 24 MB");
  });

  it("renders an unmeasured value as 'not measured', never as zero", () => {
    const text = renderReport({ ...FULL, downloadBps: undefined, latencyMs: undefined });
    expect(text).toContain("Download: not measured");
    expect(text).toContain("Latency: not measured");
    expect(text).not.toContain("Download: 0");
  });

  it("notes that the ratings are incomplete without packet loss", () => {
    expect(renderReport(FULL)).toContain("incomplete");
  });

  it("flags a low-internet-usage run so its figures are not misread as the true speed", () => {
    expect(renderReport({ ...FULL, lowData: true })).toContain("Low internet usage mode");
    expect(renderReport(FULL)).not.toContain("Low internet usage mode");
  });
});
