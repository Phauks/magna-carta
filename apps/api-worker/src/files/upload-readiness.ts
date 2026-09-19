import type { DataRegion } from "@magna-carta/database/data-region";
import type { FirmId } from "@magna-carta/identifiers/types";
import type { Bindings } from "../bindings.ts";
import type { FirmResourceProvider } from "../firm-resource-provider.ts";
import { resourceProviderForEnv } from "../firm-provisioner-wiring.ts";
import { resolveFirmBucket } from "./firm-bucket.ts";
import { FirmBucketUnavailableError } from "./firm-bucket-fault.ts";
import { BucketCredentialError } from "./firm-bucket-credentials.ts";
import { devUploadEmulationActive } from "./presigner-wiring.ts";

/*
 * WHETHER A FIRM CAN UPLOAD, ANSWERED FROM THE SERVER.
 *
 * The one hop of an upload that bypasses every Worker is the browser's presigned PUT to the firm's
 * bucket — and it has to bypass them, because the request-body cap forbids proxying bytes. So a
 * refusal on that hop reaches neither the app nor its log, and the file manager can say only that
 * storage did not answer. Five different faults produce that one symptom: the firm's bucket was
 * never created (provisioning ran the development adapter), the bucket carries no CORS policy, the
 * policy names the wrong origins, the S3 key cannot sign for that bucket (a token scoped to one
 * bucket), or the deployment names no bound bucket. Each has a different fix, and none is
 * observable from the browser's side of the hop.
 *
 * Every one of them IS observable from this side. The bucket's existence is a GET against the
 * account; the three bucket settings are whole-set PUTs the provisioner already knows how to make;
 * and whether the key can sign is a signed HEAD against the bucket, made with the same credential
 * the browser's URL will carry. So this module asks — and where the answer is a setting the code
 * owns, it re-applies the setting rather than reporting a diff, because a PUT of the whole rule set
 * costs the same as reading it and leaves the bucket right. What it cannot repair (a missing bucket,
 * a mis-scoped key) it names, with the fix.
 *
 * Deliberately NOT here: a sweep, a cache on the firm row, or a mode object. The check runs when a
 * person asks (routes/upload-readiness.ts, run from the version panel with the other reads about
 * what is running), and the report is the diagnosis. The other half of the same fault — a production deployment silently running the
 * development adapter — is closed by the deploy gate in wrangler.jsonc, which refuses to deploy
 * without the provisioner's credentials, not by code here.
 */

export type UploadReadinessCheckId =
  | "bucket-recorded"
  | "bucket-exists"
  | "event-notifications"
  | "lifecycle-rules"
  | "cors-policy"
  | "key-can-sign";

/** `applied` is a repair: the setting was re-put, whether or not it was wrong before. */
export type UploadReadinessOutcome = "ok" | "applied" | "failed" | "not-applicable";

export interface UploadReadinessCheck {
  readonly id: UploadReadinessCheckId;
  readonly outcome: UploadReadinessOutcome;
  /** What was found, in words a person acts on. Names buckets and settings, never firm data. */
  readonly detail: string;
}

export interface UploadReadiness {
  /** No check failed. A `not-applicable` check does not count against readiness. */
  readonly ready: boolean;
  readonly bucketName: string | null;
  /** Which provisioning adapter this deployment runs — the fact the checks are read against. */
  readonly provisioner: FirmResourceProvider["kind"];
  /** Whether bytes go from the browser straight to storage, or through the application locally. */
  readonly uploadPath: "direct-to-storage" | "through-the-application";
  /** In the order the preconditions must hold, so the first failure is the cause, not a consequence. */
  readonly checks: readonly UploadReadinessCheck[];
}

/** The object the signing probe asks after. It never exists; a 404 for it is the affirmative answer. */
export const READINESS_PROBE_KEY = "__readiness_probe__";

/**
 * The audit event a run of the check writes (routes/upload-readiness.ts), and the one the database
 * health read looks back for (routes/meta-database-health.ts) — so the version overlay can say when
 * the firm was last checked and what was found, without the read acting on anything.
 */
export const UPLOAD_READINESS_AUDIT_EVENT = "firm.upload_readiness_checked";

/** Which way a firm's bytes travel in this deployment; the fact every readiness reading is against. */
export function uploadPathForEnv(env: Bindings): UploadReadiness["uploadPath"] {
  return devUploadEmulationActive(env) ? "through-the-application" : "direct-to-storage";
}

