/*
 * The square a record's picture is cut to, pinned: the frame is always covered, a drag never shows
 * an edge, and what the frame shows is the part of the original that is saved.
 */
import { describe, expect, it } from "vitest";
import {
  clampOffset,
  clampZoom,
  cropSource,
  isOfferedPhotoFormat,
  MAXIMUM_ZOOM,
  MINIMUM_ZOOM,
  PHOTO_ACCEPT,
  PHOTO_FORMATS,
} from "../src/lib/directory/photo-crop.ts";

const LANDSCAPE = { width: 800, height: 400 };

describe("cropping a picture to a square", () => {
  it("at zoom 1 fits the shorter side and takes the centre", () => {
    expect(cropSource(LANDSCAPE, 200, 1, { x: 0, y: 0 })).toEqual({ x: 200, y: 0, side: 400 });
  });

  it("zooming in takes a smaller square about the same centre", () => {
    expect(cropSource(LANDSCAPE, 200, 2, { x: 0, y: 0 })).toEqual({ x: 300, y: 100, side: 200 });
  });

  it("dragging right shows more of the left of the picture", () => {
    const source = cropSource(LANDSCAPE, 200, 1, { x: 50, y: 0 });
    expect(source.x).toBeLessThan(200);
  });

  it("never lets an edge of the picture into the frame", () => {
    // At zoom 1 the landscape picture can move 100 frame pixels sideways and none up or down.
    expect(clampOffset(LANDSCAPE, 200, 1, { x: 500, y: 500 })).toEqual({ x: 100, y: 0 });
    const source = cropSource(LANDSCAPE, 200, 1, { x: 500, y: -500 });
    expect(source.x).toBe(0);
    expect(source.y).toBe(0);
  });

  it("keeps the zoom inside the range the controls offer", () => {
    expect(clampZoom(0.2)).toBe(MINIMUM_ZOOM);
    expect(clampZoom(99)).toBe(MAXIMUM_ZOOM);
  });
});

describe("the formats a photo may be chosen from", () => {
  it("names every offered format by media type and by extension in the picker filter", () => {
    for (const format of PHOTO_FORMATS) {
      expect(PHOTO_ACCEPT.split(",")).toContain(format.mediaType);
      for (const extension of format.extensions)
        expect(PHOTO_ACCEPT.split(",")).toContain(extension);
    }
  });

  it("takes an offered media type and refuses one that is not", () => {
    expect(isOfferedPhotoFormat({ name: "face.webp", type: "image/webp" })).toBe(true);
    expect(isOfferedPhotoFormat({ name: "logo.svg", type: "image/svg+xml" })).toBe(true);
    expect(isOfferedPhotoFormat({ name: "retainer.pdf", type: "application/pdf" })).toBe(false);
    expect(isOfferedPhotoFormat({ name: "iphone.heic", type: "image/heic" })).toBe(false);
  });

  it("falls back to the extension when the browser gives no media type", () => {
    expect(isOfferedPhotoFormat({ name: "FACE.AVIF", type: "" })).toBe(true);
    expect(isOfferedPhotoFormat({ name: "notes.docx", type: "" })).toBe(false);
  });
});
