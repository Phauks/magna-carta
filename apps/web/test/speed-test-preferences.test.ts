/*
 * The preferences PARSE rule, pinned: an absent or malformed stored value falls back to both
 * defaults; a stored object naming only one flag keeps the other's default; unknown keys are
 * ignored. Both defaults are false — asserted explicitly, because a default of true on either would
 * spend a firm's bandwidth without being asked. The rune store's localStorage/cross-tab wiring is
 * browser-verified; this pins the one branch worth a unit.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREFERENCES,
  parsePreferences,
} from "../src/lib/tools/speed-test/speed-test-preferences.ts";

describe("DEFAULT_PREFERENCES", () => {
  it("defaults both flags to false", () => {
    expect(DEFAULT_PREFERENCES.lowData).toBe(false);
    expect(DEFAULT_PREFERENCES.autoStart).toBe(false);
  });
});

describe("parsePreferences", () => {
  it("yields both flags false when nothing is stored", () => {
    expect(parsePreferences(null)).toEqual({ lowData: false, autoStart: false });
  });

  it("yields both flags false for malformed JSON", () => {
    expect(parsePreferences("{not json")).toEqual({ lowData: false, autoStart: false });
  });

  it("yields both flags false for a JSON value that is not an object", () => {
    expect(parsePreferences("true")).toEqual({ lowData: false, autoStart: false });
    expect(parsePreferences("42")).toEqual({ lowData: false, autoStart: false });
    expect(parsePreferences("null")).toEqual({ lowData: false, autoStart: false });
  });

  it("keeps a valid stored pair", () => {
    expect(parsePreferences('{"lowData":true,"autoStart":true}')).toEqual({
      lowData: true,
      autoStart: true,
    });
  });

  it("keeps the other flag's default when only one is stored", () => {
    expect(parsePreferences('{"lowData":true}')).toEqual({ lowData: true, autoStart: false });
    expect(parsePreferences('{"autoStart":true}')).toEqual({ lowData: false, autoStart: true });
  });

  it("ignores unknown keys and non-boolean values", () => {
    expect(parsePreferences('{"lowData":"yes","somethingElse":true}')).toEqual({
      lowData: false,
      autoStart: false,
    });
  });
});
