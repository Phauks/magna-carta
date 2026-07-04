import { afterEach, describe, expect, it, vi } from "vitest";

import type { VastClient } from "../src/vast-client.ts";

// `main` builds its vast.ai client internally via `createVastClient`, so tests that exercise
// `main`'s control flow (the `--reconcile` short-circuit and the reconcile-at-start sweep) swap in
// a fake through this hoisted holder rather than making a real network call.
const fake = vi.hoisted(() => ({ client: null as VastClient | null }));
vi.mock("../src/vast-client.ts", () => ({
  createVastClient: () => {
    if (fake.client === null) throw new Error("test did not set fake.client");
    return fake.client;
  },
}));

import {
  main,
  parseArgs,
  reconcileLeakedInstances,
  selectTargets,
  CliUsageError,
  DEFAULT_BENCHMARK_IMAGE,
} from "../src/cli.ts";
import { BENCHMARK_SHORTLIST } from "../src/offer-filter.ts";

describe("cli", () => {
  afterEach(() => {
    // Always clear VAST_API_KEY after each test so a failed assertion in one test can never leak
    // it into the next.
    delete process.env.VAST_API_KEY;
    fake.client = null;
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
    expect(parseArgs([])).toEqual({
      image: DEFAULT_BENCHMARK_IMAGE,
      gpu: undefined,
      reconcileOnly: false,
    });
    expect(parseArgs(["--gpu", "RTX_4090"])).toEqual({
      image: DEFAULT_BENCHMARK_IMAGE,
      gpu: "RTX_4090",
      reconcileOnly: false,
    });
  });

  it("parseArgs reads --image and optional --gpu, overriding the default image", () => {
    expect(parseArgs(["--image", "repo/img:tag"])).toEqual({
      image: "repo/img:tag",
      gpu: undefined,
      reconcileOnly: false,
    });
    expect(parseArgs(["--image", "repo/img:tag", "--gpu", "RTX_4090"])).toEqual({
      image: "repo/img:tag",
      gpu: "RTX_4090",
      reconcileOnly: false,
    });
  });

  it("parseArgs sets reconcileOnly for --reconcile", () => {
    expect(parseArgs(["--reconcile"])).toEqual({
      image: DEFAULT_BENCHMARK_IMAGE,
      gpu: undefined,
      reconcileOnly: true,
    });
  });

  it("main --reconcile sweeps leaked instances and rents nothing", async () => {
    process.env.VAST_API_KEY = "test-key";
    const destroyInstance = vi.fn(async (_instanceId: number) => {});
    const searchOffers = vi.fn(async () => {
      throw new Error("--reconcile must not search or rent");
    });
    fake.client = {
      searchOffers,
      createInstance: async () => {
        throw new Error("--reconcile must not rent");
      },
      getInstance: async () => {
        throw new Error("not used");
      },
      listInstances: async () => [{ instanceId: 555, label: "gpu-benchmark-RTX_5090-1" }],
      destroyInstance,
      requestLogsUrl: async () => {
        throw new Error("not used");
      },
    };

    await main(["--reconcile"]);

    expect(destroyInstance).toHaveBeenCalledWith(555);
    expect(searchOffers).not.toHaveBeenCalled();
  });

  it("main sweeps a leaked orphan before renting for a real run", async () => {
    process.env.VAST_API_KEY = "test-key";
    const destroyInstance = vi.fn(async (_instanceId: number) => {});
    const order: string[] = [];
    fake.client = {
      // No offers, so the sweep is the only observable effect and the run rents nothing — the point
      // of this test is the reconcile-at-start ordering, not a full benchmark.
      searchOffers: async () => {
        order.push("search");
        return [];
      },
      createInstance: async () => {
        throw new Error("not reached");
      },
      getInstance: async () => {
        throw new Error("not reached");
      },
      listInstances: async () => {
        order.push("list");
        return [{ instanceId: 777, label: "gpu-benchmark-RTX_5090-1" }];
      },
      destroyInstance: vi.fn(async (instanceId: number) => {
        order.push(`destroy:${instanceId}`);
        await destroyInstance(instanceId);
      }),
      requestLogsUrl: async () => {
        throw new Error("not reached");
      },
    };

    await main(["--gpu", "RTX 5090"]);

    // The start-of-run sweep destroys the orphan before the first marketplace search.
    expect(order[0]).toBe("list");
    expect(order).toContain("destroy:777");
    expect(order.indexOf("destroy:777")).toBeLessThan(order.indexOf("search"));
    expect(destroyInstance).toHaveBeenCalledWith(777);
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
