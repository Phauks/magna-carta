// Standard base64 of raw bytes — the one home for the binary<->base64 codec the rest of this package
// shares (the ciphertext envelope, the wrapped-key hierarchy, and the blind-index digest all store
// raw bytes as base64 TEXT). btoa/atob are provided by both the Workers runtime and Node, so no
// platform binding is needed. The encoding is pinned by this package's golden vectors.

export function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

// Thrown when the input is not valid base64. Callers that want a domain-specific error (e.g. the
// envelope's "envelope-malformed") catch this and rethrow; otherwise it surfaces as-is rather than a
// raw runtime DOMException.
export class Base64DecodeError extends Error {
  constructor(message?: string) {
    super(message ?? "value is not valid base64");
    this.name = "Base64DecodeError";
  }
}

// Inverse of base64FromBytes. The result is ArrayBuffer-backed so it satisfies BufferSource for
// crypto.subtle key imports. Throws Base64DecodeError if atob rejects the input.
export function bytesFromBase64(value: string): Uint8Array<ArrayBuffer> {
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new Base64DecodeError();
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
