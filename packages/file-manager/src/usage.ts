import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { FILE_TABLE, FILE_VERSION_TABLE } from "./file-statements.ts";
import { FOLDER_TABLE } from "./folder-statements.ts";
import { STORAGE_METER_TABLE } from "./metering-statements.ts";

export interface StorageClassTotals {
  readonly bytes: number;
  readonly objects: number;
}

// The two storage classes the meter and schema CHECK allow. byStorageClass is keyed to exactly these;
// any other class still counts in the totals (surfaced, never silently dropped from the snapshot).
export interface StorageUsage {
  readonly totalBytes: number;
  readonly totalObjects: number;
  readonly byStorageClass: Record<"standard" | "infrequent_access", StorageClassTotals>;
}

export interface StorageMeterRow {
  readonly storageClass: string;
  readonly bytes: number;
  readonly objectCount: number;
}

export function summarizeStorageMeterRows(rows: readonly StorageMeterRow[]): StorageUsage {
  const byStorageClass = {
    standard: { bytes: 0, objects: 0 },
    infrequent_access: { bytes: 0, objects: 0 },
  };
  let totalBytes = 0;
  let totalObjects = 0;
  for (const row of rows) {
    totalBytes += row.bytes;
    totalObjects += row.objectCount;
    if (row.storageClass === "standard" || row.storageClass === "infrequent_access") {
      byStorageClass[row.storageClass].bytes += row.bytes;
      byStorageClass[row.storageClass].objects += row.objectCount;
    }
  }
  return { totalBytes, totalObjects, byStorageClass };
}

// Sum the authoritative per-firm rollup over (artifact_role, prefix), grouped by storage class.
export async function readStorageUsage(database: SqlDatabase): Promise<StorageUsage> {
  const { results } = await database
    .prepare(
      `SELECT storage_class, SUM(bytes) AS bytes, SUM(object_count) AS objects FROM ${STORAGE_METER_TABLE} GROUP BY storage_class`,
    )
    .all<{ storage_class: string; bytes: number; objects: number }>();
  return summarizeStorageMeterRows(
    results.map((row) => ({
      storageClass: row.storage_class,
      bytes: row.bytes,
      objectCount: row.objects,
    })),
  );
}

async function count(database: SqlDatabase, sql: string): Promise<number> {
  const { results } = await database.prepare(sql).all<{ c: number }>();
  return results[0]?.c ?? 0;
}

export function readFileCount(database: SqlDatabase): Promise<number> {
  return count(database, `SELECT COUNT(*) AS c FROM ${FILE_TABLE} WHERE deleted_at IS NULL`);
}

export interface CountAndBytes {
  readonly count: number;
  readonly bytes: number;
}

// The versioning breakdown behind the storage total: what is current, what is history, and what is
// deleted but not yet swept. Prior versions are derived (all minus current) so the three published
// rows always sum: currentFiles + priorVersions = allVersions, with deletedFiles beside them.
export interface FileUsageBreakdown {
  readonly currentFiles: CountAndBytes; // live files with a clean current version
  readonly priorVersions: CountAndBytes; // superseded clean versions retained on live files
  readonly allVersions: CountAndBytes; // every clean version on a live file
  readonly deletedFiles: CountAndBytes; // soft-deleted files; bytes are their retained clean versions
}

async function countAndBytes(database: SqlDatabase, sql: string): Promise<CountAndBytes> {
  const { results } = await database.prepare(sql).all<{ c: number; b: number }>();
  return { count: results[0]?.c ?? 0, bytes: results[0]?.b ?? 0 };
}

export async function readFileUsageBreakdown(database: SqlDatabase): Promise<FileUsageBreakdown> {
  const [currentFiles, allVersions, deletedFiles] = await Promise.all([
    countAndBytes(
      database,
      `SELECT COUNT(*) AS c, COALESCE(SUM(version.size_bytes), 0) AS b FROM ${FILE_TABLE} AS file JOIN ${FILE_VERSION_TABLE} AS version ON version.id = file.current_version_id AND version.status = 'clean' WHERE file.deleted_at IS NULL`,
    ),
    countAndBytes(
      database,
      `SELECT COUNT(*) AS c, COALESCE(SUM(version.size_bytes), 0) AS b FROM ${FILE_VERSION_TABLE} AS version JOIN ${FILE_TABLE} AS file ON file.id = version.file_id AND file.deleted_at IS NULL WHERE version.status = 'clean'`,
    ),
    countAndBytes(
      database,
      `SELECT COUNT(DISTINCT file.id) AS c, COALESCE(SUM(version.size_bytes), 0) AS b FROM ${FILE_TABLE} AS file LEFT JOIN ${FILE_VERSION_TABLE} AS version ON version.file_id = file.id AND version.status = 'clean' WHERE file.deleted_at IS NOT NULL`,
    ),
  ]);
  return {
    currentFiles,
    priorVersions: {
      count: allVersions.count - currentFiles.count,
      bytes: allVersions.bytes - currentFiles.bytes,
    },
    allVersions,
    deletedFiles,
  };
}

export function readCleanVersionCount(database: SqlDatabase): Promise<number> {
  return count(database, `SELECT COUNT(*) AS c FROM ${FILE_VERSION_TABLE} WHERE status = 'clean'`);
}

export function readFolderCount(database: SqlDatabase): Promise<number> {
  return count(database, `SELECT COUNT(*) AS c FROM ${FOLDER_TABLE}`);
}
