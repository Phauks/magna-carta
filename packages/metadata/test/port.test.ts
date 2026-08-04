import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { MAX_INFLATED_BYTES } from "../src/guards.ts";
import { createMetadataPort } from "../src/metadata.ts";
import { SCRUB_ALL } from "../src/options.ts";
import { buildDocx } from "./support/docx-fixture.ts";

const port = createMetadataPort();

describe("MetadataPort", () => {
  it("inspect reports findings for a docx", async () => {
    const outcome = await port.inspect({ bytes: buildDocx(), filename: "a.docx" });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.report.clean).toBe(false);
  });

  it("scrub returns clean output and the right media type", async () => {
    const outcome = await port.scrub({ bytes: buildDocx(), filename: "a.docx" }, SCRUB_ALL);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.report.clean).toBe(true);
      expect(outcome.mediaType).toBe(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      );
    }
  });

  it("rejects an unsupported format", async () => {
    const outcome = await port.inspect({ bytes: new Uint8Array([1, 2, 3]), filename: "x.bin" });
    expect(outcome).toEqual({ ok: false, reason: "unsupported-format" });
  });

  it("reports a decompression bomb as its own failure, on both inspect and scrub", async () => {
    const bomb = zipSync({ "word/document.xml": new Uint8Array(MAX_INFLATED_BYTES + 1024) });
    expect(await port.inspect({ bytes: bomb, filename: "bomb.docx" })).toEqual({
      ok: false,
      reason: "decompression-bomb",
    });
    expect(await port.scrub({ bytes: bomb, filename: "bomb.docx" }, SCRUB_ALL)).toEqual({
      ok: false,
      reason: "decompression-bomb",
    });
  });

  it("reports an unreadable image as corrupt rather than returning a destroyed copy", async () => {
    // A JPEG whose marker structure does not parse: the walk cannot tell metadata from picture, so
    // the only safe answer is a refusal.
    const malformed = new Uint8Array([0xff, 0xd8, 0xff, 0x12, 0x34, 0x56, 0x78, 0x9a]);
    expect(await port.inspect({ bytes: malformed, filename: "x.jpg" })).toEqual({
      ok: false,
      reason: "corrupt",
    });
  });

  it("rejects an oversize input", async () => {
    const big = new Uint8Array(16 * 1024 * 1024);
    const outcome = await port.inspect({ bytes: big, filename: "big.bin" });
    expect(outcome).toEqual({ ok: false, reason: "too-large" });
  });
});
