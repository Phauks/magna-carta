import { describe, expect, it } from "vitest";
import { engineTargetFor } from "../src/engine-dispatch.ts";

describe("engineTargetFor", () => {
  it("routes both raster-served engine ids to the raster container", () => {
    expect(engineTargetFor("libvips")).toBe("raster");
    expect(engineTargetFor("image-pdf")).toBe("raster");
  });

  it("routes the office engine id to the LibreOffice container", () => {
    expect(engineTargetFor("libreoffice")).toBe("libreoffice");
  });

  it("routes the video engine id to the transcode container", () => {
    expect(engineTargetFor("transcode")).toBe("transcode");
  });

  it("routes a missing engine id to the raster container (app worker deployed ahead of this one)", () => {
    expect(engineTargetFor(null)).toBe("raster");
  });

  it("returns undefined for an engine with no Container here", () => {
    expect(engineTargetFor("email")).toBeUndefined();
    expect(engineTargetFor("nonsense")).toBeUndefined();
  });
});
