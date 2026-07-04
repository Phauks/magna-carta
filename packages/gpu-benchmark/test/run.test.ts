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
        reliability: 0.99,
        verified: true,
      } satisfies VastOffer,
    ]),
    createInstance: vi.fn().mockResolvedValue({ instanceId: 777 }),
    getInstance: vi.fn().mockResolvedValue({ status: "running", statusMsg: null }),
    listInstances: vi.fn().mockResolvedValue([]),
    destroyInstance: vi.fn().mockResolvedValue(undefined),
    requestLogsUrl: vi.fn().mockResolvedValue("https://s3.example.com/logs.txt"),
    ...overrides,
  };
}

/** A raw hashcat benchmark log matching the real onstart-command output shape. */
const rawLog = [
  "BENCH_BEGIN",
  "RTX_4090, 24576 MiB",
  "MODE=9600",
  "1:9600:2310:10251:91.27:68356",
  "BENCH_END",
].join("\n");

describe("benchmarkOneRig", () => {
  it("returns a profile and always destroys on success", async () => {
    const client = fakeClient();
    const profile = await benchmarkOneRig({
      client,
      collect: async () => rawLog,
      image: "img",
      want: { gpuName: "RTX_4090", gpuCount: 1 },
      now: () => "2026-07-03T00:00:00Z",
      onstart: "test-onstart",
      geolocationCountries: ["US"],
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

  it("still returns the captured profile when the post-success destroy throws (sweep is the backstop)", async () => {
    // A transient 5xx from the destroy endpoint must not discard an already-measured profile — the
    // end-of-run reconciliation sweep is the billing backstop for the rig this failed to destroy.
    const client = fakeClient({
      destroyInstance: vi
        .fn()
        .mockRejectedValue(new Error("vast.ai DELETE failed with status 502")),
    });
    const profile = await benchmarkOneRig({
      client,
      collect: async () => rawLog,
      image: "img",
      want: { gpuName: "RTX_4090", gpuCount: 1 },
      now: () => "t",
      onstart: "test-onstart",
      geolocationCountries: ["US"],
    });
    expect(profile.throughput).toEqual([{ hashcatMode: 9600, hashesPerSecond: 68356 }]);
    expect(client.destroyInstance).toHaveBeenCalledWith(777);
  });

  it("destroys the instance even when collection fails, and reports the failure (single offer available)", async () => {
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
        geolocationCountries: ["US"],
      }),
    ).rejects.toThrow("ssh died");
    expect(client.destroyInstance).toHaveBeenCalledWith(777);
  });

  it("throws without renting when no offer matches the wanted shape", async () => {
    const client = fakeClient({ searchOffers: vi.fn().mockResolvedValue([]) });
    await expect(
      benchmarkOneRig({
        client,
        collect: async () => rawLog,
        image: "img",
        want: { gpuName: "RTX_4090", gpuCount: 1 },
        now: () => "t",
        onstart: "test-onstart",
        geolocationCountries: ["US"],
      }),
    ).rejects.toThrow(/no verified offer/i);
    expect(client.createInstance).not.toHaveBeenCalled();
    expect(client.destroyInstance).not.toHaveBeenCalled();
  });

  it("destroys the instance when the instance never reaches running status (single offer available)", async () => {
    vi.useFakeTimers();
    try {
      const client = fakeClient({
        getInstance: vi.fn().mockResolvedValue({ status: "loading", statusMsg: null }),
      });
      const result = benchmarkOneRig({
        client,
        collect: async () => rawLog,
        image: "img",
        want: { gpuName: "RTX_4090", gpuCount: 1 },
        now: () => "t",
        onstart: "test-onstart",
        geolocationCountries: ["US"],
      });
      const assertion = expect(result).rejects.toThrow(/running/i);
      await vi.runAllTimersAsync();
      await assertion;
      expect(client.destroyInstance).toHaveBeenCalledWith(777);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries on the next-cheapest offer when the first offer's rig fails, destroying the failed instance along the way", async () => {
    const offers: VastOffer[] = [
      {
        offerId: 1,
        gpuName: "RTX_4090",
        gpuCount: 1,
        gpuRamMegabytes: 24576,
        dollarsPerHour: 0.3,
        reliability: 0.99,
        verified: true,
      },
      {
        offerId: 2,
        gpuName: "RTX_4090",
        gpuCount: 1,
        gpuRamMegabytes: 24576,
        dollarsPerHour: 0.5,
        reliability: 0.99,
        verified: true,
      },
    ];
    const createInstance = vi.fn(async (offerId: number) => ({
      instanceId: offerId === 1 ? 901 : 902,
    }));
    const getInstance = vi.fn(async (instanceId: number) => {
      if (instanceId === 901) {
        // The bad rig: vast.ai reports a terminal container-runtime failure, never `running`.
        return {
          status: "exited",
          statusMsg: "OCI runtime create failed: unable to start container process",
        };
      }
      return { status: "running", statusMsg: null };
    });
    const destroyInstance = vi.fn(async (_instanceId: number) => {});
    const collect = vi.fn(async (_client: VastClient, instanceId: number) => {
      if (instanceId === 901) {
        throw new Error("should never collect from the bad rig");
      }
      return rawLog;
    });

    const client: VastClient = {
      searchOffers: vi.fn().mockResolvedValue(offers),
      createInstance,
      getInstance,
      listInstances: vi.fn().mockResolvedValue([]),
      destroyInstance,
      requestLogsUrl: vi.fn().mockResolvedValue("https://s3.example.com/logs.txt"),
    };

    const profile = await benchmarkOneRig({
      client,
      collect,
      image: "img",
      want: { gpuName: "RTX_4090", gpuCount: 1 },
      now: () => "t",
      onstart: "test-onstart",
      geolocationCountries: ["US"],
    });

    // The winning (second, next-cheapest) offer's price is what gets recorded.
    expect(profile.dollarsPerHour).toBe(0.5);
    expect(createInstance).toHaveBeenCalledTimes(2);
    expect(createInstance).toHaveBeenNthCalledWith(1, 1, expect.anything());
    expect(createInstance).toHaveBeenNthCalledWith(2, 2, expect.anything());
    expect(destroyInstance).toHaveBeenCalledWith(901);
    expect(destroyInstance).toHaveBeenCalledWith(902);
    expect(collect).toHaveBeenCalledTimes(1);
  });

  it("throws AllOffersFailedError when every offer attempt fails", async () => {
    const offers: VastOffer[] = [
      {
        offerId: 1,
        gpuName: "RTX_4090",
        gpuCount: 1,
        gpuRamMegabytes: 24576,
        dollarsPerHour: 0.3,
        reliability: 0.99,
        verified: true,
      },
      {
        offerId: 2,
        gpuName: "RTX_4090",
        gpuCount: 1,
        gpuRamMegabytes: 24576,
        dollarsPerHour: 0.5,
        reliability: 0.99,
        verified: true,
      },
    ];
    const destroyInstance = vi.fn(async (_instanceId: number) => {});
    const client: VastClient = {
      searchOffers: vi.fn().mockResolvedValue(offers),
      createInstance: vi.fn(async (offerId: number) => ({ instanceId: offerId })),
      getInstance: vi.fn().mockResolvedValue({
        status: "exited",
        statusMsg: "OCI runtime create failed",
      }),
      listInstances: vi.fn().mockResolvedValue([]),
      destroyInstance,
      requestLogsUrl: vi.fn().mockResolvedValue("https://s3.example.com/logs.txt"),
    };

    await expect(
      benchmarkOneRig({
        client,
        collect: async () => rawLog,
        image: "img",
        want: { gpuName: "RTX_4090", gpuCount: 1 },
        now: () => "t",
        onstart: "test-onstart",
        geolocationCountries: ["US"],
      }),
    ).rejects.toThrow(/every offer tried/i);
    expect(destroyInstance).toHaveBeenCalledWith(1);
    expect(destroyInstance).toHaveBeenCalledWith(2);
  });
});
