import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Bindings } from "../src/bindings.ts";
import { resolveFirmBucket } from "../src/files/firm-bucket.ts";

// The firm bucket resolver is the one decision about where a firm's bytes live. Two things have to
// hold, and both are pinned here: the name a presigned URL is signed against and the handle the
// Worker reads through always describe ONE bucket, and every path that touches a firm's objects goes
// through the resolver rather than reaching for a binding on its own.

// The provisioner records a deterministic per-firm bucket name (a SHA-256 fold of the firm id), which
// is not the name of the bucket bound to this Worker — the exact shape that used to let an upload be
// presigned into one bucket while ingest read another.
const FIRM_PROVISIONED_BUCKET = "magna-carta-production-firm-0123456789abcdef0123456789abcdef";
const BOUND_BUCKET = "magna-carta-production-platform-files";

// An env shaped like production: the full R2 S3 credential set is present, so presigned URLs really
// do reach R2 and the bucket a URL names is the bucket the bytes land in.
function envWithRealPresigning(overrides: Partial<Bindings>): Bindings {
  return {
    R2: env.R2,
    CLOUDFLARE_ACCOUNT_ID: "account-id",
    R2_S3_ACCESS_KEY_ID: "access-key-id",
    R2_S3_SECRET_ACCESS_KEY: "secret-access-key",
    ...overrides,
  } as unknown as Bindings;
}

describe("resolveFirmBucket", () => {
  it("hands the presign side and the read side one and the same bucket", async () => {
    // The two sides resolve independently, exactly as the upload route and the ingest consumer do.
    const presignSide = resolveFirmBucket(env, FIRM_PROVISIONED_BUCKET);
    const readSide = resolveFirmBucket(env, FIRM_PROVISIONED_BUCKET);

    expect(readSide.bucketName).toBe(presignSide.bucketName);
    expect(readSide.bucket).toBe(presignSide.bucket);

    // Not just the same object identity — bytes written on one side are readable on the other.
    const key = `files/firm-bucket-seam/${crypto.randomUUID()}`;
    await presignSide.bucket.put(key, new Uint8Array([1, 2, 3]));
    const read = await readSide.bucket.get(key);
    expect(read).not.toBeNull();
    await readSide.bucket.delete(key);
  });

  it("hands back an S3-backed handle for a firm bucket this Worker has no binding to", () => {
    // The bytes must reach the bucket the presigned URL names, and there is no runtime API that turns
    // a bucket name into a binding. Until this landed the resolver refused outright, which is why
    // uploads and the download shelf were down for every provisioned firm; now the name resolves to a
    // handle that addresses that same bucket over R2's S3 API.
    const resolved = resolveFirmBucket(
      envWithRealPresigning({ R2_BUCKET_NAME: BOUND_BUCKET }),
      FIRM_PROVISIONED_BUCKET,
    );
    expect(resolved.bucketName).toBe(FIRM_PROVISIONED_BUCKET);
    expect(resolved.bucket).not.toBe(env.R2);
    // The pair invariant is what makes this safe: the handle is built FROM the name that was resolved,
    // so the two cannot describe different buckets.
    expect(typeof resolved.bucket.get).toBe("function");
    expect(typeof resolved.bucket.createMultipartUpload).toBe("function");
  });

  it("still reaches the bound bucket through its binding, not over the network", () => {
    // The common case must not pay a signing round trip: a firm provisioned against the bound bucket
    // resolves to the binding itself.
    const resolved = resolveFirmBucket(
      envWithRealPresigning({ R2_BUCKET_NAME: BOUND_BUCKET }),
      BOUND_BUCKET,
    );
    expect(resolved.bucket).toBe(env.R2);
  });

  it("accepts the firm bucket when it is the bound bucket", () => {
    const resolved = resolveFirmBucket(
      envWithRealPresigning({ R2_BUCKET_NAME: BOUND_BUCKET }),
      BOUND_BUCKET,
    );
    expect(resolved.bucketName).toBe(BOUND_BUCKET);
    expect(resolved.bucket).toBe(env.R2);
  });

  it("demands the bound bucket's name once real presigning is configured", () => {
    // Without it the binding cannot be told apart from a firm's own bucket, so nothing could prove a
    // read reaches the bucket a presigned URL addresses. An unset value is a misconfiguration.
    // The refusal is a NAMED fault (firm-bucket-fault.ts) that tells the member what is misconfigured
    // and what the operator sets, rather than an Error ID that says nothing.
    expect(() => resolveFirmBucket(envWithRealPresigning({}), BOUND_BUCKET)).toThrow(
      /does not name the storage bucket it reads through[\s\S]*R2_BUCKET_NAME/,
    );
  });

  it("carries no check where presigned URLs never reach R2", () => {
    // The test pool and local development have no R2 S3 credentials, so the development presigner
    // routes the upload leg back through the Worker, which writes through the bound handle. The
    // recorded name is then only a routing label and every firm shares the one bucket.
    const resolved = resolveFirmBucket(env, FIRM_PROVISIONED_BUCKET);
    expect(resolved.bucketName).toBe(FIRM_PROVISIONED_BUCKET);
    expect(resolved.bucket).toBe(env.R2);
  });

  it("fails loudly for a firm whose provisioning never recorded a bucket", () => {
    expect(() => resolveFirmBucket(env, null)).toThrow(/has not finished being provisioned/);
  });
});

