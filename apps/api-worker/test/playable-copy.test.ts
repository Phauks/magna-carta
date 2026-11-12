import { env, SELF } from "cloudflare:test";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  FileId,
  FileVersionId,
  FirmId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import type { Bindings } from "../src/bindings.ts";
import { producePlayableCopy } from "../src/background/conversions/playable-copy-consumer.ts";
import type { PlayableCopyMessage } from "../src/conversions/conversion-types.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// A copy of a video every browser plays: the request and status routes over the real bindings, and
// the producer that streams the original through the transcode engine and back into the bucket. The
// engine cannot run under the local pool, so the producer is handed a fake convert worker that
// answers the way the engine's HTTP surface does.

let firmId: FirmId;
let matterId: MatterId;
let ownerCookie: string;
let ownerUserId: UserId;

const ISO = "2026-11-12T00:00:00.000Z";
const ORIGINAL = new TextEncoder().encode("a QuickTime recording the browser refused");
const CONVERTED = new TextEncoder().encode("an MP4 every browser plays");

async function seedVideo(
  sniffedContentType: string,
): Promise<{ fileId: FileId; versionId: FileVersionId; r2Key: string }> {
  const firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);
  const fileId = newIdentifier("file");
  const versionId = newIdentifier("fileVersion");
  const r2Key = `files/${fileId}/${versionId}`;
  await firmDatabase
    .prepare(
      "INSERT INTO file (id, matter_id, folder_id, name, document_type_id, current_version_id, deleted_at, created_at, updated_at) VALUES (?1, ?2, NULL, 'deposition.mov', NULL, NULL, NULL, ?3, ?3)",
    )
    .bind(fileId, matterId, ISO)
    .run();
  await firmDatabase
    .prepare(
      "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, sniffed_content_type, content_sha256, status, uploaded_by, created_at, committed_at, inline_playable) " +
        "VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6, 'clean', ?7, ?8, ?8, 'playable')",
    )
    .bind(
      versionId,
      fileId,
      r2Key,
      ORIGINAL.byteLength,
      sniffedContentType,
      `hash-${versionId}`,
      ownerUserId,
      ISO,
    )
    .run();
  await firmDatabase
    .prepare("UPDATE file SET current_version_id = ?2 WHERE id = ?1")
    .bind(fileId, versionId)
    .run();
  await env.R2.put(r2Key, ORIGINAL);
  return { fileId, versionId, r2Key };
}

async function row(versionId: FileVersionId) {
  const { results } = await firmDatabaseFor(env.FIRM_DATABASE, firmId)
    .prepare(
      "SELECT playable_copy_state, playable_copy_r2_key, playable_copy_size_bytes, playable_copy_reason, playable_copy_requested_at FROM file_version WHERE id = ?1",
    )
    .bind(versionId)
    .all<{
      playable_copy_state: string | null;
      playable_copy_r2_key: string | null;
      playable_copy_size_bytes: number | null;
      playable_copy_reason: string | null;
      playable_copy_requested_at: string | null;
    }>();
  return results[0];
}

function call(fileId: FileId, method: "GET" | "POST"): Promise<Response> {
  return SELF.fetch(`https://example.com/api/v1/files/${fileId}/playable-copy`, {
    method,
    headers: { cookie: ownerCookie, origin: "https://example.com" },
  });
}

interface SeenRequest {
  readonly headers: Record<string, string>;
  readonly body: string;
}

function fakeEngine(answer: () => Response): { convert: Fetcher; seen: SeenRequest[] } {
  const seen: SeenRequest[] = [];
  const convert = {
    async fetch(input: Request | string, init?: RequestInit): Promise<Response> {
      const request = input instanceof Request ? input : new Request(input, init);
      seen.push({
        headers: Object.fromEntries(request.headers.entries()),
        body: await request.text(),
      });
      return answer();
    },
  } as unknown as Fetcher;
  return { convert, seen };
}

function produce(versionId: FileVersionId, convert: Fetcher) {
  const message: PlayableCopyMessage = {
    kind: "playable-copy",
    firmId,
    bucketName: "R2",
    versionId,
  };
  return producePlayableCopy(
    { ...env, CONVERT: convert } as unknown as Bindings,
    firmDatabaseFor(env.FIRM_DATABASE, firmId),
    message,
    () => new Date().toISOString(),
  );
}

async function markPending(versionId: FileVersionId): Promise<void> {
  await firmDatabaseFor(env.FIRM_DATABASE, firmId)
    .prepare(
      "UPDATE file_version SET playable_copy_state = 'pending', playable_copy_requested_at = ?2 WHERE id = ?1",
    )
    .bind(versionId, new Date().toISOString())
    .run();
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Playable Copy Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(firmId)
    .run();
  const owner = await seedCredentialedUser("playable-copy-owner@example.com", {
    userName: "Playable Owner",
    firmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Playable Owner", firmId);
  ownerCookie = await signInForSessionCookie("playable-copy-owner@example.com");
  matterId = newIdentifier("matter");
  await firmDatabaseFor(env.FIRM_DATABASE, firmId)
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'Playable Matter', 'open', ?2, ?3, ?3)",
    )
    .bind(matterId, owner.userId, ISO)
    .run();
});

