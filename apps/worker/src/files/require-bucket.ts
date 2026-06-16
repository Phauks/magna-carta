// An active session firm always has a provisioned bucket; null is a broken provisioning
// invariant — fail loud (→ 500) rather than operate against a missing bucket.
export function requireBucket(bucketName: string | null): string {
  if (bucketName === null) {
    throw new Error("session firm has no R2 bucket — provisioning is incomplete");
  }
  return bucketName;
}
