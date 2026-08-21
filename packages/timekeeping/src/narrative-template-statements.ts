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

// Existence check used by the service before composing an update or archive effect: prevents a
// phantom audit row from being written for a subject that does not exist.
export function selectNarrativeTemplateExistsStatement(
  database: SqlDatabase,
  id: NarrativeTemplateId,
): SqlStatement {
  return database
    .prepare(`SELECT 1 AS found FROM ${NARRATIVE_TEMPLATE_TABLE} WHERE id = ?1`)
    .bind(id);
}

export function updateNarrativeTemplateStatement(
  database: SqlDatabase,
  id: NarrativeTemplateId,
  patch: {
    narrativeTemplate?: string;
    utbmsTaskCodeId?: string | null;
    defaultRateE4?: number | null;
  },
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
// de-dups a repeated narrative; MAX(work_date) orders by the most recent use. The secondary
// MAX(created_at) tiebreaker makes the order deterministic when two narratives share their
// latest work_date, so the sequence is stable across calls and in tests.
export function recentNarrativesStatement(
  database: SqlDatabase,
  timekeeperUserId: string,
  limit: number,
): SqlStatement {
  return database
    .prepare(
      `SELECT narrative FROM time_entry WHERE timekeeper_user_id = ?1 GROUP BY narrative ORDER BY MAX(work_date) DESC, MAX(created_at) DESC LIMIT ?2`,
    )
    .bind(timekeeperUserId, limit);
}

export interface RecentNarrativesPage {
  readonly narratives: string[];
  readonly capped: boolean;
}

/**
 * The same read, capped with a signal rather than paged.
 *
 * A continuation cursor is the wrong shape here twice over. The ordering key is `MAX(work_date)`,
 * an aggregate the query computes over the group rather than a column any row carries, so a keyset
 * would page by a value that is not in the table. And the answer is a typing aid: it exists to put
 * the phrases somebody used this week under their cursor, not to let them walk backwards through
 * every narrative they have ever written. Nothing pages an autocomplete.
 *
 * What it does owe the caller is the difference between "that is all of them" and "we stopped
 * there", which is what `capped` carries — a re-pick list silently cut at its limit reads as a
 * complete history of the timekeeper's phrasing.
 */
export async function readRecentNarratives(
  database: SqlDatabase,
  timekeeperUserId: string,
  limit: number,
): Promise<RecentNarrativesPage> {
  const { results } = await recentNarrativesStatement(database, timekeeperUserId, limit + 1).all<{
    narrative: string;
  }>();
  const capped = results.length > limit;
  return {
    capped,
    narratives: (capped ? results.slice(0, limit) : results).map((row) => row.narrative),
  };
}
