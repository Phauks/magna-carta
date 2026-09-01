import type { Bindings } from "../app.ts";
import { firmBucketNotBound } from "./firm-bucket-fault.ts";
import { realR2Credentials } from "./presigner-wiring.ts";
import { requireBucket } from "./require-bucket.ts";

// The one home for "which R2 bucket holds this firm's bytes". Every path that touches a firm's
// objects resolves it here, and always as a PAIR:
//
//   - `bucketName` — the name a presigned direct-to-R2 URL addresses, and the name an R2
//     object-create event reports (the key the ingest consumer resolves back to a firm);
//   - `bucket` — the bound handle this Worker itself gets/puts/lists through.
//
// Resolving the two together is the point. Presigning an upload against the firm's own bucket while
// reading through a different bound binding is silent data loss: the bytes land in a bucket the
// Worker never reads, so ingest finds no object, retries, and dead-letters — and a read path that
// does find an object found it in some other namespace. One seam, one answer, both sides.
//
// A Worker can only get/put/list through a BOUND R2 namespace — there is no runtime API that turns
// a bucket name into a handle — so today every firm resolves to the single bound binding (env.R2).
// Binding a firm's own bucket is a config-commit + deploy step; when that lands, this function grows
// the per-firm lookup and every caller follows it without changing.
export interface FirmBucket {
  // Always names the same physical bucket as `bucket`.
  readonly bucketName: string;
  readonly bucket: R2Bucket;
}

export function resolveFirmBucket(env: Bindings, firmBucketName: string | null): FirmBucket {
  const bucketName = requireBucket(firmBucketName);
  // Direct-to-R2 presigning is live only when the full R2 S3 credential set is configured
  // (presigner-wiring.ts is the single home for that predicate). Then a signed URL genuinely
  // addresses `bucketName` at R2's S3 endpoint, so a name that is not the bound bucket sends the
  // firm's bytes somewhere no read path here can reach — refuse loudly at mint time rather than
  // write them into a hole. Without those credentials the development presigner routes the upload
  // leg back through this Worker, which writes through the bound handle, so the name is only a
  // routing label and the pair is consistent by construction.
  if (realR2Credentials(env) !== null) {
    const boundBucketName = env.R2_BUCKET_NAME;
    // Both refusals are NAMED faults rather than bare throws. They are the two ways a deployment can
    // be configured such that no upload can work at all, and each one used to reach the reader as
    // "an unexpected error occurred" with an Error ID — which told a member trying to file a
    // document nothing about what had actually gone wrong, or that it was not their file.
    if (boundBucketName === undefined || boundBucketName === "") {
      throw firmBucketNotBound(bucketName, null);
    }
    if (boundBucketName !== bucketName) {
      throw firmBucketNotBound(bucketName, boundBucketName);
    }
  }
  return { bucketName, bucket: env.R2 };
}
