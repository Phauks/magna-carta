import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll } from "vitest";
import { deflateSync } from "node:zlib";
import { ensureReady, redactDocument, DecompressionBombError } from "../src/index.js";

// A zlib stream that inflates past the 256 MiB per-stream cap, embedded as a PDF
// stream object. The guard rejects it before any parsing.
function bombPdf(): Uint8Array {
  const zeros = Buffer.alloc(256 * 1024 * 1024 + 1);
  const blob = deflateSync(zeros); // zlib-wrapped deflate
  const head = Buffer.from("%PDF-1.5\n1 0 obj<</Length 0>>stream\n", "latin1");
  const tail = Buffer.from("\nendstream endobj\n%%EOF", "latin1");
  return new Uint8Array(Buffer.concat([head, blob, tail]));
}

describe("decompression-bomb guard", () => {
  beforeAll(async () => {
    await ensureReady(
      readFileSync(fileURLToPath(new URL("../src/pkg/pdf_core_bg.wasm", import.meta.url))),
    );
  });

  it("throws a typed DecompressionBombError", async () => {
    await expect(redactDocument(bombPdf(), [], {})).rejects.toBeInstanceOf(
      DecompressionBombError,
    );
  });
});
