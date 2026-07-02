import { describe, expect, it } from "vitest";
import { isWellFormedManifest, type IntegrationManifest } from "../src/manifest.ts";

const base: IntegrationManifest = {
  id: "easypost",
  category: "shipping",
  displayName: "EasyPost",
  summary: "Buy postage and track mail.",
  credential: { kind: "apiKey", scope: "firm" },
  capability: {
    adapterId: "easypost",
    category: "shipping",
    credential: { kind: "apiKey", scope: "firm" },
    operations: { buyLabel: { supported: true } },
    passthroughAvailable: false,
  },
  permission: "shipping:manage",
  defaultEnablement: "off",
};

describe("IntegrationManifest", () => {
  it("accepts a well-formed manifest", () => {
    expect(isWellFormedManifest(base)).toEqual([]);
  });

  it("flags an empty id and a credential/capability category mismatch", () => {
    const bad = { ...base, id: "", capability: { ...base.capability, category: "other" } };
    const problems = isWellFormedManifest(bad);
    expect(problems.some((p) => p.includes("id"))).toBe(true);
    expect(problems.some((p) => p.includes("category"))).toBe(true);
  });
});
