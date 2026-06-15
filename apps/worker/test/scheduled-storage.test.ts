import { env } from "cloudflare:test";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import {
  listReachableActiveFirms,
  runStorageReconciliation,
  sweepStalePendingUploads,
} from "../src/scheduled.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { applyPerFirmMigrations } from "./support/apply-per-firm-migrations.ts";
import { seedFirm } from "./support/test-auth.ts";

// The slice 1·1 storage Crons: the */5 stale-pending upload sweep (an abandoned open session past its
// expiry is expired and its pending version abandoned) and the daily metering reconciliation (an R2
// LIST corrects a drifted storage_meter). Driven over real Miniflare bindings.

let poolFirmId: FirmId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  await applyPerFirmMigrations(env.DB_FIRM_POOL_1);
  poolFirmId = (await seedFirm({ name: "Storage Cron Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(poolFirmId)
    .run();
});

async function seedPendingSession(
  expiresAt: string,
): Promise<{ sessionId: string; versionId: string }> {
  const matterId = newIdentifier("matter");
  const fileId = newIdentifier("file");
  const versionId = newIdentifier("fileVersion");
  const sessionId = newIdentifier("uploadSession");
  const now = new Date().toISOString();
  await env.DB_FIRM_POOL_1.prepare(
    "INSERT INTO member (user_id, display_name, status, created_at) VALUES ('user_x', 'Sweeper', 'active', ?1) ON CONFLICT (user_id) DO NOTHING",
  )
    .bind(now)
    .run();
  await env.DB_FIRM_POOL_1.prepare(
    "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'Sweep Matter', 'open', 'user_x', ?2, ?2)",
  )
    .bind(matterId, now)
    .run();
  await env.DB_FIRM_POOL_1.prepare(
    "INSERT INTO file (id, matter_id, name, created_at, updated_at) VALUES (?1, ?2, 'brief.pdf', ?3, ?3)",
  )
    .bind(fileId, matterId, now)
    .run();
  await env.DB_FIRM_POOL_1.prepare(
    "INSERT INTO file_version (id, file_id, version_number, r2_key, status, uploaded_by, created_at) VALUES (?1, ?2, 1, ?3, 'pending', 'user_x', ?4)",
  )
    .bind(versionId, fileId, `files/${fileId}/${versionId}`, now)
    .run();
  await env.DB_FIRM_POOL_1.prepare(
    "INSERT INTO upload_session (id, file_version_id, mode, declared_size, declared_content_type, status, created_at, expires_at) VALUES (?1, ?2, 'put', 1024, 'application/pdf', 'open', ?3, ?4)",
  )
    .bind(sessionId, versionId, now, expiresAt)
    .run();
  return { sessionId, versionId };
}

describe("sweepStalePendingUploads", () => {
  it("expires an open session past its expiry and abandons its pending version", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const { sessionId, versionId } = await seedPendingSession(past);
    const [firm] = await listReachableActiveFirms(env);
    expect(firm).toBeDefined();

    const swept = await sweepStalePendingUploads(env, firm!);
    expect(swept).toBeGreaterThanOrEqual(1);

    const session = await env.DB_FIRM_POOL_1.prepare(
      "SELECT status FROM upload_session WHERE id = ?1",
    )
      .bind(sessionId)
      .first<{ status: string }>();
    expect(session?.status).toBe("expired");
    const version = await env.DB_FIRM_POOL_1.prepare(
      "SELECT status FROM file_version WHERE id = ?1",
    )
      .bind(versionId)
      .first<{ status: string }>();
    expect(version?.status).toBe("abandoned");
  });

  it("leaves a not-yet-expired open session untouched", async () => {
    const future = new Date(Date.now() + 60 * 60_000).toISOString();
    const { sessionId } = await seedPendingSession(future);
    const [firm] = await listReachableActiveFirms(env);
    await sweepStalePendingUploads(env, firm!);
    const session = await env.DB_FIRM_POOL_1.prepare(
      "SELECT status FROM upload_session WHERE id = ?1",
    )
      .bind(sessionId)
      .first<{ status: string }>();
    expect(session?.status).toBe("open");
  });
});

describe("runStorageReconciliation", () => {
  it("corrects a meter row that drifted from the real R2 objects", async () => {
    // Seed a meter that overstates storage, and one real 100-byte object under files/.
    await env.DB_FIRM_POOL_1.prepare(
      "INSERT INTO storage_meter (storage_class, artifact_role, prefix, bytes, object_count) VALUES ('standard', 'original', 'files', 999, 1) ON CONFLICT (storage_class, artifact_role, prefix) DO UPDATE SET bytes = 999, object_count = 1",
    ).run();
    await env.R2.put("files/reconcile-test/v1", new Uint8Array(100));
    const listed = await env.R2.list({ prefix: "files/" });
    expect(listed.objects.length).toBeGreaterThanOrEqual(1);

    const report = await runStorageReconciliation(env);
    expect(report.firmsReconciled).toBeGreaterThanOrEqual(1);
    expect(report.corrections).toBeGreaterThanOrEqual(1);

    // The meter now matches the real object (100 bytes, one object).
    const meter = await env.DB_FIRM_POOL_1.prepare(
      "SELECT bytes, object_count FROM storage_meter WHERE storage_class = 'standard' AND prefix = 'files'",
    ).first<{ bytes: number; object_count: number }>();
    expect(meter?.bytes).toBe(100);
    expect(meter?.object_count).toBe(1);
  });
});
