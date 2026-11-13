import { env, runInDurableObject, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId } from "@magna-carta/identifiers/types";
import { createApp } from "../src/http/app.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import type { SearchIndexJob } from "../src/search/index-coordinator.ts";
import { searchIndexJobName } from "../src/search/index-types.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The firm's search settings over their route: file indexing is off for a fresh firm, the seeded
// Admin role alone may read or change it, a change is one idempotent batch with its audit row, and
// turning it on starts reading the files the firm already holds.

let poolFirmId: FirmId;
let ownerUserId: string;
let ownerCookie: string;

const ROUTE = "https://example.com/api/v1/firm/search-settings";
const NOW = "2026-06-22T12:00:00.000Z";

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  // The FirmDatabase Durable Object self-migrates the full per-firm lineage (including the seed
  // that grants Admin firm:manageSearchSettings) on first access.
  poolFirmId = (
    await seedFirm({ name: "Search Settings Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
  const { userId } = await seedCredentialedUser("search-settings-owner@example.com", {
    userName: "Search Settings Owner",
    firmId: poolFirmId,
  });
  ownerUserId = userId;
  await mirrorMemberWithOwnerRole(userId, "Search Settings Owner", poolFirmId);
  ownerCookie = await signInForSessionCookie("search-settings-owner@example.com");
});

function database() {
  return firmDatabaseFor(env.FIRM_DATABASE, poolFirmId);
}

async function countAudits(): Promise<number> {
  return (
    (
      await database()
        .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'firm.search_settings_updated'")
        .first<{ n: number }>()
    )?.n ?? 0
  );
}

function patchInit(body: unknown, key: string = crypto.randomUUID()): RequestInit {
  return {
    method: "PATCH",
    headers: {
      cookie: ownerCookie,
      "content-type": "application/json",
      origin: "https://example.com",
      "Idempotency-Key": key,
    },
    body: JSON.stringify(body),
  };
}

const patch = (body: unknown, key?: string) => SELF.fetch(ROUTE, patchInit(body, key));

// A committed, clean, current version of a file on a matter: exactly what the index is owed.
async function seedCommittedDocument(name: string): Promise<string> {
  const matterId = newIdentifier("matter");
  await database()
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'Search Settings Matter', 'open', ?2, ?3, ?3)",
    )
    .bind(matterId, ownerUserId, NOW)
    .run();
  const fileId = newIdentifier("file");
  const versionId = newIdentifier("fileVersion");
  await database()
    .prepare(
      "INSERT INTO file (id, matter_id, name, current_version_id, created_at, updated_at, deleted_at) VALUES (?1, ?2, ?3, NULL, ?4, ?4, NULL)",
    )
    .bind(fileId, matterId, name, NOW)
    .run();
  await database()
    .prepare(
      "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, content_sha256, storage_class, status, uploaded_by, created_at, committed_at, sniffed_content_type) VALUES (?1, ?2, 1, ?3, 100, ?4, 'standard', 'clean', ?5, ?6, ?6, 'application/pdf')",
    )
    .bind(versionId, fileId, `files/${fileId}/${versionId}`, `hash-${fileId}`, ownerUserId, NOW)
    .run();
  await database()
    .prepare("UPDATE file SET current_version_id = ?2 WHERE id = ?1")
    .bind(fileId, versionId)
    .run();
  return fileId;
}

// A job that was never started reports the unknown-job sentinel. Asked this way, and never by
// status, because the index consumer is live under the test pool and gives the job its own verdict
// about a second after it is enqueued.
async function wasEnqueued(fileId: string): Promise<boolean> {
  const stub = env.SEARCH_INDEX_JOB.get(
    env.SEARCH_INDEX_JOB.idFromName(searchIndexJobName(poolFirmId, fileId, 1)),
  );
  const state = await runInDurableObject(stub, (instance: SearchIndexJob) => instance.status());
  return state.reason !== "unknown job";
}

describe("GET /api/v1/firm/search-settings", () => {
  it("reads file indexing as off for a fresh firm, on a deployment that binds the search service", async () => {
    // The deployment binds the search service and so does the test pool (a stub with no engine
    // behind it), so connected is what a firm reads.
    const response = await SELF.fetch(ROUTE, { headers: { cookie: ownerCookie } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      fileContentsIndexed: false,
      searchServiceConnected: true,
    });
  });

  it("says the search service is not connected on a deployment that binds none", async () => {
    // A deployment without the binding is handed in through the request's own environment.
    const response = await createApp().request(
      ROUTE,
      { headers: { cookie: ownerCookie } },
      { ...env, SEARCH_SERVICE: undefined },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      fileContentsIndexed: false,
      searchServiceConnected: false,
    });
  });

  it("returns 403 for an authenticated member without firm:manageSearchSettings", async () => {
    // In the control-plane firm but not mirrored into the firm database: the chokepoint resolves
    // the firm and finds no permissions, which is a refusal rather than a missing firm.
    await seedCredentialedUser("search-settings-noperm@example.com", {
      userName: "No Perm",
      firmId: poolFirmId,
    });
    const cookie = await signInForSessionCookie("search-settings-noperm@example.com");
    const response = await SELF.fetch(ROUTE, { headers: { cookie } });
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });
});

describe("PATCH /api/v1/firm/search-settings", () => {
  it("an empty PATCH body writes no audit row and returns the settings as they stand", async () => {
    const before = await countAudits();
    const response = await patch({});
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      fileContentsIndexed: false,
      searchServiceConnected: true,
    });
    expect(await countAudits()).toBe(before);
  });

  it("returns 422 for a value the setting does not carry", async () => {
    const response = await patch({ fileContentsIndexed: "sometimes" });
    expect(response.status).toBe(422);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  it("turning indexing on is read back, audited once, and starts on the files already held", async () => {
    const fileId = await seedCommittedDocument("Lease Agreement.pdf");
    expect(await wasEnqueued(fileId)).toBe(false);

    const key = crypto.randomUUID();
    const before = await countAudits();
    const first = await patch({ fileContentsIndexed: true }, key);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      fileContentsIndexed: true,
      searchServiceConnected: true,
    });

    // The same key again is the same answer and no second decision in the log.
    const second = await patch({ fileContentsIndexed: true }, key);
    expect(second.status).toBe(200);
    expect(second.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await second.json()).toEqual({
      fileContentsIndexed: true,
      searchServiceConnected: true,
    });
    expect((await countAudits()) - before).toBe(1);

    const read = await SELF.fetch(ROUTE, { headers: { cookie: ownerCookie } });
    expect(await read.json()).toEqual({
      fileContentsIndexed: true,
      searchServiceConnected: true,
    });

    // The file the firm already held is handed to the index without waiting for the daily pass.
    await vi.waitFor(async () => expect(await wasEnqueued(fileId)).toBe(true), {
      timeout: 20_000,
      interval: 50,
    });
  });

  it("turning indexing off is read back, and a file that arrives afterwards is left alone", async () => {
    const response = await patch({ fileContentsIndexed: false });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      fileContentsIndexed: false,
      searchServiceConnected: true,
    });

    const fileId = await seedCommittedDocument("Deposition Transcript.pdf");
    // Off to off changes nothing and starts nothing.
    expect((await patch({ fileContentsIndexed: false })).status).toBe(200);
    expect(await wasEnqueued(fileId)).toBe(false);
  });
});
