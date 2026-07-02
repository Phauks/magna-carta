import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureReady, detectDocument, redactDocument } from "../src/index.js";

const hello = new Uint8Array(
  readFileSync(fileURLToPath(new URL("./fixtures/hello.pdf", import.meta.url))),
);

describe("detectDocument", () => {
  beforeAll(async () => {
    await ensureReady(
      readFileSync(fileURLToPath(new URL("../src/pkg/pdf_core_bg.wasm", import.meta.url))),
    );
  });

  it("finds nothing in a properly redacted document", async () => {
    const redacted = await redactDocument(hello, [
      { page: 0, rect: { x0: 0, y0: 0, x1: 1000, y1: 1000 }, reason: "PII" },
    ]);
    const report = await detectDocument(redacted.pdf);
    const pageText = report.findings.filter((f) =>
      ["coveredText", "invisibleText", "whiteoutText"].includes(f.category),
    );
    expect(pageText).toHaveLength(0);
  });

  it("returns a structured report", async () => {
    const report = await detectDocument(hello);
    expect(Array.isArray(report.findings)).toBe(true);
    expect(typeof report.glyphsExamined).toBe("number");
  });
});
