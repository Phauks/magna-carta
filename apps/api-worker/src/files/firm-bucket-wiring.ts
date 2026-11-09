import type { DataRegion } from "@magna-carta/database/data-region";
import type { Bindings } from "../bindings.ts";
import { realR2Credentials } from "./presigner-wiring.ts";
import { ScopedCredentialCache } from "./firm-bucket-credentials.ts";
import { createS3FirmBucket, type S3Credentials } from "./s3-firm-bucket.ts";

// How a firm's bucket becomes a handle when it is not the one bound to this Worker.
export type FirmBucketFactory = (bucketName: string, region: DataRegion) => R2Bucket;

/**
 * One cache for the isolate. Minting is a round trip and a firm's bucket is addressed many times per
 * request, so a cache is what keeps the narrowing from costing an outbound call per object.
 */
const scopedCredentials = new ScopedCredentialCache();

/**
 * How long a credential taken from here must stay valid. These are the Worker's OWN object calls —
 * get, put, list, delete — which complete within a request rather than being handed to anyone, so
 * the horizon is a request's life and not a signed URL's.
 */
const WORKER_OPERATION_SECONDS = 60;

// Adapter selection, on the same terms as presignerForEnv and resourceProviderForEnv: the FULL R2 S3
// credential set present → the SigV4-signed S3 handle, which can address any bucket in the account;
// otherwise null, meaning there is no way to reach a bucket other than the bound one.
//
// Null is not a degraded mode, it is the development one. Without those credentials the development
// presigner routes the upload leg back through this Worker, which writes through the bound binding, so
// a firm's bucket name is only a routing label and every firm's bytes genuinely are in the bound
// bucket. The Miniflare pool has no S3 endpoint at all and always lands here, which is why the
// firm-bucket path resolves to the binding under test.
//
// WHICH CREDENTIAL SIGNS, AND WHY IT IS A CHOICE RATHER THAN A CONSTANT. The parent S3 key reaches
// every bucket in the account, for as long as it exists — wider than any request needs, since a
// request serving one firm has no business addressing another firm's bucket at all. Where an account
// API token is also configured, this narrows that: R2 mints a credential derived from the parent,
// scoped to the single bucket, with a lifetime, and THAT is what signs (firm-bucket-credentials.ts).
// The parent key stops appearing on the request path at all.
//
// Selection is by the token's presence rather than a flag, so the narrowing follows a secret that is
// already optional at deploy time — no new secret, no code path that only runs in production.
// Until it is set, this behaves exactly as it did. A minting failure is NOT quietly answered with the
// parent key: falling back would make the narrowing decorative, so the operation fails and says why.
export function firmBucketFactoryForEnv(env: Bindings): FirmBucketFactory | null {
  const parent = realR2Credentials(env);
  if (parent === null) return null;
  // The provisioner's token is the parent, and deliberately not a second secret: it already holds R2
  // edit on this account (it creates each firm's bucket and applies its CORS and expiry rules), so a
  // credential derived from it can be no wider than a capability the deployment already grants.
  const apiToken = env.CLOUDFLARE_API_TOKEN_FIRM_PROVISIONER;
  const scoped = apiToken !== undefined && apiToken !== "";

  return (bucketName, region) =>
    createS3FirmBucket({
      bucketName,
      accountId: parent.accountId,
      region,
      credentials: async (): Promise<S3Credentials> =>
        scoped
          ? scopedCredentials.credentialsFor({
              accountId: parent.accountId,
              apiToken,
              parentAccessKeyId: parent.accessKeyId,
              bucketName,
              region,
              neededSeconds: WORKER_OPERATION_SECONDS,
            })
          : { accessKeyId: parent.accessKeyId, secretAccessKey: parent.secretAccessKey },
    });
}

/** For tests, and for a deployment that has rotated the parent key. */
export function forgetScopedCredentials(): void {
  scopedCredentials.clear();
}
