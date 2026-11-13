import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { ExhibitSetId, FileId, MatterId, UserId } from "@magna-carta/identifiers/types";
import type { ExhibitScheme } from "./scheme.ts";
import type { ExhibitDisposition, ExhibitSetState } from "./types.ts";

export const EXHIBIT_SET_TABLE = "exhibit_set";

export interface ExhibitSetRow {
  readonly id: ExhibitSetId;
  readonly matter_id: MatterId;
  readonly name: string;
  readonly noun: string;
  readonly prefix: string;
  readonly sequence: ExhibitScheme["sequence"];
  readonly start_at: number;
  readonly overflow_form: ExhibitScheme["overflowForm"];
  readonly state: ExhibitSetState;
  readonly continues_from_set_id: ExhibitSetId | null;
  readonly supersedes_set_id: ExhibitSetId | null;
  readonly disposition: ExhibitDisposition | null;
  readonly issued_on: string | null;
  readonly issued_at: string | null;
  readonly issued_by: UserId | null;
  readonly filed_copy_file_id: FileId | null;
  readonly created_by: UserId | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly archived_at: string | null;
}

export const SET_COLUMNS =
  "id, matter_id, name, noun, prefix, sequence, start_at, overflow_form, state, " +
  "continues_from_set_id, supersedes_set_id, disposition, issued_on, issued_at, issued_by, " +
  "filed_copy_file_id, created_by, created_at, updated_at, archived_at";

/** The scheme a set row carries, as the label function takes it. */
export function schemeOf(set: ExhibitSetRow): ExhibitScheme {
  return {
    noun: set.noun,
    prefix: set.prefix,
    sequence: set.sequence,
    startAt: set.start_at,
    overflowForm: set.overflow_form,
  };
}

export function insertExhibitSetStatement(
  database: SqlDatabase,
  row: {
    readonly id: ExhibitSetId;
    readonly matterId: MatterId;
    readonly name: string;
    readonly scheme: ExhibitScheme;
    readonly continuesFromSetId: ExhibitSetId | null;
    readonly supersedesSetId: ExhibitSetId | null;
    readonly createdBy: UserId | null;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${EXHIBIT_SET_TABLE} (id, matter_id, name, noun, prefix, sequence, start_at, ` +
        `overflow_form, state, continues_from_set_id, supersedes_set_id, created_by, created_at, ` +
        `updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'draft', ?9, ?10, ?11, ?12, ?12)`,
    )
    .bind(
      row.id,
      row.matterId,
      row.name,
      row.scheme.noun,
      row.scheme.prefix,
      row.scheme.sequence,
      row.scheme.startAt,
      row.scheme.overflowForm,
      row.continuesFromSetId,
      row.supersedesSetId,
      row.createdBy,
      row.now,
    );
}

// Guarded on state = 'draft': a stale read of a set that has since been issued matches nothing and
// the batch refuses, rather than renaming or renumbering a filing.
export function updateDraftExhibitSetStatement(
  database: SqlDatabase,
  id: ExhibitSetId,
  fields: { readonly name: string; readonly scheme: ExhibitScheme; readonly now: string },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${EXHIBIT_SET_TABLE} SET name = ?2, noun = ?3, prefix = ?4, sequence = ?5, ` +
        `start_at = ?6, overflow_form = ?7, updated_at = ?8 WHERE id = ?1 AND state = 'draft'`,
    )
    .bind(
      id,
      fields.name,
      fields.scheme.noun,
      fields.scheme.prefix,
      fields.scheme.sequence,
      fields.scheme.startAt,
      fields.scheme.overflowForm,
      fields.now,
    );
}

export function archiveDraftExhibitSetStatement(
  database: SqlDatabase,
  id: ExhibitSetId,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${EXHIBIT_SET_TABLE} SET archived_at = ?2, updated_at = ?2 ` +
        `WHERE id = ?1 AND state = 'draft' AND archived_at IS NULL`,
    )
    .bind(id, now);
}

export async function readExhibitSetRow(
  database: SqlDatabase,
  id: ExhibitSetId,
): Promise<ExhibitSetRow | undefined> {
  const { results } = await database
    .prepare(`SELECT ${SET_COLUMNS} FROM ${EXHIBIT_SET_TABLE} WHERE id = ?1`)
    .bind(id)
    .all<ExhibitSetRow>();
  return results[0];
}
