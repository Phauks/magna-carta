// Image bytes as two route surfaces take and serve them: the office letterhead (the matters module,
// locations.ts) and the firm's brand marks (the firm module, firm-profile.ts). Shared here so the two
// keep one answer to what base64 is refused and how a stored image is streamed back.
// Base64 to bytes, refusing anything that is not base64 rather than decoding it into garbage that would
// then fail the format sniff with a message about the wrong thing. Both image surfaces take an image the same way
// for the same reasons.
export function decodeBase64(encoded: string): Uint8Array | undefined {
  try {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return undefined;
  }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Streams a stored image back, in the type the bytes were sniffed to be when they were stored.
 * Not cacheable across members and never public: it rides the session like every other read, and
 * a replaced mark is a new key, so nothing here needs to expire.
 */
export async function imageResponse(
  bucket: R2Bucket,
  objectKey: string,
  contentType: string,
): Promise<Response | null> {
  const object = await bucket.get(objectKey);
  if (object === null) return null;
  return new Response(object.body, {
    status: 200,
    headers: { "content-type": contentType, "cache-control": "private, no-store" },
  });
}
