// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
import { describe, expect, it } from "vitest";
import type { DataRegion } from "@magna-carta/database/data-region";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId } from "@magna-carta/identifiers/types";
import type { FirmResourceProvider } from "../src/firm-resource-provider.ts";
import { BucketCredentialError } from "../src/files/firm-bucket-credentials.ts";
import { firmBucketNotBound } from "../src/files/firm-bucket-fault.ts";
import {
  READINESS_PROBE_KEY,
  verifyUploadReadiness,
  type UploadReadinessDependencies,
} from "../src/files/upload-readiness.ts";

/*
 * Five faults produce one symptom in the browser. What has to hold here is that each of them
 * produces a DIFFERENT line in the report, in the order the preconditions hold, and that the report
 * never says "ok" for a thing it did not look at.
 */

const firmId = newIdentifier("firm") as FirmId;
const BUCKET = "magna-carta-production-firm-pemberton";

function restProvider(overrides: Partial<FirmResourceProvider> = {}): FirmResourceProvider {
  const applied: string[] = [];
  return {
    kind: "cloudflare-rest",
    bucketExists: () => Promise.resolve(true),
    createBucket: () => Promise.resolve({ bucketName: BUCKET }),
    configureBucketNotifications: () => {
      applied.push("notifications");
      return Promise.resolve();
    },
    configureBucketLifecycle: () => {
      applied.push("lifecycle");
      return Promise.resolve();
    },
    configureBucketCors: () => {
      applied.push("cors");
      return Promise.resolve();
    },
    ...overrides,
  };
}

function dependencies(
  overrides: Partial<UploadReadinessDependencies> = {},
): UploadReadinessDependencies {
  return {
    provider: restProvider(),
    headObject: () => Promise.resolve(null),
    uploadPath: "direct-to-storage",
    ...overrides,
  };
}

const subject = { firmId, bucketName: BUCKET, region: "us" as DataRegion };

function outcomes(report: Awaited<ReturnType<typeof verifyUploadReadiness>>) {
  return Object.fromEntries(report.checks.map((check) => [check.id, check.outcome]));
}

describe("a firm whose every precondition holds", () => {
  it("is ready: the bucket is found, the three settings re-applied, the key honoured", async () => {
    const report = await verifyUploadReadiness(dependencies(), subject);
    expect(report.ready).toBe(true);
    expect(report.provisioner).toBe("cloudflare-rest");
    expect(report.uploadPath).toBe("direct-to-storage");
    expect(outcomes(report)).toEqual({
      "bucket-recorded": "ok",
      "bucket-exists": "ok",
      "event-notifications": "applied",
      "lifecycle-rules": "applied",
      "cors-policy": "applied",
      "key-can-sign": "ok",
    });
  });

  it("probes with the presigner's own credential, for an object that does not exist", async () => {
    const seen: string[] = [];
    await verifyUploadReadiness(
      dependencies({
        headObject: (bucketName, region, key) => {
          seen.push(`${bucketName}/${key}@${region}`);
          return Promise.resolve(null);
        },
      }),
      { ...subject, region: "eu" },
    );
    expect(seen).toEqual([`${BUCKET}/${READINESS_PROBE_KEY}@eu`]);
  });
});