export interface UploadReadinessDependencies {
  readonly provider: FirmResourceProvider;
  /**
   * A HEAD for `key` in the firm's bucket, signed with exactly the credential a presigned upload
   * URL carries. Resolves null when the object is absent (the expected answer), throws when the
   * request is refused. Anything signed with a wider credential would be measuring the wrong thing.
   */
  readonly headObject: (bucketName: string, region: DataRegion, key: string) => Promise<unknown>;
  readonly uploadPath: UploadReadiness["uploadPath"];
}

export interface UploadReadinessSubject {
  readonly firmId: FirmId;
  readonly bucketName: string | null;
  readonly region: DataRegion;
}

export async function verifyUploadReadiness(
  dependencies: UploadReadinessDependencies,
  firm: UploadReadinessSubject,
): Promise<UploadReadiness> {
  const { provider } = dependencies;
  const checks: UploadReadinessCheck[] = [];
  const report = (): UploadReadiness => ({
    ready: checks.every((check) => check.outcome !== "failed"),
    bucketName: firm.bucketName,
    provisioner: provider.kind,
    uploadPath: dependencies.uploadPath,
    checks,
  });

  // 1. The firm row names a bucket. Without one nothing below can even be addressed.
  if (firm.bucketName === null) {
    checks.push({
      id: "bucket-recorded",
      outcome: "failed",
      detail:
        "The firm's record names no storage bucket: provisioning stopped before its bucket step. " +
        "Resume the firm's provisioning; nothing can be uploaded until it records one.",
    });
    return report();
  }
  const bucketName = firm.bucketName;
  checks.push({
    id: "bucket-recorded",
    outcome: "ok",
    detail: `The firm's bucket is ${bucketName}.`,
  });

  // 2. The bucket exists in the account. The development adapter records a name and creates
  //    nothing, so under it this is the check that cannot be asked — and the report says so rather
  //    than answering "ok" for a bucket nobody looked for.
  if (provider.kind === "development") {
    const detail =
      "This deployment runs the development provisioning adapter, which configures no bucket; " +
      "every firm's bytes go through the bucket bound to the application.";
    for (const id of [
      "bucket-exists",
      "event-notifications",
      "lifecycle-rules",
      "cors-policy",
    ] as const) {
      checks.push({ id, outcome: "not-applicable", detail });
    }
  } else {
    let exists: boolean;
    try {
      exists = await provider.bucketExists(firm.firmId, firm.region);
    } catch (caught) {
      checks.push({
        id: "bucket-exists",
        outcome: "failed",
        detail: `The account could not be asked whether ${bucketName} exists: ${messageOf(caught)}`,
      });
      return report();
    }
    if (!exists) {
      checks.push({
        id: "bucket-exists",
        outcome: "failed",
        detail:
          `No bucket named ${bucketName} exists in the account under the firm's jurisdiction. The ` +
          "firm was provisioned by a deployment that recorded the name without creating the bucket " +
          "(the development adapter). Re-run the firm's provisioning under the real one; the " +
          "readiness check will not create buckets the provisioner should have.",
      });
      return report();
    }
    checks.push({
      id: "bucket-exists",
      outcome: "ok",
      detail: `${bucketName} exists in the account.`,
    });

    // 3–5. The three settings the upload path needs, re-applied. Each is a PUT of the whole set the
    //      code owns, so applying is the same cost as reading and leaves the bucket correct. A PUT
    //      that is refused is reported with the API's own words and does not stop the others: they
    //      are independent, and a reader wants the whole picture.
    const settings = [
      {
        id: "event-notifications" as const,
        apply: () => provider.configureBucketNotifications(firm.firmId, firm.region),
        applied: "The object-create notification feeding the ingest queue is in place.",
      },
      {
        id: "lifecycle-rules" as const,
        apply: () => provider.configureBucketLifecycle(firm.firmId, firm.region),
        applied: "The expiry rules for regenerable artifacts are in place.",
      },
      {
        id: "cors-policy" as const,
        apply: () => provider.configureBucketCors(firm.firmId, firm.region),
        applied:
          "The browser-upload CORS policy is in place, with this deployment's own origin folded in.",
      },
    ];
    for (const setting of settings) {
      try {
        await setting.apply();
        checks.push({ id: setting.id, outcome: "applied", detail: setting.applied });
      } catch (caught) {
        checks.push({ id: setting.id, outcome: "failed", detail: messageOf(caught) });
      }
    }
  }

  // 6. The key can sign for this bucket. This is the check that tells a mis-scoped S3 token apart
  //    from everything above: the settings can all be right and the presigned URL still refused,
  //    because the token that signed it was made for one bucket and this is another. The probe is
  //    signed with the presigner's own credential — the point is to ask the exact question the
  //    browser's URL will put. Locally the upload goes through the application to the bound bucket
  //    and no URL is ever signed against R2, so there is nothing to ask.
  if (dependencies.uploadPath === "through-the-application") {
    checks.push({
      id: "key-can-sign",
      outcome: "not-applicable",
      detail:
        "Uploads go through the application to the bound bucket in this deployment; no URL is " +
        "signed against storage.",
    });
    return report();
  }
  try {
    const found = await dependencies.headObject(bucketName, firm.region, READINESS_PROBE_KEY);
    checks.push(
      found === null
        ? {
            id: "key-can-sign",
            outcome: "ok",
            detail: `The S3 credential signs a request ${bucketName} honours.`,
          }
        : {
            id: "key-can-sign",
            outcome: "ok",
            detail:
              `The S3 credential signs a request ${bucketName} honours (an object named ` +
              `${READINESS_PROBE_KEY} exists there, which nothing should have written).`,
          },
    );
  } catch (caught) {
    checks.push({ id: "key-can-sign", outcome: "failed", detail: describeSigningFailure(caught) });
  }
  return report();
}

