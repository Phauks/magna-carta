// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
import { describe, expect, it } from "vitest";
import { type AadContext, serializeAad } from "@magna-carta/encryption/aad";
import { computeBlindIndex, type BlindIndexSpec } from "@magna-carta/encryption/blind-index";
import {
  deriveAesGcmPurposeKey,
  generateFirmKeyBytes,
  importRootKek,
  unwrapFirmKeyToHkdfKey,
  wrapFirmKey,
} from "@magna-carta/encryption/keys";
import { normalizeToDigits, withStatePrefix } from "@magna-carta/encryption/normalize";
import { decryptProtectedValue, encryptProtectedValue } from "@magna-carta/encryption/protect";

import aadGolden from "../../../packages/encryption/test/golden/aad-vectors.json" with { type: "json" };
import blindIndexGolden from "../../../packages/encryption/test/golden/blind-index-vectors.json" with { type: "json" };

// The encryption package pins its frozen output with golden vectors validated on Node's webcrypto
// (its unit tests run under the default Node pool). This file re-runs a representative subset of the
// SAME vectors under workerd (the Cloudflare Workers runtime backing this package's tests), so a
// Node-vs-workerd crypto divergence — a different AAD byte order, a different HMAC truncation, a
// GCM tag the other runtime cannot verify — fails loud here rather than only in production. Every
// assertion below must match Node identically.

// The fixed 48-byte HMAC-SHA-384 subkey material the encryption package's blind-index vectors are
// computed under, standard-base64 encoded. Reproduced verbatim so the committed strings recompute
// byte-for-byte on workerd; computeBlindIndex signs with whatever subkey it is handed.
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

// The transform names the blind-index vectors reference, resolved to the frozen transforms — the
// same mapping the encryption package's own blind-index test uses.
const transforms = {
  normalizeToDigits,
  withState: (value: string) => withStatePrefix("NV", value),
} as const;

interface AadVector {
  readonly context: AadContext;
  readonly expected: string;
}

interface BlindIndexVector {
  readonly description: string;
  readonly transform: keyof typeof transforms;
  readonly lengthBits: 16 | 24 | 32;
  readonly plaintext: string;
  readonly expected: string;
}

const aadVectors = aadGolden as readonly AadVector[];
const blindIndexVectors = blindIndexGolden as readonly BlindIndexVector[];

describe("encryption parity under workerd — AAD serializer", () => {
  it.each(aadVectors)("serializeAad produces the frozen bytes for $expected", (vector) => {
    const bytes = serializeAad(vector.context);
    expect(new TextDecoder().decode(bytes)).toBe(vector.expected);
    expect(bytes).toEqual(new TextEncoder().encode(vector.expected));
  });
});

describe("encryption parity under workerd — blind index", () => {
  it.each(blindIndexVectors)(
    "computeBlindIndex matches the frozen string for $description",
    async (vector) => {
      const subkey = await importFixedSubkey();
      const spec: BlindIndexSpec = {
        table: "golden",
        field: vector.transform,
        indexName: `${vector.transform}-${vector.lengthBits}`,
        normalize: transforms[vector.transform],
        lengthBits: vector.lengthBits,
      };
      const value = await computeBlindIndex(subkey, spec, vector.plaintext);
      expect(value).toBe(vector.expected);
    },
  );
});

describe("encryption parity under workerd — protect round-trip and AAD binding", () => {
  // A random root KEK + the real key hierarchy (importRootKek → wrapFirmKey → unwrapFirmKeyToHkdfKey
  // → deriveAesGcmPurposeKey), so the round-trip exercises the same non-extractable derivation path
  // production uses, not a hand-rolled key.
  async function purposeKey(): Promise<CryptoKey> {
    const rootKekBytes = crypto.getRandomValues(new Uint8Array(32));
    let binary = "";
    for (const byte of rootKekBytes) binary += String.fromCharCode(byte);
    const rootKek = await importRootKek(btoa(binary));
    const firmHkdfKey = await unwrapFirmKeyToHkdfKey(
      rootKek,
      await wrapFirmKey(rootKek, generateFirmKeyBytes()),
    );
    return deriveAesGcmPurposeKey(firmHkdfKey, "pii");
  }

  const aad: AadContext = {
    firmId: "firm_parity",
    table: "incident",
    field: "description_ciphertext",
    rowPrimaryKey: "incident_parity",
    algoVersion: 1,
    keyVersion: 1,
  };

  it("decrypts a value it sealed under the same key and context", async () => {
    const key = await purposeKey();
    const sealed = await encryptProtectedValue(key, aad, "Sensitive words under workerd.");
    expect(sealed).not.toContain("Sensitive words under workerd.");
    const opened = await decryptProtectedValue(key, aad, sealed);
    expect(opened).toBe("Sensitive words under workerd.");
  });

  it("refuses to decrypt when one AAD component differs (the GCM tag fails)", async () => {
    const key = await purposeKey();
    const sealed = await encryptProtectedValue(key, aad, "Sensitive words under workerd.");
    // Vary exactly one AAD component — the row id — leaving the key and every other field intact.
    const movedRow: AadContext = { ...aad, rowPrimaryKey: "incident_other" };
    await expect(decryptProtectedValue(key, movedRow, sealed)).rejects.toThrow();
  });
});
