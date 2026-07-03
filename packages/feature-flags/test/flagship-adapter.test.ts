import { describe, expect, it } from "vitest";
import { flagshipEvaluator } from "../src/index.ts";
import type { FlagContext } from "../src/port.ts";
import type { FlagshipBinding } from "../src/flagship-adapter.ts";

const context: FlagContext = { targetingKey: "usr_1", firmId: "firm_1", channel: "beta" };

describe("flagshipEvaluator", () => {
  it("returns the binding's value on a successful call", async () => {
    const binding: FlagshipBinding = {
      getBooleanValue: () => Promise.resolve(true),
    };
    const result = await flagshipEvaluator(binding).getBoolean(
      "release-channels.smoke",
      false,
      context,
    );
    expect(result).toBe(true);
  });

  it("falls back to the supplied default (false) when the binding throws", async () => {
    const binding: FlagshipBinding = {
      getBooleanValue: () => Promise.reject(new Error("binding unavailable")),
    };
    const result = await flagshipEvaluator(binding).getBoolean(
      "release-channels.smoke",
      false,
      context,
    );
    expect(result).toBe(false);
  });

  it("falls back to the supplied default (true) when the binding throws", async () => {
    const binding: FlagshipBinding = {
      getBooleanValue: () => Promise.reject(new Error("binding unavailable")),
    };
    const result = await flagshipEvaluator(binding).getBoolean(
      "release-channels.smoke",
      true,
      context,
    );
    expect(result).toBe(true);
  });
});
