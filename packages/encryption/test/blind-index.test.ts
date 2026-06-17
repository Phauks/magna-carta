import { describe, expect, it } from "vitest";

import { computeBlindIndex, type BlindIndexSpec } from "../src/blind-index.ts";
import {
  deriveIndexSubkey,
  generateFirmKeyBytes,
  importRootKek,
  unwrapFirmKeyToHkdfKey,
  wrapFirmKey,
} from "../src/keys.ts";
import { normalizeToDigits, normalizeUppercaseStrip, withStatePrefix } from "../src/normalize.ts";

import goldenVectors from "./golden/blind-index-vectors.json" with { type: "json" };

// Fixed 48-byte HMAC-SHA-384 subkey material, standard-base64 encoded, so the golden vectors are
// reproducible: anyone can import these exact bytes and recompute the committed strings. This stands
// in for a subkey the key hierarchy would derive; computeBlindIndex only signs with whatever subkey
// it is handed. SHA-384 keys are commonly the block size (128 bytes), but any length is valid — a
// fixed 48 bytes keeps the constant compact and the vectors reproducible.
const FIXED_SUBKEY_BASE64 = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4v";

function bytesFromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function importFixedSubkey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    bytesFromBase64(FIXED_SUBKEY_BASE64),
    { name: "HMAC", hash: "SHA-384" },
    false,
    ["sign"],
  );
}

const transforms = {
  normalizeToDigits,
  normalizeUppercaseStrip,
  withState: (value: string) => withStatePrefix("NV", value),
} as const;

interface GoldenVector {
  readonly description: string;
  readonly transform: keyof typeof transforms;
  readonly lengthBits: 16 | 24 | 32;
  readonly plaintext: string;
  readonly expected: string;
}

const vectors = goldenVectors as readonly GoldenVector[];

function specFor(vector: GoldenVector): BlindIndexSpec {
  return {
    table: "golden",
    field: vector.transform,
    indexName: `${vector.transform}-${vector.lengthBits}`,
    normalize: transforms[vector.transform],
    lengthBits: vector.lengthBits,
  };
}

// Splits the version prefix off a stored value and base64-decodes the digest back to raw bytes.
function digestBytes(value: string): Uint8Array {
  const prefix = "1:";
  expect(value.startsWith(prefix)).toBe(true);
  return bytesFromBase64(value.slice(prefix.length));
}

describe("computeBlindIndex — golden vectors", () => {
  it.each(vectors)("$transform/$lengthBits($plaintext) === $expected", async (vector) => {
    const subkey = await importFixedSubkey();
    const value = await computeBlindIndex(subkey, specFor(vector), vector.plaintext);
    expect(value).toBe(vector.expected);
  });
});

describe("computeBlindIndex — contract", () => {
  const ssnSpec: BlindIndexSpec = {
    table: "client",
    field: "social_security_number",
    indexName: "equality-16",
    normalize: normalizeToDigits,
    lengthBits: 16,
  };

  it("yields the same value for a formatted and an unformatted SSN", async () => {
    const subkey = await importFixedSubkey();
    const formatted = await computeBlindIndex(subkey, ssnSpec, "123-45-6789");
    const unformatted = await computeBlindIndex(subkey, ssnSpec, "123456789");

    expect(formatted).toBe(unformatted);
  });

  it("stamps the version prefix on every output", async () => {
    const subkey = await importFixedSubkey();
    const value = await computeBlindIndex(subkey, ssnSpec, "123456789");

    expect(value.startsWith("1:")).toBe(true);
  });

  it("truncates to exactly lengthBits / 8 bytes", async () => {
    const subkey = await importFixedSubkey();
    const accountSpec: BlindIndexSpec = {
      table: "trust_account",
      field: "account_number",
      indexName: "equality-24",
      normalize: normalizeToDigits,
      lengthBits: 24,
    };
    const licenseSpec: BlindIndexSpec = {
      table: "client",
      field: "drivers_license",
      indexName: "equality-32",
      normalize: (value) => withStatePrefix("NV", value),
      lengthBits: 32,
    };

    const at16 = await computeBlindIndex(subkey, ssnSpec, "123456789");
    const at24 = await computeBlindIndex(subkey, accountSpec, "000111222");
    const at32 = await computeBlindIndex(subkey, licenseSpec, "D1234567");

    expect(digestBytes(at16).length).toBe(2);
    expect(digestBytes(at24).length).toBe(3);
    expect(digestBytes(at32).length).toBe(4);
  });

  it("propagates a NormalizeError from a transform that rejects its input", async () => {
    const subkey = await importFixedSubkey();

    await expect(computeBlindIndex(subkey, ssnSpec, "no-digits-here")).rejects.toThrowError(
      /normalize/,
    );
  });
});

describe("computeBlindIndex — subkey separation and determinism", () => {
  async function firmHkdfKey(): Promise<CryptoKey> {
    const rootKek = await importRootKek(randomKekBase64());
    return unwrapFirmKeyToHkdfKey(rootKek, await wrapFirmKey(rootKek, generateFirmKeyBytes()));
  }

  function randomKekBase64(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  }

  const spec: BlindIndexSpec = {
    table: "client",
    field: "social_security_number",
    indexName: "equality-32",
    normalize: normalizeToDigits,
    lengthBits: 32,
  };

  it("produces different values for subkeys derived from different (table, field, indexName)", async () => {
    const firmKey = await firmHkdfKey();
    const subkeyOne = await deriveIndexSubkey(firmKey, "client", "social_security_number", "v1");
    const subkeyTwo = await deriveIndexSubkey(firmKey, "matter", "reference_number", "v1");

    const valueOne = await computeBlindIndex(subkeyOne, spec, "123456789");
    const valueTwo = await computeBlindIndex(subkeyTwo, spec, "123456789");

    expect(valueOne).not.toBe(valueTwo);
  });

  it("is deterministic: the same subkey and plaintext yield an identical value", async () => {
    const firmKey = await firmHkdfKey();
    const subkeyOne = await deriveIndexSubkey(firmKey, "client", "social_security_number", "v1");
    const subkeyTwo = await deriveIndexSubkey(firmKey, "client", "social_security_number", "v1");

    const valueOne = await computeBlindIndex(subkeyOne, spec, "123456789");
    const valueTwo = await computeBlindIndex(subkeyTwo, spec, "123456789");

    expect(valueOne).toBe(valueTwo);
  });
});
