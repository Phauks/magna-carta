import { describe, expect, it } from "vitest";

import {
  ALGO_VERSION_AES256GCM_V1,
  decodeEnvelope,
  encodeEnvelope,
  EnvelopeError,
  type EnvelopeParts,
} from "../src/envelope.ts";

// A representative 12-byte iv and a ciphertext that includes a 16-byte GCM tag.
const iv = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
const ciphertext = new Uint8Array([
  // payload bytes
  100, 101, 102, 103, 104,
  // 16-byte authentication tag
  200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214, 215,
]);

const parts: EnvelopeParts = {
  algoVersion: ALGO_VERSION_AES256GCM_V1,
  keyVersion: 1,
  iv,
  ciphertext,
};

describe("encodeEnvelope / decodeEnvelope round-trip", () => {
  it("returns byte-identical algoVersion, keyVersion, iv, and ciphertext", () => {
    const decoded = decodeEnvelope(encodeEnvelope(parts));

    expect(decoded.algoVersion).toBe(parts.algoVersion);
    expect(decoded.keyVersion).toBe(parts.keyVersion);
    expect(decoded.iv).toEqual(parts.iv);
    expect(decoded.ciphertext).toEqual(parts.ciphertext);
  });

  it("preserves the iv length exactly at 12 bytes", () => {
    const decoded = decodeEnvelope(encodeEnvelope(parts));

    expect(decoded.iv.length).toBe(12);
  });

  it("round-trips a keyVersion of 255", () => {
    const decoded = decodeEnvelope(encodeEnvelope({ ...parts, keyVersion: 255 }));

    expect(decoded.keyVersion).toBe(255);
  });
});

describe("decodeEnvelope rejects bad input", () => {
  it("throws envelope-malformed on input that is not valid base64", () => {
    try {
      decodeEnvelope("not valid base64 !!!");
      expect.unreachable("expected decodeEnvelope to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvelopeError);
      expect((error as EnvelopeError).code).toBe("envelope-malformed");
    }
  });

  it("throws envelope-malformed on a frame shorter than 31 bytes", () => {
    const tooShort = new Uint8Array(30).fill(7);
    // Keep the algo byte valid so length is the only fault.
    tooShort[0] = ALGO_VERSION_AES256GCM_V1;
    const stored = base64FromBytes(tooShort);

    try {
      decodeEnvelope(stored);
      expect.unreachable("expected decodeEnvelope to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvelopeError);
      expect((error as EnvelopeError).code).toBe("envelope-malformed");
    }
  });

  it("throws envelope-unknown-version when the algo byte is not the known version", () => {
    // A full-length, otherwise-valid frame whose first byte is 2 (unknown).
    const frame = new Uint8Array(31).fill(9);
    frame[0] = 2;
    const stored = base64FromBytes(frame);

    try {
      decodeEnvelope(stored);
      expect.unreachable("expected decodeEnvelope to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvelopeError);
      expect((error as EnvelopeError).code).toBe("envelope-unknown-version");
    }
  });
});

describe("encodeEnvelope rejects bad input", () => {
  it.each([11, 16])("throws envelope-malformed when the iv is %i bytes", (ivLength) => {
    const badIv = new Uint8Array(ivLength).fill(3);

    try {
      encodeEnvelope({ ...parts, iv: badIv });
      expect.unreachable("expected encodeEnvelope to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvelopeError);
      expect((error as EnvelopeError).code).toBe("envelope-malformed");
    }
  });
});

// Local helper mirroring the standard base64 encoding the module uses, so the tests
// can craft arbitrary frames without depending on the module's encoder.
function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
