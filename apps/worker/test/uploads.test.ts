import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { insertMemberStatement } from "@magna-carta/data-access/member-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, MatterId } from "@magna-carta/identifiers/types";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { applyPerFirmMigrations } from "./support/apply-per-firm-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The slice 1·1 direct-to-R2 upload surface. The dev presigner stands in for the real SigV4 signer
// (no R2 S3 creds off-production, so no network), and these integration tests drive the four
// endpoints through the chokepoint over real Miniflare bindings. The presigner's signature SHAPE is
// pinned separately in test/files/presign.test.ts.

let poolFirmId: FirmId;
let matterId: MatterId;
let ownerCookie: string;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  await applyPerFirmMigrations(env.DB_FIRM_POOL_1);
  poolFirmId = (await seedFirm({ name: "Uploads Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
  // An active firm carries a provisioned bucket; the dev pool firm shares the single R2 binding.
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(poolFirmId)
    .run();

  const owner = await seedCredentialedUser("uploads-owner@example.com", {
    userName: "Uploads Owner",
    firmId: poolFirmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Uploads Owner");
  ownerCookie = await signInForSessionCookie("uploads-owner@example.com");

  // A matter to upload into (responsible member = the mirrored owner).
  matterId = newIdentifier("matter");
  await env.DB_FIRM_POOL_1.prepare(
    "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) " +
      "VALUES (?1, 'Upload Matter', 'open', ?2, ?3, ?3)",
  )
    .bind(matterId, owner.userId, "2026-06-13T00:00:00.000Z")
    .run();
});

interface PostOptions {
  cookie?: string;
  idempotencyKey?: string;
}

async function postUpload(body: unknown, options: PostOptions = {}): Promise<Response> {
  return SELF.fetch("https://example.com/api/v1/uploads", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
      ...(options.idempotencyKey === undefined
        ? {}
        : { "Idempotency-Key": options.idempotencyKey }),
    },
    body: JSON.stringify(body),
  });
}

async function postAction(path: string, body: unknown, cookie: string): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://example.com", cookie },
    body: JSON.stringify(body),
  });
}

function smallPut(name = "brief.pdf"): Record<string, unknown> {
  return { matterId, name, declaredSize: 1024, declaredContentType: "application/pdf" };
}

function largeMultipart(): Record<string, unknown> {
  return {
    matterId,
    name: "deposition.mp4",
    declaredSize: 200 * 1024 * 1024,
    declaredContentType: "video/mp4",
  };
}

