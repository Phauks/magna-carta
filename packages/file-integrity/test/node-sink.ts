import { createHash } from "node:crypto";
import type { DigestSink, HashAlgorithm } from "../src/types.ts";

const NODE_ALGORITHM_NAME: Record<HashAlgorithm, string> = {
  MD5: "md5",
  "SHA-1": "sha1",
  "SHA-256": "sha256",
  "SHA-384": "sha384",
  "SHA-512": "sha512",
};

// A node:crypto-backed DigestSink so hashAll can be exercised in the default node pool. The Worker
// uses a crypto.DigestStream-backed sink instead (apps/api-worker/src/file-integrity/worker-sink.ts);
// both satisfy the same DigestSink contract.
export function createNodeDigestSink(algorithm: HashAlgorithm): DigestSink {
  const hash = createHash(NODE_ALGORITHM_NAME[algorithm]);
  return {
    write: (chunk) => {
      hash.update(chunk);
    },
    close: async () => hash.digest("hex"),
    abort: () => {},
  };
}
