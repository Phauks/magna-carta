import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { NumberingSchemeId } from "@magna-carta/identifiers/types";
import { NUMBERING_SCHEME_TABLE, type NumberingPurpose } from "../matter-statements.ts";

// The numbering-scheme write path: a firm has at most one active scheme PER PURPOSE — one for
// matter numbers, one for consultation numbers, which are separate sequences a firm shapes
// independently. Setting a new scheme deactivates the prior active row of that purpose and inserts
// the new one active in the same batch, so the "exactly one active row per purpose" invariant the
// draw (selectActiveSchemeStatement) trusts holds transactionally. Prior schemes are kept (active = 0), not deleted — a matter's number is frozen at
// assignment, but the scheme history is the audit trail of how numbers were rendered over time.

// Clears the currently-active scheme of one purpose, leaving the other purpose's alone. Guarded on
// active = 1 so a firm with no active scheme for that purpose gets a plain insert (the UPDATE
// matches no row).
export function deactivateActiveSchemeStatement(
  database: SqlDatabase,
  purpose: NumberingPurpose,
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
  readonly purpose: NumberingPurpose;
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

// The active scheme's segments JSON for the GET surface (the matter draw reads through
// selectActiveSchemeStatement in matter-statements; this read carries only what the route renders).
export function selectActiveSchemeSegmentsStatement(
  database: SqlDatabase,
  purpose: NumberingPurpose,
): SqlStatement {
  return database
    .prepare(`SELECT segments FROM ${NUMBERING_SCHEME_TABLE} WHERE active = 1 AND purpose = ?1`)
    .bind(purpose);
}
