/*
 * The firm's object storage is not usable, and it is this deployment's fault rather than the
 * caller's.
 *
 * Two states reach here, and neither is a bug in the request: a firm whose provisioning never
 * recorded a bucket, and a firm whose recorded bucket is not the one bound to this Worker — the
 * mismatch the bucket resolver refuses because a presigned write would land where no read path can
 * reach it.
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

export function firmBucketNotBound(
  firmBucketName: string,
  boundBucketName: string | null,
): FirmBucketUnavailableError {
  return new FirmBucketUnavailableError(
    boundBucketName === null
      ? "This deployment does not name the storage bucket it reads through, so an upload cannot be " +
          "signed against one it can also read back. Nothing was uploaded and the matter is " +
          "unchanged. The operator sets R2_BUCKET_NAME to the bucket bound to the API worker."
      : `This firm's files are recorded against the storage bucket "${firmBucketName}", and this ` +
          `deployment reads through "${boundBucketName}". Signing an upload against the first would ` +
          "put the bytes where nothing here can read them back, so it was refused: nothing was " +
          "uploaded and the matter is unchanged. The operator either binds the firm's own bucket to " +
          "the API worker or records the firm against the bound one.",
  );
}
