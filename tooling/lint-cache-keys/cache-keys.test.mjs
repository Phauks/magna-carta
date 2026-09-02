import { describe, expect, it } from "vitest";
import { compareKeys, wasmCacheKeys } from "./cache-keys.mjs";

const KEY = "wasm-${{ runner.os }}-${{ hashFiles('crates/**/*.rs', 'crates/Cargo.lock') }}";

const workflowWith = (...keys) =>
  [
    "jobs:",
    "  build:",
    "    steps:",
    "      - uses: actions/cache@v6",
    "        with:",
    "          path: packages/pdf/src/pkg",
    ...keys.map((key) => `          key: ${key}`),
    "      - uses: actions/cache@v6",
    "        with:",
    "          key: tsbuild-${{ runner.os }}-node22-${{ github.sha }}",
  ].join("\n");

describe("reading the WASM cache key out of a workflow", () => {
  it("finds the wasm key and ignores every other cache's key", () => {
    expect(wasmCacheKeys(workflowWith(KEY))).toEqual([KEY]);
  });

  it("reports every wasm key it finds, so a duplicate is visible rather than merged", () => {
    expect(wasmCacheKeys(workflowWith(KEY, KEY))).toHaveLength(2);
  });

  it("finds none in a workflow that restores no WASM cache", () => {
    expect(wasmCacheKeys(workflowWith())).toEqual([]);
  });
});

describe("holding the gate and the seed to one key", () => {
  it("passes when both hold exactly the same key", () => {
    expect(compareKeys({ gateKeys: [KEY], seedKeys: [KEY] })).toEqual([]);
  });

  it("fails when the keys differ, naming both", () => {
    const problems = compareKeys({ gateKeys: [KEY], seedKeys: [`${KEY}-v2`] });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("warms nothing");
    expect(problems[0]).toContain(`${KEY}-v2`);
  });

  it("fails when either side holds no key or more than one", () => {
    expect(compareKeys({ gateKeys: [], seedKeys: [KEY] })).toHaveLength(1);
    expect(compareKeys({ gateKeys: [KEY, KEY], seedKeys: [KEY] })).toHaveLength(1);
    expect(compareKeys({ gateKeys: [KEY], seedKeys: [] })).toHaveLength(1);
  });
});
