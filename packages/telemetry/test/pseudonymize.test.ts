import { describe, expect, it } from "vitest";
import { pseudonymize } from "../src/pseudonymize.ts";

describe("pseudonymize", () => {
  it("is deterministic for the same pepper + identifier", async () => {
    const a = await pseudonymize("pepper", "firm_abc");
    const b = await pseudonymize("pepper", "firm_abc");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
  it("depends on the pepper (different pepper -> different hash)", async () => {
    expect(await pseudonymize("p1", "firm_abc")).not.toBe(await pseudonymize("p2", "firm_abc"));
  });
  it("depends on the identifier (same pepper, different id -> different hash)", async () => {
    expect(await pseudonymize("pepper", "firm_abc")).not.toBe(
      await pseudonymize("pepper", "firm_xyz"),
    );
  });
  it("fails closed on a missing or empty pepper", async () => {
    expect(await pseudonymize(undefined, "firm_abc")).toBeNull();
    expect(await pseudonymize("", "firm_abc")).toBeNull();
  });
});
