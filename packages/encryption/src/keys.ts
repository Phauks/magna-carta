// The key hierarchy: the root key-encryption key wraps per-firm data keys; this module derives
// and unwraps them. The root key arrives as the ROOT_KEK runtime secret plumbed in apps/api-worker.
//
// Shape of the hierarchy:
//   - The root KEK (a Worker secret) is an AES-KW key whose only powers are wrap/unwrap.
//   - At firm provisioning a 32-byte firm key is minted, AES-KW-wrapped under the root KEK, and the
//     wrapped bytes are stored. The raw firm-key bytes are never persisted.
//   - Unwrapping produces the firm key directly as a NON-EXTRACTABLE HKDF base key: the unwrap step
//     itself imports the recovered bytes as an HKDF key, so the plaintext key material never surfaces
//     to JavaScript.
//   - HKDF-SHA-384 then derives purpose keys (AES-GCM for encryption) and per-field index subkeys
//     (HMAC for blind indexes) from that base key. Every derived key is non-extractable too.
//
// Non-extractable end to end: bytes enter once (firm-key mint, root-KEK import) and never leave —
// no derived or unwrapped key can be exported.

import { base64FromBytes, bytesFromBase64 } from "./base64.ts";

// Frozen contract — these parameters define version 1 of the protected-field key schema. Changing any
// value here changes every key derived from it, so they are never edited: a change is a new version
// with a new info prefix. (HKDF hash, salt, and info strings.)
const HKDF_HASH = "SHA-384";
const HKDF_SALT = new TextEncoder().encode("magna-carta-protected-v1");

const PURPOSE_INFO: Readonly<Record<Purpose, string>> = Object.freeze({
  pii: "mc:v1:pii",
  secrets: "mc:v1:secrets",
});

function indexInfo(table: string, field: string, indexName: string): string {
  return `mc:v1:index:${table}:${field}:${indexName}`;
}

const FIRM_KEY_LENGTH = 32;

const textEncoder = new TextEncoder();

// Imports the base64-encoded root KEK as a non-extractable AES-KW key. Its only usages are wrapping
// and unwrapping firm keys; it can never encrypt application data directly.
export function importRootKek(base64Kek: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", bytesFromBase64(base64Kek), { name: "AES-KW" }, false, [
    "wrapKey",
    "unwrapKey",
  ]);
}

// Mints a fresh 32-byte firm key. Provisioning-only: the bytes are wrapped immediately and never
// stored or returned anywhere else.
export function generateFirmKeyBytes(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(FIRM_KEY_LENGTH));
}

export type Purpose = "pii" | "secrets";

// AES-KW-wraps the freshly minted firm-key bytes under the root KEK and returns the wrapped key as
// standard base64. AES-KW wraps a key in its "raw" form, which requires an extractable source key —
// and WebCrypto forbids extractable HKDF keys, so the bytes are imported here as a throwaway
// extractable AES key used ONLY for this wrap step. AES-KW copies the raw 32 bytes verbatim, so the
// carrier algorithm is irrelevant; on the way back in, unwrapFirmKeyToHkdfKey reinterprets those same
// bytes as a non-extractable HKDF key. The persisted artefact is the wrapped ciphertext, never the
// raw bytes.
export async function wrapFirmKey(rootKek: CryptoKey, firmKeyBytes: Uint8Array): Promise<string> {
  // Copy into a fresh ArrayBuffer-backed view so the bytes satisfy BufferSource regardless of the
  // caller's backing buffer.
  const rawKey = Uint8Array.from(firmKeyBytes);
  const wrappableFirmKey = await crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, true, [
    "encrypt",
    "decrypt",
  ]);
  const wrapped = await crypto.subtle.wrapKey("raw", wrappableFirmKey, rootKek, "AES-KW");
  return base64FromBytes(new Uint8Array(wrapped));
}

// Unwraps a stored wrapped firm key under the root KEK directly into a non-extractable HKDF base key.
// Because unwrapKey imports the recovered bytes straight into a CryptoKey, the plaintext key material
// never surfaces to JavaScript. An unwrap under the wrong root KEK fails the AES-KW integrity check
// and rejects.
export function unwrapFirmKeyToHkdfKey(
  rootKek: CryptoKey,
  wrappedBase64: string,
): Promise<CryptoKey> {
  return crypto.subtle.unwrapKey(
    "raw",
    bytesFromBase64(wrappedBase64),
    rootKek,
    "AES-KW",
    { name: "HKDF" },
    false,
    ["deriveKey"],
  );
}

// Derives the AES-256-GCM key for a purpose from the firm's HKDF base key. Each purpose uses a
// distinct HKDF info string, so the pii and secrets keys are cryptographically independent: one
// cannot decrypt the other's ciphertext. Non-extractable; encrypt/decrypt only.
export function deriveAesGcmPurposeKey(
  firmHkdfKey: CryptoKey,
  purpose: Purpose,
): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: HKDF_HASH,
      salt: HKDF_SALT,
      info: textEncoder.encode(PURPOSE_INFO[purpose]),
    },
    firmHkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// Derives the HMAC-SHA-384 subkey for one blind index from the firm's HKDF base key. The HKDF info
// string binds the subkey to its exact (table, field, indexName) triple, so subkeys for different
// columns are independent and an index value cannot be replayed against another column.
// Non-extractable; sign only.
export function deriveIndexSubkey(
  firmHkdfKey: CryptoKey,
  table: string,
  field: string,
  indexName: string,
): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: HKDF_HASH,
      salt: HKDF_SALT,
      info: textEncoder.encode(indexInfo(table, field, indexName)),
    },
    firmHkdfKey,
    { name: "HMAC", hash: HKDF_HASH },
    false,
    ["sign"],
  );
}
