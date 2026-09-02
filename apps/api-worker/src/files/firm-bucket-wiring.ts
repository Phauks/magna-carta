import type { DataRegion } from "@magna-carta/database/data-region";
import type { Bindings } from "../app.ts";
import { realR2Credentials } from "./presigner-wiring.ts";
import { createS3FirmBucket } from "./s3-firm-bucket.ts";

// How a firm's bucket becomes a handle when it is not the one bound to this Worker.
export type FirmBucketFactory = (bucketName: string, region: DataRegion) => R2Bucket;

// Adapter selection, on the same terms as presignerForEnv and resourceProviderForEnv: the FULL R2 S3
// credential set present → the SigV4-signed S3 handle, which can address any bucket in the account;
// otherwise null, meaning there is no way to reach a bucket other than the bound one.
//
// Null is not a degraded mode, it is the development one. Without those credentials the development
// presigner routes the upload leg back through this Worker, which writes through the bound binding, so
// a firm's bucket name is only a routing label and every firm's bytes genuinely are in the bound
// bucket. The Miniflare pool has no S3 endpoint at all and always lands here, which is why the
// firm-bucket path resolves to the binding under test.
export function firmBucketFactoryForEnv(env: Bindings): FirmBucketFactory | null {
  const credentials = realR2Credentials(env);
  if (credentials === null) return null;
  return (bucketName, region) => createS3FirmBucket({ ...credentials, bucketName, region });
}
