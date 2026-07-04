import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseBenchmarkJson } from "../src/bench-parse.ts";

describe("envelope-contract", () => {
  it("the image's sample output parses into the full baseline mode set", () => {
    const raw = readFileSync(
      new URL("../../../containers/recovery-gpu/bench/sample-output.json", import.meta.url),
      "utf8",
    );
    expect(
      parseBenchmarkJson(raw)
        .throughput.map((entry) => entry.hashcatMode)
        .sort((a, b) => a - b),
    ).toEqual([9400, 9500, 9600, 10500, 10700, 11600, 13600, 17200]);
  });
});
