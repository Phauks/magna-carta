import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureReady, recoveryTier } from "@magna-carta/decryption";
import decryptionWasmModule from "@magna-carta/decryption/src/pkg/decryption_core_bg.wasm";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId } from "@magna-carta/identifiers/types";
import { createApp } from "../src/http/app.ts";
import type { Bindings } from "../src/bindings.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { recoveryQueue } from "../src/background/recovery/recovery-consumer.ts";
import type {
  RecoveryBackend,
  RecoveryJobState,
  RecoveryShardMessage,
} from "../src/recovery/recovery-types.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// End-to-end capstone for the password-recovery orchestration: a real HTTP request starts a job
// through the RecoveryJobCoordinator Durable Object (env.RECOVERY_JOB), which fans shard messages
// out over RECOVERY_QUEUE; a real recovery Container cannot run in this pool, so the shard search is
// driven by invoking the queue consumer (recoveryQueue) directly with a fake RecoveryBackend — the
// same "drive the consumer with a hand-built MessageBatch" pattern the per-firm queue consumer's
// end-to-end test already established, since the pool never auto-drains a Queue. The coordinator DO
// and the audit rows it triggers are exercised for real.

// The same RC4-40 password-protected PDF (password: "test") used in decryption-route.test.ts and
// decryption-e2e.test.ts — mode 10500, which recoveryTier classifies cfCapable.
// Embedded as base64 because workerd has no filesystem access.
// Source: crates/decryption-core/tests/fixtures/pdf_userpw_test.pdf (828 bytes)
const PDF_FIXTURE_BASE64 =
  "JVBERi0xLjMKJeLjz9MKMSAwIG9iago8PAovUHJvZHVjZXIgPDZlNDcxYmFjZTg+Cj4+CmVuZG9i" +
  "agoyIDAgb2JqCjw8Ci9UeXBlIC9QYWdlcwovQ291bnQgMQovS2lkcyBbIDQgMCBSIF0KPj4KZW5k" +
  "b2JqCjMgMCBvYmoKPDwKL1R5cGUgL0NhdGFsb2cKL1BhZ2VzIDIgMCBSCj4+CmVuZG9iago0IDAg" +
  "b2JqCjw8Ci9UeXBlIC9QYWdlCi9SZXNvdXJjZXMgPDwKPj4KL01lZGlhQm94IFsgMC4wIDAuMCAy" +
  "MDAgMjAwIF0KL1BhcmVudCAyIDAgUgo+PgplbmRvYmoKNSAwIG9iago8PAovViAyCi9SIDMKL0xl" +
  "bmd0aCAxMjgKL1AgNDI5NDk2NzI5MgovRmlsdGVyIC9TdGFuZGFyZAovTyA8YmFkYWQxZTg2NDQy" +
  "Njk5NDI3MTE2ZDNlNWQ1MjcxYmM4MGEyNzgxNGZjNWU4MGY4MTVlZmVlZjgzOTM1NGM1Zj4KL1Ug" +
  "PGYxMWFjZWIxZjVhMmY1Y2RmN2EzNmE0OGQwYmVhZTk3MjhiZjRlNWU0ZTc1OGE0MTY0MDA0ZTU2" +
  "ZmZmYTAxMDg+Cj4+CmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAw" +
  "MTUgMDAwMDAgbiAKMDAwMDAwMDA1OSAwMDAwMCBuIAowMDAwMDAwMTE4IDAwMDAwIG4gCjAwMDAw" +
  "MDAxNjcgMDAwMDAgbiAKMDAwMDAwMDI2MSAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9TaXplIDYKL1Jv" +
  "b3QgMyAwIFIKL0luZm8gMSAwIFIKL0lEIFsgPDM1Mzk2MzMyMzA2MjYyNjE2NTYzMzgzMjY1MzE2" +
  "MjM1NjMzNjMzNjM2MTYyNjU2NjM1NjE2NjYxNjU2NjMxMzE+IDwzNTM5NjMzMjMwNjI2MjYxNjU2" +
  "MzM4MzI2NTMxNjIzNTYzMzYzMzYzNjE2MjY1NjYzNTYxNjY2MTY1NjYzMTMxPiBdCi9FbmNyeXB0" +
  "IDUgMCBSCj4+CnN0YXJ0eHJlZgo0NzYKJSVFT0YK";

