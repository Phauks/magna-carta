/*
 * The probe's contract: a fixed number of samples, a median (not a mean — one stalled request
 * must not move the answer), failed samples excluded rather than counted as zero, and total
 * failure reported as unreachable rather than as a very fast zero.
 */
import { describe, expect, it } from "vitest";
import {
  PROBE_SAMPLES,
  median,
  probeConnection,
  type ConnectionFacts,
} from "../src/lib/tools/speed-test/connection-probe.ts";

const FACTS: ConnectionFacts = {
  ip: "203.0.113.7",
  asn: 22773,
  asOrganization: "Cox Communications Inc.",
  colo: "LAS",
  country: "US",
};

describe("median", () => {
  it("returns the middle value of an odd-length set", () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it("averages the middle pair of an even-length set", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("returns null for an empty set", () => {
    expect(median([])).toBeNull();
  });
});

describe("probeConnection", () => {
  it("takes PROBE_SAMPLES samples and reports their median", async () => {
    let call = 0;
    // Each sample advances the clock by a known amount: 10, 20, 30, 40, 50 → median 30.
    const durations = [10, 20, 30, 40, 50];
    let clock = 0;
    const outcome = await probeConnection({
      fetchJson: async () => {
        clock += durations[call] ?? 0;
        call += 1;
        return FACTS;
      },
      now: () => clock,
    });
    expect(call).toBe(PROBE_SAMPLES);
    expect(outcome.medianRoundTripMs).toBe(30);
    expect(outcome.successfulSamples).toBe(PROBE_SAMPLES);
    expect(outcome.facts).toEqual(FACTS);
  });

  it("excludes a failed sample rather than counting it as zero", async () => {
    let call = 0;
    let clock = 0;
    const outcome = await probeConnection({
      fetchJson: async () => {
        call += 1;
        if (call === 1) throw new Error("network");
        clock += 20;
        return FACTS;
      },
      now: () => clock,
    });
    expect(outcome.successfulSamples).toBe(PROBE_SAMPLES - 1);
    expect(outcome.medianRoundTripMs).toBe(20);
  });

  it("reports unreachable when every sample fails", async () => {
    const outcome = await probeConnection({
      fetchJson: async () => {
        throw new Error("network");
      },
      now: () => 0,
    });
    expect(outcome.facts).toBeNull();
    expect(outcome.medianRoundTripMs).toBeNull();
    expect(outcome.successfulSamples).toBe(0);
  });
});
