import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { writeFirmSettingStatement } from "@magna-carta/data-access/setting-statements";
import { modeThresholdDefinition } from "@magna-carta/file-manager/upload-policy";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, MatterId } from "@magna-carta/identifiers/types";
import { createApp } from "../src/app.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { handleIngestMessage } from "../src/files/ingest-consumer.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The development-only R2 upload route (routes/developer/dev-r2-upload.ts) stands in for direct-to-R2 uploads
// under `wrangler dev`, where no presigned R2 host resolves and no R2 object-create event fires. It
// writes bytes to object storage, so it is guarded three ways. These tests pin each guard:
//   1. Real-credential absence — a production-shaped env (the full R2 S3 credential set present) does
//      not serve the route; it answers a bare 404 before the chokepoint runs.
//   2. The chokepoint — an unauthenticated request is refused (401) even where the route is active.
//   3. Object-key validation — a key no upload session in the firm minted is refused (404), while the
//      key uploads.initiate actually minted is accepted and its bytes land in R2.
//
// The pool env carries the R2_S3_* placeholders but deliberately omits CLOUDFLARE_ACCOUNT_ID, so the
// dev upload emulation is active by default here (presigner-wiring.ts devUploadEmulationActive) — the
// same state `wrangler dev` runs in. Guard 1 is exercised by injecting the missing account id.

