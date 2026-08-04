// An active session firm always has a provisioned bucket; null is a broken provisioning
// invariant — fail loud (→ 500) rather than operate against a missing bucket. The null guard for
// firm-bucket.ts, which is what callers resolve a firm's bucket through — reach for that resolver
// rather than this, so the name a URL is signed against and the handle bytes are read through
// always come from one decision.
export function requireBucket(bucketName: string | null): string {
  if (bucketName === null) {
    throw new Error("session firm has no R2 bucket — provisioning is incomplete");
  }
  return bucketName;
}
