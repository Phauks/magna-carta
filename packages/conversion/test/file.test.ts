import { describe, expect, it } from "vitest";
import { availableTargets, convertFile, detectFormat } from "../src/file.ts";
import { makeImage } from "./support/vips.ts";
// Side-effect import: registers libvips so convertFile's default resolver can run image conversions.
import "../src/adapters/libvips/index.ts";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function makePngFile(name = "photo.png"): Promise<File> {
  return new File([await makeImage(".png")], name, { type: "image/png" });
}

describe("detectFormat", () => {
  it("detects by MIME type", () => {
    expect(detectFormat({ name: "anything", type: "image/jpeg" })).toBe("jpeg");
  });
  it("detects by extension (case-insensitive) when type is missing or unknown", () => {
    expect(detectFormat({ name: "PHOTO.PNG" })).toBe("png");
    expect(detectFormat({ name: "a.webp", type: "" })).toBe("webp");
    expect(detectFormat({ name: "report.docx" })).toBe("docx");
  });
  it("returns undefined for an unrecognized file", () => {
    expect(detectFormat({ name: "mystery.xyz" })).toBeUndefined();
    expect(detectFormat({ name: "noextension" })).toBeUndefined();
  });
});

describe("availableTargets", () => {
  it("lists the reachable targets for a recognized file (includes pdf via image-pdf engine)", () => {
    const targets = availableTargets({ name: "photo.png", type: "image/png" });
    // pdf via image-pdf, and searchable-pdf via image-pdf then the ocr edge.
    expect([...targets].sort()).toEqual(["gif", "jpeg", "pdf", "searchable-pdf", "tiff", "webp"]);
  });
  it("returns [] for an unrecognized file", () => {
    expect(availableTargets({ name: "mystery.xyz" })).toEqual([]);
  });
});

describe("convertFile", () => {
  it("converts a real PNG file to WebP and renames the output", async () => {
    const file = await makePngFile("vacation.png");
    const result = await convertFile(file, "webp");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.filename).toBe("vacation.webp");
      expect(result.blob.type).toBe("image/webp");
      const head = new Uint8Array(await result.blob.arrayBuffer());
      expect(head[0]).toBe(0x52); // 'R' (RIFF/WebP)
    }
  });
  it("reports unknown-source-format for an unrecognized file", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "mystery.xyz");
    const result = await convertFile(file, "webp");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unknown-source-format");
  });
  it("passes through unsupported-edge when no path exists", async () => {
    const file = await makePngFile();
    const result = await convertFile(file, "mp4");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unsupported-edge");
  });
  it("passes through engine-not-implemented for a deferred engine (docx -> pdf)", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "contract.docx", { type: DOCX });
    const result = await convertFile(file, "pdf");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("engine-not-implemented");
  });
});
