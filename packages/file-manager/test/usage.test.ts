import { describe, expect, it } from "vitest";
import { meterCommitStatements } from "../src/metering-statements.ts";
import {
  readCleanVersionCount,
  readFileCount,
  readFolderCount,
  readStorageUsage,
  summarizeStorageMeterRows,
} from "../src/usage.ts";
import { freshDatabase, seedMatter } from "./support.ts";

const STANDARD = { storageClass: "standard", artifactRole: "original", prefix: "files" };
const IA = { storageClass: "infrequent_access", artifactRole: "original", prefix: "files" };

describe("summarizeStorageMeterRows", () => {
  it("returns zeros for no rows", () => {
    expect(summarizeStorageMeterRows([])).toEqual({
      totalBytes: 0,
      totalObjects: 0,
      byStorageClass: { standard: { bytes: 0, objects: 0 }, infrequent_access: { bytes: 0, objects: 0 } },
    });
  });

  it("sums per class and overall", () => {
    const usage = summarizeStorageMeterRows([
      { storageClass: "standard", bytes: 1000, objectCount: 2 },
      { storageClass: "infrequent_access", bytes: 500, objectCount: 1 },
    ]);
    expect(usage.totalBytes).toBe(1500);
    expect(usage.totalObjects).toBe(3);
    expect(usage.byStorageClass.standard).toEqual({ bytes: 1000, objects: 2 });
    expect(usage.byStorageClass.infrequent_access).toEqual({ bytes: 500, objects: 1 });
  });

  it("surfaces an unexpected class in the totals (never silently dropped)", () => {
    const usage = summarizeStorageMeterRows([{ storageClass: "glacier", bytes: 9, objectCount: 1 }]);
    expect(usage.totalBytes).toBe(9);
    expect(usage.totalObjects).toBe(1);
    expect(usage.byStorageClass.standard).toEqual({ bytes: 0, objects: 0 });
  });
});

describe("readStorageUsage", () => {
  it("reads zero on an empty firm", async () => {
    const database = freshDatabase();
    expect(await readStorageUsage(database)).toEqual({
      totalBytes: 0,
      totalObjects: 0,
      byStorageClass: { standard: { bytes: 0, objects: 0 }, infrequent_access: { bytes: 0, objects: 0 } },
    });
  });

  it("sums the storage_meter rollup by class", async () => {
    const database = freshDatabase();
    await database.batch(meterCommitStatements(database, STANDARD, 1000));
    await database.batch(meterCommitStatements(database, STANDARD, 200));
    await database.batch(meterCommitStatements(database, IA, 500));
    const usage = await readStorageUsage(database);
    expect(usage.totalBytes).toBe(1700);
    expect(usage.totalObjects).toBe(3);
    expect(usage.byStorageClass.standard).toEqual({ bytes: 1200, objects: 2 });
    expect(usage.byStorageClass.infrequent_access).toEqual({ bytes: 500, objects: 1 });
  });
});

describe("entity counts", () => {
  it("counts non-deleted files, clean versions, and folders", async () => {
    const database = freshDatabase();
    await seedMatter(database); // member 'user_a' + matter 'matter_a'
    const t = "2026-01-01T00:00:00.000Z";
    await database
      .prepare(
        "INSERT INTO folder (id, matter_id, parent_folder_id, name, created_at, updated_at) VALUES ('folder_a','matter_a',NULL,'F',?1,?1)",
      )
      .bind(t)
      .run();
    await database
      .prepare(
        "INSERT INTO file (id, matter_id, folder_id, name, document_type_id, current_version_id, deleted_at, created_at, updated_at) VALUES ('file_a','matter_a',NULL,'a.txt',NULL,NULL,NULL,?1,?1)",
      )
      .bind(t)
      .run();
    await database
      .prepare(
        "INSERT INTO file (id, matter_id, folder_id, name, document_type_id, current_version_id, deleted_at, created_at, updated_at) VALUES ('file_b','matter_a',NULL,'b.txt',NULL,NULL,?1,?1,?1)",
      )
      .bind(t)
      .run(); // soft-deleted
    await database
      .prepare(
        "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, declared_content_type, sniffed_content_type, content_sha256, scan_verdict, scan_engine_version, status, uploaded_by, created_at, committed_at) VALUES ('ver_a','file_a',1,'k1',100,NULL,NULL,NULL,'clean',NULL,'clean','user_a',?1,?1)",
      )
      .bind(t)
      .run();
    await database
      .prepare(
        "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, declared_content_type, sniffed_content_type, content_sha256, scan_verdict, scan_engine_version, status, uploaded_by, created_at, committed_at) VALUES ('ver_b','file_a',2,'k2',100,NULL,NULL,NULL,NULL,NULL,'pending','user_a',?1,NULL)",
      )
      .bind(t)
      .run();

    expect(await readFileCount(database)).toBe(1); // file_b is soft-deleted
    expect(await readCleanVersionCount(database)).toBe(1); // ver_b is pending
    expect(await readFolderCount(database)).toBe(1);
  });

  it("counts zero on an empty firm", async () => {
    const database = freshDatabase();
    expect(await readFileCount(database)).toBe(0);
    expect(await readCleanVersionCount(database)).toBe(0);
    expect(await readFolderCount(database)).toBe(0);
  });
});
