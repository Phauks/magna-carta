import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { NarrativeTemplateId } from "@magna-carta/identifiers/types";

export const NARRATIVE_TEMPLATE_TABLE = "narrative_template";

// A template fills narrative AND rate together: utbms_task_code_id keys the suggestion to a task, and
// default_rate_e4 pre-fills the rate alongside the narrative (both optional).
export interface InsertNarrativeTemplateRow {
  readonly id: NarrativeTemplateId;
  readonly utbmsTaskCodeId: string | null;
  readonly narrativeTemplate: string;
  readonly defaultRateE4: number | null;
  readonly createdAt: string;
}

export function insertNarrativeTemplateStatement(
  database: SqlDatabase,
  row: InsertNarrativeTemplateRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${NARRATIVE_TEMPLATE_TABLE} (id, utbms_task_code_id, narrative_template, default_rate_e4, archived_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?5)`,
    )
    .bind(row.id, row.utbmsTaskCodeId, row.narrativeTemplate, row.defaultRateE4, row.createdAt);
}

export function updateNarrativeTemplateStatement(
  database: SqlDatabase,
  id: NarrativeTemplateId,
  patch: { narrativeTemplate?: string; utbmsTaskCodeId?: string | null; defaultRateE4?: number | null },
  updatedAt: string,
): SqlStatement {
  const sets: string[] = [];
  const bindings: (string | number | null)[] = [id];
  let index = 2;
  for (const [column, value] of Object.entries({
    narrative_template: patch.narrativeTemplate,
    utbms_task_code_id: patch.utbmsTaskCodeId,
    default_rate_e4: patch.defaultRateE4,
  })) {
    if (value === undefined) continue;
    sets.push(`${column} = ?${index}`);
    bindings.push(value);
    index += 1;
  }
  const updatedAtPlaceholder = `?${index}`;
  bindings.push(updatedAt);
  return database
    .prepare(
      `UPDATE ${NARRATIVE_TEMPLATE_TABLE} SET ${[...sets, `updated_at = ${updatedAtPlaceholder}`].join(", ")} WHERE id = ?1`,
    )
    .bind(...bindings);
}

export function archiveNarrativeTemplateStatement(
  database: SqlDatabase,
  id: NarrativeTemplateId,
  archivedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${NARRATIVE_TEMPLATE_TABLE} SET archived_at = ?2, updated_at = ?2 WHERE id = ?1`,
    )
    .bind(id, archivedAt);
}

// Active templates only (archived rows drop out).
export function listNarrativeTemplatesStatement(database: SqlDatabase): SqlStatement {
  return database.prepare(
    `SELECT id, utbms_task_code_id, narrative_template, default_rate_e4, archived_at FROM ${NARRATIVE_TEMPLATE_TABLE} WHERE archived_at IS NULL ORDER BY created_at`,
  );
}

// The timekeeper's distinct recent narratives, most recent first — the one-tap re-pick read. DISTINCT
// de-dups a repeated narrative; MAX(work_date) orders by the most recent use. Reads time_entry directly.
export function recentNarrativesStatement(
  database: SqlDatabase,
  timekeeperUserId: string,
  limit: number,
): SqlStatement {
  return database
    .prepare(
      `SELECT narrative FROM time_entry WHERE timekeeper_user_id = ?1 GROUP BY narrative ORDER BY MAX(work_date) DESC LIMIT ?2`,
    )
    .bind(timekeeperUserId, limit);
}
