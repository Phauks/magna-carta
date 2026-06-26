import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { FileId, FileVersionId, FolderId, MatterId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  commitVersion,
  initiateUpload,
  moveFile,
  quarantineVersion,
  recordRescanVerdict,
  softDeleteFile,
} from "../src/file-service.ts";
import { createFolder } from "../src/folder-service.ts";
import { listFiles, loadCommittedVersionByR2Key } from "../src/queries.ts";
import { lookupScanCache } from "../src/scan-cache.ts";
import { readScanEngineVersion } from "../src/upload-policy.ts";
import { ACTOR, freshDatabase, now, options, seedMatter } from "./support.ts";

// A second matter (id + responsible member) alongside seedMatter's matter_a, for cross-matter guards.
async function seedSecondMatter(database: ReturnType<typeof freshDatabase>): Promise<MatterId> {
  const matterId = "matter_b" as MatterId;
  await database
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'M2', 'open', 'user_a', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
    )
    .bind(matterId)
    .run();
  return matterId;
}

const pdf = { name: "brief.pdf", declaredSize: 1024, declaredContentType: "application/pdf" };

async function initiate(database: ReturnType<typeof freshDatabase>, matterId: string, extra = {}) {
  const result = await initiateUpload(
    database,
    {
      matterId: matterId as never,
      name: pdf.name,
      declaredSize: pdf.declaredSize,
      declaredContentType: pdf.declaredContentType,
      uploadedBy: ACTOR,
      mode: "put",
      ...extra,
    },
    options,
  );
  await commitEffectBatch(database, result.effect, { now });
  return result;
}

async function commit(
  database: ReturnType<typeof freshDatabase>,
  versionId: FileVersionId,
  hash: string,
) {
  const result = await commitVersion(
    database,
    {
      versionId,
      sizeBytes: 1024,
      sniffedContentType: "application/pdf",
      contentSha256: hash,
      scanVerdict: "unscanned",
      scanEngineVersion: null,
      scanDetail: null,
      now: now(),
    },
    options,
  );
  await commitEffectBatch(database, result.effect, { now });
  return result;
}

describe("initiateUpload", () => {
  it("creates a pending file that is invisible until a version commits", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { fileId } = await initiate(database, matterId);
    // Pending: not in the file list.
    expect((await listFiles(database, { matterId })).data).toHaveLength(0);
    void (fileId satisfies FileId);
  });

  it("refuses a blocked extension and an oversize upload by policy", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    await expect(
      initiateUpload(
        database,
        {
          matterId,
          name: "malware.exe",
          declaredSize: 10,
          declaredContentType: "application/octet-stream",
          uploadedBy: ACTOR,
          mode: "put",
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "upload-policy-type" });
    await expect(
      initiateUpload(
        database,
        {
          matterId,
          name: "huge.pdf",
          declaredSize: 999 * 1024 * 1024 * 1024,
          declaredContentType: "application/pdf",
          uploadedBy: ACTOR,
          mode: "put",
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "upload-policy-size" });
  });
});

describe("commitVersion", () => {
  it("flips the file to visible and meters its bytes", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { fileId, versionId } = await initiate(database, matterId);
    const result = await commit(database, versionId, "hash-a");
    expect(result.skipped).toBe(false);
    const { data } = await listFiles(database, { matterId });
    expect(data.map((row) => row.id)).toEqual([fileId]);
    const meter = await database
      .prepare("SELECT bytes, object_count FROM storage_meter WHERE prefix = 'files'")
      .all<{ bytes: number; object_count: number }>();
    expect(meter.results[0]).toEqual({ bytes: 1024, object_count: 1 });
  });

  it("skips a no-op re-upload of identical bytes (no new version cut)", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { fileId, versionId } = await initiate(database, matterId);
    await commit(database, versionId, "hash-a");
    // A second version on the same file with the SAME hash.
    const second = await initiate(database, matterId, { fileId });
    const result = await commit(database, second.versionId, "hash-a");
    expect(result.skipped).toBe(true);
    const versions = await database
      .prepare("SELECT status FROM file_version WHERE file_id = ?1 ORDER BY version_number")
      .bind(fileId)
      .all<{ status: string }>();
    expect(versions.results.map((row) => row.status)).toEqual(["clean", "abandoned"]);
  });

  it("refuses to commit a version that is not pending", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { versionId } = await initiate(database, matterId);
    await commit(database, versionId, "hash-a");
    await expect(commit(database, versionId, "hash-b")).rejects.toMatchObject({
      code: "version-not-pending",
    });
  });
});