let poolFirmId: FirmId;
let matterId: MatterId;
let ownerCookie: string;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (
    await seedFirm({ name: "Dev Upload Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
  // An active firm carries a provisioned bucket; the dev pool firm shares the single R2 binding.
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(poolFirmId)
    .run();

  const owner = await seedCredentialedUser("dev-upload-owner@example.com", {
    userName: "Dev Upload Owner",
    firmId: poolFirmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Dev Upload Owner", poolFirmId);
  ownerCookie = await signInForSessionCookie("dev-upload-owner@example.com");

  matterId = newIdentifier("matter");
  await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) " +
        "VALUES (?1, 'Dev Upload Matter', 'open', ?2, ?3, ?3)",
    )
    .bind(matterId, owner.userId, "2026-07-09T00:00:00.000Z")
    .run();
});

describe("guard 1 — real-credential absence", () => {
  it("does not serve the route when the full R2 S3 credential set is present (production-shaped)", async () => {
    const app = createApp();
    // The pool env already holds the R2_S3_* placeholders; supplying CLOUDFLARE_ACCOUNT_ID completes
    // the credential set, so realR2Credentials resolves and the dev emulation is inactive. A Proxy
    // keeps every real binding (telemetry, DB, DO) intact so only the guard condition changes.
    const productionEnv = new Proxy(env, {
      get(target, property, receiver) {
        if (property === "CLOUDFLARE_ACCOUNT_ID") return "prod-account-id-1234567890";
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    const response = await app.request(
      "/api/__dev/r2/object?key=files/anything",
      { method: "PUT", body: new Uint8Array([1, 2, 3]) },
      productionEnv,
    );
    expect(response.status).toBe(404);

    // Contrast: under the pool env (no account id → dev emulation active) the SAME route IS wired, so
    // the request reaches the chokepoint and is refused for lack of a session — a 401, not a 404. This
    // proves the 404 above is credential-driven, not a missing route.
    const devEnvResponse = await app.request(
      "/api/__dev/r2/object?key=files/anything",
      { method: "PUT", body: new Uint8Array([1, 2, 3]) },
      env,
    );
    expect(devEnvResponse.status).toBe(401);
  });
});

describe("guard 2 — the chokepoint", () => {
  it("401s an unauthenticated request even where the route is active", async () => {
    const response = await SELF.fetch(
      "https://example.com/api/__dev/r2/object?key=files/anything",
      {
        method: "PUT",
        headers: { origin: "https://example.com" },
        body: new Uint8Array([1, 2, 3]),
      },
    );
    expect(response.status).toBe(401);
  });
});

describe("guard 3 — object-key validation", () => {
  it("rejects a key no upload session minted, and accepts the key uploads.initiate minted", async () => {
    // Mint a real pending version + object key through the normal ceremony.
    const initiate = await SELF.fetch("https://example.com/api/v1/uploads", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://example.com",
        cookie: ownerCookie,
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        matterId,
        name: "brief.pdf",
        declaredSize: 1024,
        declaredContentType: "application/pdf",
      }),
    });
    expect(initiate.status).toBe(201);
    const initiated = (await initiate.json()) as {
      mode: string;
      key: string;
      url: string;
      headers: Record<string, string>;
    };
    expect(initiated.mode).toBe("put");
    // The response tells the client which headers the upload must carry, and the object's scope is
    // among them: in production those headers are covered by the URL's signature, so an upload that
    // leaves one off is refused rather than landing an object nothing can place.
    expect(initiated.headers["x-amz-meta-matter"]).toBe(matterId);
    expect(initiated.headers["x-amz-meta-object_class"]).toBe("working-document");
    // The presigner rerouted the upload to the same-origin dev route.
    expect(initiated.url).toContain("/api/__dev/r2/object");

    // An arbitrary key (nothing in this firm minted it) resolves to no pending version → 404.
    const arbitrary = await SELF.fetch(
      "https://example.com/api/__dev/r2/object?key=files/not-a-real-minted-key",
      {
        method: "PUT",
        headers: { origin: "https://example.com", cookie: ownerCookie },
        body: new Uint8Array([1, 2, 3]),
      },
    );
    expect(arbitrary.status).toBe(404);

    // The minted key is accepted, and the bytes land in R2 (the exact handle ingest reads).
    const accepted = await SELF.fetch(`https://example.com${initiated.url}`, {
      method: "PUT",
      headers: { origin: "https://example.com", cookie: ownerCookie, ...initiated.headers },
      body: new Uint8Array([1, 2, 3, 4, 5]),
    });
    expect(accepted.status).toBe(200);
    const stored = await env.R2.get(initiated.key);
    expect(stored).not.toBeNull();
    // End to end: what the client sent as headers is what the stored object carries as its dimensions.
    expect(stored?.customMetadata).toEqual({
      matter: matterId,
      object_class: "working-document",
    });
  });
});

// The end-to-end proof the same-origin dev route stands in for: a real file run through the full
// four-step ceremony lands bytes AND drives ingest to a clean commit, for BOTH the single-shot and the
// multipart paths. The Miniflare pool IS the local runtime `vp run worker-dev` serves; the only
// stand-in is the ingest event — Miniflare delivers no R2 object-create notification, so the ceremony's
// enqueue is not auto-consumed. handleIngestMessage drives that event explicitly (exactly as the queue
// consumer would in production), then the version's status is read straight from the firm database. A
// valid PDF whose declared size matches its bytes passes the ingest gates; the engine-less scan port
// (no SCAN_SERVICE binding in the pool) yields a clean commit.
const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n");

describe("development upload path end to end — pending -> clean", () => {
  async function versionStatus(versionId: string): Promise<string | undefined> {
    const result = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare("SELECT status FROM file_version WHERE id = ?1")
      .bind(versionId)
      .all<{ status: string }>();
    return result.results[0]?.status;
  }

  async function initiateUploadRequest(name: string): Promise<{
    mode: string;
    key: string;
    url?: string;
    uploadId: string;
    versionId: string;
  }> {
    const response = await SELF.fetch("https://example.com/api/v1/uploads", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://example.com",
        cookie: ownerCookie,
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        matterId,
        name,
        declaredSize: PDF_BYTES.byteLength,
        declaredContentType: "application/pdf",
      }),
    });
    expect(response.status).toBe(201);
    return response.json();
  }

  // Drives the ingest event the R2 notification would have fired locally.
  async function driveIngest(key: string): Promise<void> {
    await handleIngestMessage(env, {
      bucket: "R2",
      object: { key, size: PDF_BYTES.byteLength },
      action: "PutObject",
    });
  }

  it("single-shot PUT: bytes land and the version commits clean", async () => {
    const initiated = await initiateUploadRequest("e2e-single.pdf");
    expect(initiated.mode).toBe("put");
    expect(await versionStatus(initiated.versionId)).toBe("pending");

    const put = await SELF.fetch(`https://example.com${initiated.url ?? ""}`, {
      method: "PUT",
      headers: { origin: "https://example.com", cookie: ownerCookie },
      body: PDF_BYTES,
    });
    expect(put.status).toBe(200);

    await driveIngest(initiated.key);
    expect(await versionStatus(initiated.versionId)).toBe("clean");
  });

  it("multipart: staged part assembles, bytes land, and the version commits clean", async () => {
    // Lower the firm's mode threshold so a small file takes the multipart path (default is 100 MB).
    await writeFirmSettingStatement(
      firmDatabaseFor(env.FIRM_DATABASE, poolFirmId),
      modeThresholdDefinition,
      1,
      new Date().toISOString(),
    ).run();

    const initiated = await initiateUploadRequest("e2e-multipart.pdf");
    expect(initiated.mode).toBe("multipart");
    expect(await versionStatus(initiated.versionId)).toBe("pending");

    // Sign part 1, PUT the part to the dev route (stages it), then complete (assembles + enqueues).
    const sign = await SELF.fetch(
      `https://example.com/api/v1/uploads/${initiated.uploadId}/parts/1`,
      { headers: { cookie: ownerCookie } },
    );
    expect(sign.status).toBe(200);
    const { url } = (await sign.json()) as { url: string };
    const part = await SELF.fetch(`https://example.com${url}`, {
      method: "PUT",
      headers: { origin: "https://example.com", cookie: ownerCookie },
      body: PDF_BYTES,
    });
    expect(part.status).toBe(200);
    const etag = part.headers.get("etag") ?? '"dev-part"';

    const complete = await SELF.fetch(
      `https://example.com/api/v1/uploads/${initiated.uploadId}/complete`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://example.com",
          cookie: ownerCookie,
        },
        body: JSON.stringify({ parts: [{ partNumber: 1, etag }] }),
      },
    );
    expect(complete.status).toBe(200);

    // A multipart object's metadata is fixed when the upload is created, not when it completes, so the
    // assembled object must carry what the create was given — the same scope a single-shot PUT lands.
    const assembled = await env.R2.head(initiated.key);
    expect(assembled?.customMetadata).toEqual({
      matter: matterId,
      object_class: "working-document",
    });

    await driveIngest(initiated.key);
    expect(await versionStatus(initiated.versionId)).toBe("clean");
  });
});
