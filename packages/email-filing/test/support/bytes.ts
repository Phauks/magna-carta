// A tight `ArrayBuffer` view over a `Uint8Array`, for the WebCrypto calls these tests make directly.
// `crypto.subtle` takes a `BufferSource` backed by a plain `ArrayBuffer`; a bare `Uint8Array` is
// generic over `ArrayBufferLike` (it could be a `SharedArrayBuffer`), which those APIs reject.
// Slicing to the view's exact bounds yields the `ArrayBuffer` they accept — the same conversion
// src/dkim.ts makes before every `digest`/`verify`, and the same one `@magna-carta/signing`'s
// `bytes.ts` publishes for the packages that depend on it.
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
