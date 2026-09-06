/*
 * Hashing a file before it is sent, so the firm can be asked whether it already holds the bytes.
 *
 * WHY HASH FIRST. A file the firm already holds — the same brief dropped twice, a folder re-sent
 * after a failed batch, a document that is already on another matter — costs the reader the whole
 * transfer and the matter a duplicate. Hashing first turns that into one small question, and the
 * answer decides whether a byte moves at all. The digest is the browser's own; the server computes
 * its own over the bytes it receives, and only the server's goes into the record.
 *
 * WHY THERE IS A CEILING. WebCrypto digests a whole buffer at once, so the file is read into memory
 * to be hashed. Past a few hundred megabytes that is a cost the reader feels and a tab that may
 * not survive it; a file that large is sent without the question, and the host's own hash at ingest
 * still catches a repeat of a version already on the file. A streaming hasher lifts the ceiling
 * when one is built (the Rust integrity crate is the natural home).
 */

/** Files at or below this are hashed before sending; larger ones go straight to the transfer. */
export const HASH_BEFORE_UPLOAD_CEILING_BYTES = 256 * 1024 * 1024;

/** Lowercase hex, which is how the server records a digest and how the lookup expects it. */
function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The SHA-256 of a file's bytes, or null when the file is over the ceiling or the browser cannot
 * read it. Null means "do not ask", never "no match": the transfer proceeds as if the question had
 * not been put.
 */
export async function sha256OfFile(
  file: Pick<File, "size" | "arrayBuffer">,
  ceiling = HASH_BEFORE_UPLOAD_CEILING_BYTES,
): Promise<string | null> {
  if (file.size > ceiling) return null;
  try {
    const bytes = await file.arrayBuffer();
    return toHex(await crypto.subtle.digest("SHA-256", bytes));
  } catch {
    return null;
  }
}