async function initiateMultipart(): Promise<{ uploadId: string; key: string }> {
  const response = await postUpload(largeMultipart(), {
    cookie: ownerCookie,
    idempotencyKey: crypto.randomUUID(),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { mode: string; uploadId: string; key: string };
  expect(body.mode).toBe("multipart");
  return { uploadId: body.uploadId, key: body.key };
}

describe("POST /api/v1/uploads — initiate", () => {
  it("mints a single-shot presigned PUT for a small file", async () => {
    const response = await postUpload(smallPut(), {
      cookie: ownerCookie,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, string | Record<string, string>>;
    expect(body["mode"]).toBe("put");
    expect(body["uploadId"]).toMatch(/^uploadSession_/);
    expect(body["fileId"]).toMatch(/^file_/);
    expect(body["versionId"]).toMatch(/^fileVersion_/);
    expect(body["key"]).toContain("files/");
    expect(body["method"]).toBe("PUT");
    expect(body["url"] as string).toMatch(/^https:\/\//);
    expect(body["headers"]).toMatchObject({ "Content-Type": "application/pdf" });
  });

  it("opens a multipart session for a file above the mode threshold", async () => {
    const response = await postUpload(largeMultipart(), {
      cookie: ownerCookie,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body["mode"]).toBe("multipart");
    expect(body["uploadId"]).toMatch(/^uploadSession_/);
    expect(body["key"]).toContain("files/");
    expect(body["url"]).toBeUndefined();
  });

  it("refuses a blocked extension with a 422 upload-not-allowed problem", async () => {
    const response = await postUpload(
      { matterId, name: "malware.exe", declaredSize: 10, declaredContentType: "application/pdf" },
      { cookie: ownerCookie, idempotencyKey: crypto.randomUUID() },
    );
    expect(response.status).toBe(422);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body["type"]).toBe("https://api.magnacarta.esq/problems/upload-not-allowed");
  });

  it("demands an Idempotency-Key (400)", async () => {
    const response = await postUpload(smallPut(), { cookie: ownerCookie });
    expect(response.status).toBe(400);
  });

  it("403s a member without files:upload", async () => {
    await seedCredentialedUser("uploads-readonly@example.com", {
      userName: "No Upload",
      firmId: poolFirmId,
    });
    const { userId } = await seedCredentialedUser("uploads-noperms@example.com", {
      userName: "No Perms",
      firmId: poolFirmId,
    });
    // Mirror as a member with NO role assignment → empty effective permissions.
    await insertMemberStatement(env.DB_FIRM_POOL_1, {
      userId,
      displayName: "No Perms",
      now: "2026-06-13T00:00:00.000Z",
    }).run();
    const cookie = await signInForSessionCookie("uploads-noperms@example.com");
    const response = await postUpload(smallPut(), { cookie, idempotencyKey: crypto.randomUUID() });
    expect(response.status).toBe(403);
    expect(((await response.json()) as Record<string, unknown>)["requestAccess"]).toBe(true);
  });

  it("a lost-race duplicate multipart initiate creates no second R2 multipart upload", async () => {
    // Two concurrent multipart initiates share one Idempotency-Key: only the winner reserves a
    // session and (OUTSIDE the idempotency batch) creates the R2 multipart upload + persists its id;
    // the loser replays the winner's response and creates nothing. The regression guard is that the
    // R2 multipart create never rides the idempotency effect, so a lost race leaves exactly one
    // session carrying exactly one persisted upload id — never a second, orphaned multipart upload.
    const idempotencyKey = crypto.randomUUID();
    const [first, second] = await Promise.all([
      postUpload(largeMultipart(), { cookie: ownerCookie, idempotencyKey }),
      postUpload(largeMultipart(), { cookie: ownerCookie, idempotencyKey }),
    ]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstBody = (await first.json()) as { uploadId: string; versionId: string };
    const secondBody = (await second.json()) as { uploadId: string; versionId: string };
    // Both calls return the SAME session (one reservation; the loser replayed the winner's response).
    expect(secondBody.uploadId).toBe(firstBody.uploadId);

    // Exactly one session for that version, and its r2_upload_id is set exactly once (the winner's).
    const sessions = await env.DB_FIRM_POOL_1.prepare(
      "SELECT COUNT(*) AS n FROM upload_session WHERE file_version_id = ?1 AND r2_upload_id IS NOT NULL",
    )
      .bind(firstBody.versionId)
      .first<{ n: number }>();
    expect(sessions?.n).toBe(1);
  });

  it("mints a key under bulk/ when uploadKind is bulk", async () => {
    const response = await postUpload(
      { ...smallPut("bulk-brief.pdf"), uploadKind: "bulk" },
      { cookie: ownerCookie, idempotencyKey: crypto.randomUUID() },
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body["key"]).toMatch(/^bulk\//);
  });

  it("replays a repeated Idempotency-Key and stores the record in the FIRM database, not the control plane", async () => {
    const idempotencyKey = crypto.randomUUID();
    const first = await postUpload(smallPut("idem.pdf"), { cookie: ownerCookie, idempotencyKey });
    expect(first.status).toBe(201);
    const firstBody = await first.json();

    const second = await postUpload(smallPut("idem.pdf"), { cookie: ownerCookie, idempotencyKey });
    expect(second.status).toBe(201);
    expect(second.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await second.json()).toEqual(firstBody);

    // The record lives in the per-firm idempotency_key table (raw key — the table is physically
    // tenant-isolated), never the shared control-plane table.
    const firmRow = await env.DB_FIRM_POOL_1.prepare(
      "SELECT key FROM idempotency_key WHERE key = ?1",
    )
      .bind(idempotencyKey)
      .first<{ key: string }>();
    expect(firmRow?.key).toBe(idempotencyKey);
    const controlRow = await env.DB_CONTROL.prepare(
      "SELECT key FROM idempotency_key WHERE key = ?1 OR key = ?2",
    )
      .bind(idempotencyKey, `${poolFirmId}:${idempotencyKey}`)
      .first();
    expect(controlRow).toBeNull();
  });
});

describe("GET /api/v1/uploads/{id}/parts/{partNumber} — sign part", () => {
  it("signs a part of an open multipart session", async () => {
    const { uploadId } = await initiateMultipart();
    const response = await SELF.fetch(`https://example.com/api/v1/uploads/${uploadId}/parts/1`, {
      headers: { cookie: ownerCookie },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { url: string };
    expect(body.url).toMatch(/^https:\/\//);
    expect(body.url).toContain("partNumber=1");
  });

  it("409s signing a part of a single-shot (non-multipart) session", async () => {
    const putResponse = await postUpload(smallPut("single.pdf"), {
      cookie: ownerCookie,
      idempotencyKey: crypto.randomUUID(),
    });
    const { uploadId } = (await putResponse.json()) as { uploadId: string };
    const response = await SELF.fetch(`https://example.com/api/v1/uploads/${uploadId}/parts/1`, {
      headers: { cookie: ownerCookie },
    });
    expect(response.status).toBe(409);
  });

  it("404s an unknown session", async () => {
    const response = await SELF.fetch(
      "https://example.com/api/v1/uploads/uploadSession_doesNotExist000000000/parts/1",
      { headers: { cookie: ownerCookie } },
    );
    expect(response.status).toBe(404);
  });
});

describe("POST /api/v1/uploads/{id}/complete", () => {
  it("completes a multipart session with its part manifest", async () => {
    const { uploadId } = await initiateMultipart();
    const response = await postAction(
      `/api/v1/uploads/${uploadId}/complete`,
      { parts: [{ partNumber: 1, etag: "etag-1" }] },
      ownerCookie,
    );
    expect(response.status).toBe(200);
    const status = await env.DB_FIRM_POOL_1.prepare(
      "SELECT status FROM upload_session WHERE id = ?1",
    )
      .bind(uploadId)
      .first<{ status: string }>();
    expect(status?.status).toBe("completed");
  });

  it("409s a multipart completion sent without parts", async () => {
    const { uploadId } = await initiateMultipart();
    const response = await postAction(`/api/v1/uploads/${uploadId}/complete`, {}, ownerCookie);
    expect(response.status).toBe(409);
  });
});

describe("POST /api/v1/uploads/{id}/abort", () => {
  it("aborts an open session and abandons its pending version", async () => {
    const putResponse = await postUpload(smallPut("abortme.pdf"), {
      cookie: ownerCookie,
      idempotencyKey: crypto.randomUUID(),
    });
    const { uploadId, versionId } = (await putResponse.json()) as {
      uploadId: string;
      versionId: string;
    };
    const response = await postAction(`/api/v1/uploads/${uploadId}/abort`, {}, ownerCookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "aborted" });

    const session = await env.DB_FIRM_POOL_1.prepare(
      "SELECT status FROM upload_session WHERE id = ?1",
    )
      .bind(uploadId)
      .first<{ status: string }>();
    expect(session?.status).toBe("aborted");
    const version = await env.DB_FIRM_POOL_1.prepare(
      "SELECT status FROM file_version WHERE id = ?1",
    )
      .bind(versionId)
      .first<{ status: string }>();
    expect(version?.status).toBe("abandoned");
  });

  it("409s aborting an already-aborted session", async () => {
    const putResponse = await postUpload(smallPut("doubleabort.pdf"), {
      cookie: ownerCookie,
      idempotencyKey: crypto.randomUUID(),
    });
    const { uploadId } = (await putResponse.json()) as { uploadId: string };
    expect((await postAction(`/api/v1/uploads/${uploadId}/abort`, {}, ownerCookie)).status).toBe(
      200,
    );
    expect((await postAction(`/api/v1/uploads/${uploadId}/abort`, {}, ownerCookie)).status).toBe(
      409,
    );
  });
});
