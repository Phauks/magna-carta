import { describe, expect, it } from "vitest";
import { engineTargetFor } from "../src/engine-dispatch.ts";

describe("engineTargetFor", () => {
  it("routes both raster-served engine ids to the raster container", () => {
    expect(engineTargetFor("libvips")).toBe("raster");
    expect(engineTargetFor("image-pdf")).toBe("raster");
  });

  it("routes a missing engine id to the raster container (app worker deployed ahead of this one)", () => {
    expect(engineTargetFor(null)).toBe("raster");
  });

  it("returns undefined for an engine with no Container here", () => {
    expect(engineTargetFor("libreoffice")).toBeUndefined();
    expect(engineTargetFor("email")).toBeUndefined();
    expect(engineTargetFor("ffmpeg")).toBeUndefined();
    expect(engineTargetFor("nonsense")).toBeUndefined();
  });
});
