/*
 * The scan engine's reading on the File Safety page, pinned on its pure model: the composite the
 * container stamps itself with splits into three named lines and never into a partial one, the
 * depth options are their word alone, and what a depth means is stated from the verdict model
 * rather than invented.
 */
import { describe, expect, it } from "vitest";
import {
  SCAN_TIER_ALWAYS_COUNTS,
  SCAN_TIER_DEFINITION,
  SCAN_TIER_RULES_SOON_LINE,
  scanTierFromValue,
  scanTierMeaning,
  scanTierRulesDefinition,
} from "$lib/file-manager/scan-policy-draft.svelte.ts";
import {
  decomposeScanEngineVersion,
  SCAN_ENGINE_UNREPORTED_DETAIL,
  scanEngineReadingLines,
} from "$lib/versions/scan-engine-version.ts";

describe("the scan engine's composite version", () => {
  it("splits into the engine, the YARA ruleset and the malware definitions", () => {
    expect(
      decomposeScanEngineVersion("engine/3.7.1+yara-rules/2026-09-01+clamav-db/27544"),
    ).toEqual({
      engineCode: "3.7.1",
      yaraRuleset: "2026-09-01",
      malwareDefinitions: "27544",
    });
  });

  it("refuses a partial composite rather than labelling a value wrongly", () => {
    expect(decomposeScanEngineVersion("engine/3.7.1+clamav-db/27544")).toBeNull();
    expect(decomposeScanEngineVersion("engine/+yara-rules/x+clamav-db/y")).toBeNull();
    expect(decomposeScanEngineVersion("")).toBeNull();
  });

  it("reads as three named lines, engine first", () => {
    const lines = scanEngineReadingLines({
      engineCode: "3.7.1",
      yaraRuleset: "2026-09-01",
      malwareDefinitions: "27544",
    });
    expect(lines.map((line) => line.label)).toEqual([
      "Engine",
      "YARA ruleset",
      "Malware definitions",
    ]);
    expect(lines[0]?.value).toBe("3.7.1");
  });

  it("says what an absent engine means for uploads, without an em dash", () => {
    expect(SCAN_ENGINE_UNREPORTED_DETAIL).toMatch(/unscanned/);
    expect(SCAN_ENGINE_UNREPORTED_DETAIL).not.toContain("—");
  });
});

describe("the scan depth options", () => {
  it("read Core, Extended and Full, and nothing else in the option itself", () => {
    // Owner ruling, 2026-09-11: the option is its word; what it means is said beneath the engine.
    expect(SCAN_TIER_DEFINITION.options?.map((option) => option.label)).toEqual([
      "Core",
      "Extended",
      "Full",
    ]);
  });

  it("state each depth's meaning from the verdict model, and what counts at every depth", () => {
    expect(scanTierMeaning("core")).toMatch(/known malware/);
    expect(scanTierMeaning("extended")).toMatch(/above the threshold/);
    expect(scanTierMeaning("full")).toMatch(/every rule/i);
    // The antivirus signatures and the structural checks sit outside the tiers.
    expect(SCAN_TIER_ALWAYS_COUNTS).toMatch(/every depth/);
    for (const tier of ["core", "extended", "full"] as const) {
      const definition = scanTierRulesDefinition(tier);
      expect(definition.label).toBe("Rules At This Depth");
      expect(definition.description).toContain(scanTierMeaning(tier));
      expect(definition.description).toContain(SCAN_TIER_ALWAYS_COUNTS);
      expect(definition.description).not.toContain("—");
    }
  });

  it("marks the rule families as what the engine does not report yet, never a list", () => {
    expect(SCAN_TIER_RULES_SOON_LINE).toMatch(/once the scanner reports them/);
  });

  it("reads a staged value back to its tier, and the default for anything else", () => {
    expect(scanTierFromValue("core")).toBe("core");
    expect(scanTierFromValue("full")).toBe("full");
    expect(scanTierFromValue("not a tier")).toBe("extended");
    expect(scanTierFromValue(true)).toBe("extended");
  });
});
