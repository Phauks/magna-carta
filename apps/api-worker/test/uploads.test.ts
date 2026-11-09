import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { insertMemberStatement } from "@magna-carta/data-access/member-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, MatterId } from "@magna-carta/identifiers/types";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
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
  await mirrorMemberWithOwnerRole(owner.userId, "Uploads Owner", poolFirmId);
  ownerCookie = await signInForSessionCookie("uploads-owner@example.com");

  // A matter to upload into (responsible member = the mirrored owner).
  matterId = newIdentifier("matter");
  await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
    .prepare(
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
    // Off production (no real R2 S3 credential set) the presigner reroutes the upload leg to the
    // Worker itself so `wrangler dev` and the test pool run the identical ceremony against a
    // resolvable, same-origin target — the development R2 upload route (routes/developer/dev-r2-upload.ts).
    expect(body["url"] as string).toContain("/api/__dev/r2/object");
    expect(body["headers"]).toMatchObject({ "content-type": "application/pdf" });
  });

  it("answers ONE spelling of each signed header, so the browser sends the value that was signed", async () => {
    // The production defect: the response carried both "Content-Type" and "content-type". A record
    // with two spellings of one header is merged by the browser's Headers into one doubled value
    // ("application/pdf, application/pdf"), which is not the value the signature covers, so R2
    // refused every PUT. Asserted through Headers itself, because that merge is the failure.
    const response = await postUpload(smallPut(), {
      cookie: ownerCookie,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { headers: Record<string, string> };
    const names = Object.keys(body.headers).map((name) => name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    const sent = new Headers(body.headers);
    expect(sent.get("content-type")).toBe("application/pdf");
    // The scope stamp is signed too, so it must be in the set the client is told to send.
    expect(sent.get("x-amz-meta-object_class")).toBe("working-document");
    expect(sent.get("x-amz-meta-matter")).toBe(matterId);
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

  it("404s a new version aimed at a soft-deleted file", async () => {
    const created = await postUpload(smallPut("doomed.pdf"), {
      cookie: ownerCookie,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(created.status).toBe(201);
    const { fileId } = (await created.json()) as { fileId: string };
    await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare("UPDATE file SET deleted_at = ?2 WHERE id = ?1")
      .bind(fileId, "2026-06-13T01:00:00.000Z")
      .run();

    // The file is gone as far as every read is concerned; a new version of it is refused the same
    // way a version of a file that never existed would be.
    const response = await postUpload(
      { ...smallPut("doomed.pdf"), fileId },
      { cookie: ownerCookie, idempotencyKey: crypto.randomUUID() },
    );
    expect(response.status).toBe(404);
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
    await insertMemberStatement(firmDatabaseFor(env.FIRM_DATABASE, poolFirmId), {
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
    const sessionsResult = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare(
        "SELECT COUNT(*) AS n FROM upload_session WHERE file_version_id = ?1 AND r2_upload_id IS NOT NULL",
      )
      .bind(firstBody.versionId)
      .all<{ n: number }>();
    const sessions = sessionsResult.results[0];
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
    const firmRowResult = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare("SELECT key FROM idempotency_key WHERE key = ?1")
      .bind(idempotencyKey)
      .all<{ key: string }>();
    const firmRow = firmRowResult.results[0];
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
    // Same rerouting for a multipart part: the dev presigner points the part PUT at the Worker's
    // development R2 upload route rather than a presigned R2 host.
    expect(body.url).toContain("/api/__dev/r2/part");
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
    // Off production the presigner reroutes the part PUT to the Worker's development R2 upload route,
    // which stages the bytes; the server-side completion then assembles the staged parts into the
    // final object. Stage part 1 through that route first so completion finds bytes to assemble —
    // the identical four-step ceremony a real client runs (sign part -> PUT part -> complete).
    const signResponse = await SELF.fetch(
      `https://example.com/api/v1/uploads/${uploadId}/parts/1`,
      { headers: { cookie: ownerCookie } },
    );
    expect(signResponse.status).toBe(200);
    const { url } = (await signResponse.json()) as { url: string };
    const partResponse = await SELF.fetch(`https://example.com${url}`, {
      method: "PUT",
      headers: { cookie: ownerCookie, origin: "https://example.com" },
      body: new Uint8Array([1, 2, 3, 4]),
    });
    expect(partResponse.status).toBe(200);
    const etag = partResponse.headers.get("etag") ?? '"dev-part"';

    const response = await postAction(
      `/api/v1/uploads/${uploadId}/complete`,
      { parts: [{ partNumber: 1, etag }] },
      ownerCookie,
    );
    expect(response.status).toBe(200);
    const statusResult = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare("SELECT status FROM upload_session WHERE id = ?1")
      .bind(uploadId)
      .all<{ status: string }>();
    const status = statusResult.results[0];
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

    const sessionResult = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare("SELECT status FROM upload_session WHERE id = ?1")
      .bind(uploadId)
      .all<{ status: string }>();
    const session = sessionResult.results[0];
    expect(session?.status).toBe("aborted");
    const versionResult = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare("SELECT status FROM file_version WHERE id = ?1")
      .bind(versionId)
      .all<{ status: string }>();
    const version = versionResult.results[0];
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

// ---- the hash-first path: asking whether the firm already holds the bytes, and duplicating them ----

const HELD_HASH = "a".repeat(64);
const HELD_BYTES = "%PDF-1.4 the same brief every time";

/** A clean file on a matter whose current version holds HELD_BYTES, the object in the R2 binding. */
async function seedHeldFile(onMatterId: MatterId, name: string) {
  const firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, poolFirmId);
  const fileId = newIdentifier("file");
  const versionId = newIdentifier("fileVersion");
  const r2Key = `files/${fileId}/${versionId}`;
  const at = "2026-06-13T00:00:00.000Z";
  await firmDatabase
    .prepare(
      "INSERT INTO file (id, matter_id, folder_id, name, document_type_id, current_version_id, deleted_at, created_at, updated_at) VALUES (?1, ?2, NULL, ?3, NULL, NULL, NULL, ?4, ?4)",
    )
    .bind(fileId, onMatterId, name, at)
    .run();
  await firmDatabase
    .prepare(
      "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, declared_content_type, sniffed_content_type, content_sha256, scan_verdict, scan_engine_version, status, uploaded_by, created_at, committed_at) " +
        "VALUES (?1, ?2, 1, ?3, ?4, 'application/pdf', 'application/pdf', ?5, 'clean', 'engine-9', 'clean', NULL, ?6, ?6)",
    )
    .bind(versionId, fileId, r2Key, HELD_BYTES.length, HELD_HASH, at)
    .run();
  await firmDatabase
    .prepare("UPDATE file SET current_version_id = ?2 WHERE id = ?1")
    .bind(fileId, versionId)
    .run();
  await env.R2.put(r2Key, HELD_BYTES, {
    customMetadata: { matter: onMatterId, object_class: "working-document" },
  });
  return { fileId, versionId, r2Key };
}

describe("POST /api/v1/uploads/matches", () => {
  it("names the file on the matter that already holds the bytes, and the ones elsewhere", async () => {
    const held = await seedHeldFile(matterId, "held brief.pdf");
    const otherMatterId = newIdentifier("matter");
    await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare(
        "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'Other Matter', 'open', (SELECT responsible_member_id FROM matter WHERE id = ?2), ?3, ?3)",
      )
      .bind(otherMatterId, matterId, "2026-06-13T00:00:00.000Z")
      .run();
    const elsewhere = await seedHeldFile(otherMatterId, "held elsewhere.pdf");

    const response = await postAction(
      "/api/v1/uploads/matches",
      { matterId, sha256: HELD_HASH, sizeBytes: HELD_BYTES.length },
      ownerCookie,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      onMatter: { fileId: string; versionId: string; name: string; folderId: string | null }[];
      elsewhere: { fileId: string; versionId: string; matterId: string }[];
    };
    expect(body.onMatter.some((match) => match.fileId === held.fileId)).toBe(true);
    expect(body.onMatter.find((match) => match.fileId === held.fileId)).toMatchObject({
      versionId: held.versionId,
      name: "held brief.pdf",
      folderId: null,
    });
    expect(body.elsewhere.some((match) => match.fileId === elsewhere.fileId)).toBe(true);
    expect(body.elsewhere.find((match) => match.fileId === elsewhere.fileId)?.matterId).toBe(
      otherMatterId,
    );
  });

  it("answers nothing for a size that disagrees with the digest", async () => {
    await seedHeldFile(matterId, "held again.pdf");
    const response = await postAction(
      "/api/v1/uploads/matches",
      { matterId, sha256: HELD_HASH, sizeBytes: 1 },
      ownerCookie,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { onMatter: unknown[]; elsewhere: unknown[] };
    expect(body.onMatter).toEqual([]);
    expect(body.elsewhere).toEqual([]);
  });
});

describe("POST /api/v1/uploads/duplicates", () => {
  it("makes a committed file from held bytes with no upload, copying the object under the new key", async () => {
    const otherMatterId = newIdentifier("matter");
    await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare(
        "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'Source Matter', 'open', (SELECT responsible_member_id FROM matter WHERE id = ?2), ?3, ?3)",
      )
      .bind(otherMatterId, matterId, "2026-06-13T00:00:00.000Z")
      .run();
    const source = await seedHeldFile(otherMatterId, "source.pdf");

    const response = await SELF.fetch("https://example.com/api/v1/uploads/duplicates", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://example.com",
        cookie: ownerCookie,
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        sourceVersionId: source.versionId,
        matterId,
        folderId: null,
        name: "duplicated.pdf",
        sourceModifiedAt: "2025-03-04T09:30:00.000Z",
        createdAtBasis: "source",
      }),
    });
    expect(response.status).toBe(201);
    const made = (await response.json()) as { fileId: string; versionId: string };
    expect(made.fileId).toMatch(/^file_/);

    const read = await SELF.fetch(`https://example.com/api/v1/files/${made.fileId}`, {
      headers: { origin: "https://example.com", cookie: ownerCookie },
    });
    expect(read.status).toBe(200);
    const summary = (await read.json()) as Record<string, unknown>;
    expect(summary).toMatchObject({
      matterId,
      name: "duplicated.pdf",
      status: "clean",
      sizeBytes: HELD_BYTES.length,
      scanVerdict: "clean",
      createdAt: "2025-03-04T09:30:00.000Z",
    });

    const copied = await env.R2.get(`files/${made.fileId}/${made.versionId}`);
    expect(copied).not.toBeNull();
    expect(await copied?.text()).toBe(HELD_BYTES);
    // Stamped for the matter it now belongs to, not the one it came from.
    expect(copied?.customMetadata).toMatchObject({ matter: matterId });
  });

  it("404s a version that is not committed, and demands an Idempotency-Key", async () => {
    const missing = await SELF.fetch("https://example.com/api/v1/uploads/duplicates", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://example.com",
        cookie: ownerCookie,
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        sourceVersionId: newIdentifier("fileVersion"),
        matterId,
        name: "x.pdf",
      }),
    });
    expect(missing.status).toBe(404);

    const bare = await postAction(
      "/api/v1/uploads/duplicates",
      { sourceVersionId: newIdentifier("fileVersion"), matterId, name: "x.pdf" },
      ownerCookie,
    );
    expect(bare.status).toBe(400);
  });
});
