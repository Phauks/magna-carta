import { describe, expect, it } from "vitest";
import {
  emitMeterDataPoint,
  meterCommitStatements,
  meterCorrectionStatements,
  meterHardDeleteStatements,
  meterTierChangeStatements,
  normalizeR2StorageClass,
  prefixOf,
  reconciliationDiff,
  type MeterRow,
} from "../src/metering-statements.ts";
import { freshDatabase } from "./support.ts";

const STANDARD = { storageClass: "standard", artifactRole: "original", prefix: "files" };
const IA = { storageClass: "infrequent_access", artifactRole: "original", prefix: "files" };

async function readMeter(database: ReturnType<typeof freshDatabase>): Promise<MeterRow[]> {
  const { results } = await database
    .prepare(
      "SELECT storage_class, artifact_role, prefix, bytes, object_count FROM storage_meter ORDER BY storage_class",
    )
    .all<{
      storage_class: string;
      artifact_role: string;
      prefix: string;
      bytes: number;
      object_count: number;
    }>();
  return results.map((row) => ({
    storageClass: row.storage_class,
    artifactRole: row.artifact_role,
    prefix: row.prefix,
    bytes: row.bytes,
    objectCount: row.object_count,
  }));
}

describe("storage-meter statements", () => {
  it("commit then hard-delete returns the bucket to zero", async () => {
    const database = freshDatabase();
    await database.batch(meterCommitStatements(database, STANDARD, 1000));
    await database.batch(meterCommitStatements(database, STANDARD, 500));
    expect(await readMeter(database)).toEqual([{ ...STANDARD, bytes: 1500, objectCount: 2 }]);
    await database.batch(meterHardDeleteStatements(database, STANDARD, 1000));
    expect(await readMeter(database)).toEqual([{ ...STANDARD, bytes: 500, objectCount: 1 }]);
  });

  it("a tier change transfers bytes and count between classes", async () => {
    const database = freshDatabase();
    await database.batch(meterCommitStatements(database, STANDARD, 800));
    await database.batch(meterTierChangeStatements(database, STANDARD, IA, 800));
    expect(await readMeter(database)).toEqual([
      { ...IA, bytes: 800, objectCount: 1 },
      { ...STANDARD, bytes: 0, objectCount: 0 },
    ]);
  });
});

describe("prefixOf", () => {
  it("derives the top-level key segment", () => {
    expect(prefixOf("files/file_abc/fileVersion_xyz")).toBe("files");
    expect(prefixOf("files")).toBe("files");
  });
});

describe("normalizeR2StorageClass", () => {
  it("maps R2's PascalCase classes to our lowercase tokens", () => {
    expect(normalizeR2StorageClass("Standard")).toBe("standard");
    expect(normalizeR2StorageClass("InfrequentAccess")).toBe("infrequent_access");
  });

  it("treats an absent/empty class as the default Standard tier", () => {
    // Miniflare reports "" and real R2 omits the class for default-tier objects — both must bucket
    // with the meter's "standard" rows, not a phantom empty-class bucket (the reconciliation drift bug).
    expect(normalizeR2StorageClass("")).toBe("standard");
  });
});

describe("reconciliationDiff", () => {
  it("computes the corrections and drift between R2 reality and the meter", async () => {
    // The meter claims 1500 bytes / 2 objects; R2 actually holds 1000 / 1 (one object lost).
    const meterRows: MeterRow[] = [{ ...STANDARD, bytes: 1500, objectCount: 2 }];
    const listed = [{ key: "files/a/v1", size: 1000, storageClass: "standard" }];
    const { corrections, drift } = reconciliationDiff(listed, meterRows);
    expect(corrections).toEqual([{ key: STANDARD, bytesDelta: -500, countDelta: -1 }]);
    expect(drift[0]).toMatchObject({
      storageClass: "standard",
      prefix: "files",
      expectedBytes: 1500,
      actualBytes: 1000,
    });
  });

  it("reports no drift when the meter matches reality", () => {
    const meterRows: MeterRow[] = [{ ...STANDARD, bytes: 1000, objectCount: 1 }];
    const listed = [{ key: "files/a/v1", size: 1000, storageClass: "standard" }];
    expect(reconciliationDiff(listed, meterRows).corrections).toEqual([]);
  });

  it("applying the corrections makes the meter match reality", async () => {
    const database = freshDatabase();
    // Seed a skewed meter.
    await database.batch(meterCommitStatements(database, STANDARD, 1500));
    const meterRows = await readMeter(database); // 1500 / 1
    const listed = [
      { key: "files/a/v1", size: 1000, storageClass: "standard" },
      { key: "files/b/v1", size: 500, storageClass: "standard" },
    ]; // reality: 1500 / 2 — the meter under-counts by one object
    const { corrections } = reconciliationDiff(listed, meterRows);
    await database.batch(meterCorrectionStatements(database, corrections));
    expect(await readMeter(database)).toEqual([{ ...STANDARD, bytes: 1500, objectCount: 2 }]);
  });
});

describe("emitMeterDataPoint", () => {
  it("writes one firm-indexed data point per bucket", () => {
    const points: unknown[] = [];
    emitMeterDataPoint({ writeDataPoint: (point) => points.push(point) }, "firm_a", {
      ...STANDARD,
      bytes: 1000,
      objectCount: 1,
    });
    expect(points[0]).toEqual({
      indexes: ["firm_a"],
      blobs: ["standard", "original", "files"],
      doubles: [1000, 1],
    });
  });
});
