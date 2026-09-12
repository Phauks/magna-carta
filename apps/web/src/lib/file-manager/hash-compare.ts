import { HASH_ALGORITHMS, type DigestSet, type HashAlgorithm } from "./matter-file-api.ts";

/**
 * What a digest somebody typed, pasted or uploaded reads as against the digests computed for the
 * version on screen. The algorithm is told from the digest's own length, so the reader never has
 * to say which fingerprint they were given — a court order rarely labels it.
 */
export type ExpectedDigestReading =
  | { readonly kind: "empty" }
  /** Not a hexadecimal digest of any length the five algorithms produce. */
  | { readonly kind: "unrecognised" }
  /** A well-formed digest, but nothing has been computed yet to hold it against. */
  | { readonly kind: "waiting"; readonly algorithm: HashAlgorithm }
  | { readonly kind: "match"; readonly algorithm: HashAlgorithm }
  | { readonly kind: "mismatch"; readonly algorithm: HashAlgorithm };

/** Hex length of each algorithm's digest. Lengths are distinct, so a length names its algorithm. */
const DIGEST_LENGTHS: Readonly<Record<HashAlgorithm, number>> = {
  md5: 32,
  sha1: 40,
  sha256: 64,
  sha384: 96,
  sha512: 128,
};

export const ALGORITHM_LABELS: Readonly<Record<HashAlgorithm, string>> = {
  md5: "MD5",
  sha1: "SHA-1",
  sha256: "SHA-256",
  sha384: "SHA-384",
  sha512: "SHA-512",
};

/**
 * The digest inside whatever was handed over. A pasted `sha256sum` line ("<digest>  name"), an
 * uppercase digest, or a digest with a stray `SHA256:` label all carry one hexadecimal run of a
 * digest's length; that run is the digest. Empty when there is none.
 */
export function extractDigest(text: string): string {
  const runs = text.toLowerCase().match(/[0-9a-f]+/g) ?? [];
  const lengths = new Set(Object.values(DIGEST_LENGTHS));
  return runs.find((run) => lengths.has(run.length)) ?? "";
}

export function algorithmOfDigest(digest: string): HashAlgorithm | null {
  return HASH_ALGORITHMS.find((algorithm) => DIGEST_LENGTHS[algorithm] === digest.length) ?? null;
}

export function readExpectedDigest(
  text: string,
  computed: DigestSet | null,
): ExpectedDigestReading {
  if (text.trim() === "") return { kind: "empty" };
  const digest = extractDigest(text);
  const algorithm = algorithmOfDigest(digest);
  if (algorithm === null) return { kind: "unrecognised" };
  if (computed === null) return { kind: "waiting", algorithm };
  return { kind: computed[algorithm] === digest ? "match" : "mismatch", algorithm };
}

/** Whether a file's own bytes are worth hashing to produce an expected digest: any file will do. */
export function expectedDigestText(reading: ExpectedDigestReading): string {
  switch (reading.kind) {
    case "empty":
      return "";
    case "unrecognised":
      return "That is not a digest of any of the five algorithms.";
    case "waiting":
      return `A ${ALGORITHM_LABELS[reading.algorithm]} digest. It is compared once the digests above are computed.`;
    case "match":
      return `Matches this version's ${ALGORITHM_LABELS[reading.algorithm]} digest.`;
    case "mismatch":
      return `Does not match this version's ${ALGORITHM_LABELS[reading.algorithm]} digest.`;
  }
}
