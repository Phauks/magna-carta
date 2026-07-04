import type { FileVersionId, RepairProvenanceId } from "@magna-carta/identifiers/types";
import type { SqlDatabase, SqlStatement } from "./idempotency-statements.ts";

interface LossManifest {
  readonly items: Array<{ name: string; recovered: boolean; detail: string }>;
  readonly fullyRecovered: boolean;
  readonly synthesized: string[];
}

export const FILE_REPAIR_PROVENANCE_TABLE = "file_repair_provenance";

export type RepairOperation = "repair" | "carve";

export interface RepairProvenanceInsert {
  readonly id: RepairProvenanceId;
  readonly fileVersionId: FileVersionId;
  readonly operation: RepairOperation;
  readonly fullyRecovered: boolean;
  readonly manifestJson: string;
  readonly sourceMediaType: string | null;
  readonly createdAt: string;
}

export function recordRepairProvenanceStatement(
  database: SqlDatabase,
  row: RepairProvenanceInsert,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${FILE_REPAIR_PROVENANCE_TABLE} (id, file_version_id, operation, fully_recovered, manifest_json, source_media_type, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
    .bind(
      row.id,
      row.fileVersionId,
      row.operation,
      row.fullyRecovered ? 1 : 0,
      row.manifestJson,
      row.sourceMediaType,
      row.createdAt,
    );
}

export interface RepairProvenance {
  readonly operation: RepairOperation;
  readonly fullyRecovered: boolean;
  readonly manifest: LossManifest;
  readonly sourceMediaType: string | null;
  readonly createdAt: string;
}

export async function readRepairProvenance(
  database: SqlDatabase,
  fileVersionId: string,
): Promise<RepairProvenance | null> {
  const { results } = await database
    .prepare(
      `SELECT operation, fully_recovered, manifest_json, source_media_type, created_at FROM ${FILE_REPAIR_PROVENANCE_TABLE} WHERE file_version_id = ?1 LIMIT 1`,
    )
    .bind(fileVersionId)
    .all<{
      operation: RepairOperation;
      fully_recovered: number;
      manifest_json: string;
      source_media_type: string | null;
      created_at: string;
    }>();
  const row = results[0];
  if (row === undefined) return null;
  return {
    operation: row.operation,
    fullyRecovered: row.fully_recovered === 1,
    manifest: JSON.parse(row.manifest_json) as LossManifest,
    sourceMediaType: row.source_media_type,
    createdAt: row.created_at,
  };
}