describe("the playable copy routes", () => {
  it("reports none, accepts a request for a version already judged playable, and does not start twice", async () => {
    const { fileId, versionId } = await seedVideo("video/quicktime");

    const before = await call(fileId, "GET");
    expect(before.status).toBe(200);
    expect(await before.json()).toMatchObject({ versionId, state: "none", streamUrl: null });

    const asked = await call(fileId, "POST");
    expect(asked.status).toBe(202);
    expect(await asked.json()).toMatchObject({ state: "pending" });
    const requestedAt = (await row(versionId))?.playable_copy_requested_at;
    expect(requestedAt).not.toBeNull();

    const again = await call(fileId, "POST");
    expect(again.status).toBe(202);
    expect((await row(versionId))?.playable_copy_requested_at).toBe(requestedAt);
  });

  it("refuses a file the converter cannot read with 422", async () => {
    const { fileId } = await seedVideo("video/webm");
    const response = await call(fileId, "POST");
    expect(response.status).toBe(422);
    expect(((await response.json()) as { type: string }).type).toContain(
      "playable-copy-not-a-candidate",
    );
  });

  it("answers 404 for a file that does not exist", async () => {
    const response = await call(newIdentifier("file"), "GET");
    expect(response.status).toBe(404);
  });
});

describe("the playable copy producer", () => {
  it("streams the original to the engine, writes the copy beside it, stamps it and records it", async () => {
    const { fileId, versionId, r2Key } = await seedVideo("video/x-matroska");
    await markPending(versionId);
    const engine = fakeEngine(
      () =>
        new Response(CONVERTED, {
          status: 200,
          headers: {
            "content-type": "video/mp4",
            "content-length": String(CONVERTED.byteLength),
          },
        }),
    );

    const outcome = await produce(versionId, engine.convert);

    expect(outcome).toEqual({
      kind: "ready",
      r2Key: `${r2Key}.playable.mp4`,
      sizeBytes: CONVERTED.byteLength,
    });
    expect(engine.seen[0]?.headers).toMatchObject({
      "x-engine-id": "transcode",
      "x-source-format": "mkv",
      "x-target-format": "playable-mp4",
      "x-recipe": "mp4-h264-aac-faststart",
    });
    expect(engine.seen[0]?.body).toBe(new TextDecoder().decode(ORIGINAL));
    const copy = await env.R2.get(`${r2Key}.playable.mp4`);
    expect(await copy?.text()).toBe(new TextDecoder().decode(CONVERTED));
    expect(copy?.customMetadata?.object_class).toBe("playable-copy");
    expect(copy?.customMetadata?.matter).toBe(matterId);
    expect(await row(versionId)).toMatchObject({
      playable_copy_state: "ready",
      playable_copy_r2_key: `${r2Key}.playable.mp4`,
      playable_copy_size_bytes: CONVERTED.byteLength,
    });

    // The status route now reports it ready; a request hands it out rather than remaking it.
    const status = await call(fileId, "GET");
    expect(await status.json()).toMatchObject({ state: "ready", sizeBytes: CONVERTED.byteLength });
    const asked = await call(fileId, "POST");
    expect(asked.status).toBe(200);
  });

  it("records the engine's refusal as unavailable, with its reason", async () => {
    const { fileId, versionId } = await seedVideo("video/mp4");
    await markPending(versionId);
    const engine = fakeEngine(() => new Response("AC-3 sound", { status: 415 }));

    expect(await produce(versionId, engine.convert)).toEqual({
      kind: "unavailable",
      reason: "unsupported",
    });
    expect(await row(versionId)).toMatchObject({
      playable_copy_state: "unavailable",
      playable_copy_reason: "unsupported",
    });
    const status = await call(fileId, "POST");
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ state: "unavailable", reason: "unsupported" });
  });

  it("throws on an engine fault so the queue retries, and leaves the request pending", async () => {
    const { versionId } = await seedVideo("video/mp4");
    await markPending(versionId);
    const engine = fakeEngine(() => new Response("engine unbound", { status: 503 }));

    await expect(produce(versionId, engine.convert)).rejects.toThrow("503");
    expect((await row(versionId))?.playable_copy_state).toBe("pending");
  });

  it("does nothing for a version nobody asked about", async () => {
    const { versionId } = await seedVideo("video/mp4");
    const engine = fakeEngine(() => new Response(null, { status: 500 }));
    expect(await produce(versionId, engine.convert)).toEqual({ kind: "skipped" });
    expect(engine.seen).toHaveLength(0);
  });
});
