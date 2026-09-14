/*
 * What each lineage's TypeScript declares, as plain data: table name -> column names.
 *
 * Enumerated off the schema modules rather than from a hand-kept list, so a table added to a schema
 * is included by the commit that adds it and nothing has to be remembered.
 *
 * It lives here rather than in the consumer because drizzle's table reflection belongs to the schema
 * package: a caller outside it (tooling/migration-integrity) cannot resolve `drizzle-orm` from its
 * own directory, and giving it a dependency on the ORM to ask this package what it declares is the
 * wrong way round.
 */
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import * as controlPlaneSchema from "./control-plane-schema.ts";
import * as perFirmSchema from "./per-firm-schema.ts";

export type Lineage = "control-plane" | "per-firm";

/** Table name -> its declared column names, for one lineage. */
export function declaredTables(lineage: Lineage): Map<string, Set<string>> {
  const module = lineage === "per-firm" ? perFirmSchema : controlPlaneSchema;
  const declared = new Map<string, Set<string>>();
  for (const candidate of Object.values(module) as unknown[]) {
    if (!(candidate instanceof SQLiteTable)) continue;
    const config = getTableConfig(candidate);
    declared.set(config.name, new Set(config.columns.map((column) => column.name)));
  }
  return declared;
}
