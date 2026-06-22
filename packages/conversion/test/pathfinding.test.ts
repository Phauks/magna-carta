import { describe, expect, it } from "vitest";
import { availableConversions, findPath } from "../src/pathfinding.ts";

describe("findPath", () => {
  it("finds a direct edge", () => {
    const result = findPath("png", "webp");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.path.map((e) => `${e.from}->${e.to}`)).toEqual(["png->webp"]);
    }
  });

  it("chains a multi-hop path wpd->odt->pdf when no direct edge exists", () => {
    const result = findPath("wpd", "pdf");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.path.map((e) => `${e.from}->${e.to}`)).toEqual(["wpd->odt", "odt->pdf"]);
    }
  });

  it("returns no-path across disconnected families", () => {
    expect(findPath("png", "mp4")).toEqual({ ok: false, reason: "no-path" });
  });

  it("returns no-path for an unknown format", () => {
    expect(findPath("png", "nope")).toEqual({ ok: false, reason: "no-path" });
  });
});

describe("availableConversions", () => {
  it("lists reachable targets from a raster source (includes multi-hop none here, all direct)", () => {
    const targets = availableConversions("png");
    expect([...targets].sort()).toEqual(["gif", "jpeg", "tiff", "webp"]);
  });

  it("includes multi-hop reachables from wpd (odt and pdf)", () => {
    expect([...availableConversions("wpd")].sort()).toEqual(["odt", "pdf"]);
  });
});
