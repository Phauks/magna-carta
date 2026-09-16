import { describe, expect, it } from "vitest";
import { DIMENSIONS, NEEDS_WASM, parseList, selectDimensions } from "./plan.mjs";

describe("selectDimensions", () => {
  it("runs everything, in the declared order, by default", () => {
    const { selected, skippedByFlag } = selectDimensions();
    expect(selected).toEqual(DIMENSIONS);
    expect(skippedByFlag.size).toBe(0);
  });

  it("narrows with --only, keeping the declared order", () => {
    const { selected } = selectDimensions({ only: ["tests", "format"] });
    expect(selected).toEqual(["format", "tests"]);
  });

  it("removes with --skip and records why", () => {
    const { selected, skippedByFlag } = selectDimensions({ skip: ["containers", "audit"] });
    expect(selected).not.toContain("containers");
    expect(selected).not.toContain("audit");
    expect(skippedByFlag.get("audit")).toBe("named by --skip");
  });

  it("--checks-only drops only the test battery", () => {
    const { selected, skippedByFlag } = selectDimensions({ checksOnly: true });
    expect(selected).toEqual(DIMENSIONS.filter((name) => name !== "tests"));
    expect(skippedByFlag.get("tests")).toBe("--checks-only");
  });

  it("refuses a name that is not a dimension rather than skipping nothing quietly", () => {
    expect(() => selectDimensions({ skip: ["test"] })).toThrow(/"test" is not a dimension/);
    expect(() => selectDimensions({ only: ["lints"] })).toThrow(/"lints" is not a dimension/);
  });

  it("every dimension that needs the artefacts is a real dimension", () => {
    for (const name of NEEDS_WASM) expect(DIMENSIONS).toContain(name);
  });
});

describe("parseList", () => {
  it("reads a comma-separated list, repeated flags accumulating", () => {
    expect(parseList(["--skip", "a,b", "--skip", "c"], "--skip")).toEqual(["a", "b", "c"]);
  });

  it("refuses a flag with no value", () => {
    expect(() => parseList(["--skip"], "--skip")).toThrow(/needs a comma-separated list/);
    expect(() => parseList(["--skip", "--all"], "--skip")).toThrow(/needs a comma-separated list/);
  });
});
