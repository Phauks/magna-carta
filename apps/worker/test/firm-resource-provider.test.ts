import { describe, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import {
  createCloudflareRestFirmResourceProvider,
  createDevFirmResourceProvider,
  firmResourceName,
} from "../src/firm-resource-provider.ts";

const POOL = ["DB_FIRM_POOL_1", "DB_FIRM_POOL_2"] as const;

describe("dev FirmResourceProvider (pool-claiming adapter)", () => {
  it("claims the first pool binding when none are claimed", async () => {
    const provider = createDevFirmResourceProvider({
      poolBindingNames: POOL,
      claimedDatabaseIdentifiers: () => Promise.resolve([]),
    });
    await expect(provider.createDatabase(newIdentifier("firm"))).resolves.toEqual({
      databaseIdentifier: "DB_FIRM_POOL_1",
    });
  });

  it("claims the next unclaimed binding, skipping claimed ones in any order", async () => {
    const provider = createDevFirmResourceProvider({
      poolBindingNames: POOL,
      // Claimed identifiers include non-pool values (test fixtures seed arbitrary ones) — ignored.
      claimedDatabaseIdentifiers: () => Promise.resolve(["d1-test-whatever", "DB_FIRM_POOL_1"]),
    });
    await expect(provider.createDatabase(newIdentifier("firm"))).resolves.toEqual({
      databaseIdentifier: "DB_FIRM_POOL_2",
    });
  });

  it("fails loud when the pool is exhausted", async () => {
    const provider = createDevFirmResourceProvider({
      poolBindingNames: POOL,
      claimedDatabaseIdentifiers: () => Promise.resolve([...POOL]),
    });
    await expect(provider.createDatabase(newIdentifier("firm"))).rejects.toThrow(
      /dev firm-database pool exhausted/,
    );
  });

  it("createBucket answers the single pre-declared local bucket binding", async () => {
    const provider = createDevFirmResourceProvider({
      poolBindingNames: POOL,
      claimedDatabaseIdentifiers: () => Promise.resolve([]),
    });
    await expect(provider.createBucket(newIdentifier("firm"))).resolves.toEqual({
      bucketName: "R2",
    });
  });
});

type StubCall = { url: string; method: string; headers: Record<string, string>; body: unknown };

// A scripted fetch stub: each call answers the next queued response and records the request.
// A string body answers RAW (text/html) — the edge-error-page case; anything else is JSON.
function stubFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: StubCall[] = [];
  const fetchImplementation = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    calls.push({
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      body: request.method === "GET" ? undefined : await request.json(),
    });
    const next = responses.shift();
    if (next === undefined) throw new Error("stub fetch exhausted");
    if (typeof next.body === "string") {
      return new Response(next.body, {
        status: next.status,
        headers: { "content-type": "text/html" },
      });
    }
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { calls, fetchImplementation };
}

function restProvider(stub: { fetchImplementation: typeof fetch }) {
  return createCloudflareRestFirmResourceProvider({
    accountId: "test-account-id",
    apiToken: "test-api-token",
    fetchImplementation: stub.fetchImplementation,
  });
}

// The resource name a recorded create call asked for — fails loud on a missing call/body.
function requestedName(call: StubCall | undefined): string {
  const body = call?.body as { name?: string } | undefined;
  if (body?.name === undefined) throw new Error("recorded stub call carries no name in its body");
  return body.name;
}

// Scripted probe answers for the find-first order (CF2): creation probes existence FIRST and
// only creates when the probe misses.
const EMPTY_D1_LIST = { status: 200, body: { success: true, result: [] } };
const BUCKET_NOT_FOUND = {
  status: 404,
  body: {
    success: false,
    errors: [{ code: 10006, message: "The specified bucket does not exist." }],
  },
};