/*
 * The S3 handle reports a refused request as "R2 S3 head failed for <bucket>/<key>: <status>"
 * (s3-firm-bucket.ts). A 403 on a HEAD for an object that does not exist is the signature of a
 * credential that cannot act on the bucket at all — for an all-buckets key the same request answers
 * 404 — so it gets the sentence that names the fix. Everything else is passed through in its own
 * words: a credential that could not be minted says so, and a bound-bucket fault carries its detail.
 */
function describeSigningFailure(caught: unknown): string {
  if (caught instanceof BucketCredentialError) {
    // Two tokens are involved in a mint — the provisioner token authorises the request and the
    // R2 S3 token is the parent the credential is derived from — and a refusal does not say which
    // side R2 objected to. Both are named, with the property each must have; a refusal that cleared
    // on a later run with nothing changed has been seen once and is explained by neither.
    return (
      `A bucket-scoped credential could not be minted for this bucket: ${caught.message}. The ` +
      "mint is authorised by the provisioner token (CLOUDFLARE_API_TOKEN_FIRM_PROVISIONER), which " +
      "needs Workers R2 Storage edit on the account, and derives from the R2 S3 token " +
      "(R2_S3_ACCESS_KEY_ID), which must reach this bucket — an R2 API token made for one bucket " +
      "cannot be narrowed to another. Check both under R2, Manage R2 API Tokens, and run the " +
      "check again before changing either."
    );
  }
  if (caught instanceof FirmBucketUnavailableError) return caught.detail;
  const message = messageOf(caught);
  if (message.endsWith(": 403")) {
    return (
      "Storage refused a request signed with the S3 credential (403). The R2 S3 token " +
      "(R2_S3_ACCESS_KEY_ID / R2_S3_SECRET_ACCESS_KEY) cannot act on this bucket — it was made for " +
      "one bucket rather than the whole account. Re-mint it as Object Read & Write with " +
      '"Apply to all buckets in this account" and set the pair with wrangler secret put ' +
      "(docs/conventions/operations.md, deploy secrets)."
    );
  }
  return `Storage did not honour a request signed with the S3 credential: ${message}`;
}

function messageOf(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

/** The deployment's real ports, for the route. Reads the firm's bucket and region from its row. */
export async function checkUploadReadinessForFirm(
  env: Bindings,
  firmId: FirmId,
): Promise<UploadReadiness> {
  const row = await env.DB_CONTROL.prepare(
    "SELECT bucket_name, data_region FROM firm WHERE id = ?1",
  )
    .bind(firmId)
    .first<{ bucket_name: string | null; data_region: string | null }>();
  const region: DataRegion = row?.data_region === "eu" ? "eu" : "us";
  return verifyUploadReadiness(
    {
      provider: resourceProviderForEnv(env),
      // The same resolver every object path uses, so the credential the probe is signed with is
      // the one a presigned URL carries (firm-bucket-wiring.ts decides which).
      headObject: (bucketName, bucketRegion, key) =>
        resolveFirmBucket(env, bucketName, bucketRegion).bucket.head(key),
      uploadPath: uploadPathForEnv(env),
    },
    { firmId, bucketName: row?.bucket_name ?? null, region },
  );
}
