// Versioned ciphertext envelope: the on-disk binary frame that wraps every AES-256-GCM ciphertext
// so the algorithm version and key version travel with the bytes. Storing the versions inline lets
// the cipher or a key be rotated later without a schema change — a value sealed under one version
// keeps decoding because its frame still says which version produced it.
//
// Binary frame layout, then standard-base64-encoded to the stored TEXT string:
//   [ algoVersion (1 byte) | keyVersion (1 byte) | iv (12 bytes) | ciphertext (rest) ]
//
// Pure module: no platform bindings. base64 uses btoa/atob, which the Workers runtime and Node both
// provide, matching the cursor-pagination encoder elsewhere in the repo.

// The current frame's algorithm version: AES-256-GCM, first revision. A new cipher gets a new value,
// never an edit — frames stamped with an older version must keep decoding.
export const ALGO_VERSION_AES256GCM_V1 = 1;

const ALGO_VERSION_OFFSET = 0;
const KEY_VERSION_OFFSET = 1;
const IV_OFFSET = 2;
const IV_LENGTH = 12;
const CIPHERTEXT_OFFSET = IV_OFFSET + IV_LENGTH;
// 1 algo + 1 keyVersion + 12 iv + 16 GCM tag + at least 1 ciphertext byte.
const MINIMUM_GCM_TAG_LENGTH = 16;
const MINIMUM_FRAME_LENGTH = CIPHERTEXT_OFFSET + MINIMUM_GCM_TAG_LENGTH + 1;

export type EnvelopeErrorCode = "envelope-malformed" | "envelope-unknown-version";

export class EnvelopeError extends Error {
  readonly code: EnvelopeErrorCode;

  constructor(code: EnvelopeErrorCode, message?: string) {
    super(message ?? code);
    this.name = "EnvelopeError";
    this.code = code;
  }
}

export interface EnvelopeParts {
  readonly algoVersion: number; // 1..255 (one byte)
  readonly keyVersion: number; // 1..255 (one byte)
  readonly iv: Uint8Array; // exactly 12 bytes
  readonly ciphertext: Uint8Array; // AES-GCM ciphertext + 16-byte tag
}

function isVersionByte(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 255;
}

// Builds the binary frame from its parts and returns its standard-base64 encoding.
// Throws EnvelopeError("envelope-malformed") if the iv is not exactly 12 bytes or either version
// is not an integer in 1..255.
export function encodeEnvelope(parts: EnvelopeParts): string {
  if (parts.iv.length !== IV_LENGTH) {
    throw new EnvelopeError("envelope-malformed", `iv must be ${IV_LENGTH} bytes`);
  }
  if (!isVersionByte(parts.algoVersion)) {
    throw new EnvelopeError("envelope-malformed", "algoVersion must be an integer in 1..255");
  }
  if (!isVersionByte(parts.keyVersion)) {
    throw new EnvelopeError("envelope-malformed", "keyVersion must be an integer in 1..255");
  }

  const frame = new Uint8Array(CIPHERTEXT_OFFSET + parts.ciphertext.length);
  frame[ALGO_VERSION_OFFSET] = parts.algoVersion;
  frame[KEY_VERSION_OFFSET] = parts.keyVersion;
  frame.set(parts.iv, IV_OFFSET);
  frame.set(parts.ciphertext, CIPHERTEXT_OFFSET);

  return base64FromBytes(frame);
}

// Decodes a stored envelope string back into its parts.
// Throws EnvelopeError("envelope-malformed") if the input is not valid base64 or the frame is too
// short to hold every required field; EnvelopeError("envelope-unknown-version") if the algorithm
// version is not one this build understands.
export function decodeEnvelope(stored: string): EnvelopeParts {
  const frame = bytesFromBase64(stored);

  if (frame.length < MINIMUM_FRAME_LENGTH) {
    throw new EnvelopeError("envelope-malformed", "frame is shorter than the minimum length");
  }

  const algoVersion = frame[ALGO_VERSION_OFFSET];
  if (algoVersion !== ALGO_VERSION_AES256GCM_V1) {
    throw new EnvelopeError("envelope-unknown-version", `unknown algorithm version ${algoVersion}`);
  }

  // The minimum-length check above guarantees this index is in bounds.
  const keyVersion = frame[KEY_VERSION_OFFSET] as number;
  const iv = frame.slice(IV_OFFSET, CIPHERTEXT_OFFSET);
  const ciphertext = frame.slice(CIPHERTEXT_OFFSET);

  return { algoVersion, keyVersion, iv, ciphertext };
}

// Standard base64 of the raw bytes, via a binary string and btoa.
function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

// Inverse of base64FromBytes. atob throws on invalid base64; that surfaces as envelope-malformed.
function bytesFromBase64(stored: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(stored);
  } catch {
    throw new EnvelopeError("envelope-malformed", "stored value is not valid base64");
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
