import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { NumberingSchemeId } from "@magna-carta/identifiers/types";
import type { SchemeNumberingPurpose } from "./purposes.ts";

// Table name tracked against @magna-carta/database's schema by the schema-name-sync fitness tests.
export const NUMBERING_SCHEME_TABLE = "numbering_scheme";

// The numbering-scheme write path: a firm has at most one active scheme PER PURPOSE — one for
// matter numbers, one for consultation numbers, one for conflicts check numbers, and so on through
// the purpose register — because they are separate sequences a firm shapes independently. Setting a
// new scheme deactivates the prior active row of that purpose and inserts the new one active in the
// same batch, so the "exactly one active row per purpose" invariant the draw trusts holds
// transactionally. Prior schemes are kept (active = 0), not deleted — a number is frozen at
// assignment, but the scheme history is the audit trail of how numbers were rendered over time.

// Clears the currently-active scheme of one purpose, leaving every other purpose's alone. Guarded on
// active = 1 so a firm with no active scheme for that purpose gets a plain insert (the UPDATE
// matches no row).
// fitness:unguarded-write — matches a set rather than one row, so zero is an empty set rather than a refusal
export function deactivateActiveSchemeStatement(
  database: SqlDatabase,
  purpose: SchemeNumberingPurpose,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${NUMBERING_SCHEME_TABLE} SET active = 0, updated_at = ?1 WHERE active = 1 AND purpose = ?2`,
    )
    .bind(now, purpose);
}

export interface InsertNumberingSchemeRow {
  readonly id: NumberingSchemeId;
  readonly segments: string; // the scheme JSON the renderer parses via numberingSchemeSchema
  readonly purpose: SchemeNumberingPurpose;
  readonly createdAt: string;
}

export function insertNumberingSchemeStatement(
  database: SqlDatabase,
  row: InsertNumberingSchemeRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${NUMBERING_SCHEME_TABLE} (id, segments, purpose, active, created_at, updated_at) VALUES (?1, ?2, ?3, 1, ?4, ?4)`,
    )
    .bind(row.id, row.segments, row.purpose, row.createdAt);
}

// The one active scheme for a purpose (a single active row per purpose is enforced in the write
// path above). segments is the JSON the renderer parses via numberingSchemeSchema. Read by the draw
// and by the settings surface alike.
export function selectActiveSchemeStatement(
  database: SqlDatabase,
  purpose: SchemeNumberingPurpose,
): SqlStatement {
  return database
    .prepare(`SELECT id, segments FROM ${NUMBERING_SCHEME_TABLE} WHERE active = 1 AND purpose = ?1`)
    .bind(purpose);
}