// Wrangler bundles .wasm imports as WebAssembly.Module — the same ambient-declared cast
// routes/files/recovery.ts uses, so recoveryTier() below can initialise the engine from the compiled
// module rather than attempting a network fetch under workerd.
const decryptionWasm = decryptionWasmModule as unknown as WebAssembly.Module;

const app = createApp();

let firmId: FirmId;
let ownerCookie = "";
let unpermissionedCookie = "";
// A second member of the same firm who ALSO holds tools:decryption — used to prove password
// retrieval is bound to the initiating user, not merely to the firm + permission.
let otherPermissionedCookie = "";

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  // The firm's FirmDatabase Durable Object self-migrates on first access (resolved by firmId), so
  // create the firm row first, then reach its database — mirrors decryption-route.test.ts's harness
  // rather than decryption-e2e.test.ts's full HTTP firm-provisioning dance, which this orchestration
  // test does not need.
  firmId = (
    await seedFirm({ name: "Recovery E2E Firm", databaseIdentifier: "DB_FIRM_RECOVERY_E2E" })
  ).firmId;

  const { userId } = await seedCredentialedUser("recovery-e2e-owner@example.com", {
    userName: "Recovery E2E Owner",
    firmId,
  });
  await mirrorMemberWithOwnerRole(userId, "Recovery E2E Owner", firmId);
  ownerCookie = await signInForSessionCookie("recovery-e2e-owner@example.com");

  // seedCredentialedUser assigns no role; membership alone carries no permission, so this principal
  // fails the tools:decryption permission gate (not the membership gate).
  await seedCredentialedUser("recovery-e2e-noperm@example.com", {
    userName: "Recovery E2E No Permission",
    firmId,
  });
  unpermissionedCookie = await signInForSessionCookie("recovery-e2e-noperm@example.com");

  // A second permissioned member of the SAME firm: holds tools:decryption via the owner role, so the
  // permission gate passes — only the per-job ownership check separates them from the starter.
  const other = await seedCredentialedUser("recovery-e2e-other@example.com", {
    userName: "Recovery E2E Other Member",
    firmId,
  });
  await mirrorMemberWithOwnerRole(other.userId, "Recovery E2E Other Member", firmId);
  otherPermissionedCookie = await signInForSessionCookie("recovery-e2e-other@example.com");
});

