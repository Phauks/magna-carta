// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
import { describe, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import {
  createCloudflareRestFirmResourceProvider,
  createDevFirmResourceProvider,
  firmResourceName,
} from "../src/firm-resource-provider.ts";
import { browserUploadCorsRules } from "../src/files/browser-upload-cors.ts";
import { MEETING_RECORDING_STAGING_PREFIX } from "@magna-carta/meetings/recording-types";
import {
  FILED_STAGING_GRACE_MILLISECONDS,
  UNSETTLED_STAGING_RETENTION_MILLISECONDS,
} from "../src/meetings/recording-sweep.ts";
import { MAXIMUM_RECORDING_HOURS } from "../src/meetings/sink-token.ts";

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

// The shape the REST adapter PUTs to the bucket's lifecycle endpoint.
interface LifecycleRuleBody {
  readonly id: string;
  readonly enabled: boolean;
  readonly conditions: { readonly prefix: string };
  readonly deleteObjectsTransition?: { readonly condition: { readonly maxAge: number } };
  readonly abortMultipartUploadsTransition?: { readonly condition: { readonly maxAge: number } };
}

async function appliedLifecycleRules(region: "us" | "eu" = "us") {
  const stub = stubFetch([{ status: 200, body: { success: true, result: {} } }]);
  const firmId = newIdentifier("firm");
  await restProvider(stub).configureBucketLifecycle(firmId, region);
  const call = stub.calls[0];
  const rules = (call?.body as { rules: readonly LifecycleRuleBody[] }).rules;
  const byPrefix = (prefix: string): LifecycleRuleBody => {
    const rule = rules.find((candidate) => candidate.conditions.prefix === prefix);
    if (rule === undefined) throw new Error(`no lifecycle rule for ${prefix}`);
    return rule;
  };
  return { call, firmId, rules, byPrefix };
}

const DAY_SECONDS = 24 * 60 * 60;

// R2's lifecycle PUT replaces the bucket's whole rule set, so a rule that is not in the provider's
// list is gone from every bucket the next time provisioning reaches it. Every rule a firm bucket needs
// is therefore pinned here, against the code that depends on it.
describe("FirmResourceProvider — the bucket's lifecycle rules", () => {
  it("dev adapter: configureBucketLifecycle is a no-op (Miniflare has no lifecycle engine)", async () => {
    await expect(
      createDevFirmResourceProvider().configureBucketLifecycle(newIdentifier("firm"), "us"),
    ).resolves.toBeUndefined();
  });

  it("REST adapter: PUTs the whole rule set onto the firm's bucket, jurisdiction header riding for an EU firm", async () => {
    const us = await appliedLifecycleRules("us");
    expect(us.call?.method).toBe("PUT");
    expect(us.call?.url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/test-account-id/r2/buckets/${await firmResourceName(us.firmId)}/lifecycle`,
    );
    expect(us.call?.headers["cf-r2-jurisdiction"]).toBeUndefined();
    expect(us.rules.map((rule) => rule.conditions.prefix)).toEqual([
      "bundles/",
      "conversions/",
      `${MEETING_RECORDING_STAGING_PREFIX}/`,
      "files/",
    ]);
    expect(us.rules.every((rule) => rule.enabled)).toBe(true);
    const eu = await appliedLifecycleRules("eu");
    expect(eu.call?.headers["cf-r2-jurisdiction"]).toBe("eu");
  });

  it("keeps the regenerable caches' expiries", async () => {
    const { byPrefix } = await appliedLifecycleRules();
    expect(byPrefix("bundles/").deleteObjectsTransition?.condition.maxAge).toBe(7 * DAY_SECONDS);
    expect(byPrefix("conversions/").deleteObjectsTransition?.condition.maxAge).toBe(DAY_SECONDS);
  });

  it("expires staged meeting audio only after the recording sweep's own retention has run out", async () => {
    const { byPrefix } = await appliedLifecycleRules();
    const staging = byPrefix(`${MEETING_RECORDING_STAGING_PREFIX}/`);
    const expiryMilliseconds = (staging.deleteObjectsTransition?.condition.maxAge ?? 0) * 1000;
    // Lifecycle age counts from the object's creation, and the sweep's retention from the recording
    // settling — up to a whole maximum-length recording later. The rule must outlast both, or it
    // deletes the only copy of a failed recording's audio while the sweep still promises to keep it.
    const maximumRecordingMilliseconds = MAXIMUM_RECORDING_HOURS * 60 * 60 * 1000;
    expect(expiryMilliseconds).toBeGreaterThanOrEqual(
      UNSETTLED_STAGING_RETENTION_MILLISECONDS + maximumRecordingMilliseconds,
    );
    expect(expiryMilliseconds).toBeGreaterThan(FILED_STAGING_GRACE_MILLISECONDS);
    // A bounded backstop, not an indefinite one: within two days of the sweep's figure.
    expect(expiryMilliseconds).toBeLessThanOrEqual(
      UNSETTLED_STAGING_RETENTION_MILLISECONDS + 2 * DAY_SECONDS * 1000,
    );
    // An open staged upload is the captured audio until it completes, so it is never aborted sooner.
    expect(staging.abortMultipartUploadsTransition?.condition.maxAge).toBe(
      staging.deleteObjectsTransition?.condition.maxAge,
    );
  });

  it("never expires a firm's documents, and aborts an abandoned upload under files/ only after a week", async () => {
    const { byPrefix } = await appliedLifecycleRules();
    const files = byPrefix("files/");
    expect(files.deleteObjectsTransition).toBeUndefined();
    // Past the one-day browser upload session and the hours a twelve-hour recording's compose can
    // take even when retried, so the rule cannot cut off an upload something will still complete.
    expect(files.abortMultipartUploadsTransition?.condition.maxAge).toBe(7 * DAY_SECONDS);
  });

  it("carries an abandoned-upload abort on every prefix", async () => {
    const { rules } = await appliedLifecycleRules();
    for (const rule of rules) {
      expect(rule.abortMultipartUploadsTransition?.condition.maxAge).toBeGreaterThan(0);
    }
  });

  it("REST adapter: an API refusal surfaces as the named failure rather than a completed step", async () => {
    const stub = stubFetch([
      {
        status: 400,
        body: { success: false, errors: [{ code: 10043, message: "bad rule" }] },
      },
    ]);
    await expect(
      restProvider(stub).configureBucketLifecycle(newIdentifier("firm"), "us"),
    ).rejects.toThrow(/configureBucketLifecycle failed: HTTP 400/);
  });
});

describe("FirmResourceProvider — the bucket's browser-upload CORS policy", () => {
  it("translates the dashboard-shaped artifact into the API's rule shape, extra origins folded in once", () => {
    const rules = browserUploadCorsRules(["https://preview.example", "https://magnacarta.esq"]);
    expect(rules).toHaveLength(1);
    const rule = rules[0];
    expect(rule?.id).toBe("browser-direct-upload");
    expect(rule?.allowed.methods).toEqual(["GET", "PUT"]);
    // The signed headers: an upload that omits one is refused by R2, so a policy that does not allow
    // them fails every browser upload at the preflight.
    expect(rule?.allowed.headers).toEqual([
      "content-type",
      "x-amz-meta-matter",
      "x-amz-meta-object_class",
    ]);
    // Multipart cannot complete without the client reading each part's ETag.
    expect(rule?.exposeHeaders).toEqual(["ETag"]);
    expect(rule?.allowed.origins).toContain("https://preview.example");
    expect(
      rule?.allowed.origins.filter((origin) => origin === "https://magnacarta.esq"),
    ).toHaveLength(1);
  });

  it("dev adapter: configureBucketCors is a no-op (local uploads are same-origin)", async () => {
    await expect(
      createDevFirmResourceProvider().configureBucketCors(newIdentifier("firm"), "us"),
    ).resolves.toBeUndefined();
  });

  it("REST adapter: PUTs the rule set onto the firm's bucket, jurisdiction header riding for an EU firm", async () => {
    const stub = stubFetch([
      { status: 200, body: { success: true, result: {} } },
      { status: 200, body: { success: true, result: {} } },
    ]);
    const provider = createCloudflareRestFirmResourceProvider({
      accountId: "test-account-id",
      apiToken: "test-api-token",
      browserOrigins: ["https://preview.example"],
      fetchImplementation: stub.fetchImplementation,
    });
    const firmId = newIdentifier("firm");
    await provider.configureBucketCors(firmId, "us");
    await provider.configureBucketCors(firmId, "eu");
    const [us, eu] = stub.calls;
    expect(us?.method).toBe("PUT");
    expect(us?.url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/test-account-id/r2/buckets/${await firmResourceName(firmId)}/cors`,
    );
    expect(us?.headers["cf-r2-jurisdiction"]).toBeUndefined();
    expect(eu?.headers["cf-r2-jurisdiction"]).toBe("eu");
    const body = us?.body as { rules: ReturnType<typeof browserUploadCorsRules> };
    expect(body.rules[0]?.allowed.origins).toContain("https://preview.example");
  });

  it("REST adapter: an API refusal surfaces as the named failure rather than a completed step", async () => {
    const stub = stubFetch([
      {
        status: 403,
        body: { success: false, errors: [{ code: 10000, message: "Authentication error" }] },
      },
    ]);
    await expect(
      restProvider(stub).configureBucketCors(newIdentifier("firm"), "us"),
    ).rejects.toThrow(/configureBucketCors failed: HTTP 403/);
  });
});

describe("FirmResourceProvider — asking whether a bucket exists without creating it", () => {
  const firmId = newIdentifier("firm");

  it("dev adapter says so by kind, and answers true for the only bucket there is", async () => {
    const provider = createDevFirmResourceProvider();
    expect(provider.kind).toBe("development");
    await expect(provider.bucketExists(firmId, "us")).resolves.toBe(true);
  });

  it("REST adapter: a found bucket is true, a 404 is false, and neither call creates anything", async () => {
    const found = stubFetch([{ status: 200, body: { success: true, result: {} } }]);
    const provider = restProvider(found);
    expect(provider.kind).toBe("cloudflare-rest");
    await expect(provider.bucketExists(firmId, "us")).resolves.toBe(true);
    expect(found.calls.map((call) => call.method)).toEqual(["GET"]);

    const missing = stubFetch([BUCKET_NOT_FOUND]);
    await expect(restProvider(missing).bucketExists(firmId, "us")).resolves.toBe(false);
    expect(missing.calls.map((call) => call.method)).toEqual(["GET"]);
  });

  it("REST adapter: a refused probe is a failure to ask, never an absence", async () => {
    const refused = stubFetch([
      {
        status: 403,
        body: { success: false, errors: [{ code: 10000, message: "Authentication error" }] },
      },
    ]);
    await expect(restProvider(refused).bucketExists(firmId, "us")).rejects.toThrow(
      /bucketExists failed: HTTP 403.*Authentication error/s,
    );
  });

  it("REST adapter: an eu firm is asked for under the eu jurisdiction header", async () => {
    const stub = stubFetch([BUCKET_NOT_FOUND]);
    await restProvider(stub).bucketExists(firmId, "eu");
    expect(stub.calls[0]?.headers["cf-r2-jurisdiction"]).toBe("eu");
  });
});

describe("FirmResourceProvider — a notification rule R2 refuses as an overlap", () => {
  const firmId = newIdentifier("firm");
  const OVERLAP = {
    status: 400,
    body: {
      success: false,
      errors: [
        {
          code: 11020,
          message:
            "Event notification R2 rule conflict on bucket 'x': The notification configuration is invalid: Notification configuration rules have invalid overlap.",
        },
      ],
    },
  };

  it("succeeds when the bucket already sends files/ to the same queue — the resumed-provisioning case", async () => {
    const stub = stubFetch([
      OVERLAP,
      {
        status: 200,
        body: {
          success: true,
          result: {
            queues: [
              {
                queueId: "queue-1",
                rules: [{ prefix: "files/", actions: ["PutObject", "CompleteMultipartUpload"] }],
              },
            ],
          },
        },
      },
    ]);
    const provider = createCloudflareRestFirmResourceProvider({
      accountId: "test-account-id",
      apiToken: "test-api-token",
      eventNotificationQueueId: "queue-1",
      fetchImplementation: stub.fetchImplementation,
    });
    await expect(provider.configureBucketNotifications(firmId, "us")).resolves.toBeUndefined();
    expect(stub.calls.map((call) => call.method)).toEqual(["PUT", "GET"]);
    expect(stub.calls[1]?.url).toMatch(/\/event_notifications\/r2\/[^/]+\/configuration$/);
  });

  it("fails, in the API's words, when the overlap is with a rule to some other queue", async () => {
    const stub = stubFetch([
      OVERLAP,
      {
        status: 200,
        body: {
          success: true,
          result: {
            queues: [{ queueId: "some-older-queue", rules: [{ prefix: "files/", actions: [] }] }],
          },
        },
      },
    ]);
    const provider = createCloudflareRestFirmResourceProvider({
      accountId: "test-account-id",
      apiToken: "test-api-token",
      eventNotificationQueueId: "queue-1",
      fetchImplementation: stub.fetchImplementation,
    });
    // The failure names what the bucket holds, so the reader can see the mismatch rather than
    // being handed the API's refusal a second time.
    await expect(provider.configureBucketNotifications(firmId, "us")).rejects.toThrow(
      /does not send files\/ to queue queue-1.*some-older-queue ← files\//s,
    );
  });

  it("reads the queue id without its hyphens as the same queue the API answers with hyphens", async () => {
    // The deployment's secret holds the UUID bare; the API's path accepts that and its answer
    // carries hyphens. The first real run reported this pair as a mismatch.
    const stub = stubFetch([
      OVERLAP,
      {
        status: 200,
        body: {
          success: true,
          result: {
            queues: [
              { queueId: "5b113972-5b4f-4881-b604-7ab6aa88e51a", rules: [{ prefix: "files/" }] },
            ],
          },
        },
      },
    ]);
    const provider = createCloudflareRestFirmResourceProvider({
      accountId: "test-account-id",
      apiToken: "test-api-token",
      eventNotificationQueueId: "5b1139725b4f4881b6047ab6aa88e51a",
      fetchImplementation: stub.fetchImplementation,
    });
    await expect(provider.configureBucketNotifications(firmId, "us")).resolves.toBeUndefined();
  });

  it("reads a snake_case queue id as the same queue", async () => {
    const stub = stubFetch([
      OVERLAP,
      {
        status: 200,
        body: {
          success: true,
          result: { queues: [{ queue_id: "queue-1", rules: [{ prefix: "files/" }] }] },
        },
      },
    ]);
    const provider = createCloudflareRestFirmResourceProvider({
      accountId: "test-account-id",
      apiToken: "test-api-token",
      eventNotificationQueueId: "queue-1",
      fetchImplementation: stub.fetchImplementation,
    });
    await expect(provider.configureBucketNotifications(firmId, "us")).resolves.toBeUndefined();
  });

  it("says when the configuration could not be read, rather than repeating the refusal", async () => {
    const stub = stubFetch([
      OVERLAP,
      {
        status: 403,
        body: { success: false, errors: [{ code: 10000, message: "Authentication error" }] },
      },
    ]);
    const provider = createCloudflareRestFirmResourceProvider({
      accountId: "test-account-id",
      apiToken: "test-api-token",
      eventNotificationQueueId: "queue-1",
      fetchImplementation: stub.fetchImplementation,
    });
    await expect(provider.configureBucketNotifications(firmId, "us")).rejects.toThrow(
      /reading the bucket's configuration failed.*Authentication error/s,
    );
  });
});
