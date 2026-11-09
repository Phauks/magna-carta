import { env, runInDurableObject, SELF } from "cloudflare:test";
import type { FirmId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { converted, engineNotImplemented, type ConversionPort } from "@magna-carta/conversion/port";
import { conversionQueue } from "../src/background/conversions/conversion-consumer.ts";
import type { ConversionJob } from "../src/conversions/conversion-coordinator.ts";
import type { ConversionMessage } from "../src/conversions/conversion-types.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// Focused route-registration test for the conversion endpoints. Asserts each route is reachable at
// its declared method/path and that Route B rejects an unconvertible pair (png->mp4 has no graph
// path) with 422. Route A and Route C are checked for presence (not 404) against a seeded session.
//
// The end-to-end suite (further below) drives the full transient convert→download journey through
// real Miniflare bindings using a FAKE engine injected through conversionQueue's resolver seam:
// upload slot → source bytes in R2 → submit → drain queue → poll status → verified result.

let firmId: FirmId;
let ownerCookie: string;

// Second firm for tenant-isolation assertions.
let firmId2: FirmId;
let ownerCookie2: string;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);

  firmId = (
    await seedFirm({ name: "Conversion Routes Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
  // Each firm records its own bucket name, as provisioning makes them differ (firm.bucket_name is
  // UNIQUE — it is what an R2 event resolves back to a firm). The test pool binds a single bucket
  // that stands in for both.
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = ?2 WHERE id = ?1")
    .bind(firmId, "conversion-routes-firm-bucket")
    .run();
  const owner = await seedCredentialedUser("conversion-owner@example.com", {
    userName: "Conversion Owner",
    firmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Conversion Owner", firmId);
  ownerCookie = await signInForSessionCookie("conversion-owner@example.com");

  firmId2 = (
    await seedFirm({ name: "Conversion Tenant B Firm", databaseIdentifier: "DB_FIRM_POOL_2" })
  ).firmId;
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = ?2 WHERE id = ?1")
    .bind(firmId2, "conversion-tenant-b-firm-bucket")
    .run();
  const owner2 = await seedCredentialedUser("conversion-owner-b@example.com", {
    userName: "Conversion Owner B",
    firmId: firmId2,
  });
  await mirrorMemberWithOwnerRole(owner2.userId, "Conversion Owner B", firmId2);
  ownerCookie2 = await signInForSessionCookie("conversion-owner-b@example.com");
});

// Builds a one-message MessageBatch for conversionQueue — mirrors the conversion-consumer test.
function makeBatch(message: ConversionMessage): {
  batch: MessageBatch<ConversionMessage>;
  acks: string[];
  retries: string[];
} {
  const acks: string[] = [];
  const retries: string[] = [];
  const batch = {
    queue: "magna-carta-production-conversion",
    messages: [
      {
        id: "msg-e2e",
        timestamp: new Date(),
        attempts: 1,
        body: message,
        ack: () => acks.push("msg-e2e"),
        retry: () => retries.push("msg-e2e"),
      },
    ],
  } as unknown as MessageBatch<ConversionMessage>;
  return { batch, acks, retries };
}

describe("POST /api/v1/conversions/upload", () => {
  it("is registered and returns 200 (presign minted by dev presigner)", async () => {
    const response = await SELF.fetch("https://example.com/api/v1/conversions/upload", {
      method: "POST",
      headers: { cookie: ownerCookie, origin: "https://example.com" },
    });
    // The dev presigner returns a placeholder signed URL so the route returns 200, not 404.
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      jobId?: string;
      uploadUrl?: string;
      sourceKey?: string;
    };
    expect(typeof body.jobId).toBe("string");
    expect(typeof body.uploadUrl).toBe("string");
    expect(typeof body.sourceKey).toBe("string");
    expect(body.sourceKey).toContain("conversions/");
  });
});

describe("POST /api/v1/conversions", () => {
  it("rejects an unconvertible format pair (png->mp4) with 422", async () => {
    const response = await SELF.fetch("https://example.com/api/v1/conversions", {
      method: "POST",
      headers: {
        cookie: ownerCookie,
        origin: "https://example.com",
        "content-type": "application/json",
      },
      body: JSON.stringify({ from: "png", to: "mp4", jobId: "x", sourceKey: "y" }),
    });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { status?: number; type?: string };
    expect(body.status).toBe(422);
  });
});

describe("GET /api/v1/conversions/{jobId}", () => {
  it("is registered and returns 200 (unknown job maps to failed state)", async () => {
    // The DO for this job has never been started, so status() returns the UNKNOWN sentinel:
    // { status: "failed", reason: "unknown job" }. The route maps that to { status: "failed" }.
    const response = await SELF.fetch("https://example.com/api/v1/conversions/someId", {
      headers: { cookie: ownerCookie, origin: "https://example.com" },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status?: string; reason?: string };
    expect(body.status).toBe("failed");
  });

  it("mints a signed URL when the job is done and the artifact exists in R2", async () => {
    const jobId = "job-done-test";
    const sourceKey = `conversions/${firmId}/${jobId}/source`;
    const resultKey = `conversions/${firmId}/${jobId}/result`;

    // Prime the DO: swap the CONVERSION queue send for a no-op so start() does not enqueue,
    // then call markDone to advance the state to `done` with the result key.
    const stub = env.CONVERSION_JOB.get(env.CONVERSION_JOB.idFromName(`${firmId}:${jobId}`));
    const startMessage: ConversionMessage = {
      firmId,
      bucketName: "conversion-routes-firm-bucket",
      jobId,
      sourceKey,
      resultKey,
      from: "png",
      to: "pdf",
    };
    await runInDurableObject(stub, async (instance: ConversionJob) => {
      const mutable = instance as unknown as { env: Record<string, unknown> };
      mutable.env = { ...mutable.env, CONVERSION: { send: async () => {} } };
      await instance.start(startMessage);
      await instance.markDone(resultKey, "application/pdf");
    });

    // Put the artifact in R2 so the route finds it.
    await env.R2.put(resultKey, "converted-content");

    const response = await SELF.fetch(`https://example.com/api/v1/conversions/${jobId}`, {
      headers: { cookie: ownerCookie, origin: "https://example.com" },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status?: string;
      url?: string;
      mediaType?: string;
    };
    expect(body.status).toBe("done");
    expect(typeof body.url).toBe("string");
    expect(body.url ?? "").toContain("dev-presigned=get");
    expect(typeof body.mediaType).toBe("string");
  });

  it("reports expired when the job is done but the artifact has been reaped from R2", async () => {
    const jobId = "job-expired-test";
    const sourceKey = `conversions/${firmId}/${jobId}/source`;
    const resultKey = `conversions/${firmId}/${jobId}/result`;

    // Prime the DO to `done` without touching R2 — simulates a lifecycle-reaped artifact.
    const stub = env.CONVERSION_JOB.get(env.CONVERSION_JOB.idFromName(`${firmId}:${jobId}`));
    const startMessage: ConversionMessage = {
      firmId,
      bucketName: "conversion-routes-firm-bucket",
      jobId,
      sourceKey,
      resultKey,
      from: "png",
      to: "pdf",
    };
    await runInDurableObject(stub, async (instance: ConversionJob) => {
      const mutable = instance as unknown as { env: Record<string, unknown> };
      mutable.env = { ...mutable.env, CONVERSION: { send: async () => {} } };
      await instance.start(startMessage);
      await instance.markDone(resultKey, "application/pdf");
    });

    // No R2 put — the object does not exist, so the route must report `expired`.
    const response = await SELF.fetch(`https://example.com/api/v1/conversions/${jobId}`, {
      headers: { cookie: ownerCookie, origin: "https://example.com" },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status?: string; url?: string };
    expect(body.status).toBe("expired");
    expect(body.url).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// End-to-end journey: upload → submit → drain queue → poll result
// ---------------------------------------------------------------------------
// These three scenarios exercise the full transient convert→download path through real Miniflare
// bindings. The engine Container is deploy-time; a FAKE engine is injected through conversionQueue's
// third-argument resolver seam so the consumer logic runs end-to-end without the Container.

describe("E2E: happy path — upload→submit→drain→done", () => {
  it("authed member converts png→webp through a fake engine and retrieves a presigned result URL", async () => {
    // Step 1: mint a job slot and presigned upload URL.
    const uploadResponse = await SELF.fetch("https://example.com/api/v1/conversions/upload", {
      method: "POST",
      headers: { cookie: ownerCookie, origin: "https://example.com" },
    });
    expect(uploadResponse.status).toBe(200);
    const uploadBody = (await uploadResponse.json()) as {
      jobId: string;
      uploadUrl: string;
      sourceKey: string;
    };
    const { jobId, sourceKey } = uploadBody;
    expect(typeof jobId).toBe("string");
    expect(typeof sourceKey).toBe("string");

    // Step 2: write the source bytes directly to the test R2 binding at the server-derived key
    // (the job route ignores the body's sourceKey and re-derives it as conversions/<firmId>/<jobId>/source).
    const sourceBytes = new TextEncoder().encode("fake-png-source-bytes");
    await env.R2.put(sourceKey, sourceBytes);

    // Step 3: submit the job — POST /conversions {jobId, from, to} → 202 queued.
    // The route derives sourceKey and resultKey server-side from firmId:jobId.
    const submitResponse = await SELF.fetch("https://example.com/api/v1/conversions", {
      method: "POST",
      headers: {
        cookie: ownerCookie,
        origin: "https://example.com",
        "content-type": "application/json",
      },
      body: JSON.stringify({ jobId, sourceKey, from: "png", to: "webp" }),
    });
    expect(submitResponse.status).toBe(202);
    const submitBody = (await submitResponse.json()) as { jobId: string; status: string };
    expect(submitBody.jobId).toBe(jobId);
    expect(submitBody.status).toBe("queued");

    // Step 4: build the queue message the DO just enqueued. The route pins both keys server-side,
    // so resultKey is conversions/<firmId>/<jobId>/result — identical to how the DO constructed it.
    const resultKey = `conversions/${firmId}/${jobId}/result`;
    const resultBytes = new Uint8Array([0x52, 0x49, 0x46, 0x46]); // fake WEBP header bytes
    const queueMessage: ConversionMessage = {
      firmId,
      bucketName: "conversion-routes-firm-bucket",
      jobId,
      sourceKey,
      resultKey,
      from: "png",
      to: "webp",
    };

    // Step 5: drain the queue with a fake port returning the converted bytes.
    const fakePort: ConversionPort = {
      convert: async () => converted(resultBytes, "image/webp"),
    };
    const { batch, acks, retries } = makeBatch(queueMessage);
    await conversionQueue(batch, env, () => () => fakePort);

    // The consumer acked the message (not retried).
    expect(acks).toEqual(["msg-e2e"]);
    expect(retries).toEqual([]);

    // The result R2 object exists with the fake bytes and correct media type.
    const resultObject = await env.R2.get(resultKey);
    expect(resultObject).not.toBeNull();
    const storedBytes = new Uint8Array(await resultObject!.arrayBuffer());
    expect(storedBytes).toEqual(resultBytes);
    expect(resultObject!.httpMetadata?.contentType).toBe("image/webp");

    // Step 6: poll GET /conversions/{jobId} → done + presigned URL + mediaType.
    const statusResponse = await SELF.fetch(`https://example.com/api/v1/conversions/${jobId}`, {
      headers: { cookie: ownerCookie, origin: "https://example.com" },
    });
    expect(statusResponse.status).toBe(200);
    const statusBody = (await statusResponse.json()) as {
      status?: string;
      url?: string;
      mediaType?: string;
    };
    expect(statusBody.status).toBe("done");
    expect(typeof statusBody.url).toBe("string");
    expect(statusBody.url ?? "").toContain("dev-presigned=get");
    expect(statusBody.mediaType).toBe("image/webp");

    // Step 7: the result bytes are readable at the R2 key the route named — byte-equal to the fake output.
    const resultCheck = await env.R2.get(resultKey);
    expect(resultCheck).not.toBeNull();
    const finalBytes = new Uint8Array(await resultCheck!.arrayBuffer());
    expect(finalBytes).toEqual(resultBytes);
  });
});

describe("E2E: tenant isolation — firm B cannot read firm A's job", () => {
  it("firm B's authed session polling firm A's jobId gets failed/unknown-job, never the result", async () => {
    // Seed a complete job for firm A using the same full journey.
    const uploadResponse = await SELF.fetch("https://example.com/api/v1/conversions/upload", {
      method: "POST",
      headers: { cookie: ownerCookie, origin: "https://example.com" },
    });
    expect(uploadResponse.status).toBe(200);
    const { jobId, sourceKey } = (await uploadResponse.json()) as {
      jobId: string;
      sourceKey: string;
    };

    await env.R2.put(sourceKey, new TextEncoder().encode("firm-a-source"));

    const submitResponse = await SELF.fetch("https://example.com/api/v1/conversions", {
      method: "POST",
      headers: {
        cookie: ownerCookie,
        origin: "https://example.com",
        "content-type": "application/json",
      },
      body: JSON.stringify({ jobId, sourceKey, from: "png", to: "webp" }),
    });
    expect(submitResponse.status).toBe(202);

    const resultKey = `conversions/${firmId}/${jobId}/result`;
    const resultBytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const queueMessage: ConversionMessage = {
      firmId,
      bucketName: "conversion-routes-firm-bucket",
      jobId,
      sourceKey,
      resultKey,
      from: "png",
      to: "webp",
    };

    await conversionQueue(makeBatch(queueMessage).batch, env, () => () => ({
      convert: async () => converted(resultBytes, "image/webp"),
    }));

    // Firm A can see the result (control: the job is done).
    const firmAStatus = await SELF.fetch(`https://example.com/api/v1/conversions/${jobId}`, {
      headers: { cookie: ownerCookie, origin: "https://example.com" },
    });
    expect(firmAStatus.status).toBe(200);
    const firmABody = (await firmAStatus.json()) as { status?: string };
    expect(firmABody.status).toBe("done");

    // Firm B polls the same jobId. The DO for firm B is keyed firmId2:jobId — a DIFFERENT DO that
    // was never started — so status() returns the UNKNOWN sentinel: { status: "failed", reason: "unknown job" }.
    const firmBStatus = await SELF.fetch(`https://example.com/api/v1/conversions/${jobId}`, {
      headers: { cookie: ownerCookie2, origin: "https://example.com" },
    });
    expect(firmBStatus.status).toBe(200);
    const firmBBody = (await firmBStatus.json()) as {
      status?: string;
      reason?: string;
      url?: string;
    };
    expect(firmBBody.status).toBe("failed");
    expect(firmBBody.reason).toBe("unknown job");
    // No URL or mediaType must leak across the tenant boundary.
    expect(firmBBody.url).toBeUndefined();
  });
});

describe("E2E: typed failure — engine-not-implemented ends the job failed", () => {
  it("draining with an engineNotImplemented port marks the job failed with the typed reason", async () => {
    // Mint a slot and submit a job for firm A.
    const uploadResponse = await SELF.fetch("https://example.com/api/v1/conversions/upload", {
      method: "POST",
      headers: { cookie: ownerCookie, origin: "https://example.com" },
    });
    expect(uploadResponse.status).toBe(200);
    const { jobId, sourceKey } = (await uploadResponse.json()) as {
      jobId: string;
      sourceKey: string;
    };

    await env.R2.put(sourceKey, new TextEncoder().encode("png-source-for-failure"));

    const submitResponse = await SELF.fetch("https://example.com/api/v1/conversions", {
      method: "POST",
      headers: {
        cookie: ownerCookie,
        origin: "https://example.com",
        "content-type": "application/json",
      },
      body: JSON.stringify({ jobId, sourceKey, from: "png", to: "webp" }),
    });
    expect(submitResponse.status).toBe(202);

    const resultKey = `conversions/${firmId}/${jobId}/result`;
    const queueMessage: ConversionMessage = {
      firmId,
      bucketName: "conversion-routes-firm-bucket",
      jobId,
      sourceKey,
      resultKey,
      from: "png",
      to: "webp",
    };

    // Drain with a fake port returning engineNotImplemented — a typed, terminal failure.
    const { batch, acks, retries } = makeBatch(queueMessage);
    await conversionQueue(batch, env, () => () => ({
      convert: async () => engineNotImplemented(),
    }));

    // Typed failures are terminal (acked, not retried).
    expect(acks).toEqual(["msg-e2e"]);
    expect(retries).toEqual([]);

    // Polling the status route returns failed with the typed reason.
    const statusResponse = await SELF.fetch(`https://example.com/api/v1/conversions/${jobId}`, {
      headers: { cookie: ownerCookie, origin: "https://example.com" },
    });
    expect(statusResponse.status).toBe(200);
    const statusBody = (await statusResponse.json()) as {
      status?: string;
      reason?: string;
      url?: string;
    };
    expect(statusBody.status).toBe("failed");
    expect(statusBody.reason).toBe("engine-not-implemented");
    expect(statusBody.url).toBeUndefined();
  });
});