async function ownerRequest(
  path: string,
  init: { method: string; body?: unknown },
): Promise<Response> {
  return app.request(
    `https://example.com${path}`,
    {
      method: init.method,
      headers: {
        "content-type": "application/json",
        origin: "https://example.com",
        cookie: ownerCookie,
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    },
    env,
  );
}

async function unpermissionedPost(path: string, body: unknown): Promise<Response> {
  return app.request(
    `https://example.com${path}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://example.com",
        cookie: unpermissionedCookie,
      },
      body: JSON.stringify(body),
    },
    env,
  );
}

// A fake MessageBatch over the recovery shard queue, mirroring recovery-consumer.test.ts's batchOf —
// captures ack()/retry() so the driving step can assert the terminal disposition without a real queue.
function batchOf(message: RecoveryShardMessage): MessageBatch<RecoveryShardMessage> {
  return {
    queue: "magna-carta-production-recovery-shard",
    messages: [
      {
        id: crypto.randomUUID(),
        timestamp: new Date(),
        attempts: 1,
        body: message,
        ack: () => {},
        retry: () => {},
      },
    ],
  } as unknown as MessageBatch<RecoveryShardMessage>;
}

const RECOVERY_SHARD_COUNT = 4; // matches routes/files/recovery.ts's RECOVERY_SHARD_COUNT

describe("recovery end-to-end: cfCapable happy path (button -> tier router -> fan-out -> first-hit -> password)", () => {
  let jobId = "";
  let extractedHash = "";
  // A distinctive marker, not a real-world password, so the redaction assertion below cannot
  // false-positive against an incidental substring elsewhere in the audit metadata.
  const FOUND_PASSWORD = "recovery-e2e-found-password-3f9k2q";

  it("inspect extracts the same hash the coordinator will search against (redaction baseline)", async () => {
    const response = await ownerRequest("/api/v1/decryption/inspect", {
      method: "POST",
      body: { fileBase64: PDF_FIXTURE_BASE64, attestation: { authorized: true } },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { format: string; hash: string; hashcatMode: number };
    expect(body.format).toBe("pdf");
    expect(body.hashcatMode).toBe(10500);
    extractedHash = body.hash;
    expect(extractedHash).toMatch(/^\$pdf\$/);
  });

  it("POST /recover starts a queued cfCapable job", async () => {
    const response = await ownerRequest("/api/v1/decryption/recover", {
      method: "POST",
      body: { fileBase64: PDF_FIXTURE_BASE64, attestation: { authorized: true } },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { jobId: string; tier: string; status: string };
    expect(body.tier).toBe("cfCapable");
    expect(body.status).toBe("queued");
    jobId = body.jobId;
    expect(jobId).not.toBe("");
  });

  it("driving one shard to a found outcome resolves the job through the real coordinator DO", async () => {
    const backend: RecoveryBackend = {
      recoverShard: async () => ({ found: FOUND_PASSWORD, candidatesTried: 42 }),
    };
    const message: RecoveryShardMessage = {
      firmId,
      jobId,
      shardIndex: 0,
      shardCount: RECOVERY_SHARD_COUNT,
      hash: extractedHash,
      format: "pdf",
      hashcatMode: 10500,
      ruleSet: "best64",
    };
    await recoveryQueue(batchOf(message), env as unknown as Bindings, () => backend);

    const statusResponse = await ownerRequest(`/api/v1/decryption/recover/${jobId}`, {
      method: "GET",
    });
    expect(statusResponse.status).toBe(200);
    const body = (await statusResponse.json()) as {
      status: string;
      result?: { password: string };
    };
    expect(body.status).toBe("found");
    expect(body.result?.password).toBe(FOUND_PASSWORD);
  });

  it("redaction: the recovery_started audit row exists; no decryption.recovery_* row leaks the password or the extracted hash-secret", async () => {
    const firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);
    const startedCount = await firmDatabase
      .prepare(
        "SELECT COUNT(*) AS count FROM audit_log WHERE event = 'decryption.recovery_started'",
      )
      .first<{ count: number }>();
    expect(startedCount?.count).toBeGreaterThanOrEqual(1);

    const rows = await firmDatabase
      .prepare("SELECT event, metadata FROM audit_log WHERE event LIKE 'decryption.recovery_%'")
      .all<{ event: string; metadata: string }>();
    expect(rows.results.length).toBeGreaterThanOrEqual(1);

    const combined = rows.results.map((row) => row.metadata).join("\n");
    // Neither the recovered password nor the extracted hash-secret — the two pieces of material the
    // route/coordinator boundary deliberately never persists — may appear in any recovery audit row.
    expect(combined).not.toContain(FOUND_PASSWORD);
    expect(combined).not.toContain(extractedHash);
    // The JSON key "password" must never appear either — a leak under a differently-named key would
    // survive the value check above but is caught here.
    expect(combined).not.toContain('"password"');

    // Each row's outcome is recorded without leaking content.
    const startedRow = rows.results.find((row) => row.event === "decryption.recovery_started");
    expect(startedRow?.metadata).toContain("fileSha256");
    expect(startedRow?.metadata).toContain('"tier":"cfCapable"');
  });
});

describe("recovery end-to-end: permission gate and validation", () => {
  it("403 for a firm member whose role lacks tools:decryption", async () => {
    const response = await unpermissionedPost("/api/v1/decryption/recover", {
      fileBase64: PDF_FIXTURE_BASE64,
      attestation: { authorized: true },
    });
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  it("400 when attestation.authorized is false", async () => {
    const response = await ownerRequest("/api/v1/decryption/recover", {
      method: "POST",
      body: { fileBase64: PDF_FIXTURE_BASE64, attestation: { authorized: false } },
    });
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  it("400 (not 500) for malformed base64 input", async () => {
    const response = await ownerRequest("/api/v1/decryption/recover", {
      method: "POST",
      body: { fileBase64: "!!!not base64!!!", attestation: { authorized: true } },
    });
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });
});

describe("recovery end-to-end: cancel", () => {
  it("POST /recover then DELETE /recover/{jobId} then GET shows cancelled", async () => {
    const startResponse = await ownerRequest("/api/v1/decryption/recover", {
      method: "POST",
      body: { fileBase64: PDF_FIXTURE_BASE64, attestation: { authorized: true } },
    });
    expect(startResponse.status).toBe(200);
    const { jobId } = (await startResponse.json()) as { jobId: string };

    const cancelResponse = await ownerRequest(`/api/v1/decryption/recover/${jobId}`, {
      method: "DELETE",
    });
    expect(cancelResponse.status).toBe(204);

    const statusResponse = await ownerRequest(`/api/v1/decryption/recover/${jobId}`, {
      method: "GET",
    });
    expect(statusResponse.status).toBe(200);
    const body = (await statusResponse.json()) as { status: string };
    expect(body.status).toBe("cancelled");

    // A cancelled job's audit trail carries jobId + actor only, never any recovered material — there
    // is none to leak here (the job never found anything), but the shape must stay redacted the same
    // way the happy path is.
    const firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);
    const cancelledRow = await firmDatabase
      .prepare(
        "SELECT metadata FROM audit_log WHERE event = 'decryption.recovery_cancelled' ORDER BY created_at DESC LIMIT 1",
      )
      .first<{ metadata: string }>();
    expect(cancelledRow?.metadata).toContain(jobId);
  });
});

describe("recovery end-to-end: password retrieval is bound to the initiating user", () => {
  it("a different firm member with tools:decryption cannot read another member's job (404, indistinguishable from unknown)", async () => {
    // The owner starts a job.
    const startResponse = await ownerRequest("/api/v1/decryption/recover", {
      method: "POST",
      body: { fileBase64: PDF_FIXTURE_BASE64, attestation: { authorized: true } },
    });
    expect(startResponse.status).toBe(200);
    const { jobId } = (await startResponse.json()) as { jobId: string };

    // A second, equally-permissioned member of the same firm polls the same jobId. The firm scope and
    // the tools:decryption gate both pass — only the ownership check stands between them and the job —
    // and it 404s, revealing nothing about whether the job exists.
    const otherResponse = await app.request(
      `https://example.com/api/v1/decryption/recover/${jobId}`,
      {
        method: "GET",
        headers: { origin: "https://example.com", cookie: otherPermissionedCookie },
      },
      env,
    );
    expect(otherResponse.status).toBe(404);
    expect(otherResponse.headers.get("content-type")).toContain("application/problem+json");

    // The initiating user still reads their own job normally — the binding denies others, not everyone.
    const ownerResponse = await ownerRequest(`/api/v1/decryption/recover/${jobId}`, {
      method: "GET",
    });
    expect(ownerResponse.status).toBe(200);
  });
});