describe("quarantineVersion", () => {
  it("quarantines a pending version, keeping the file invisible", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { versionId } = await initiate(database, matterId);
    const result = await quarantineVersion(
      database,
      { versionId, reason: "scan-flagged", scanDetail: null },
      options,
    );
    await commitEffectBatch(database, result.effect, { now });
    expect((await listFiles(database, { matterId })).data).toHaveLength(0);
    const row = await database
      .prepare("SELECT status FROM file_version WHERE id = ?1")
      .bind(versionId)
      .all<{ status: string }>();
    expect(row.results[0]?.status).toBe("quarantined");
  });
});

describe("commitVersion — scan_detail persistence", () => {
  it("persists scan_detail on commit", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { versionId } = await initiate(database, matterId);
    const result = await commitVersion(
      database,
      {
        versionId,
        sizeBytes: 4,
        sniffedContentType: "application/pdf",
        contentSha256: "ab",
        scanVerdict: "unscanned",
        scanEngineVersion: null,
        scanDetail: "encrypted",
        now: now(),
      },
      options,
    );
    await commitEffectBatch(database, result.effect, { now });
    const rows = await database
      .prepare("SELECT scan_detail FROM file_version WHERE id = ?1")
      .bind(versionId)
      .all<{ scan_detail: string | null }>();
    expect(rows.results[0]?.scan_detail).toBe("encrypted");
  });

  it("persists scan_detail on quarantine", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { versionId } = await initiate(database, matterId);
    const result = await quarantineVersion(
      database,
      { versionId, reason: "scan-flagged", scanDetail: "trojan detected" },
      options,
    );
    await commitEffectBatch(database, result.effect, { now });
    const rows = await database
      .prepare("SELECT scan_detail FROM file_version WHERE id = ?1")
      .bind(versionId)
      .all<{ scan_detail: string | null }>();
    expect(rows.results[0]?.scan_detail).toBe("trojan detected");
  });
});

describe("commitVersion — current scan engine version stamp", () => {
  it("stamps the firm's current scan engine version on a clean commit from a real engine", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    expect(await readScanEngineVersion(database)).toBeNull();
    const { versionId } = await initiate(database, matterId);
    const result = await commitVersion(
      database,
      {
        versionId,
        sizeBytes: 1024,
        sniffedContentType: "application/pdf",
        contentSha256: "hash-clean",
        scanVerdict: "clean",
        scanEngineVersion: "clamav/1.0+heuristics/1",
        scanDetail: null,
        now: now(),
      },
      options,
    );
    await commitEffectBatch(database, result.effect, { now });
    expect(await readScanEngineVersion(database)).toBe("clamav/1.0+heuristics/1");
  });

  it("leaves the stamp unchanged on an unscanned commit (never fabricated without a real scan)", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { versionId } = await initiate(database, matterId);
    await commit(database, versionId, "hash-unscanned");
    // An `unscanned` commit carries no engine version — the stamp must stay null, never invented.
    expect(await readScanEngineVersion(database)).toBeNull();
  });

  it("does not stamp a clean commit that carries no engine version", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { versionId } = await initiate(database, matterId);
    const result = await commitVersion(
      database,
      {
        versionId,
        sizeBytes: 1024,
        sniffedContentType: "application/pdf",
        contentSha256: "hash-clean-noengine",
        scanVerdict: "clean",
        scanEngineVersion: null,
        scanDetail: null,
        now: now(),
      },
      options,
    );
    await commitEffectBatch(database, result.effect, { now });
    expect(await readScanEngineVersion(database)).toBeNull();
  });
});

describe("softDeleteFile", () => {
  it("excludes a deleted file by default but a recovery view still finds it", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { fileId, versionId } = await initiate(database, matterId);
    await commit(database, versionId, "hash-a");
    const result = await softDeleteFile(database, fileId, options);
    await commitEffectBatch(database, result.effect, { now });
    expect((await listFiles(database, { matterId })).data).toHaveLength(0);
    const recoverable = await listFiles(database, { matterId, includeDeleted: true });
    expect(recoverable.data.map((row) => row.id)).toEqual([fileId]);
  });

  it("refuses to act on an unknown file", async () => {
    const database = freshDatabase();
    await seedMatter(database);
    await expect(softDeleteFile(database, "file_missing" as FileId, options)).rejects.toMatchObject(
      { code: "unknown-file" },
    );
  });
});

describe("commitVersion — monotonic current version", () => {
  it("keeps the pointer at the newer version when an older one commits out of order", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { fileId, versionId: v1 } = await initiate(database, matterId);
    const second = await initiate(database, matterId, { fileId });
    // Commit v2 first (different bytes), then v1 (older) late — the pointer must not regress to v1.
    await commit(database, second.versionId, "hash-v2");
    await commit(database, v1, "hash-v1");
    const file = await database
      .prepare("SELECT current_version_id FROM file WHERE id = ?1")
      .bind(fileId)
      .all<{ current_version_id: string }>();
    expect(file.results[0]?.current_version_id).toBe(second.versionId);
  });
});

