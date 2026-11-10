import { describe, expect, it } from "vitest";
import { canConvertLocally, enginePlacements } from "../src/placement.ts";

describe("enginePlacements", () => {
  it("marks libvips as both local- and server-capable", () => {
    const placements = enginePlacements("libvips");
    expect(placements).toContain("local");
    expect(placements).toContain("server");
  });

  it("marks LibreOffice, email, and the video transcode as server-only", () => {
    for (const id of ["libreoffice", "email", "transcode"] as const) {
      expect(enginePlacements(id)).toEqual(["server"]);
    }
  });
});

describe("enginePlacements — image-pdf", () => {
  it("marks image-pdf as server-only", () => {
    expect(enginePlacements("image-pdf")).toEqual(["server"]);
  });
});

describe("canConvertLocally", () => {
  it("is true for an all-libvips image conversion (png -> webp)", () => {
    expect(canConvertLocally("png", "webp")).toBe(true);
  });

  it("is false when no path exists (png -> mp4)", () => {
    expect(canConvertLocally("png", "mp4")).toBe(false);
  });

  it("is false for a server-only engine (docx -> pdf via LibreOffice)", () => {
    expect(canConvertLocally("docx", "pdf")).toBe(false);
  });

  it("is false for a multi-hop server-only path (wpd -> odt -> pdf)", () => {
    expect(canConvertLocally("wpd", "pdf")).toBe(false);
  });

  it("is false for a server-only image-pdf conversion (png -> pdf)", () => {
    expect(canConvertLocally("png", "pdf")).toBe(false);
  });

  it("is false for a server-only image-pdf conversion (bmp -> pdf)", () => {
    expect(canConvertLocally("bmp", "pdf")).toBe(false);
  });
});
