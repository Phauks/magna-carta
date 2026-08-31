import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { DIRECTORY_ORGANIZATION_TABLE, DIRECTORY_PERSON_TABLE } from "./statements.ts";

export interface DirectoryCounts {
  readonly people: number;
  readonly organizations: number;
}

// The firm-usage read: how many distinct people and organizations the Directory holds. Merged and
// soft-deleted records are excluded — a person merged into another is the same person, and counting
// both would report more contacts than the firm has.
export async function readDirectoryCounts(database: SqlDatabase): Promise<DirectoryCounts> {
  const [people, organizations] = await Promise.all([
    countActive(database, DIRECTORY_PERSON_TABLE),
    countActive(database, DIRECTORY_ORGANIZATION_TABLE),
  ]);
  return { people, organizations };
}

async function countActive(database: SqlDatabase, table: string): Promise<number> {
  const { results } = await database
    .prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE status = 'active' AND deleted_at IS NULL`)
    .all<{ c: number }>();
  return results[0]?.c ?? 0;
}