describe("each fault gets its own line, and the walk stops where nothing below can be asked", () => {
  it("a firm with no recorded bucket fails at the first check and asks nothing else", async () => {
    let asked = false;
    const report = await verifyUploadReadiness(
      dependencies({
        provider: restProvider({ bucketExists: () => ((asked = true), Promise.resolve(true)) }),
      }),
      { ...subject, bucketName: null },
    );
    expect(report.ready).toBe(false);
    expect(report.checks).toHaveLength(1);
    expect(report.checks[0]).toMatchObject({ id: "bucket-recorded", outcome: "failed" });
    expect(report.checks[0]?.detail).toContain("provisioning stopped before its bucket step");
    expect(asked).toBe(false);
  });

  it("a bucket the account does not have is named as the development-adapter signature, and is NOT created", async () => {
    let created = false;
    const report = await verifyUploadReadiness(
      dependencies({
        provider: restProvider({
          bucketExists: () => Promise.resolve(false),
          createBucket: () => ((created = true), Promise.resolve({ bucketName: BUCKET })),
        }),
      }),
      subject,
    );
    expect(report.ready).toBe(false);
    expect(outcomes(report)).toEqual({ "bucket-recorded": "ok", "bucket-exists": "failed" });
    expect(report.checks[1]?.detail).toContain(`No bucket named ${BUCKET} exists`);
    expect(report.checks[1]?.detail).toContain("development adapter");
    expect(created).toBe(false);
  });

  it("an account that cannot be asked is a failure to look, never an absence", async () => {
    const report = await verifyUploadReadiness(
      dependencies({
        provider: restProvider({
          bucketExists: () =>
            Promise.reject(
              new Error("bucketExists failed: HTTP 403 — 10000: Authentication error"),
            ),
        }),
      }),
      subject,
    );
    expect(report.checks[1]).toMatchObject({ id: "bucket-exists", outcome: "failed" });
    expect(report.checks[1]?.detail).toContain("could not be asked");
    expect(report.checks[1]?.detail).toContain("Authentication error");
  });

  it("a refused setting is reported in the API's words and does not stop the other settings", async () => {
    const report = await verifyUploadReadiness(
      dependencies({
        provider: restProvider({
          configureBucketLifecycle: () =>
            Promise.reject(
              new Error("configureBucketLifecycle failed: HTTP 400 — 10043: bad rule"),
            ),
        }),
      }),
      subject,
    );
    expect(report.ready).toBe(false);
    expect(outcomes(report)).toMatchObject({
      "event-notifications": "applied",
      "lifecycle-rules": "failed",
      "cors-policy": "applied",
      "key-can-sign": "ok",
    });
    expect(report.checks.find((check) => check.id === "lifecycle-rules")?.detail).toContain(
      "10043: bad rule",
    );
  });

  it("a 403 on the signed probe names the mis-scoped S3 token and the re-mint", async () => {
    const report = await verifyUploadReadiness(
      dependencies({
        headObject: () =>
          Promise.reject(new Error(`R2 S3 head failed for ${BUCKET}/${READINESS_PROBE_KEY}: 403`)),
      }),
      subject,
    );
    expect(report.ready).toBe(false);
    const signing = report.checks.find((check) => check.id === "key-can-sign");
    expect(signing?.outcome).toBe("failed");
    expect(signing?.detail).toContain("cannot act on this bucket");
    expect(signing?.detail).toContain("Apply to all buckets in this account");
  });

  it("a credential that could not be minted says so, with the token it needs", async () => {
    const report = await verifyUploadReadiness(
      dependencies({
        headObject: () => Promise.reject(new BucketCredentialError(BUCKET, "HTTP 403")),
      }),
      subject,
    );
    const signing = report.checks.find((check) => check.id === "key-can-sign");
    expect(signing?.outcome).toBe("failed");
    expect(signing?.detail).toContain("could not be minted");
    expect(signing?.detail).toContain("CLOUDFLARE_API_TOKEN_FIRM_PROVISIONER");
    expect(signing?.detail).toContain("R2_S3_ACCESS_KEY_ID");
  });

  it("a deployment naming no bound bucket carries that fault's own sentence", async () => {
    const report = await verifyUploadReadiness(
      dependencies({ headObject: () => Promise.reject(firmBucketNotBound()) }),
      subject,
    );
    const signing = report.checks.find((check) => check.id === "key-can-sign");
    expect(signing?.outcome).toBe("failed");
    expect(signing?.detail).toContain("R2_BUCKET_NAME");
  });

  it("any other refusal is passed through in its own words", async () => {
    const report = await verifyUploadReadiness(
      dependencies({
        headObject: () => Promise.reject(new Error(`R2 S3 head failed for ${BUCKET}/x: 500`)),
      }),
      subject,
    );
    const signing = report.checks.find((check) => check.id === "key-can-sign");
    expect(signing?.outcome).toBe("failed");
    expect(signing?.detail).toContain(": 500");
    expect(signing?.detail).not.toContain("Apply to all buckets");
  });
});

describe("the development deployment says what it did not look at", () => {
  it("marks every account check not-applicable rather than ok, and is still ready", async () => {
    const report = await verifyUploadReadiness(
      dependencies({
        provider: { ...restProvider(), kind: "development" },
        uploadPath: "through-the-application",
        headObject: () => Promise.reject(new Error("must not be asked")),
      }),
      subject,
    );
    expect(report.ready).toBe(true);
    expect(report.provisioner).toBe("development");
    expect(outcomes(report)).toEqual({
      "bucket-recorded": "ok",
      "bucket-exists": "not-applicable",
      "event-notifications": "not-applicable",
      "lifecycle-rules": "not-applicable",
      "cors-policy": "not-applicable",
      "key-can-sign": "not-applicable",
    });
  });
});
