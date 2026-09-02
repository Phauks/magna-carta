import { firmBucketNotProvisioned } from "./firm-bucket-fault.ts";

// An active session firm always has a provisioned bucket; null is a broken provisioning invariant —
// refuse rather than operate against a missing bucket. It refuses as a NAMED fault (→ 503 saying
// provisioning is unfinished), not a bare throw: the condition is known and its remedy is an
// operator step, so the reader is told that rather than handed an Error ID for a fault they cannot
// act on. The null guard for firm-bucket.ts, which is what callers resolve a firm's bucket
// through — reach for that resolver rather than this, so the name a URL is signed against and the
// handle bytes are read through always come from one decision.
export function requireBucket(bucketName: string | null): string {
  if (bucketName === null) throw firmBucketNotProvisioned();
  return bucketName;
}
