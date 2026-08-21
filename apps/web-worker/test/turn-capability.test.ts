/*
 * Whether packet loss can be measured at all. Asking first is what keeps a missing session or an
 * unprovisioned key from aborting the whole run — the engine is only ever told to measure packet
 * loss when the credentials behind it actually exist.
 */
import { describe, expect, it } from "vitest";
import { probeTurnCapability } from "../src/lib/tools/speed-test/turn-capability.ts";

describe("probeTurnCapability", () => {
  it("is available when credentials are issued", async () => {
    expect(await probeTurnCapability(async () => 200)).toEqual({ available: true });
  });

  it("names a missing session", async () => {
    expect(await probeTurnCapability(async () => 401)).toEqual({
      available: false,
      reason: "unauthenticated",
    });
  });

  it("names a missing permission", async () => {
    expect(await probeTurnCapability(async () => 403)).toEqual({
      available: false,
      reason: "forbidden",
    });
  });

  it("names an unconfigured deployment", async () => {
    expect(await probeTurnCapability(async () => 503)).toEqual({
      available: false,
      reason: "not-configured",
    });
  });

  it("falls back to unavailable for any other answer", async () => {
    expect(await probeTurnCapability(async () => 502)).toEqual({
      available: false,
      reason: "unavailable",
    });
  });

  it("treats a transport failure as unavailable rather than throwing", async () => {
    const capability = await probeTurnCapability(async () => {
      throw new Error("offline");
    });
    expect(capability).toEqual({ available: false, reason: "unavailable" });
  });
});
