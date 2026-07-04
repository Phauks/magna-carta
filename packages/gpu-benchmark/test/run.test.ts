import { describe, it, expect, vi } from "vitest";
import { benchmarkOneRig } from "../src/run.ts";
import type { VastClient, VastOffer } from "../src/vast-client.ts";

function fakeClient(overrides: Partial<VastClient> = {}): VastClient {
  return {
    searchOffers: vi.fn().mockResolvedValue([
      {
        offerId: 42,
        gpuName: "RTX_4090",
        gpuCount: 1,
        gpuRamMegabytes: 24576,
        dollarsPerHour: 0.4,
        internetDownMbps: 900,
        reliability: 0.99,
        verified: true,
      } satisfies VastOffer,
    ]),
    createInstance: vi.fn().mockResolvedValue({ instanceId: 777 }),
    getInstance: vi.fn().mockResolvedValue({ status: "running", sshHost: "h", sshPort: 22 }),
    listInstances: vi.fn().mockResolvedValue([]),
    destroyInstance: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const envelope = JSON.stringify({
  gpuName: "RTX_4090",
  gpuCount: 1,
  gpuRamMegabytes: 24576,
  throughput: [{ hashcatMode: 9600, hashesPerSecond: 68356 }],
});

describe("benchmarkOneRig", () => {
  it("returns a profile and always destroys on success", async () => {
    const client = fakeClient();
    const profile = await benchmarkOneRig({
      client,
      collect: async () => envelope,
      image: "img",
      want: { gpuName: "RTX_4090", gpuCount: 1 },
      now: () => "2026-07-03T00:00:00Z",
      onstart: "test-onstart",
    });
    expect(profile.dollarsPerHour).toBe(0.4);
    expect(profile.gpuName).toBe("RTX_4090");
    expect(profile.gpuCount).toBe(1);
    expect(profile.gpuRamMegabytes).toBe(24576);
    expect(profile.throughput).toEqual([{ hashcatMode: 9600, hashesPerSecond: 68356 }]);
    expect(profile.measuredAt).toBe("2026-07-03T00:00:00Z");
    expect(profile.bootSeconds).toBeGreaterThanOrEqual(0);
    expect(client.destroyInstance).toHaveBeenCalledWith(777);
    expect(client.createInstance).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ onstart: "test-onstart" }),
    );
  });

  it("destroys the instance even when collection fails", async () => {
    const client = fakeClient();
    await expect(
      benchmarkOneRig({
        client,
        collect: async () => {
          throw new Error("ssh died");
        },
        image: "img",
        want: { gpuName: "RTX_4090", gpuCount: 1 },
        now: () => "t",
        onstart: "test-onstart",
      }),
    ).rejects.toThrow("ssh died");
    expect(client.destroyInstance).toHaveBeenCalledWith(777);
  });

  it("throws without renting when no offer matches the wanted shape", async () => {
    const client = fakeClient({ searchOffers: vi.fn().mockResolvedValue([]) });
    await expect(
      benchmarkOneRig({
        client,
        collect: async () => envelope,
        image: "img",
        want: { gpuName: "RTX_4090", gpuCount: 1 },
        now: () => "t",
        onstart: "test-onstart",
      }),
    ).rejects.toThrow(/no verified offer/i);
    expect(client.createInstance).not.toHaveBeenCalled();
    expect(client.destroyInstance).not.toHaveBeenCalled();
  });

  it("destroys the instance when the instance never reaches running status", async () => {
    vi.useFakeTimers();
    try {
      const client = fakeClient({
        getInstance: vi
          .fn()
          .mockResolvedValue({ status: "loading", sshHost: null, sshPort: null }),
      });
      const result = benchmarkOneRig({
        client,
        collect: async () => envelope,
        image: "img",
        want: { gpuName: "RTX_4090", gpuCount: 1 },
        now: () => "t",
        onstart: "test-onstart",
      });
      const assertion = expect(result).rejects.toThrow(/running/i);
      await vi.runAllTimersAsync();
      await assertion;
      expect(client.destroyInstance).toHaveBeenCalledWith(777);
    } finally {
      vi.useRealTimers();
    }
  });
});
