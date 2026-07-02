import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";

// The three tables that constitute the custom-fields schema. Every table-wide check runs over all
// three so a schema mistake in any table is caught by one pass.
const TABLES = ["custom_field", "picklist_option", "custom_field_value"] as const;

// The partial-unique index that enforces the at-most-one-current-value invariant per (target row,
// field) pair. Its presence in sqlite_master is the proof the migration landed correctly; its
// absence means the uniqueness guarantee has no backing and concurrent writes can produce split-
// brain current rows.
const CURRENT_VALUE_INDEX = "custom_field_value_current_unique_index";

// assertCustomFieldsFitness runs the table-wide custom-fields invariant audit and throws if any
// invariant is broken:
//
//   1. No column on any of the three tables uses a floating-point type (REAL or FLOAT). Floats
//      cannot represent fractional monetary amounts or arbitrary-scale numbers without drift —
//      every numeric value must be stored as an INTEGER (scaled by the field's number_scale) or
//      TEXT. A REAL column is a schema bug, not a precision choice.
//
//   2. Every table's primary key is a TEXT handle. Numeric auto-increment PKs are incompatible
//      with the identifier system (branded text handles with a prefix, e.g. "customField_…") and
//      with cross-table joins that assume handle equality. An INTEGER PK means the migration
//      created the wrong column type.
//
//   3. The partial-unique index `custom_field_value_current_unique_index` exists. Without it the
//      (target_row_id, field_id) uniqueness constraint for is_current = 1 has no enforcement and
//      concurrent writes can silently produce duplicate current rows.
//
// Resolves silently when all three invariants hold. Wire it in a test (as a freshly migrated DB
// must always pass) and optionally as a periodic integrity sweep.
export async function assertCustomFieldsFitness(database: SqlDatabase): Promise<void> {
  // 1 + 2: scan PRAGMA table_info for each table.
  for (const table of TABLES) {
    const { results: columns } = await database
      .prepare(`PRAGMA table_info(${table})`)
      .all<{ name: string; type: string; pk: number }>();

    for (const column of columns) {
      const upperType = column.type.toUpperCase();
      if (upperType.includes("REAL") || upperType.includes("FLOAT")) {
        throw new Error(
          `custom-fields fitness: ${table}.${column.name} is a float column` +
            ` (type ${column.type}) — floats cannot represent fractional amounts` +
            ` without drift; use INTEGER with an explicit scale instead.`,
        );
      }
    }

    const primaryKey = columns.find((column) => column.pk === 1);
    if (primaryKey === undefined || primaryKey.type.toUpperCase() !== "TEXT") {
      throw new Error(
        `custom-fields fitness: ${table} primary key must be a TEXT handle` +
          ` — found ${primaryKey === undefined ? "no pk column" : `type ${primaryKey.type}`}.`,
      );
    }
  }

  // 3: verify the partial-unique current-value index exists.
  const { results: indexRows } = await database
    .prepare(
      `SELECT name FROM sqlite_master` +
        ` WHERE type = 'index' AND name = '${CURRENT_VALUE_INDEX}'`,
    )
    .all<{ name: string }>();

  if (indexRows.length !== 1) {
    throw new Error(
      `custom-fields fitness: the partial-unique current-value index` +
        ` '${CURRENT_VALUE_INDEX}' is missing from sqlite_master —` +
        ` the at-most-one-current-value invariant has no backing.`,
    );
  }
}