describe("moveFile — same-matter integrity", () => {
  it("moves a file into a folder of its own matter", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { fileId, versionId } = await initiate(database, matterId);
    await commit(database, versionId, "hash-a");
    const { folderId, effect } = await createFolder(database, { matterId, name: "Same" }, options);
    await commitEffectBatch(database, effect, { now });
    const moved = await moveFile(database, fileId, folderId, options);
    await commitEffectBatch(database, moved.effect, { now });
    const row = await database
      .prepare("SELECT folder_id FROM file WHERE id = ?1")
      .bind(fileId)
      .all<{ folder_id: string }>();
    expect(row.results[0]?.folder_id).toBe(folderId);
  });

  it("refuses to move a file into a folder of another matter", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const otherMatterId = await seedSecondMatter(database);
    const { fileId, versionId } = await initiate(database, matterId);
    await commit(database, versionId, "hash-a");
    const { folderId, effect } = await createFolder(
      database,
      { matterId: otherMatterId, name: "Foreign" },
      options,
    );
    await commitEffectBatch(database, effect, { now });
    await expect(moveFile(database, fileId, folderId, options)).rejects.toMatchObject({
      code: "file-cross-matter",
    });
  });

  it("refuses to move a file into an unknown folder", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { fileId, versionId } = await initiate(database, matterId);
    await commit(database, versionId, "hash-a");
    await expect(
      moveFile(database, fileId, "folder_missing" as FolderId, options),
    ).rejects.toMatchObject({ code: "unknown-folder" });
  });
});

describe("initiateUpload — lane selection by uploadKind", () => {
  it("mints an R2 key under files/ by default (interactive lane)", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const result = await initiate(database, matterId);
    expect(result.r2Key).toMatch(/^files\//);
  });

  it("mints an R2 key under bulk/ when uploadKind is bulk", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const result = await initiate(database, matterId, { uploadKind: "bulk" });
    expect(result.r2Key).toMatch(/^bulk\//);
  });

  it("bulk upload still meters under files/ on commit (meter dimension is logical, not the key prefix)", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { versionId } = await initiate(database, matterId, { uploadKind: "bulk" });
    await commit(database, versionId, "hash-bulk");
    const meter = await database
      .prepare("SELECT bytes, object_count FROM storage_meter WHERE prefix = 'files'")
      .all<{ bytes: number; object_count: number }>();
    expect(meter.results[0]).toEqual({ bytes: 1024, object_count: 1 });
  });
});

describe("initiateUpload — new version on an existing file", () => {
  it("refuses a new version whose declared matter differs from the file's matter", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const otherMatterId = await seedSecondMatter(database);
    const { fileId } = await initiate(database, matterId);
    await expect(
      initiateUpload(
        database,
        {
          matterId: otherMatterId,
          name: "v2.pdf",
          declaredSize: 1024,
          declaredContentType: "application/pdf",
          uploadedBy: ACTOR,
          mode: "put",
          fileId,
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "file-matter-mismatch" });
  });
});

