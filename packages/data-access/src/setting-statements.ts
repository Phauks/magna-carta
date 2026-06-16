import { z } from "zod";
import { canonicalJsonStringify } from "./canonical.ts";
import type { SqlDatabase, SqlStatement } from "./idempotency-statements.ts";

// Per-firm key/value config — the storage seam a full settings framework will later formalize. The
// VALUE is JSON validated through a zod schema with a default in code, so a missing row IS the
// default and no settings UI is needed to make a setting readable. Behavior over the table lives
// with each owning package, which exports its own FirmSettingDefinition; this builder is generic.

// Table name tracked against @magna-carta/database's per-firm schema by the schema-name-sync fitness
// test. The setting table exists only in the per-firm database — the caller supplies that handle.
export const SETTING_TABLE = "setting";

export interface FirmSettingDefinition<T> {
  readonly key: string;
  readonly schema: z.ZodType<T>;
  readonly defaultValue: T;
}

// Reads the row and parses the stored JSON through the schema. An absent row OR an unparseable /
// invalid stored value yields the default — a bad write must never brick reads. (A call site that
// cares about a corrupt stored value can detect it separately; the read path stays total.)
export async function readFirmSetting<T>(
  database: SqlDatabase,
  definition: FirmSettingDefinition<T>,
): Promise<T> {
  const { results } = await database
    .prepare(`SELECT value FROM ${SETTING_TABLE} WHERE key = ?1`)
    .bind(definition.key)
    .all<{ value: string }>();
  const row = results[0];
  if (row === undefined) return definition.defaultValue;
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.value);
  } catch {
    return definition.defaultValue;
  }
  const validated = definition.schema.safeParse(parsed);
  return validated.success ? validated.data : definition.defaultValue;
}

// Composes the upsert for an effect batch. The value is validated up front (a bad write fails loud
// at the source, never silently), then stored as canonical JSON so the serialized form is stable.
export function writeFirmSettingStatement<T>(
  database: SqlDatabase,
  definition: FirmSettingDefinition<T>,
  value: T,
  now: string,
): SqlStatement {
  const validated = definition.schema.parse(value);
  return database
    .prepare(
      `INSERT INTO ${SETTING_TABLE} (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(definition.key, canonicalJsonStringify(validated), now);
}
