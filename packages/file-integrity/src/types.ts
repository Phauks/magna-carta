// The fixed algorithm set. Every hash run computes all five in one pass — MD5 and SHA-1 are retained
// for eDiscovery/legacy interop (load files and opposing-party tooling still specify them) and are
// labelled as legacy-interop, not security-grade, in the UI. SHA-256 is the primary digest and the
// one with an ingest baseline to compare against.
export const HASH_ALGORITHMS = ["MD5", "SHA-1", "SHA-256", "SHA-384", "SHA-512"] as const;
export type HashAlgorithm = (typeof HASH_ALGORITHMS)[number];

// Each algorithm's field name in HashResult.
export const ALGORITHM_RESULT_KEY = {
  MD5: "md5",
  "SHA-1": "sha1",
  "SHA-256": "sha256",
  "SHA-384": "sha384",
  "SHA-512": "sha512",
} as const satisfies Record<HashAlgorithm, string>;

// A streaming digest backend for ONE algorithm. `write` is fed every chunk; `close` finalises and
// returns the lowercase-hex digest. The Worker backs this with crypto.DigestStream; tests back it
// with node:crypto. Injecting it keeps this package pure and node-testable.
export interface DigestSink {
  write(chunk: Uint8Array): Promise<void> | void;
  close(): Promise<string>;
}
export type CreateDigestSink = (algorithm: HashAlgorithm) => DigestSink;

export interface HashResult {
  readonly md5: string;
  readonly sha1: string;
  readonly sha256: string;
  readonly sha384: string;
  readonly sha512: string;
  readonly sizeBytes: number;
}

export type BaselineComparison = "match" | "mismatch" | "no-baseline";

export interface VerifyResult {
  readonly hashes: HashResult;
  readonly baselineSha256: string | null;
  readonly comparison: BaselineComparison;
}
