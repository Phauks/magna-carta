import { describe, expect, it } from "vitest";

import {
  deriveAesGcmPurposeKey,
  deriveIndexSubkey,
  generateFirmKeyBytes,
  importRootKek,
  unwrapFirmKeyToHkdfKey,
  wrapFirmKey,
} from "../src/keys.ts";

// A 32-byte AES-256 key-encryption key, standard-base64 encoded, for the root KEK.
function randomKekBase64(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

const textEncoder = new TextEncoder();

describe("importRootKek", () => {
  it("imports a non-extractable AES-KW key usable only for wrap/unwrap", async () => {
    const rootKek = await importRootKek(randomKekBase64());

    expect(rootKek.extractable).toBe(false);
    expect(rootKek.type).toBe("secret");
    expect(rootKek.usages).toEqual(["wrapKey", "unwrapKey"]);
  });
});

describe("generateFirmKeyBytes", () => {
  it("returns 32 fresh random bytes", () => {
    const first = generateFirmKeyBytes();
    const second = generateFirmKeyBytes();

    expect(first).toBeInstanceOf(Uint8Array);
    expect(first.length).toBe(32);
    expect(second.length).toBe(32);
    // Two independent draws must not collide.
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(false);
  });
});

describe("wrapFirmKey / unwrapFirmKeyToHkdfKey", () => {
  it("unwraps to a non-extractable HKDF base key usable only for deriveKey", async () => {
    const rootKek = await importRootKek(randomKekBase64());
    const wrapped = await wrapFirmKey(rootKek, generateFirmKeyBytes());
    const firmHkdfKey = await unwrapFirmKeyToHkdfKey(rootKek, wrapped);

    expect(firmHkdfKey.extractable).toBe(false);
    expect(firmHkdfKey.usages).toEqual(["deriveKey"]);
  });

  it("rejects an unwrap performed under a different root KEK", async () => {
    const rootKekA = await importRootKek(randomKekBase64());
    const rootKekB = await importRootKek(randomKekBase64());
    const wrapped = await wrapFirmKey(rootKekA, generateFirmKeyBytes());

    await expect(unwrapFirmKeyToHkdfKey(rootKekB, wrapped)).rejects.toBeDefined();
  });
});

describe("deriveAesGcmPurposeKey", () => {
  it("derives a non-extractable AES-GCM key usable only for encrypt/decrypt", async () => {
    const rootKek = await importRootKek(randomKekBase64());
    const firmHkdfKey = await unwrapFirmKeyToHkdfKey(
      rootKek,
      await wrapFirmKey(rootKek, generateFirmKeyBytes()),
    );

    const purposeKey = await deriveAesGcmPurposeKey(firmHkdfKey, "pii");

    expect(purposeKey.extractable).toBe(false);
    expect(purposeKey.usages).toEqual(["encrypt", "decrypt"]);
    const aesAlgorithm = purposeKey.algorithm as { name: string; length: number };
    expect(aesAlgorithm.name).toBe("AES-GCM");
    expect(aesAlgorithm.length).toBe(256);
  });

  it("round-trips a plaintext through wrap/unwrap/derive then AES-GCM encrypt/decrypt", async () => {
    const rootKek = await importRootKek(randomKekBase64());
    const wrapped = await wrapFirmKey(rootKek, generateFirmKeyBytes());
    const firmHkdfKey = await unwrapFirmKeyToHkdfKey(rootKek, wrapped);
    const purposeKey = await deriveAesGcmPurposeKey(firmHkdfKey, "pii");

    const plaintext = textEncoder.encode("client matter: confidential note");
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, purposeKey, plaintext);
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, purposeKey, ciphertext);

    expect(new Uint8Array(decrypted)).toEqual(plaintext);
  });

  it("derives deterministically: a second derivation decrypts the first key's ciphertext", async () => {
    const rootKek = await importRootKek(randomKekBase64());
    const wrapped = await wrapFirmKey(rootKek, generateFirmKeyBytes());

    const firmHkdfKeyOne = await unwrapFirmKeyToHkdfKey(rootKek, wrapped);
    const firmHkdfKeyTwo = await unwrapFirmKeyToHkdfKey(rootKek, wrapped);
    const purposeKeyOne = await deriveAesGcmPurposeKey(firmHkdfKeyOne, "pii");
    const purposeKeyTwo = await deriveAesGcmPurposeKey(firmHkdfKeyTwo, "pii");

    const plaintext = textEncoder.encode("deterministic derivation check");
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      purposeKeyOne,
      plaintext,
    );
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      purposeKeyTwo,
      ciphertext,
    );

    expect(new Uint8Array(decrypted)).toEqual(plaintext);
  });

  it("isolates purposes: a secrets key cannot decrypt a pii ciphertext", async () => {
    const rootKek = await importRootKek(randomKekBase64());
    const wrapped = await wrapFirmKey(rootKek, generateFirmKeyBytes());
    const firmHkdfKey = await unwrapFirmKeyToHkdfKey(rootKek, wrapped);

    const piiKey = await deriveAesGcmPurposeKey(firmHkdfKey, "pii");
    const secretsKey = await deriveAesGcmPurposeKey(firmHkdfKey, "secrets");

    const plaintext = textEncoder.encode("purpose isolation check");
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, piiKey, plaintext);

    await expect(
      crypto.subtle.decrypt({ name: "AES-GCM", iv }, secretsKey, ciphertext),
    ).rejects.toBeDefined();
  });
});

