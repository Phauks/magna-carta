import { describe, expect, it } from "vitest";

import { type AadContext } from "../src/aad.ts";
import {
  ALGO_VERSION_AES256GCM_V1,
  decodeEnvelope,
  encodeEnvelope,
  EnvelopeError,
} from "../src/envelope.ts";
import {
  deriveAesGcmPurposeKey,
  generateFirmKeyBytes,
  importRootKek,
  unwrapFirmKeyToHkdfKey,
  wrapFirmKey,
} from "../src/keys.ts";
import { decryptProtectedValue, encryptProtectedValue } from "../src/protect.ts";

// A fixed 32-byte root KEK (standard base64) so every test draws its purpose key from the same
// deterministic key flow: importRootKek → generateFirmKeyBytes → wrapFirmKey →
// unwrapFirmKeyToHkdfKey → deriveAesGcmPurposeKey.
const ROOT_KEK_BASE64 = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";

// Builds a real AES-256-GCM purpose key by running the full firm-key flow.
async function purposeKey(): Promise<CryptoKey> {
  const rootKek = await importRootKek(ROOT_KEK_BASE64);
  const wrapped = await wrapFirmKey(rootKek, generateFirmKeyBytes());
  const firmHkdfKey = await unwrapFirmKeyToHkdfKey(rootKek, wrapped);
  return deriveAesGcmPurposeKey(firmHkdfKey, "pii");
}

const baseContext: AadContext = {
  firmId: "firm-0001",
  table: "client",
  field: "email",
  rowPrimaryKey: "row-0001",
  algoVersion: ALGO_VERSION_AES256GCM_V1,
  keyVersion: 1,
};

describe("encryptProtectedValue / decryptProtectedValue round-trip", () => {
  it("returns the original plaintext when context and key match", async () => {
    const key = await purposeKey();
    const plaintext = "alice@example.test";

    const stored = await encryptProtectedValue(key, baseContext, plaintext);
    const recovered = await decryptProtectedValue(key, baseContext, stored);

    expect(recovered).toBe(plaintext);
  });

  it("round-trips unicode plaintext byte-for-byte", async () => {
    const key = await purposeKey();
    const plaintext = "Renée — 日本語 — 🔐 — café";

    const stored = await encryptProtectedValue(key, baseContext, plaintext);
    const recovered = await decryptProtectedValue(key, baseContext, stored);

    expect(recovered).toBe(plaintext);
  });
});

describe("AAD mismatch matrix: a single differing component fails the tag check", () => {
  const mismatches: ReadonlyArray<[string, AadContext]> = [
    ["firmId", { ...baseContext, firmId: "firm-0002" }],
    ["table", { ...baseContext, table: "matter" }],
    ["field", { ...baseContext, field: "phone" }],
    ["rowPrimaryKey", { ...baseContext, rowPrimaryKey: "row-0002" }],
    ["algoVersion", { ...baseContext, algoVersion: 2 }],
    ["keyVersion", { ...baseContext, keyVersion: 2 }],
  ];

  it.each(mismatches)("rejects when only %s differs", async (_component, mismatchedContext) => {
    const key = await purposeKey();
    const stored = await encryptProtectedValue(key, baseContext, "confidential note");

    await expect(decryptProtectedValue(key, mismatchedContext, stored)).rejects.toBeDefined();
  });
});

describe("fresh IV per encryption", () => {
  it("produces two different stored strings and two different ivs for the same input", async () => {
    const key = await purposeKey();

    const first = await encryptProtectedValue(key, baseContext, "same plaintext");
    const second = await encryptProtectedValue(key, baseContext, "same plaintext");

    expect(first).not.toBe(second);

    const ivFirst = decodeEnvelope(first).iv;
    const ivSecond = decodeEnvelope(second).iv;
    expect(ivFirst).not.toEqual(ivSecond);
  });

  it("draws 1,000 distinct ivs across 1,000 encryptions", async () => {
    const key = await purposeKey();
    const seenIvs = new Set<string>();

    for (let count = 0; count < 1000; count += 1) {
      const stored = await encryptProtectedValue(key, baseContext, "distinct-iv check");
      const iv = decodeEnvelope(stored).iv;
      let binary = "";
      for (const byte of iv) {
        binary += String.fromCharCode(byte);
      }
      seenIvs.add(btoa(binary));
    }

    expect(seenIvs.size).toBe(1000);
  });
});

describe("tamper detection", () => {
  it("rejects a stored value whose ciphertext has one flipped byte", async () => {
    const key = await purposeKey();
    const stored = await encryptProtectedValue(key, baseContext, "tamper target");

    const parts = decodeEnvelope(stored);
    const tamperedCiphertext = Uint8Array.from(parts.ciphertext);
    tamperedCiphertext[0] = (tamperedCiphertext[0] ?? 0) ^ 0x01;
    const tampered = encodeEnvelope({ ...parts, ciphertext: tamperedCiphertext });

    await expect(decryptProtectedValue(key, baseContext, tampered)).rejects.toBeDefined();
  });
});

describe("envelope refusals surface unchanged", () => {
  it("propagates an EnvelopeError from a malformed stored value without swallowing it", async () => {
    const key = await purposeKey();

    try {
      await decryptProtectedValue(key, baseContext, "not valid base64 !!!");
      expect.unreachable("expected decryptProtectedValue to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvelopeError);
      expect((error as EnvelopeError).code).toBe("envelope-malformed");
    }
  });
});
