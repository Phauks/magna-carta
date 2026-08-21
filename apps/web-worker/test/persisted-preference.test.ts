/*
 * The persisted-preference codecs, pinned: the two read-time validators every migrated call site
 * now shares. stringUnionPreference keeps only a member of its set and folds everything else to
 * the fallback; jsonPreference routes absent, empty, unparseable, and partial payloads through the
 * caller's normalize, and hands a full payload straight in. The rune store and its localStorage /
 * cross-tab wiring are browser-verified — this pins the pure branches worth a unit.
 */
import { describe, expect, it } from "vitest";
import {
  jsonPreference,
  stringUnionPreference,
} from "../src/lib/preferences/persisted-preference.ts";

describe("stringUnionPreference", () => {
  const codec = stringUnionPreference("mc-example-view", ["tiles", "list"], "tiles");

  it("keeps a member of the allowed set", () => {
    expect(codec.decode("tiles")).toBe("tiles");
    expect(codec.decode("list")).toBe("list");
  });

  it("falls back for null, empty, or unknown values", () => {
    expect(codec.decode(null)).toBe("tiles");
    expect(codec.decode("")).toBe("tiles");
    expect(codec.decode("gallery")).toBe("tiles");
  });

  it("encodes to the raw string", () => {
    expect(codec.encode("list")).toBe("list");
  });

  it("carries its storage key", () => {
    expect(codec.storageKey).toBe("mc-example-view");
  });
});

describe("jsonPreference", () => {
  interface Flags {
    enabled: boolean;
    count: number;
  }
  const fallback = (): Flags => ({ enabled: true, count: 0 });
  const normalize = (parsed: unknown): Flags => {
    const value = fallback();
    if (parsed !== null && typeof parsed === "object") {
      const record = parsed as Partial<Flags>;
      if (typeof record.enabled === "boolean") value.enabled = record.enabled;
      if (typeof record.count === "number") value.count = record.count;
    }
    return value;
  };
  const codec = jsonPreference("mc-example-flags", normalize);

  it("normalizes an absent key to the fallback", () => {
    expect(codec.decode(null)).toEqual({ enabled: true, count: 0 });
  });

  it("normalizes an unparseable payload to the fallback", () => {
    expect(codec.decode("{not json")).toEqual({ enabled: true, count: 0 });
  });

  it("fills missing fields from the fallback and keeps valid ones", () => {
    expect(codec.decode(JSON.stringify({ enabled: false }))).toEqual({ enabled: false, count: 0 });
  });

  it("drops fields of the wrong type", () => {
    expect(codec.decode(JSON.stringify({ enabled: "yes", count: 3 }))).toEqual({
      enabled: true,
      count: 3,
    });
  });

  it("returns a fresh object each decode (no shared mutable default)", () => {
    const first = codec.decode(null);
    const second = codec.decode(null);
    expect(first).not.toBe(second);
  });

  it("round-trips through encode", () => {
    const value = { enabled: false, count: 7 };
    expect(codec.decode(codec.encode(value))).toEqual(value);
  });
});