describe("Cloudflare REST FirmResourceProvider", () => {
  const firmId = newIdentifier("firm");

  it("probes the database name first and creates only when absent, with bearer auth on the account endpoint", async () => {
    const databaseName = await firmResourceName(firmId);
    const stub = stubFetch([
      EMPTY_D1_LIST,
      {
        status: 200,
        body: { success: true, result: { uuid: "11111111-2222-4333-8444-555555555555" } },
      },
    ]);
    const created = await restProvider(stub).createDatabase(firmId);
    expect(created).toEqual({ databaseIdentifier: "11111111-2222-4333-8444-555555555555" });
    // Find-first: the existence probe precedes the create.
    expect(stub.calls[0]?.method).toBe("GET");
    expect(stub.calls[0]?.url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/test-account-id/d1/database?name=${databaseName}`,
    );
    const create = stub.calls[1];
    expect(create?.method).toBe("POST");
    expect(create?.url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/test-account-id/d1/database",
    );
    expect(create?.headers["authorization"]).toBe("Bearer test-api-token");
    // Deterministic name derived from the firm id (lowercase-hex slug — D1/R2 name alphabets
    // exclude the identifier alphabet's uppercase and underscore characters).
    expect(requestedName(create)).toMatch(/^magna-carta-production-firm-[0-9a-f]{32}$/);
  });

  it("answers an existing database straight from the probe — idempotent resume issues NO create", async () => {
    const databaseName = await firmResourceName(firmId);
    const stub = stubFetch([
      {
        status: 200,
        body: {
          success: true,
          result: [
            { name: "some-other-database", uuid: "99999999-0000-4000-8000-000000000000" },
            { name: databaseName, uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" },
          ],
        },
      },
    ]);
    await expect(restProvider(stub).createDatabase(firmId)).resolves.toEqual({
      databaseIdentifier: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    });
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]?.method).toBe("GET");
  });

  it("recovers through the already-exists fallback when a concurrent create wins the probe-create race", async () => {
    const databaseName = await firmResourceName(firmId);
    const stub = stubFetch([
      EMPTY_D1_LIST, // the probe misses…
      {
        status: 400, // …a concurrent create lands between probe and POST…
        body: {
          success: false,
          errors: [{ code: 7502, message: "a database with that name already exists" }],
        },
      },
      {
        status: 200, // …and the fallback lookup recovers the UUID.
        body: {
          success: true,
          result: [{ name: databaseName, uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" }],
        },
      },
    ]);
    await expect(restProvider(stub).createDatabase(firmId)).resolves.toEqual({
      databaseIdentifier: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    });
    expect(stub.calls.map((call) => call.method)).toEqual(["GET", "POST", "GET"]);
    expect(stub.calls[2]?.url).toContain(`/d1/database?name=${databaseName}`);
  });

  it("throws on a non-already-exists HTTP error", async () => {
    const stub = stubFetch([
      EMPTY_D1_LIST,
      {
        status: 403,
        body: { success: false, errors: [{ code: 10000, message: "authentication error" }] },
      },
    ]);
    await expect(restProvider(stub).createDatabase(firmId)).rejects.toThrow(
      /createDatabase failed.*403.*authentication error/s,
    );
  });

  it("describes a non-JSON edge error page as an operation failure, never an opaque parse error", async () => {
    const stub = stubFetch([{ status: 502, body: "<html><body>502 Bad Gateway</body></html>" }]);
    const failure: unknown = await restProvider(stub)
      .createDatabase(firmId)
      .then(() => {
        throw new Error("createDatabase resolved against an HTML 502 — it must throw");
      })
      .catch((caught: unknown) => caught);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(SyntaxError);
    expect((failure as Error).message).toMatch(/createDatabase failed: HTTP 502/);
  });

  it("probes the bucket first and creates only when absent, answering the deterministic name", async () => {
    const stub = stubFetch([
      BUCKET_NOT_FOUND,
      { status: 200, body: { success: true, result: {} } },
    ]);
    const created = await restProvider(stub).createBucket(firmId);
    expect(created.bucketName).toMatch(/^magna-carta-production-firm-[0-9a-f]{32}$/);
    // Find-first: the existence probe precedes the create.
    expect(stub.calls[0]?.method).toBe("GET");
    expect(stub.calls[0]?.url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/test-account-id/r2/buckets/${created.bucketName}`,
    );
    expect(stub.calls[1]?.method).toBe("POST");
    expect(stub.calls[1]?.url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/test-account-id/r2/buckets",
    );
    expect(requestedName(stub.calls[1])).toBe(created.bucketName);
  });

  it("answers an existing bucket straight from the probe — idempotent resume issues NO create", async () => {
    const stub = stubFetch([{ status: 200, body: { success: true, result: {} } }]);
    const created = await restProvider(stub).createBucket(firmId);
    expect(created.bucketName).toMatch(/^magna-carta-production-firm-[0-9a-f]{32}$/);
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]?.method).toBe("GET");
  });

  it("treats an already-owned create as success when a concurrent create wins the probe-create race", async () => {
    const stub = stubFetch([
      BUCKET_NOT_FOUND,
      {
        status: 400,
        body: {
          success: false,
          errors: [
            {
              code: 10004,
              message: "The bucket you tried to create already exists, and you own it.",
            },
          ],
        },
      },
    ]);
    const created = await restProvider(stub).createBucket(firmId);
    expect(created.bucketName).toMatch(/^magna-carta-production-firm-[0-9a-f]{32}$/);
  });

  it("throws on a non-already-exists R2 error", async () => {
    const stub = stubFetch([
      BUCKET_NOT_FOUND,
      {
        status: 500,
        body: { success: false, errors: [{ code: 10001, message: "internal error" }] },
      },
    ]);
    await expect(restProvider(stub).createBucket(firmId)).rejects.toThrow(
      /createBucket failed.*500.*internal error/s,
    );
  });

  it("derives the same slug for the same firm id across database and bucket", async () => {
    const databaseStub = stubFetch([
      EMPTY_D1_LIST,
      {
        status: 200,
        body: { success: true, result: { uuid: "11111111-2222-4333-8444-555555555555" } },
      },
    ]);
    const bucketStub = stubFetch([
      BUCKET_NOT_FOUND,
      { status: 200, body: { success: true, result: {} } },
    ]);
    await restProvider(databaseStub).createDatabase(firmId);
    await restProvider(bucketStub).createBucket(firmId);
    expect(requestedName(databaseStub.calls[1])).toBe(requestedName(bucketStub.calls[1]));
  });
});
