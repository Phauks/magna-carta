// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
import { describe, expect, it, vi } from "vitest";
import { createUsageConsentResolver } from "../../src/usage/consent.ts";

function fakeDatabase(enabled: boolean, optedOut: boolean) {
  return {
    prepare(sql: string) {
      const value = sql.includes("setting") ? JSON.stringify(enabled) : optedOut ? 1 : 0;
      return {
        bind: () => ({
          all: async () =>
            sql.includes("setting") ? { results: [{ value }] } : { results: [{ optedOut: value }] },
        }),
      };
    },
  } as never;
}

describe("usage consent resolver", () => {
  it("is true when firm enabled and user not opted out", async () => {
    const resolver = createUsageConsentResolver();
    expect(await resolver.resolve(fakeDatabase(true, false), "firm_a", "user_a")).toBe(true);
  });
  it("is false when the user opted out", async () => {
    const resolver = createUsageConsentResolver();
    expect(await resolver.resolve(fakeDatabase(true, true), "firm_a", "user_b")).toBe(false);
  });
  it("caches within the TTL (no second read)", async () => {
    let clock = 0;
    const resolver = createUsageConsentResolver({ ttlMs: 1000, clock: () => clock });
    const database = fakeDatabase(true, false);
    const spy = vi.spyOn(database as { prepare: unknown }, "prepare" as never);
    await resolver.resolve(database, "firm_a", "user_c");
    await resolver.resolve(database, "firm_a", "user_c");
    expect(spy).toHaveBeenCalledTimes(2); // firm + member, once; second resolve is a cache hit
    clock = 2000;
    await resolver.resolve(database, "firm_a", "user_c");
    expect(spy).toHaveBeenCalledTimes(4); // TTL expired -> re-read
  });
});
