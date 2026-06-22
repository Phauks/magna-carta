import { describe, expect, it } from "vitest";
import { EDGES, edgesFrom, getFormat } from "../src/registry.ts";

describe("registry", () => {
  it("registers the v1 formats", () => {
    expect(getFormat("png")?.mediaType).toBe("image/png");
    expect(getFormat("pdf")?.mediaType).toBe("application/pdf");
    expect(getFormat("nope")).toBeUndefined();
  });

  it("has a direct libvips edge png->webp", () => {
    const edge = EDGES.find((e) => e.from === "png" && e.to === "webp");
    expect(edge?.engineId).toBe("libvips");
  });

  it("has the two LibreOffice edges that chain wpd->odt->pdf", () => {
    expect(
      EDGES.some((e) => e.from === "wpd" && e.to === "odt" && e.engineId === "libreoffice"),
    ).toBe(true);
    expect(
      EDGES.some((e) => e.from === "odt" && e.to === "pdf" && e.engineId === "libreoffice"),
    ).toBe(true);
  });

  it("edgesFrom returns only edges leaving a node", () => {
    expect(edgesFrom("png").every((e) => e.from === "png")).toBe(true);
    expect(edgesFrom("png").length).toBeGreaterThan(0);
  });
});
