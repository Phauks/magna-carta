import { describe, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import {
  createCloudflareRestFirmResourceProvider,
  createDevFirmResourceProvider,
  firmResourceName,
} from "../src/firm-resource-provider.ts";

describe("dev FirmResourceProvider (bucket-name adapter)", () => {
  it("createBucket answers a per-firm-unique deterministic name (the event→firm resolution key)", async () => {
    const provider = createDevFirmResourceProvider();
    const firmId = newIdentifier("firm");
    // Region is irrelevant to the dev adapter's deterministic name — "us" exercises the common case.
    const created = await provider.createBucket(firmId, "us");
    // The same deterministic shape production uses, derived from the firm id — unique per firm so
    // the ingest consumer's bucket_name → firm lookup is unambiguous with more than one dev firm.
    expect(created.bucketName).toBe(await firmResourceName(firmId));
    expect(created.bucketName).toMatch(/^magna-carta-production-firm-[0-9a-f]{32}$/);
    const otherFirmId = newIdentifier("firm");
    expect((await provider.createBucket(otherFirmId, "us")).bucketName).not.toBe(
      created.bucketName,
    );
  });

  it("configureBucketNotifications is a no-op (Miniflare delivers no R2 notifications)", async () => {
    const provider = createDevFirmResourceProvider();
    await expect(
      provider.configureBucketNotifications(newIdentifier("firm"), "us"),
    ).resolves.toBeUndefined();
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

// Scripted probe answer for the find-first order: creation probes existence FIRST and only
// creates when the probe misses.
const BUCKET_NOT_FOUND = {
  status: 404,
  body: {
    success: false,
    errors: [{ code: 10006, message: "The specified bucket does not exist." }],
  },
};

describe("Cloudflare REST FirmResourceProvider", () => {
  const firmId = newIdentifier("firm");

  it("probes the bucket first and creates only when absent, answering the deterministic name", async () => {
    const stub = stubFetch([
      BUCKET_NOT_FOUND,
      { status: 200, body: { success: true, result: {} } },
    ]);
    const created = await restProvider(stub).createBucket(firmId, "us");
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
    expect(stub.calls[1]?.headers["authorization"]).toBe("Bearer test-api-token");
    // Deterministic name derived from the firm id (lowercase-hex slug — D1/R2 name alphabets
    // exclude the identifier alphabet's uppercase and underscore characters).
    expect(requestedName(stub.calls[1])).toBe(created.bucketName);
  });

  it("answers an existing bucket straight from the probe — idempotent resume issues NO create", async () => {
    const stub = stubFetch([{ status: 200, body: { success: true, result: {} } }]);
    const created = await restProvider(stub).createBucket(firmId, "us");
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
    const created = await restProvider(stub).createBucket(firmId, "us");
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
    await expect(restProvider(stub).createBucket(firmId, "us")).rejects.toThrow(
      /createBucket failed.*500.*internal error/s,
    );
  });

  it("describes a non-JSON edge error page as an operation failure, never an opaque parse error", async () => {
    const stub = stubFetch([{ status: 502, body: "<html><body>502 Bad Gateway</body></html>" }]);
    const failure: unknown = await restProvider(stub)
      .createBucket(firmId, "us")
      .then(() => {
        throw new Error("createBucket resolved against an HTML 502 — it must throw");
      })
      .catch((caught: unknown) => caught);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(SyntaxError);
    expect((failure as Error).message).toMatch(/createBucket failed: HTTP 502/);
  });

  it("derives a deterministic slug from the firm id, stable across calls", async () => {
    const firstStub = stubFetch([
      BUCKET_NOT_FOUND,
      { status: 200, body: { success: true, result: {} } },
    ]);
    const secondStub = stubFetch([
      BUCKET_NOT_FOUND,
      { status: 200, body: { success: true, result: {} } },
    ]);
    await restProvider(firstStub).createBucket(firmId, "us");
    await restProvider(secondStub).createBucket(firmId, "us");
    expect(requestedName(firstStub.calls[1])).toBe(requestedName(secondStub.calls[1]));
  });

  it("eu firm's create carries the eu jurisdiction header and no locationHint; us firm's create carries a North-America locationHint and no jurisdiction header", async () => {
    const euStub = stubFetch([
      BUCKET_NOT_FOUND,
      { status: 200, body: { success: true, result: {} } },
    ]);
    const euCreated = await restProvider(euStub).createBucket(firmId, "eu");
    // Both the probe (GET) and the create (POST) must carry the same jurisdiction header, or the
    // probe queries the wrong jurisdiction and always misses.
    expect(euStub.calls[0]?.headers["cf-r2-jurisdiction"]).toBe("eu");
    expect(euStub.calls[1]?.headers["cf-r2-jurisdiction"]).toBe("eu");
    expect(requestedName(euStub.calls[1])).toBe(euCreated.bucketName);
    expect((euStub.calls[1]?.body as { locationHint?: string }).locationHint).toBeUndefined();

    const usStub = stubFetch([
      BUCKET_NOT_FOUND,
      { status: 200, body: { success: true, result: {} } },
    ]);
    await restProvider(usStub).createBucket(firmId, "us");
    expect(usStub.calls[0]?.headers["cf-r2-jurisdiction"]).toBeUndefined();
    expect(usStub.calls[1]?.headers["cf-r2-jurisdiction"]).toBeUndefined();
    expect((usStub.calls[1]?.body as { locationHint?: string }).locationHint).toBe("enam");
  });

  it("configureBucketNotifications PUTs the object-create rule to the files-ingest queue", async () => {
    const stub = stubFetch([{ status: 200, body: { success: true, result: {} } }]);
    const provider = createCloudflareRestFirmResourceProvider({
      accountId: "test-account-id",
      apiToken: "test-api-token",
      eventNotificationQueueId: "queue-uuid-files-ingest",
      fetchImplementation: stub.fetchImplementation,
    });
    await provider.configureBucketNotifications(firmId, "us");

    const call = stub.calls[0];
    expect(call?.method).toBe("PUT");
    const bucketName = await firmResourceName(firmId);
    expect(call?.url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/test-account-id/event_notifications/r2/${bucketName}/configuration/queues/queue-uuid-files-ingest`,
    );
    expect(call?.body).toEqual({
      rules: [{ actions: ["PutObject", "CompleteMultipartUpload"], prefix: "files/" }],
    });
  });

  it("configureBucketNotifications fails loud without a queue id (a REST misconfiguration)", async () => {
    const stub = stubFetch([]);
    const provider = createCloudflareRestFirmResourceProvider({
      accountId: "test-account-id",
      apiToken: "test-api-token",
      fetchImplementation: stub.fetchImplementation,
    });
    await expect(provider.configureBucketNotifications(firmId, "us")).rejects.toThrow(
      /eventNotificationQueueId/,
    );
  });

  it("configureBucketNotifications surfaces a non-success envelope as a failure", async () => {
    const stub = stubFetch([
      { status: 403, body: { success: false, errors: [{ code: 10001, message: "forbidden" }] } },
    ]);
    const provider = createCloudflareRestFirmResourceProvider({
      accountId: "test-account-id",
      apiToken: "test-api-token",
      eventNotificationQueueId: "queue-uuid-files-ingest",
      fetchImplementation: stub.fetchImplementation,
    });
    await expect(provider.configureBucketNotifications(firmId, "us")).rejects.toThrow(
      /configureBucketNotifications failed.*403.*forbidden/s,
    );
  });

  it("configureBucketNotifications PUTs TWO notification rules — files/ to interactive queue, bulk/ to bulk queue", async () => {
    const stub = stubFetch([
      { status: 200, body: { success: true, result: {} } }, // files/ rule
      { status: 200, body: { success: true, result: {} } }, // bulk/ rule
    ]);
    const provider = createCloudflareRestFirmResourceProvider({
      accountId: "test-account-id",
      apiToken: "test-api-token",
      eventNotificationQueueId: "queue-uuid-files-ingest",
      bulkEventNotificationQueueId: "queue-uuid-bulk-ingest",
      fetchImplementation: stub.fetchImplementation,
    });
    await provider.configureBucketNotifications(firmId, "us");

    expect(stub.calls).toHaveLength(2);
    const bucketName = await firmResourceName(firmId);

    // Interactive rule — prefix files/
    const filesCall = stub.calls[0];
    expect(filesCall?.method).toBe("PUT");
    expect(filesCall?.url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/test-account-id/event_notifications/r2/${bucketName}/configuration/queues/queue-uuid-files-ingest`,
    );
    expect(filesCall?.body).toEqual({
      rules: [{ actions: ["PutObject", "CompleteMultipartUpload"], prefix: "files/" }],
    });

    // Bulk rule — prefix bulk/
    const bulkCall = stub.calls[1];
    expect(bulkCall?.method).toBe("PUT");
    expect(bulkCall?.url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/test-account-id/event_notifications/r2/${bucketName}/configuration/queues/queue-uuid-bulk-ingest`,
    );
    expect(bulkCall?.body).toEqual({
      rules: [{ actions: ["PutObject", "CompleteMultipartUpload"], prefix: "bulk/" }],
    });
  });

  it("eu firm's notification PUTs carry the eu jurisdiction header; us firm's carry none — the bucket lives under a jurisdiction-restricted namespace, so an unheadered PUT misses it", async () => {
    const euStub = stubFetch([
      { status: 200, body: { success: true, result: {} } }, // files/ rule
      { status: 200, body: { success: true, result: {} } }, // bulk/ rule
    ]);
    const euProvider = createCloudflareRestFirmResourceProvider({
      accountId: "test-account-id",
      apiToken: "test-api-token",
      eventNotificationQueueId: "queue-uuid-files-ingest",
      bulkEventNotificationQueueId: "queue-uuid-bulk-ingest",
      fetchImplementation: euStub.fetchImplementation,
    });
    await euProvider.configureBucketNotifications(firmId, "eu");
    expect(euStub.calls[0]?.headers["cf-r2-jurisdiction"]).toBe("eu");
    expect(euStub.calls[1]?.headers["cf-r2-jurisdiction"]).toBe("eu");

    const usStub = stubFetch([
      { status: 200, body: { success: true, result: {} } }, // files/ rule
      { status: 200, body: { success: true, result: {} } }, // bulk/ rule
    ]);
    const usProvider = createCloudflareRestFirmResourceProvider({
      accountId: "test-account-id",
      apiToken: "test-api-token",
      eventNotificationQueueId: "queue-uuid-files-ingest",
      bulkEventNotificationQueueId: "queue-uuid-bulk-ingest",
      fetchImplementation: usStub.fetchImplementation,
    });
    await usProvider.configureBucketNotifications(firmId, "us");
    expect(usStub.calls[0]?.headers["cf-r2-jurisdiction"]).toBeUndefined();
    expect(usStub.calls[1]?.headers["cf-r2-jurisdiction"]).toBeUndefined();
  });
});
