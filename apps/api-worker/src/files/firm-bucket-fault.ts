/*
 * The firm's object storage is not usable, and it is this deployment's fault rather than the
 * caller's.
 *
 * Two states reach here, and neither is a bug in the request: a firm whose provisioning never
 * recorded a bucket, and a deployment that does not name the bucket it reads through, so the bucket
 * resolver cannot tell the bound bucket apart from a firm's own. (A firm whose bucket is simply not
 * the bound one is no longer a fault at all — the resolver hands back an S3-backed handle addressing
 * that bucket, s3-firm-bucket.ts.)
 *
 * They were plain `Error`s, so the outermost boundary turned each into "An unexpected error
 * occurred. Quote the Error ID when reporting it." That sentence is correct for a fault nobody
 * anticipated and wrong for this one: the condition is known, its remedy is an operator step, and a
 * member trying to upload a file was left with an Error ID and no idea that the deployment — not
 * their file — was what refused. The rule this restores is the one the human-verification gate
 * already states: a fault the caller cannot act on is never a 500 with an opaque Error ID.
 *
 * The message says what is misconfigured, because the person reading it is a member of the firm and
 * the person who can fix it is the operator they will forward it to. It names bucket names, which
 * are deployment configuration, and never anything about the firm's data.
 */
export class FirmBucketUnavailableError extends Error {
  /** What a reader is told: the condition, and that nothing was written. */
  readonly detail: string;

  constructor(detail: string) {
    super(detail);
    this.name = "FirmBucketUnavailableError";
    this.detail = detail;
  }
}

export function firmBucketNotProvisioned(): FirmBucketUnavailableError {
  return new FirmBucketUnavailableError(
    "This firm's file storage has not finished being provisioned, so nothing can be written to it " +
      "yet. Nothing was uploaded and the matter is unchanged. An administrator can resume the " +
      "firm's provisioning; it is a deployment step, not something to fix on this screen.",
  );
}

export function firmBucketNotBound(): FirmBucketUnavailableError {
  return new FirmBucketUnavailableError(
    "This deployment does not name the storage bucket it reads through, so an upload cannot be " +
      "signed against one it can also read back. Nothing was uploaded and the matter is " +
      "unchanged. The operator sets R2_BUCKET_NAME to the bucket bound to the API worker.",
  );
}
