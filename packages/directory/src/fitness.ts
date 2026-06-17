import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";

// A reference that still points at a subordinate entity after a merge — the kind of dangling pointer
// a complete repoint must never leave behind. table/column name where the stale pointer lives, plus
// the offending row id, so a failure message is actionable.
export interface DanglingReference {
  readonly table: string;
  readonly column: string;
  readonly row: string;
}

// The thrown failure when the merge repoint is incomplete: at least one inbound reference still points
// at the subordinate. Carries the full list so a test or operator sees every stale pointer at once.
export class DanglingSubordinateReferenceError extends Error {
  readonly code = "dangling-subordinate-reference";
  readonly references: readonly DanglingReference[];
  constructor(subordinateId: string, references: readonly DanglingReference[]) {
    super(
      `directory: ${references.length} inbound reference(s) still point at the merged subordinate ${subordinateId}: ${references
        .map((r) => `${r.table}.${r.column}#${r.row}`)
        .join(", ")} (dangling-subordinate-reference)`,
    );
    this.name = "DanglingSubordinateReferenceError";
    this.references = references;
  }
}

// The reusable inbound-reference query: every real indexed column that a merge repoints from the
// subordinate to the master. Kept in one place so the merge's repoint set and this audit stay in
// lockstep — adding a new referencing column means adding it here too.
const INBOUND_REFERENCE_PROBES: ReadonlyArray<{ table: string; column: string }> = [
  { table: "matter_party", column: "entity_id" },
  { table: "directory_edge", column: "from_entity_id" },
  { table: "directory_edge", column: "to_entity_id" },
  { table: "directory_entity_category", column: "entity_id" },
];

// findDanglingToSubordinate scans every inbound-reference column for rows that still point at the
// subordinate. Returns one DanglingReference per offending row across all probed tables. A complete,
// correct merge leaves this empty. Soft-deleted rows still count — a repoint must move them too, so a
// later undelete never resurrects a pointer to an archived subordinate.
export async function findDanglingToSubordinate(
  database: SqlDatabase,
  subordinateId: string,
): Promise<DanglingReference[]> {
  const found: DanglingReference[] = [];
  for (const probe of INBOUND_REFERENCE_PROBES) {
    // directory_entity_category has no own id column — its identity is the (entity_id, category_id)
    // composite, so report the category_id as the row discriminator. Every other probed table has id.
    const rowExpression = probe.table === "directory_entity_category" ? "category_id" : "id";
    const { results } = await database
      .prepare(`SELECT ${rowExpression} AS row FROM ${probe.table} WHERE ${probe.column} = ?1`)
      .bind(subordinateId)
      .all<{ row: string }>();
    for (const result of results) {
      found.push({ table: probe.table, column: probe.column, row: result.row });
    }
  }
  return found;
}

// assertNoDanglingToSubordinate is the fitness assertion: it throws DanglingSubordinateReferenceError
// if any inbound reference still points at the subordinate after a merge, and resolves silently when
// the repoint is complete. Wire it after a merge (or in a test) to prove the relink left nothing
// behind.
export async function assertNoDanglingToSubordinate(
  database: SqlDatabase,
  subordinateId: string,
): Promise<void> {
  const dangling = await findDanglingToSubordinate(database, subordinateId);
  if (dangling.length > 0) {
    throw new DanglingSubordinateReferenceError(subordinateId, dangling);
  }
}
