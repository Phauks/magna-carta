import { afterEach, describe, expect, it, vi } from "vitest";

import {
  main,
  parseArgs,
  reconcileLeakedInstances,
  selectTargets,
  CliUsageError,
  DEFAULT_BENCHMARK_IMAGE,
} from "../src/cli.ts";
import { BENCHMARK_SHORTLIST } from "../src/offer-filter.ts";
import type { VastClient } from "../src/vast-client.ts";

describe("cli", () => {
  afterEach(() => {
    // Always clear VAST_API_KEY after each test so a failed assertion in one test can never leak
    // it into the next.
    delete process.env.VAST_API_KEY;
  });

  it("exports an async main", () => {
    expect(typeof main).toBe("function");
  });

  it("refuses to run without VAST_API_KEY", async () => {
    delete process.env.VAST_API_KEY;
    await expect(main([])).rejects.toThrow(/VAST_API_KEY/);
  });

  it("refuses to run when VAST_API_KEY is empty", async () => {
    process.env.VAST_API_KEY = "";
    await expect(main([])).rejects.toThrow(/VAST_API_KEY/);
  });

  it("parseArgs defaults --image to the public hashcat image when omitted", () => {
    expect(parseArgs([])).toEqual({ image: DEFAULT_BENCHMARK_IMAGE, gpu: undefined });
    expect(parseArgs(["--gpu", "RTX_4090"])).toEqual({
      image: DEFAULT_BENCHMARK_IMAGE,
      gpu: "RTX_4090",
    });
  });

  it("parseArgs reads --image and optional --gpu, overriding the default image", () => {
    expect(parseArgs(["--image", "repo/img:tag"])).toEqual({
      image: "repo/img:tag",
      gpu: undefined,
    });
    expect(parseArgs(["--image", "repo/img:tag", "--gpu", "RTX_4090"])).toEqual({
      image: "repo/img:tag",
      gpu: "RTX_4090",
    });
  });

  it("selectTargets returns the whole shortlist when no --gpu is given", () => {
    expect(selectTargets(BENCHMARK_SHORTLIST, undefined)).toEqual([...BENCHMARK_SHORTLIST]);
  });

  it("selectTargets narrows to every shortlist entry matching the named GPU", () => {
    const targets = selectTargets(BENCHMARK_SHORTLIST, "rtx 4090");
    expect(targets.length).toBeGreaterThan(1);
    for (const target of targets) {
      expect(target.gpuName).toBe("RTX 4090");
    }
  });

  it("selectTargets throws a clear error for an unknown GPU", () => {
    expect(() => selectTargets(BENCHMARK_SHORTLIST, "NOT_A_REAL_GPU")).toThrow(CliUsageError);
    expect(() => selectTargets(BENCHMARK_SHORTLIST, "NOT_A_REAL_GPU")).toThrow(/NOT_A_REAL_GPU/);
  });
});

describe("reconcileLeakedInstances", () => {
  it("destroys only the gpu-benchmark-labeled instance, never an unrelated one", async () => {
    const destroyInstance = vi.fn(async (_instanceId: number) => {});
    const fakeClient: VastClient = {
      searchOffers: async () => {
        throw new Error("not used in this test");
      },
      createInstance: async () => {
        throw new Error("not used in this test");
      },
      getInstance: async () => {
        throw new Error("not used in this test");
      },
      listInstances: async () => [
        { instanceId: 111, label: "gpu-benchmark-RTX_4090-1" },
        { instanceId: 222, label: "someone-elses-unrelated-instance" },
      ],
      destroyInstance,
      requestLogsUrl: async () => {
        throw new Error("not used in this test");
      },
    };

    await reconcileLeakedInstances(fakeClient);

    expect(destroyInstance).toHaveBeenCalledTimes(1);
    expect(destroyInstance).toHaveBeenCalledWith(111);
    expect(destroyInstance).not.toHaveBeenCalledWith(222);
  });

  it("propagates a destroyInstance failure rather than swallowing it (main's own finally is what logs and moves on)", async () => {
    const fakeClient: VastClient = {
      searchOffers: async () => {
        throw new Error("not used in this test");
      },
      createInstance: async () => {
        throw new Error("not used in this test");
      },
      getInstance: async () => {
        throw new Error("not used in this test");
      },
      listInstances: async () => [{ instanceId: 111, label: "gpu-benchmark-RTX_4090-1" }],
      destroyInstance: async () => {
        throw new Error("vast.ai request to DELETE /api/v0/instances/111/ failed with status 500");
      },
      requestLogsUrl: async () => {
        throw new Error("not used in this test");
      },
    };

    await expect(reconcileLeakedInstances(fakeClient)).rejects.toThrow(/500/);
  });
});