// The worker's tests run inside the workerd pool, whose node:fs cannot read the host source tree, so
// the sources are pulled in as raw text at build time. import.meta.glob is a Vite build-time macro
// (it inlines the matched files and must be referenced by its full literal name); its type is not in
// the worker's tsconfig lib, so the one macro shape this scan uses is declared here.
declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options: { query: string; import: string; eager: true },
    ): Record<string, string>;
  }
}

const SOURCES = import.meta.glob("../src/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

// The modules on both ends of an upload's life: the routes that mint the presigned URL, the consumer
// that reads the uploaded object back, and the paths that write a firm's bytes server-side. A direct
// binding access here is what split the two ends apart, so it is what this scan forbids.
const GUARDED = [
  "src/http/routes/files/uploads.ts",
  "src/background/files/ingest-consumer.ts",
  // The conversion pair: the routes presign the source upload and the result download, and the queue
  // consumer reads that source and writes that result. Split them across two buckets and a job either
  // finds no source or lands a result nothing can hand back.
  "src/http/routes/documents/conversions.ts",
  "src/background/conversions/conversion-consumer.ts",
  "src/http/routes/communications/shipping.ts",
  "src/http/routes/files/file-repair.ts",
  "src/emails/attachment-extraction.ts",
  "src/background/scheduled.ts",
];

function guardedSource(suffix: string): string {
  const needle = suffix.replace("src/", "");
  for (const [path, source] of Object.entries(SOURCES)) {
    if (path.endsWith(needle)) return source;
  }
  throw new Error(`${suffix} was not seen by the source scan`);
}

describe("the upload and read paths resolve their bucket through one seam", () => {
  it("sees the guarded sources at all", () => {
    // Non-vacuity floor: a glob that stopped matching would otherwise pass this suite silently.
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50);
  });

  for (const suffix of GUARDED) {
    it(`${suffix} resolves its bucket through resolveFirmBucket`, () => {
      const source = guardedSource(suffix);
      expect(source).toContain("resolveFirmBucket");
    });

    it(`${suffix} reaches for no R2 binding of its own`, () => {
      const source = guardedSource(suffix);
      // Comments describing the binding are fine; a member access on it is not.
      const bindingAccess = /\benv\.R2\s*\./.exec(source);
      expect(bindingAccess, `${suffix} accesses the R2 binding directly`).toBeNull();
    });
  }
});