// The gpuRequired tier (slow key-derivation functions — PDF R5/R6, OOXML agile encryption, 7-Zip) has
// no encrypted-file fixture in this repo: only the mode-9600 example HASH string used by the Rust
// engine's own unit tests, which is a hash string, not file bytes, and cannot be driven through the
// route's extractHash(bytes). So this covers the tier-routing behavior at the level that IS testable
// today — the classification function and the coordinator's zero-shard terminal path — rather than
// fabricating a fake "OOXML" upload that would just 400. The full-file HTTP path (POST /recover with a
// real agile-OOXML encrypted file) awaits that fixture; the GPU rung that eventually serves needsGpu
// jobs plugs into this same coordinator seam with no further route or coordinator changes.
describe("recovery end-to-end: gpuRequired tier routing (coordinator-level; full-file HTTP path awaits an agile-OOXML fixture)", () => {
  it("recoveryTier classifies OOXML agile encryption (hashcat mode 9600) as gpuRequired", async () => {
    await ensureReady(decryptionWasm);
    const tier = await recoveryTier("ooxml", 9600);
    expect(tier).toBe("gpuRequired");
  });

  it("the coordinator started with tier gpuRequired enqueues zero shards and is immediately terminal needsGpu", async () => {
    const gpuJobId = newIdentifier("recoveryJob");
    const coordinator = env.RECOVERY_JOB.get(env.RECOVERY_JOB.idFromName(`${firmId}:${gpuJobId}`));
    const state: RecoveryJobState = await coordinator.start({
      tier: "gpuRequired",
      shardCount: 0,
      hash: "$office$2*100000*128*16*aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa*bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb*cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      format: "ooxml",
      hashcatMode: 9600,
      ruleSet: "best64",
      firmId,
      jobId: gpuJobId,
      startedByUserId: "user_gpu_test",
    });
    expect(state.status).toBe("needsGpu");
    expect(state.progress).toEqual({ candidatesTried: 0, shardsDone: 0, shardCount: 0 });
    expect(state.password).toBeNull();

    const polled = await coordinator.status();
    expect(polled.status).toBe("needsGpu");
  });
});
