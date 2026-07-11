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
  const reachable = async () => ({ ok: true as const, facts: FACTS });

  it("takes PROBE_SAMPLES samples and reports their median", async () => {
    let call = 0;
    let clock = 0;
    const durations = [10, 20, 30, 40, 50];
    const outcome = await probeConnection({
      fetchJson: async () => {
        clock += durations[call] ?? 0;
        call += 1;
        return { ok: true as const, facts: FACTS };
      },
      now: () => clock,
    });
    expect(call).toBe(PROBE_SAMPLES);
    expect(outcome.status).toBe("reachable");
    expect(outcome.medianRoundTripMs).toBe(30);
    expect(outcome.successfulSamples).toBe(PROBE_SAMPLES);
    expect(outcome.facts).toEqual(FACTS);
  });

  it("excludes a transport failure rather than counting it as zero", async () => {
    let call = 0;
    let clock = 0;
    const outcome = await probeConnection({
      fetchJson: async () => {
        call += 1;
        if (call === 1) return { ok: false as const, status: null };
        clock += 20;
        return { ok: true as const, facts: FACTS };
      },
      now: () => clock,
    });
    expect(outcome.status).toBe("reachable");
    expect(outcome.successfulSamples).toBe(PROBE_SAMPLES - 1);
    expect(outcome.medianRoundTripMs).toBe(20);
  });

  it("reports unreachable when every sample fails in transport", async () => {
    const outcome = await probeConnection({
      fetchJson: async () => ({ ok: false as const, status: null }),
      now: () => 0,
    });
    expect(outcome.status).toBe("unreachable");
    expect(outcome.facts).toBeNull();
    expect(outcome.medianRoundTripMs).toBeNull();
    expect(outcome.successfulSamples).toBe(0);
  });

  // The bug this whole task exists to prevent: a 401 is OUR missing session, never the firm's network.
  it("reports unauthenticated on a 401 and stops sampling immediately", async () => {
    let call = 0;
    const outcome = await probeConnection({
      fetchJson: async () => {
        call += 1;
        return { ok: false as const, status: 401 };
      },
      now: () => 0,
    });
    expect(outcome.status).toBe("unauthenticated");
    expect(call).toBe(1);
    expect(outcome.medianRoundTripMs).toBeNull();
  });

  it("reports forbidden on a 403 and stops sampling immediately", async () => {
    let call = 0;
    const outcome = await probeConnection({
      fetchJson: async () => {
        call += 1;
        return { ok: false as const, status: 403 };
      },
      now: () => 0,
    });
    expect(outcome.status).toBe("forbidden");
    expect(call).toBe(1);
  });

  it("treats a server error as a transport failure, not a refusal", async () => {
    const outcome = await probeConnection({
      fetchJson: async () => ({ ok: false as const, status: 500 }),
      now: () => 0,
    });
    expect(outcome.status).toBe("unreachable");
  });

  it("still succeeds when reachable", async () => {
    const outcome = await probeConnection({ fetchJson: reachable, now: () => 0 });
    expect(outcome.status).toBe("reachable");
  });
});
