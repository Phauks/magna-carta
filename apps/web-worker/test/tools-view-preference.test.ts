/*
 * The view-preference PARSE rule, pinned: only the two known views survive a read; anything
 * else (null, a stale/hand-edited value) falls back to the default. The rune store and its
 * localStorage/cross-tab wiring are browser-verified — this pins the one branch worth a unit.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_VIEW, parseToolsView } from "../src/lib/tools/tools-view-preference.ts";

describe("parseToolsView", () => {
  it("keeps a valid stored view", () => {
    expect(parseToolsView("tiles")).toBe("tiles");
    expect(parseToolsView("list")).toBe("list");
  });

  it("falls back to the default for null or unknown values", () => {
    expect(parseToolsView(null)).toBe(DEFAULT_VIEW);
    expect(parseToolsView("grid")).toBe(DEFAULT_VIEW);
    expect(parseToolsView("")).toBe(DEFAULT_VIEW);
  });

  it("defaults to tiles", () => {
    expect(DEFAULT_VIEW).toBe("tiles");
  });
});
