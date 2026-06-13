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
