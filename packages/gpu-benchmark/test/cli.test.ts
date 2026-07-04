import { afterEach, describe, expect, it } from "vitest";

import { main, parseArgs, selectTargets, CliUsageError } from "../src/cli.ts";
import { BENCHMARK_SHORTLIST } from "../src/offer-filter.ts";

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
    await expect(main(["--image", "some/image:tag"])).rejects.toThrow(/VAST_API_KEY/);
  });

  it("refuses to run when VAST_API_KEY is empty", async () => {
    process.env.VAST_API_KEY = "";
    await expect(main(["--image", "some/image:tag"])).rejects.toThrow(/VAST_API_KEY/);
  });

  it("parseArgs requires --image", () => {
    expect(() => parseArgs([])).toThrow(CliUsageError);
    expect(() => parseArgs(["--gpu", "RTX_4090"])).toThrow(/--image/);
  });

  it("parseArgs reads --image and optional --gpu", () => {
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
    const targets = selectTargets(BENCHMARK_SHORTLIST, "rtx_4090");
    expect(targets.length).toBeGreaterThan(1);
    for (const target of targets) {
      expect(target.gpuName).toBe("RTX_4090");
    }
  });

  it("selectTargets throws a clear error for an unknown GPU", () => {
    expect(() => selectTargets(BENCHMARK_SHORTLIST, "NOT_A_REAL_GPU")).toThrow(CliUsageError);
    expect(() => selectTargets(BENCHMARK_SHORTLIST, "NOT_A_REAL_GPU")).toThrow(/NOT_A_REAL_GPU/);
  });
});