describe("recordRescanVerdict — in-place re-scan", () => {
  async function committedVersion(database: ReturnType<typeof freshDatabase>, hash: string) {
    const matterId = await seedMatter(database);
    const { versionId } = (await initiate(database, matterId)) as { versionId: FileVersionId };
    const committed = await commit(database, versionId, hash);
    return { versionId, fileId: committed.fileId };
  }

  it("stamps a clean re-scan verdict in place — no pointer move, cache recorded", async () => {
    const database = freshDatabase();
    const { versionId, fileId } = await committedVersion(database, "hash-x");
    const before = await database
      .prepare("SELECT current_version_id FROM file WHERE id = ?1")
      .bind(fileId)
      .all<{ current_version_id: string }>();

    const cleanRaw = {
      engineVersion: "clamav/2.0",
      clam: { state: "clean" as const },
      heuristic: { kind: "none" as const },
      matches: [],
      timings: { clamdMs: 3, yaraMs: 2 },
    };
    await commitEffectBatch(
      database,
      recordRescanVerdict(
        database,
        {
          fileId,
          versionId,
          scanVerdict: "clean",
          scanEngineVersion: "clamav/2.0",
          scanDetail: null,
          signature: null,
          contentSha256: "hash-x",
          now: now(),
          rawScanResult: cleanRaw,
        },
        options,
      ).effect,
      { now },
    );

    const row = await database
      .prepare("SELECT scan_verdict, scan_engine_version, status FROM file_version WHERE id = ?1")
      .bind(versionId)
      .all<{ scan_verdict: string; scan_engine_version: string; status: string }>();
    expect(row.results[0]).toMatchObject({
      scan_verdict: "clean",
      scan_engine_version: "clamav/2.0",
      status: "clean",
    });
    const after = await database
      .prepare("SELECT current_version_id FROM file WHERE id = ?1")
      .bind(fileId)
      .all<{ current_version_id: string }>();
    expect(after.results[0]?.current_version_id).toBe(before.results[0]?.current_version_id);
    expect(await lookupScanCache(database, "hash-x", "clamav/2.0")).toEqual(cleanRaw);
  });

  it("an infected re-scan keeps the version VISIBLE (status stays clean) — informed access, no data loss", async () => {
    const database = freshDatabase();
    const { versionId, fileId } = await committedVersion(database, "hash-bad");

    const infectedRaw = {
      engineVersion: "clamav/2.0",
      clam: { state: "infected" as const, signature: "Eicar-Test-Signature" },
      heuristic: { kind: "none" as const },
      matches: [],
      timings: { clamdMs: 4, yaraMs: 1 },
    };
    const { effect } = recordRescanVerdict(
      database,
      {
        fileId,
        versionId,
        scanVerdict: "flagged",
        scanEngineVersion: "clamav/2.0",
        scanDetail: "Eicar-Test-Signature",
        signature: "Eicar-Test-Signature",
        contentSha256: "hash-bad",
        now: now(),
        rawScanResult: infectedRaw,
      },
      options,
    );
    // A fresh infected finding emits a notification (the outbox seam); a clean re-scan emits none.
    expect(effect.outboxMessages).toEqual([
      { topic: "file.rescan_infected", payload: { fileId, versionId } },
    ]);
    await commitEffectBatch(database, effect, { now });

    const row = await database
      .prepare("SELECT scan_verdict, status FROM file_version WHERE id = ?1")
      .bind(versionId)
      .all<{ scan_verdict: string; status: string }>();
    // The hallmark of informed access: flagged but still committed/visible — never hidden or regressed.
    expect(row.results[0]).toMatchObject({ scan_verdict: "flagged", status: "clean" });
    expect(await lookupScanCache(database, "hash-bad", "clamav/2.0")).toEqual(infectedRaw);
  });
});

describe("commitVersion — flagged-but-committed version", () => {
  it("persists scan_verdict='flagged', status='clean', populates the scan cache, and records the commit audit", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { versionId } = await initiate(database, matterId);

    const flaggedRaw = {
      engineVersion: "clamav/1.0+heuristics/1",
      clam: { state: "infected" as const, signature: "Eicar-Test-Signature" },
      heuristic: { kind: "none" as const },
      matches: [],
      timings: { clamdMs: 5, yaraMs: 2 },
    };

    const result = await commitVersion(
      database,
      {
        versionId,
        sizeBytes: 2048,
        sniffedContentType: "application/pdf",
        contentSha256: "hash-flagged",
        scanVerdict: "flagged",
        scanEngineVersion: "clamav/1.0+heuristics/1",
        scanDetail: "Eicar-Test-Signature",
        now: now(),
        rawScanResult: flaggedRaw,
      },
      options,
    );
    await commitEffectBatch(database, result.effect, { now });

    // The version row: flagged verdict, but status is 'clean' (committed + accessible per treatment gate).
    const row = await database
      .prepare("SELECT scan_verdict, status FROM file_version WHERE id = ?1")
      .bind(versionId)
      .all<{ scan_verdict: string; status: string }>();
    expect(row.results[0]).toMatchObject({ scan_verdict: "flagged", status: "clean" });

    // The scan cache must be populated (engine-version keyed dedup — same as a clean commit).
    expect(await lookupScanCache(database, "hash-flagged", "clamav/1.0+heuristics/1")).toEqual(
      flaggedRaw,
    );

    // A commit audit row must exist for this version.
    const audit = await database
      .prepare(
        "SELECT event FROM audit_log WHERE event = 'file.version_committed' AND subject_id = ?1",
      )
      .bind(versionId)
      .all<{ event: string }>();
    expect(audit.results).toHaveLength(1);
  });
});

describe("loadCommittedVersionByR2Key", () => {
  it("loads a committed version by r2 key (hash + engine); undefined while pending or unknown", async () => {
    const database = freshDatabase();
    const matterId = await seedMatter(database);
    const { versionId } = (await initiate(database, matterId)) as { versionId: FileVersionId };
    const key = (
      await database
        .prepare("SELECT r2_key FROM file_version WHERE id = ?1")
        .bind(versionId)
        .all<{ r2_key: string }>()
    ).results[0]?.r2_key as string;

    // While pending, the committed-only loader must not find it (status gate).
    expect(await loadCommittedVersionByR2Key(database, key)).toBeUndefined();

    await commit(database, versionId, "hash-q");
    expect(await loadCommittedVersionByR2Key(database, key)).toMatchObject({
      id: versionId,
      contentSha256: "hash-q",
      scanVerdict: "unscanned",
      scanEngineVersion: null,
    });
    expect(await loadCommittedVersionByR2Key(database, "files/does-not-exist")).toBeUndefined();
  });
});