describe("deriveIndexSubkey", () => {
  it("derives a non-extractable HMAC-SHA-384 key usable only for sign", async () => {
    const rootKek = await importRootKek(randomKekBase64());
    const firmHkdfKey = await unwrapFirmKeyToHkdfKey(
      rootKek,
      await wrapFirmKey(rootKek, generateFirmKeyBytes()),
    );

    const subkey = await deriveIndexSubkey(firmHkdfKey, "client", "email", "equality");

    expect(subkey.extractable).toBe(false);
    expect(subkey.usages).toEqual(["sign"]);
    const hmacAlgorithm = subkey.algorithm as { name: string; hash: { name: string } };
    expect(hmacAlgorithm.name).toBe("HMAC");
    expect(hmacAlgorithm.hash.name).toBe("SHA-384");
  });

  it("separates triples: different (table, field, indexName) produce different MACs", async () => {
    const rootKek = await importRootKek(randomKekBase64());
    const firmHkdfKey = await unwrapFirmKeyToHkdfKey(
      rootKek,
      await wrapFirmKey(rootKek, generateFirmKeyBytes()),
    );

    const subkeyOne = await deriveIndexSubkey(firmHkdfKey, "client", "email", "equality");
    const subkeyTwo = await deriveIndexSubkey(firmHkdfKey, "matter", "reference", "equality");

    const input = textEncoder.encode("alice@example.test");
    const macOne = new Uint8Array(await crypto.subtle.sign("HMAC", subkeyOne, input));
    const macTwo = new Uint8Array(await crypto.subtle.sign("HMAC", subkeyTwo, input));

    expect(macOne).not.toEqual(macTwo);
  });

  it("derives deterministically: the same triple twice yields an identical MAC", async () => {
    const rootKek = await importRootKek(randomKekBase64());
    const wrapped = await wrapFirmKey(rootKek, generateFirmKeyBytes());

    const firmHkdfKeyOne = await unwrapFirmKeyToHkdfKey(rootKek, wrapped);
    const firmHkdfKeyTwo = await unwrapFirmKeyToHkdfKey(rootKek, wrapped);
    const subkeyOne = await deriveIndexSubkey(firmHkdfKeyOne, "client", "email", "equality");
    const subkeyTwo = await deriveIndexSubkey(firmHkdfKeyTwo, "client", "email", "equality");

    const input = textEncoder.encode("alice@example.test");
    const macOne = new Uint8Array(await crypto.subtle.sign("HMAC", subkeyOne, input));
    const macTwo = new Uint8Array(await crypto.subtle.sign("HMAC", subkeyTwo, input));

    expect(macOne).toEqual(macTwo);
  });
});
