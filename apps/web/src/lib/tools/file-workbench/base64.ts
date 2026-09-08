/*
 * Base64 for the one place this workbench needs it: handing a file's bytes to the decryption and
 * recovery routes, which take `fileBase64` in a JSON body rather than a multipart upload — the
 * file never leaves the request that is about it, and this is the encoding that request needs.
 */

/** Bytes to base64, chunked so a large file does not blow the call stack of `String.fromCharCode`. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

/** Base64 to bytes. Throws on input that is not valid base64, exactly as `atob` does. */
export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
