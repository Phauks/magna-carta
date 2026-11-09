import { describe, expect, it } from "vitest";
import {
  PLATFORM_DEFAULT_REASONING_TIER,
  REASONING_TIERS,
  reasoningModelForTier,
} from "../src/catalog.ts";
import { parseReasoningTierOverrides, resolveReasoningTier } from "../src/reasoning-tier.ts";

describe("reasoning tiers", () => {
  it("every tier has exactly one occupant, so resolution is total", () => {
    for (const tier of REASONING_TIERS) {
      expect(reasoningModelForTier(tier).slot, tier).toBe("reasoning");
    }
  });

  it("every tier occupant is ZDR-eligible", () => {
    for (const tier of REASONING_TIERS) {
      expect(reasoningModelForTier(tier).zdrEligible, tier).toBe(true);
    }
  });

  it("resolves to the catalog occupant when nothing is configured", () => {
    const resolution = resolveReasoningTier(PLATFORM_DEFAULT_REASONING_TIER);
    expect(resolution.entry).toBe(reasoningModelForTier(PLATFORM_DEFAULT_REASONING_TIER));
    expect(resolution.overrideApplied).toBe(false);
    expect(resolution.rejectedOverride).toBeUndefined();
  });
});

describe("the deploy-configuration override", () => {
  it("re-points a tier at another curated, eligible reasoning model", () => {
    const balanced = reasoningModelForTier("balanced");
    const resolution = resolveReasoningTier("most-capable", { "most-capable": balanced.modelId });
    expect(resolution.entry.modelId).toBe(balanced.modelId);
    expect(resolution.overrideApplied).toBe(true);
  });

  it("REFUSES a model that is not in the catalog, and falls back to the occupant", () => {
    // The load-bearing case. A deploy-time string carries no verification that a model is
    // zero-data-retention eligible, so an unknown identifier can never be honoured — otherwise the
    // catalog stops being exhaustive and a non-eligible model becomes representable through config.
    const resolution = resolveReasoningTier("most-capable", {
      "most-capable": "anthropic/claude-fable-5-1",
    });
    expect(resolution.overrideApplied).toBe(false);
    expect(resolution.entry).toBe(reasoningModelForTier("most-capable"));
    expect(resolution.rejectedOverride).toBe("anthropic/claude-fable-5-1");
    expect(resolution.rejectionReason).toBe("not-in-catalog");
  });

  it("REFUSES a catalog model that is not a reasoning model", () => {
    const resolution = resolveReasoningTier("most-capable", {
      "most-capable": "anthropic/claude-haiku-5-5",
    });
    expect(resolution.overrideApplied).toBe(false);
    expect(resolution.rejectionReason).toBe("not-a-reasoning-model");
  });

  it("reports the rejection rather than swallowing it", () => {
    const resolution = resolveReasoningTier("balanced", { balanced: "provider/typo" });
    expect(resolution.rejectedOverride).toBe("provider/typo");
  });

  it("treats an override naming the current occupant as no override at all", () => {
    const occupant = reasoningModelForTier("balanced");
    const resolution = resolveReasoningTier("balanced", { balanced: occupant.modelId });
    expect(resolution.overrideApplied).toBe(false);
    expect(resolution.entry).toBe(occupant);
  });

  it("leaves other tiers untouched", () => {
    const resolution = resolveReasoningTier("balanced", {
      "most-capable": reasoningModelForTier("balanced").modelId,
    });
    expect(resolution.entry).toBe(reasoningModelForTier("balanced"));
    expect(resolution.overrideApplied).toBe(false);
  });
});

describe("parsing the configured value", () => {
  it("reads an absent or empty value as no overrides", () => {
    expect(parseReasoningTierOverrides(undefined)).toEqual({ overrides: {}, malformed: false });
    expect(parseReasoningTierOverrides("   ")).toEqual({ overrides: {}, malformed: false });
  });

  it("reads a tier-to-model object", () => {
    expect(parseReasoningTierOverrides('{"most-capable":"anthropic/claude-sonnet-5-5"}')).toEqual({
      overrides: { "most-capable": "anthropic/claude-sonnet-5-5" },
      malformed: false,
    });
  });

  it("reports malformed JSON without throwing — a bad variable must not stop the platform serving", () => {
    expect(parseReasoningTierOverrides("{not json")).toEqual({ overrides: {}, malformed: true });
    expect(parseReasoningTierOverrides('["most-capable"]')).toEqual({
      overrides: {},
      malformed: true,
    });
  });

  it("drops an unknown tier but keeps a good one beside it", () => {
    const parsed = parseReasoningTierOverrides(
      '{"balanced":"anthropic/claude-sonnet-5-5","cheapest":"anthropic/claude-haiku-4-5"}',
    );
    expect(parsed.overrides).toEqual({ balanced: "anthropic/claude-sonnet-5-5" });
    expect(parsed.malformed).toBe(true);
  });

  it("a parsed override still goes through catalog validation, so parsing widens nothing", () => {
    const parsed = parseReasoningTierOverrides('{"most-capable":"provider/anything-at-all"}');
    const resolution = resolveReasoningTier("most-capable", parsed.overrides);
    expect(resolution.overrideApplied).toBe(false);
    expect(resolution.entry).toBe(reasoningModelForTier("most-capable"));
  });
});
