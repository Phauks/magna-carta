import { describe, expect, it } from "vitest";
import { acceptedOptions, compactOptions, optionHeaders, refusedOptions } from "../src/options.ts";

describe("conversion options", () => {
  it("offers size, grey and quality to a JPEG target, the raster engine's whole set", () => {
    expect(acceptedOptions("png", "jpeg")).toEqual(["maxDimension", "quality", "grayscale"]);
  });

  it("offers size and grey, but no quality, to the other raster targets and to image-to-PDF", () => {
    for (const to of ["png", "webp", "tiff", "gif"]) {
      expect(acceptedOptions("jpeg", to)).toEqual(["maxDimension", "grayscale"]);
    }
    expect(acceptedOptions("png", "pdf")).toEqual(["maxDimension", "grayscale"]);
    expect(acceptedOptions("bmp", "pdf")).toEqual(["maxDimension", "grayscale"]);
  });

  it("offers nothing where the final engine reads no options", () => {
    expect(acceptedOptions("docx", "pdf")).toEqual([]);
    expect(acceptedOptions("doc", "pdf")).toEqual([]);
    expect(acceptedOptions("pdf", "searchable-pdf")).toEqual([]);
    expect(acceptedOptions("mov", "mp4")).toEqual([]);
    expect(acceptedOptions("eml", "pdf")).toEqual([]);
    expect(acceptedOptions("png", "docx")).toEqual([]);
  });

  it("names every asked-for option a conversion cannot honour", () => {
    expect(
      refusedOptions("png", "jpeg", { maxDimension: 800, quality: 60, grayscale: true }),
    ).toEqual([]);
    expect(refusedOptions("png", "webp", { quality: 60 })).toEqual(["quality"]);
    expect(refusedOptions("docx", "pdf", { maxDimension: 800, grayscale: true })).toEqual([
      "maxDimension",
      "grayscale",
    ]);
    // grayscale false is not a request.
    expect(refusedOptions("docx", "pdf", { grayscale: false })).toEqual([]);
  });

  it("drops empty options and spells the rest as the engine's headers", () => {
    expect(compactOptions({ grayscale: false })).toBeUndefined();
    expect(compactOptions(undefined)).toBeUndefined();
    expect(compactOptions({ maxDimension: 1200, grayscale: false })).toEqual({
      maxDimension: 1200,
    });
    expect(optionHeaders({ maxDimension: 1200, quality: 80, grayscale: true })).toEqual({
      "x-max-dimension": "1200",
      "x-quality": "80",
      "x-grayscale": "true",
    });
    expect(optionHeaders(undefined)).toEqual({});
  });
});
