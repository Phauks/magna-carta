import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planMigration, roundTripOk, slugFor } from "./migrate-decisions.mjs";

const sample = readFileSync(join(import.meta.dirname, "test/fixtures/register-sample.txt"), "utf8");

describe("slugFor", () => {
  it("kebab-cases area + body lead", () => {
    expect(
      slugFor({ number: 1, area: "API", body: "Route-metadata model — one chokepoint." }),
    ).toMatch(/^api-route-metadata/);
  });
});

describe("planMigration", () => {
  it("produces one file per ADR with a padded numbered path", () => {
    const plan = planMigration(sample);
    expect(plan).toHaveLength(3);
    expect(plan[0].path).toMatch(/^docs\/decisions\/0001-/);
  });
});

describe("roundTripOk", () => {
  it("is lossless on the sample register", () => {
    expect(roundTripOk(sample)).toBe(true);
  });
});
