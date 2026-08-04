// A tight `ArrayBuffer` view over a `Uint8Array`. WebCrypto and pkijs's ASN.1 layer want a
// `BufferSource` backed by a plain `ArrayBuffer`; a bare `Uint8Array` is generic over
// `ArrayBufferLike` (it could be a `SharedArrayBuffer`), which those APIs reject. Slicing to the
// view's exact bounds yields the `ArrayBuffer` they accept.
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** Base64-encode bytes. Chunked so a large document does not overflow `String.fromCharCode`'s
 * argument stack. `btoa` is available in both workerd and node. */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Decode a base64 string to bytes (`atob` is available in both workerd and node). */
export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
