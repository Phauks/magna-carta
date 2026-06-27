import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  DecryptionError,
  detectFormat,
  ensureReady,
  extractHash,
  stripWithKey,
  verifyGuess,
} from "../src/index.js";

const wasmBytes = readFileSync(
  fileURLToPath(new URL("../src/pkg/decryption_core_bg.wasm", import.meta.url)),
);

const pdfFixture = new Uint8Array(
  readFileSync(
    fileURLToPath(
      new URL(
        "../../../crates/decryption-core/tests/fixtures/pdf_userpw_test.pdf",
        import.meta.url,
      ),
    ),
  ),
);

describe("@magna-carta/decryption wasm wrapper", () => {
  beforeAll(async () => {
    await ensureReady(wasmBytes);
  });

  describe("detectFormat", () => {
    it("returns pdf for a %PDF magic header", async () => {
      const pdfHeader = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
      expect(await detectFormat(pdfHeader)).toBe("pdf");
    });

    it("returns null for unrecognised bytes", async () => {
      expect(await detectFormat(new Uint8Array([0x00, 0x00, 0x00, 0x00]))).toBeNull();
    });
  });

  describe("PDF fixture round-trip (password: test)", () => {
    it("stripWithKey decrypts the fixture and output begins with %PDF", async () => {
      const result = await stripWithKey(pdfFixture, "test");
      expect(result.bytes[0]).toBe(0x25); // %
      expect(result.bytes[1]).toBe(0x50); // P
      expect(result.bytes[2]).toBe(0x44); // D
      expect(result.bytes[3]).toBe(0x46); // F
    });

    it("extractHash yields a hash that verifyGuess confirms for the correct password", async () => {
      const { hash } = await extractHash(pdfFixture);
      expect(await verifyGuess(hash, "pdf", "test")).toBe(true);
    });

    it("verifyGuess returns false for a wrong candidate", async () => {
      const { hash } = await extractHash(pdfFixture);
      expect(await verifyGuess(hash, "pdf", "definitely-wrong")).toBe(false);
    });
  });

  describe("DecryptionError", () => {
    it("stripWithKey with a wrong password throws DecryptionError with code wrongPassword", async () => {
      await expect(stripWithKey(pdfFixture, "wrong-password")).rejects.toSatisfy(
        (err: unknown) => err instanceof DecryptionError && err.code === "wrongPassword",
      );
    });
  });
});
