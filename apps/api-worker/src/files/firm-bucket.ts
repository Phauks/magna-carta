import type { DataRegion } from "@magna-carta/database/data-region";
import type { Bindings } from "../bindings.ts";
import { firmBucketNotBound } from "./firm-bucket-fault.ts";
import { firmBucketFactoryForEnv } from "./firm-bucket-wiring.ts";
import { requireBucket } from "./require-bucket.ts";

// The one home for "which bucket holds this firm's bytes". Every path that touches a firm's objects
// resolves it here, and always as a PAIR:
//
//   - `bucketName` — the name a presigned direct-to-R2 URL addresses, and the name an R2 object-create
//     event reports (the key the ingest consumer resolves back to a firm);
//   - `bucket` — the handle this Worker itself gets/puts/lists through.
//
// Resolving the two together is the point. Presigning an upload against the firm's own bucket while
// reading through a different handle is silent data loss: the bytes land in a bucket the Worker never
// reads, so ingest finds no object, retries, and dead-letters — and a read path that does find an
// object found it in some other namespace. One seam, one answer, both sides.
//
// A Worker can only get/put/list through a BOUND R2 namespace, and there is no runtime API that turns
// a bucket name into a binding. So when a firm's bucket is not the bound one, the handle is an
// S3-API-backed stand-in (s3-firm-bucket.ts) signed with the account-scoped credential that already
// reaches every bucket in the account — not a binding, but the same surface, addressing the same
// bucket the name does. That is what keeps firm creation off the release path: a firm provisioned at
// 2 a.m. is readable at 2 a.m., with no config commit and no deploy.
export interface FirmBucket {
  // Always names the same physical bucket as `bucket`.
  readonly bucketName: string;
  readonly bucket: R2Bucket;
}

// `region` selects the S3 endpoint host, because a bucket created under a Cloudflare jurisdiction
// exists only at that jurisdiction's endpoint (r2-s3-endpoint.ts). It defaults to the column default
// rather than being required at all 35 call sites; a caller that holds the firm's row should pass the
// row's dataRegion, and resolveFirmBucketForFirmId below always does. The default is only ever wrong
// for a firm provisioned outside the default jurisdiction, which no firm is today — see the
// per-firm-R2 ADR, which carries this as a named remaining gap rather than a solved one.
export function resolveFirmBucket(
  env: Bindings,
  firmBucketName: string | null,
  region: DataRegion = "us",
): FirmBucket {
  const bucketName = requireBucket(firmBucketName);

  // No S3 credential set: the development presigner routes the upload leg back through this Worker,
  // which writes through the bound handle, so every firm's bytes really are in the bound bucket and
  // the name is a routing label. The pair is consistent by construction.
  const factory = firmBucketFactoryForEnv(env);
  if (factory === null) return { bucketName, bucket: env.R2 };

  const boundBucketName = env.R2_BUCKET_NAME;
  // A NAMED fault rather than a bare throw: this is the one way a deployment can be configured such
  // that no upload can work at all, and a bare Error reached the member as "an unexpected error
  // occurred" with an Error ID — which said nothing about what was wrong, or that it was not their
  // file (firm-bucket-fault.ts).
  if (boundBucketName === undefined || boundBucketName === "") {
    throw firmBucketNotBound();
  }
  // The bound bucket is reached through its binding: no signing, no network hop, exact binding
  // semantics. Everything else goes over the S3 API.
  if (boundBucketName === bucketName) return { bucketName, bucket: env.R2 };
  return { bucketName, bucket: factory(bucketName, region) };
}

// The same pair, for a caller that holds only a firm id — a queue consumer whose message predates any
// bucket field, or a sweep working from a firm id rather than a firm row. The control-plane row is the
// registry of record for a firm's bucket (bucket_name is unique there precisely so an R2 event can be
// resolved back to a firm), so this reads it and hands the answer to the resolver above rather than
// letting a second notion of "the firm's bucket" exist. It reads the firm's data region in the same
// query, so this path never depends on the default above. Prefer passing the name when a caller
// already has it: this costs a control-plane read.
export async function resolveFirmBucketForFirmId(
  env: Bindings,
  firmId: string,
): Promise<FirmBucket> {
  const { results } = await env.DB_CONTROL.prepare(
    "SELECT bucket_name, data_region FROM firm WHERE id = ?1",
  )
    .bind(firmId)
    .all<{ bucket_name: string | null; data_region: string | null }>();
  const row = results[0];
  const region: DataRegion = row?.data_region === "eu" ? "eu" : "us";
  return resolveFirmBucket(env, row?.bucket_name ?? null, region);
}
