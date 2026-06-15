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

// A clean committed version backing an R2 object: only these keys count toward the firm's meter.
// Reconciliation filters the R2 LIST against this set, so an object with no clean version row (orphan,
// quarantined, or another firm's) is ignored rather than driven into the meter.
async function seedCleanVersion(r2Key: string, sizeBytes: number): Promise<void> {
  const matterId = newIdentifier("matter");
  const fileId = newIdentifier("file");
  const versionId = newIdentifier("fileVersion");
  const now = new Date().toISOString();
  await env.DB_FIRM_POOL_1.prepare(
    "INSERT INTO member (user_id, display_name, status, created_at) VALUES ('user_recon', 'Recon', 'active', ?1) ON CONFLICT (user_id) DO NOTHING",
  )
    .bind(now)
    .run();
  await env.DB_FIRM_POOL_1.prepare(
    "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'Recon Matter', 'open', 'user_recon', ?2, ?2)",
  )
    .bind(matterId, now)
    .run();
  await env.DB_FIRM_POOL_1.prepare(
    "INSERT INTO file (id, matter_id, name, created_at, updated_at) VALUES (?1, ?2, 'doc.pdf', ?3, ?3)",
  )
    .bind(fileId, matterId, now)
    .run();
  await env.DB_FIRM_POOL_1.prepare(
    "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, status, scan_verdict, storage_class, uploaded_by, created_at, committed_at) VALUES (?1, ?2, 1, ?3, ?4, 'clean', 'unscanned', 'standard', 'user_recon', ?5, ?5)",
  )
    .bind(versionId, fileId, r2Key, sizeBytes, now)
    .run();
  await env.DB_FIRM_POOL_1.prepare("UPDATE file SET current_version_id = ?2 WHERE id = ?1")
    .bind(fileId, versionId)
    .run();
}

async function readFilesMeter(): Promise<{ bytes: number; object_count: number } | null> {
  return env.DB_FIRM_POOL_1.prepare(
    "SELECT bytes, object_count FROM storage_meter WHERE storage_class = 'standard' AND prefix = 'files'",
  ).first<{ bytes: number; object_count: number }>();
}

describe("runStorageReconciliation", () => {
  it("corrects a skewed meter to a clean version's R2 object", async () => {
    // A clean version + its real 100-byte object, with a meter that overstates storage.
    const r2Key = "files/recon-clean/v1";
    await seedCleanVersion(r2Key, 100);
    await env.R2.put(r2Key, new Uint8Array(100));
    await env.DB_FIRM_POOL_1.prepare(
      "INSERT INTO storage_meter (storage_class, artifact_role, prefix, bytes, object_count) VALUES ('standard', 'original', 'files', 999, 5) ON CONFLICT (storage_class, artifact_role, prefix) DO UPDATE SET bytes = 999, object_count = 5",
    ).run();

    const report = await runStorageReconciliation(env);
    expect(report.firmsReconciled).toBeGreaterThanOrEqual(1);
    expect(report.corrections).toBeGreaterThanOrEqual(1);

    const meter = await readFilesMeter();
    expect(meter?.bytes).toBe(100);
    expect(meter?.object_count).toBe(1);
  });

  it("ignores an orphan/quarantined R2 object with no clean version row (meter unchanged)", async () => {
    // The meter already matches the one clean object from the prior test (100 bytes, one object).
    const before = await readFilesMeter();
    // An R2 object with NO backing clean version — a quarantined/abandoned leftover. It must not be
    // counted: reconciliation only considers objects whose key is in the firm's clean set.
    await env.R2.put("files/orphan-no-clean-version/v1", new Uint8Array(7777));

    await runStorageReconciliation(env);

    const after = await readFilesMeter();
    expect(after?.bytes).toBe(before?.bytes);
    expect(after?.object_count).toBe(before?.object_count);
  });

  it("ignores an R2 object whose key is not in this firm's clean set (cross-firm contamination)", async () => {
    const before = await readFilesMeter();
    // An object under files/ that belongs to ANOTHER firm (the single bound R2 is shared in the dev
    // pool) — its key is in no clean version row of THIS firm, so it must not inflate this meter.
    await env.R2.put("files/other-firms-file/v1", new Uint8Array(123456));

    await runStorageReconciliation(env);

    const after = await readFilesMeter();
    expect(after?.bytes).toBe(before?.bytes);
    expect(after?.object_count).toBe(before?.object_count);
  });
});
