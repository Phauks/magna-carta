// A tight `ArrayBuffer` view over a `Uint8Array`. WebCrypto and pkijs's ASN.1 layer want a
// `BufferSource` backed by a plain `ArrayBuffer`; a bare `Uint8Array` is generic over
// `ArrayBufferLike` (it could be a `SharedArrayBuffer`), which those APIs reject. Slicing to the
// view's exact bounds yields the `ArrayBuffer` they accept.
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
