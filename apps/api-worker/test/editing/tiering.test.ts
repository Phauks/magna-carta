import { env } from "cloudflare:test";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { beforeAll, describe, expect, it } from "vitest";
import { runTieringSweep } from "../../src/background/editing/tiering-sweep.ts";
import { applyControlPlaneMigrations } from "../support/apply-control-plane-migrations.ts";
import { firmDatabaseHandle } from "../support/firm-database-handle.ts";

// The conservative Standard->Infrequent-Access tiering sweep: only superseded, non-current versions
// past the IA 30-day minimum are tiered; the live/latest version is never touched, the meter shifts
// class in the same batch (object count net-zero — a transfer, not a delete), and nothing is deleted.

const BUCKET = "magna-carta-test-tier-bucket";
const MEMBER = "user_tier";
// A fixed "now" so committed_at cutoffs are deterministic.
const NOW_MS = Date.parse("2026-06-22T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW_MS - n * 24 * 60 * 60 * 1000).toISOString();

let firmDb: ReturnType<typeof firmDatabaseHandle>;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  const firmId = newIdentifier("firm");
  firmDb = firmDatabaseHandle(firmId);
  await env.DB_CONTROL.prepare(
    "INSERT INTO firm (id, name, database_identifier, bucket_name, status, created_at) VALUES (?1, 'Tier Firm', 'DB_FIRM_POOL_1', ?2, 'active', ?3)",
  )
    .bind(firmId, BUCKET, daysAgo(100))
    .run();
  await firmDb
    .prepare(
      "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, 'Tierer', 'active', ?2)",
    )
    .bind(MEMBER, daysAgo(100))
    .run();
});

async function seedVersion(
  fileId: string,
  versionNumber: number,
  storageClass: string,
  committedAt: string,
  sizeBytes: number,
): Promise<string> {
  const versionId = newIdentifier("fileVersion");
  await firmDb
    .prepare(
      "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, content_sha256, storage_class, status, uploaded_by, created_at, committed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'clean', ?8, ?9, ?9)",
    )
    .bind(
      versionId,
      fileId,
      versionNumber,
      `files/${fileId}/${versionId}`,
      sizeBytes,
      `hash-${versionNumber}`,
      storageClass,
      MEMBER,
      committedAt,
    )
    .run();
  await env.R2.put(`files/${fileId}/${versionId}`, new Uint8Array(sizeBytes));
  return versionId;
}

async function storageClassOf(versionId: string): Promise<string | undefined> {
  const row = await firmDb
    .prepare("SELECT storage_class FROM file_version WHERE id = ?1")
    .bind(versionId)
    .first<{ storage_class: string }>();
  return row?.storage_class;
}

async function meterFor(storageClass: string): Promise<{ bytes: number; object_count: number }> {
  const row = await firmDb
    .prepare(
      "SELECT bytes, object_count FROM storage_meter WHERE storage_class = ?1 AND prefix = 'files'",
    )
    .bind(storageClass)
    .first<{ bytes: number; object_count: number }>();
  return { bytes: row?.bytes ?? 0, object_count: row?.object_count ?? 0 };
}

describe("runTieringSweep", () => {
  it("tiers only superseded, non-current versions past the 30-day window; never the live version; meter shifts class in place; nothing deleted", async () => {
    const matterId = newIdentifier("matter");
    await firmDb
      .prepare(
        "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'M', 'open', ?2, ?3, ?3)",
      )
      .bind(matterId, MEMBER, daysAgo(100))
      .run();
    const fileId = newIdentifier("file");
    await firmDb
      .prepare(
        "INSERT INTO file (id, matter_id, name, current_version_id, created_at, updated_at) VALUES (?1, ?2, 'Brief.docx', NULL, ?3, ?3)",
      )
      .bind(fileId, matterId, daysAgo(100))
      .run();

    // v1: old, superseded, standard -> tierable. v2: old but CURRENT -> never. v3: recent, superseded
    // -> inside the window, not yet. v4: old, superseded, but already IA -> nothing to do.
    const v1 = await seedVersion(fileId, 1, "standard", daysAgo(40), 1000);
    const v2 = await seedVersion(fileId, 2, "standard", daysAgo(40), 2000);
    const v3 = await seedVersion(fileId, 3, "standard", daysAgo(5), 3000);
    const v4 = await seedVersion(fileId, 4, "infrequent_access", daysAgo(40), 4000);
    await firmDb
      .prepare("UPDATE file SET current_version_id = ?2 WHERE id = ?1")
      .bind(fileId, v2)
      .run();

    // Seed the authoritative meter to match the four committed versions (3 standard + 1 IA).
    await firmDb
      .prepare(
        "INSERT INTO storage_meter (storage_class, artifact_role, prefix, bytes, object_count) VALUES ('standard', 'original', 'files', 6000, 3), ('infrequent_access', 'original', 'files', 4000, 1)",
      )
      .run();

    const tiered: string[] = [];
    const report = await runTieringSweep(env, {
      now: NOW_MS,
      tierObject: async (_bucket, key) => {
        tiered.push(key);
      },
    });

    expect(report.tiered).toBe(1);
    // Only v1 (old + superseded + standard) is tiered.
    expect(tiered).toEqual([`files/${fileId}/${v1}`]);
    expect(await storageClassOf(v1)).toBe("infrequent_access");
    // The current version, the in-window version, and the already-IA version are untouched.
    expect(await storageClassOf(v2)).toBe("standard");
    expect(await storageClassOf(v3)).toBe("standard");
    expect(await storageClassOf(v4)).toBe("infrequent_access");

    // The meter shifted v1's bytes/count from standard to IA — a transfer, object count net-zero.
    const standard = await meterFor("standard");
    const ia = await meterFor("infrequent_access");
    expect(standard).toEqual({ bytes: 5000, object_count: 2 });
    expect(ia).toEqual({ bytes: 5000, object_count: 2 });

    // Nothing is deleted — v1's object still exists in R2.
    expect(await env.R2.get(`files/${fileId}/${v1}`)).not.toBeNull();
  });
});
