// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
import { describe, expect, it } from "vitest";
import {
  BucketCredentialError,
  ScopedCredentialCache,
  mintScopedBucketCredentials,
} from "../src/files/firm-bucket-credentials.ts";

/*
 * The credential that reaches a firm's objects should reach that firm's bucket and no other, for a
 * window rather than forever. What has to hold: the mint asks for exactly that scope, a partial
 * answer is a failure rather than a credential, a jurisdiction bucket is asked for under its own
 * jurisdiction, and — the one that is easy to get wrong — a cached credential is never handed to
 * something that will outlive it.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const OK = {
  success: true,
  result: { accessKeyId: "scoped-key", secretAccessKey: "scoped-secret", sessionToken: "token" },
};

const BASE = {
  accountId: "account-1",
  apiToken: "parent-token",
  parentAccessKeyId: "parent-key",
  bucketName: "magna-carta-production-firm-pemberton",
  region: "us" as const,
};

describe("minting a scoped credential", () => {
  it("asks for one bucket, object permission only, and computes the expiry R2 does not return", async () => {
    let seen: { url: string; body: Record<string, unknown>; headers: Headers } | null = null;
    const credentials = await mintScopedBucketCredentials({
      ...BASE,
      ttlSeconds: 7200,
      now: () => 1_000_000,
      fetchImpl: (async (url: string, init: RequestInit) => {
        seen = {
          url,
          body: JSON.parse(String(init.body)) as Record<string, unknown>,
          headers: new Headers(init.headers),
        };
        return jsonResponse(OK);
      }) as unknown as typeof fetch,
    });

    const request = seen as unknown as { url: string; body: Record<string, unknown> };
    expect(request.url).toContain("/accounts/account-1/r2/temp-access-credentials");
    expect(request.body.bucket).toBe(BASE.bucketName);
    expect(request.body.parentAccessKeyId).toBe("parent-key");
    // Objects, never the bucket's own configuration — a credential that cannot administer the bucket
    // cannot be made to.
    expect(request.body.permission).toBe("object-read-write");
    // R2 answers no expiry at all, so it is computed from the TTL that was asked for.
    expect(credentials.expiresAtMilliseconds).toBe(1_000_000 + 7200 * 1000);
    expect(credentials.sessionToken).toBe("token");
  });

  it("asks for a jurisdiction bucket under its own jurisdiction", async () => {
    let headers: Headers | null = null;
    await mintScopedBucketCredentials({
      ...BASE,
      region: "eu",
      fetchImpl: (async (_url: string, init: RequestInit) => {
        headers = new Headers(init.headers);
        return jsonResponse(OK);
      }) as unknown as typeof fetch,
    });
    expect((headers as unknown as Headers).get("cf-r2-jurisdiction")).toBe("eu");
  });

  it("treats a 200 carrying an incomplete credential as a failure, not a credential", async () => {
    await expect(
      mintScopedBucketCredentials({
        ...BASE,
        fetchImpl: (async () =>
          jsonResponse({ success: true, result: { accessKeyId: "only-this" } })) as never,
      }),
    ).rejects.toBeInstanceOf(BucketCredentialError);
  });

  it("reports the API's own message when it refuses", async () => {
    await expect(
      mintScopedBucketCredentials({
        ...BASE,
        fetchImpl: (async () =>
          jsonResponse(
            { success: false, errors: [{ message: "insufficient permissions" }] },
            403,
          )) as never,
      }),
    ).rejects.toThrow(/insufficient permissions/);
  });
});

describe("the credential cache", () => {
  it("reuses a credential that outlives what is being signed", async () => {
    let mints = 0;
    let clock = 1_000_000;
    const cache = new ScopedCredentialCache(() => clock);
    const fetchImpl = (async () => {
      mints += 1;
      return jsonResponse(OK);
    }) as never;

    await cache.credentialsFor({ ...BASE, fetchImpl, neededSeconds: 300 });
    clock += 60_000;
    await cache.credentialsFor({ ...BASE, fetchImpl, neededSeconds: 300 });
    expect(mints).toBe(1);
  });

  it("re-mints rather than sign a URL that would outlive its credential", async () => {
    let mints = 0;
    let clock = 1_000_000;
    const cache = new ScopedCredentialCache(() => clock);
    const fetchImpl = (async () => {
      mints += 1;
      return jsonResponse(OK);
    }) as never;

    // A short download URL is fine on a fresh two-hour credential.
    await cache.credentialsFor({ ...BASE, fetchImpl, neededSeconds: 300 });
    expect(mints).toBe(1);

    // Ninety minutes later the same credential has half an hour left. A five-minute URL still fits;
    // an hour-long upload URL does not, and taking the cached one would hand a member an upload that
    // stops working long before its own expiry says it should.
    clock += 90 * 60 * 1000;
    await cache.credentialsFor({ ...BASE, fetchImpl, neededSeconds: 300 });
    expect(mints).toBe(1);
    await cache.credentialsFor({ ...BASE, fetchImpl, neededSeconds: 3600 });
    expect(mints).toBe(2);
  });

  it("keeps one entry per bucket, so one firm's credential never signs another's object", async () => {
    const minted: string[] = [];
    const clock = 1_000_000;
    const cache = new ScopedCredentialCache(() => clock);
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      minted.push((JSON.parse(String(init.body)) as { bucket: string }).bucket);
      return jsonResponse(OK);
    }) as unknown as typeof fetch;

    await cache.credentialsFor({ ...BASE, fetchImpl, neededSeconds: 300 });
    await cache.credentialsFor({
      ...BASE,
      bucketName: "magna-carta-production-firm-hale",
      fetchImpl,
      neededSeconds: 300,
    });
    expect(minted).toEqual([
      "magna-carta-production-firm-pemberton",
      "magna-carta-production-firm-hale",
    ]);
  });

  it("does not share an entry between the same bucket name in two regions", async () => {
    let mints = 0;
    const cache = new ScopedCredentialCache(() => 1_000_000);
    const fetchImpl = (async () => {
      mints += 1;
      return jsonResponse(OK);
    }) as never;
    await cache.credentialsFor({ ...BASE, fetchImpl, neededSeconds: 300 });
    await cache.credentialsFor({ ...BASE, region: "eu", fetchImpl, neededSeconds: 300 });
    // A jurisdiction bucket is a different bucket at a different endpoint; one credential is not
    // good for both.
    expect(mints).toBe(2);
  });
});
