import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { detect } from "../src/detect.ts";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function minimalDocx(): Uint8Array {
  return zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "word/document.xml": strToU8("<w:document/>"),
  });
}

describe("detect", () => {
  it("detects JPEG by SOI marker", () => expect(detect(JPEG)).toBe("jpeg"));
  it("detects PNG by signature", () => expect(detect(PNG)).toBe("png"));
  it("detects docx by zip containing word/document.xml", () =>
    expect(detect(minimalDocx())).toBe("docx"));
  it("classifies an unknown blob as unsupported", () =>
    expect(detect(new Uint8Array([1, 2, 3, 4]))).toBe("unsupported"));
  it("classifies a non-docx zip as unsupported", () =>
    expect(detect(zipSync({ "hello.txt": strToU8("hi") }))).toBe("unsupported"));
});
