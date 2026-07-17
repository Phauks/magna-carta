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

describe("findPath — image-pdf engine", () => {
  it("finds a direct png->pdf edge using the image-pdf engine", () => {
    const result = findPath("png", "pdf");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.path).toHaveLength(1);
      expect(result.path[0]!.engineId).toBe("image-pdf");
    }
  });

  it("finds a direct jpeg->pdf edge using the image-pdf engine", () => {
    const result = findPath("jpeg", "pdf");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.path[0]!.engineId).toBe("image-pdf");
  });

  it("finds a direct webp->pdf edge using the image-pdf engine", () => {
    const result = findPath("webp", "pdf");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.path[0]!.engineId).toBe("image-pdf");
  });

  it("finds a direct tiff->pdf edge using the image-pdf engine", () => {
    const result = findPath("tiff", "pdf");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.path[0]!.engineId).toBe("image-pdf");
  });

  it("finds a direct gif->pdf edge using the image-pdf engine", () => {
    const result = findPath("gif", "pdf");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.path[0]!.engineId).toBe("image-pdf");
  });

  it("finds a direct bmp->pdf edge using the image-pdf engine", () => {
    const result = findPath("bmp", "pdf");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.path[0]!.engineId).toBe("image-pdf");
  });
});

describe("availableConversions", () => {
  it("lists reachable targets from a raster source (includes pdf via image-pdf engine)", () => {
    const targets = availableConversions("png");
    // pdf is reachable via image-pdf, and searchable-pdf via image-pdf then the ocr edge.
    expect([...targets].sort()).toEqual(["gif", "jpeg", "pdf", "searchable-pdf", "tiff", "webp"]);
  });

  it("includes multi-hop reachables from wpd (odt and pdf)", () => {
    expect([...availableConversions("wpd")].sort()).toEqual(["odt", "pdf", "searchable-pdf"]);
  });
});
