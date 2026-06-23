import { describe, expect, it } from "vitest";
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
      expect(outcome.mediaType).toContain("wordprocessingml");
    }
  });

  it("rejects an unsupported format", async () => {
    const outcome = await port.inspect({ bytes: new Uint8Array([1, 2, 3]), filename: "x.bin" });
    expect(outcome).toEqual({ ok: false, reason: "unsupported-format" });
  });

  it("rejects an oversize input", async () => {
    const big = new Uint8Array(16 * 1024 * 1024);
    const outcome = await port.inspect({ bytes: big, filename: "big.bin" });
    expect(outcome).toEqual({ ok: false, reason: "too-large" });
  });
});
