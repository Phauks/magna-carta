import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";

// Authoritative per-firm storage rollup, keyed (storage_class, artifact_role, prefix). The exact
// rollup is maintained transactionally in the same batch as the file mutation that changes it; a
// scheduled R2 LIST reconciliation corrects any drift (built in this module's reconciliation half).
export const STORAGE_METER_TABLE = "storage_meter";

export interface MeterKey {
  readonly storageClass: string;
  readonly artifactRole: string;
  readonly prefix: string;
}

// Upsert that adds the delta to an existing row or seeds it — composed INTO the commitVersion batch,
// so the rollup moves atomically with the version it counts (and an idempotent replay no-ops with it).
function meterDeltaStatement(
  database: SqlDatabase,
  key: MeterKey,
  bytesDelta: number,
  countDelta: number,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${STORAGE_METER_TABLE} (storage_class, artifact_role, prefix, bytes, object_count) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT (storage_class, artifact_role, prefix) DO UPDATE SET bytes = bytes + excluded.bytes, object_count = object_count + excluded.object_count`,
    )
    .bind(key.storageClass, key.artifactRole, key.prefix, bytesDelta, countDelta);
}

// A committed version adds its bytes and one object to its (class, role, prefix) bucket.
export function meterCommitStatements(
  database: SqlDatabase,
  key: MeterKey,
  sizeBytes: number,
): SqlStatement[] {
  return [meterDeltaStatement(database, key, sizeBytes, 1)];
}

// A hard-deleted version removes its bytes and one object. Built and tested now; consumed when a
// later slice introduces a real hard-delete path (eviction of derived caches) — the rollup contract.
export function meterHardDeleteStatements(
  database: SqlDatabase,
  key: MeterKey,
  sizeBytes: number,
): SqlStatement[] {
  return [meterDeltaStatement(database, key, -sizeBytes, -1)];
}

// A storage-class tier change (Standard -> Infrequent Access) moves the object's bytes and count from
// one class bucket to the other (same role + prefix). The object count is unchanged overall — this is
// a transfer, not a delete. Consumed when Phase 2 tiering lands.
export function meterTierChangeStatements(
  database: SqlDatabase,
  fromKey: MeterKey,
  toKey: MeterKey,
  sizeBytes: number,
): SqlStatement[] {
  return [
    meterDeltaStatement(database, fromKey, -sizeBytes, -1),
    meterDeltaStatement(database, toKey, sizeBytes, 1),
  ];
}

// The top-level key segment (today always "files"). The reconciliation buckets R2 objects by it.
export function prefixOf(key: string): string {
  return key.split("/")[0] ?? "";
}

// R2's list() reports an object's storage class in the API's PascalCase form ("Standard",
// "InfrequentAccess"); our meter — and the schema CHECK — use the lowercase tokens ("standard",
// "infrequent_access"). Normalize at the R2 boundary so reconciliation diffs like against like.
// An absent/empty class means the default Standard tier — Miniflare reports it as "" and real R2
// omits it — so it normalizes to "standard" rather than minting a phantom empty-class bucket.
const R2_STORAGE_CLASS_TOKENS: Readonly<Record<string, string>> = {
  Standard: "standard",
  InfrequentAccess: "infrequent_access",
};

export function normalizeR2StorageClass(r2Class: string): string {
  if (r2Class === "") return "standard";
  return R2_STORAGE_CLASS_TOKENS[r2Class] ?? r2Class.toLowerCase();
}

export interface ListedObject {
  readonly key: string;
  readonly size: number;
  readonly storageClass: string; // R2 returns the object's storage class on LIST
}

export interface MeterRow {
  readonly storageClass: string;
  readonly artifactRole: string;
  readonly prefix: string;
  readonly bytes: number;
  readonly objectCount: number;
}

export interface MeterCorrection {
  readonly key: MeterKey;
  readonly bytesDelta: number;
  readonly countDelta: number;
}

export interface ReconciliationResult {
  readonly corrections: readonly MeterCorrection[];
  readonly drift: readonly {
    readonly storageClass: string;
    readonly prefix: string;
    readonly expectedBytes: number;
    readonly actualBytes: number;
    readonly expectedCount: number;
    readonly actualCount: number;
  }[];
}

// Pure: aggregate the authoritative R2 LIST by (storage_class, prefix) and diff it against the meter
// to produce the delta corrections and a drift report. artifact_role is not observable from R2 at
// this slice (every object is 'original'), so reconciliation operates at (class, prefix) granularity
// and attributes corrections to the original role — the bucket every committed version writes.
const ORIGINAL_ROLE = "original";

export function reconciliationDiff(
  listedObjects: readonly ListedObject[],
  meterRows: readonly MeterRow[],
): ReconciliationResult {
  const actual = new Map<string, { bytes: number; count: number }>();
  for (const object of listedObjects) {
    const bucketKey = `${object.storageClass}\0${prefixOf(object.key)}`;
    const entry = actual.get(bucketKey) ?? { bytes: 0, count: 0 };
    entry.bytes += object.size;
    entry.count += 1;
    actual.set(bucketKey, entry);
  }
  // The meter's expected totals per (class, prefix), summed across roles.
  const expected = new Map<string, { bytes: number; count: number }>();
  for (const row of meterRows) {
    const bucketKey = `${row.storageClass}\0${row.prefix}`;
    const entry = expected.get(bucketKey) ?? { bytes: 0, count: 0 };
    entry.bytes += row.bytes;
    entry.count += row.objectCount;
    expected.set(bucketKey, entry);
  }
  const corrections: MeterCorrection[] = [];
  const drift: ReconciliationResult["drift"][number][] = [];
  for (const bucketKey of new Set([...actual.keys(), ...expected.keys()])) {
    const [storageClass, prefix] = bucketKey.split("\0") as [string, string];
    const here = actual.get(bucketKey) ?? { bytes: 0, count: 0 };
    const there = expected.get(bucketKey) ?? { bytes: 0, count: 0 };
    const bytesDelta = here.bytes - there.bytes;
    const countDelta = here.count - there.count;
    if (bytesDelta === 0 && countDelta === 0) continue;
    corrections.push({
      key: { storageClass, artifactRole: ORIGINAL_ROLE, prefix },
      bytesDelta,
      countDelta,
    });
    drift.push({
      storageClass,
      prefix,
      expectedBytes: there.bytes,
      actualBytes: here.bytes,
      expectedCount: there.count,
      actualCount: here.count,
    });
  }
  return { corrections, drift };
}

// The statements that apply reconciliation corrections (the cron commits them in a batch).
export function meterCorrectionStatements(
  database: SqlDatabase,
  corrections: readonly MeterCorrection[],
): SqlStatement[] {
  return corrections.map((correction) =>
    meterDeltaStatement(database, correction.key, correction.bytesDelta, correction.countDelta),
  );
}

// The Analytics Engine trend seam (decided: AE writes ride a telemetry port). Emits one data point
// per meter bucket, indexed by firm. NOTHING IMPLEMENTS THIS PORT TODAY — `@magna-carta/telemetry`
// exists and owns the platform's event and metric surfaces, but it does not implement this one, and
// no caller passes an adapter, so no meter trend point is written anywhere. Trends are advisory and
// D1 stays authoritative, which is why that is a gap rather than a defect.
export interface MeterTelemetry {
  writeDataPoint(point: { indexes: string[]; blobs: string[]; doubles: number[] }): void;
}

export function emitMeterDataPoint(telemetry: MeterTelemetry, firmId: string, row: MeterRow): void {
  telemetry.writeDataPoint({
    indexes: [firmId],
    blobs: [row.storageClass, row.artifactRole, row.prefix],
    doubles: [row.bytes, row.objectCount],
  });
}
