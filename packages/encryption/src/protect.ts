// The protect() enforcement chokepoint: the single seam through which encrypted fields are sealed
// on write and opened on read, so no protected value reaches storage in the clear. Ties together
// the envelope, key hierarchy, and the canonical additional-authenticated-data binding.
//
// Each sealed value is AES-256-GCM ciphertext, with the canonical AAD bytes fed in as additional
// authenticated data and the algorithm/key versions and iv carried in the versioned envelope. The
// AAD binding means a ciphertext copied to a different row, field, firm, or format fails to decrypt:
// the GCM tag is computed over the AAD, so a context mismatch fails the authentication check.

import { type AadContext, serializeAad } from "./aad.ts";
import { ALGO_VERSION_AES256GCM_V1, decodeEnvelope, encodeEnvelope } from "./envelope.ts";

const AES_GCM = "AES-GCM";
const IV_LENGTH = 12;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

// Seals a plaintext under the purpose key, binding it to its context. Returns the base64 envelope
// string to store. The context's algoVersion/keyVersion are stamped into the envelope so the value
// can be opened later, and are also part of the AAD so the bytes cannot be replayed under another
// version.
export async function encryptProtectedValue(
  purposeKey: CryptoKey,
  aad: AadContext,
  plaintext: string,
): Promise<string> {
  // The ONLY initialization-vector source in the entire package: every AES-GCM seal draws a fresh
  // random 12-byte iv here, so no iv is ever reused under a key.
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  const result = await crypto.subtle.encrypt(
    { name: AES_GCM, iv, additionalData: arrayBufferView(serializeAad(aad)) },
    purposeKey,
    arrayBufferView(textEncoder.encode(plaintext)),
  );

  return encodeEnvelope({
    algoVersion: ALGO_VERSION_AES256GCM_V1,
    keyVersion: aad.keyVersion,
    iv,
    ciphertext: new Uint8Array(result),
  });
}

// Opens a stored value under the purpose key and the caller's context. decodeEnvelope's refusals
// (malformed input, unknown version) propagate unchanged. The caller's context is authoritative for
// the AAD — a mismatch against the bytes sealed at encrypt time fails the GCM tag check and rejects.
export async function decryptProtectedValue(
  purposeKey: CryptoKey,
  aad: AadContext,
  stored: string,
): Promise<string> {
  const parts = decodeEnvelope(stored);

  const result = await crypto.subtle.decrypt(
    {
      name: AES_GCM,
      iv: arrayBufferView(parts.iv),
      additionalData: arrayBufferView(serializeAad(aad)),
    },
    purposeKey,
    arrayBufferView(parts.ciphertext),
  );

  return textDecoder.decode(result);
}

// Copies bytes into a fresh ArrayBuffer-backed view so they satisfy BufferSource regardless of the
// source's backing buffer (a Uint8Array<ArrayBufferLike> from a slice or TextEncoder does not).
function arrayBufferView(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(bytes);
}
