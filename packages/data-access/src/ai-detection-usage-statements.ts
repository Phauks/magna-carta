import type { AiDetectionUsageId } from "@magna-carta/identifiers/types";
import type { SqlDatabase, SqlStatement } from "./idempotency-statements.ts";

// Authoritative per-firm AI-text-detection usage: one row per successful detection. Word count is the
// billing-relevant unit (Pangram bills by words, not tokens); cost_minor is an indicative snapshot at
// the recorded rate, and a future billing decision reads word_count, not summed rounded cents. The
// matter_id column is the (currently unused) matter-action seam. Behavior over the table lives here;
// the structure lives in @magna-carta/database's per-firm schema.
export const AI_DETECTION_USAGE_TABLE = "ai_detection_usage";

export type AiDetectionUsageMode = "realtime" | "bulk";

export interface AiDetectionUsageInsert {
  readonly id: AiDetectionUsageId;
  readonly requestedBy: string;
  readonly wordCount: number;
  readonly mode: AiDetectionUsageMode;
  readonly costMinor: number;
  readonly adapterId: string;
  readonly vendorVersion: string | null;
  readonly resultBand: string | null;
  readonly matterId: string | null;
  readonly createdAt: string;
}

export function recordAiDetectionUsageStatement(
  database: SqlDatabase,
  row: AiDetectionUsageInsert,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${AI_DETECTION_USAGE_TABLE} (id, requested_by, word_count, mode, cost_minor, adapter_id, vendor_version, result_band, matter_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    )
    .bind(
      row.id,
      row.requestedBy,
      row.wordCount,
      row.mode,
      row.costMinor,
      row.adapterId,
      row.vendorVersion,
      row.resultBand,
      row.matterId,
      row.createdAt,
    );
}

export interface AiDetectionUsageSummary {
  readonly totalRequests: number;
  readonly totalWords: number;
  readonly totalCostMinor: number;
}

export async function readAiDetectionUsage(
  database: SqlDatabase,
): Promise<AiDetectionUsageSummary> {
  const { results } = await database
    .prepare(
      `SELECT COUNT(*) AS requests, COALESCE(SUM(word_count), 0) AS words, COALESCE(SUM(cost_minor), 0) AS cost FROM ${AI_DETECTION_USAGE_TABLE}`,
    )
    .all<{ requests: number; words: number; cost: number }>();
  const row = results[0];
  return {
    totalRequests: row?.requests ?? 0,
    totalWords: row?.words ?? 0,
    totalCostMinor: row?.cost ?? 0,
  };
}
