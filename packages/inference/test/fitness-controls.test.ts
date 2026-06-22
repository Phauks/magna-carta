import { describe, expect, it } from "vitest";
import type { FirmId } from "@magna-carta/identifiers/types";
import { deriveFirmMetadata, gatewayOptions, GATEWAY_ID } from "../src/gateway.ts";

// A representative spread of firms/slots/envs — the controls invariant holds for every one.
const CASES: Array<[FirmId, string, string]> = [
  ["firm_1" as FirmId, "reasoning", "production"],
  ["firm_2" as FirmId, "utility", "production"],
  ["firm_3" as FirmId, "embedding", "development"],
];

describe("caching-off fitness", () => {
  it("every request skips the cache and sets no cache key", () => {
    for (const [firmId, slot, env] of CASES) {
      const options = gatewayOptions(firmId, slot, env);
      expect(options.skipCache).toBe(true);
      // A cache key alone caches for minutes even with caching off — none may appear.
      expect(options).not.toHaveProperty("cacheKey");
    }
  });

  it("logging is off on every request (no prompt/response body is logged)", () => {
    for (const [firmId, slot, env] of CASES) {
      expect(gatewayOptions(firmId, slot, env).collectLog).toBe(false);
    }
  });
});

// The real spec invariant: a cache key, IF ever present, must be firm-id-prefixed (the default key
// carries no firm dimension under shared credentials, so two firms could collide). This guard fails any
// controls object that grows a non-firm-prefixed cache key, so a future "add caching" change cannot
// silently weaponize the shared default.
function cacheKeyIsFirmPrefixedOrAbsent(options: {
  metadata: Record<string, string>;
  cacheKey?: string;
}): boolean {
  if (options.cacheKey === undefined) return true;
  // firm_id is always present in every controls object produced by gatewayOptions; the index type is
  // widened to Record<string, string> to accept the real GatewayOptions type.
  const firmId = options.metadata["firm_id"] ?? "";
  return options.cacheKey.startsWith(`${firmId}:`);
}

describe("firm-prefixed-cache-key fitness", () => {
  it("holds for the shipped controls (no key today) and would reject a bare cache key", () => {
    for (const [firmId, slot, env] of CASES) {
      expect(cacheKeyIsFirmPrefixedOrAbsent(gatewayOptions(firmId, slot, env))).toBe(true);
    }
    // A hypothetical non-firm-prefixed key is rejected by the guard.
    expect(
      cacheKeyIsFirmPrefixedOrAbsent({ metadata: { firm_id: "firm_1" }, cacheKey: "global-key" }),
    ).toBe(false);
    expect(
      cacheKeyIsFirmPrefixedOrAbsent({ metadata: { firm_id: "firm_1" }, cacheKey: "firm_1:abc" }),
    ).toBe(true);
  });
});

describe("derived-firm-metadata fitness", () => {
  it("every request carries a derived non-empty firm_id, <=5 keys, no model tag", () => {
    for (const [firmId, slot, env] of CASES) {
      const metadata = deriveFirmMetadata(firmId, slot, env);
      // firm_id is always present; the index type is Record<string, string> (noUncheckedIndexedAccess).
      expect((metadata["firm_id"] ?? "").length).toBeGreaterThan(0);
      expect(Object.keys(metadata).length).toBeLessThanOrEqual(5);
      expect(metadata).not.toHaveProperty("model");
      expect(gatewayOptions(firmId, slot, env).id).toBe(GATEWAY_ID);
    }
  });
});
