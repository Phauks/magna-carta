/*
 * The digest computed here, in the browser, over the bytes the person handed us.
 *
 * This figure is FEEDBACK, not evidence. A digest that goes into a record is computed by the
 * server over the bytes the server received, because that is the only one that says anything about
 * what arrived. Nothing on this workbench goes into a record, so the browser figure is the right
 * one here, and the Hash panel says where it came from rather than letting the two be confused.
 *
 * SHA-256 and SHA-1 only: those are what WebCrypto offers, and MD5 (which the server-side
 * @magna-carta/file-integrity also reports) has no browser implementation worth carrying.
 */

/** The algorithms a browser can compute, in the order the panel lists them. */
export const BROWSER_DIGEST_ALGORITHMS = ["SHA-256", "SHA-1"] as const;

export type BrowserDigestAlgorithm = (typeof BROWSER_DIGEST_ALGORITHMS)[number];

export type BrowserDigests = Readonly<Record<BrowserDigestAlgorithm, string>>;

/** Lowercase hex, which is how every tool a lawyer might compare against prints a digest. */
export function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Two digests over one buffer. The file is read once by the caller; this hashes what it was given
 * rather than reading the file again per algorithm.
 */
export async function digestBuffer(bytes: ArrayBuffer): Promise<BrowserDigests> {
  const computed = await Promise.all(
    BROWSER_DIGEST_ALGORITHMS.map(async (algorithm) => {
      const digest = await crypto.subtle.digest(algorithm, bytes);
      return [algorithm, toHex(digest)] as const;
    }),
  );
  return Object.fromEntries(computed) as BrowserDigests;
}

/**
 * Whether a digest a person pasted is the same one, ignoring case and surrounding space. Comparing
 * the strings directly is what sends someone chasing a difference that is only whitespace.
 */
export function digestMatches(pasted: string, computed: string): boolean {
  return pasted.trim().toLowerCase() === computed.trim().toLowerCase();
}
