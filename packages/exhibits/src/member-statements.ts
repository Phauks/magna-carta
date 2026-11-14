import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  ExhibitSetId,
  ExhibitSetMemberId,
  FileVersionId,
  MatterExhibitId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { ExhibitMemberStatus } from "./types.ts";

export const EXHIBIT_SET_MEMBER_TABLE = "exhibit_set_member";

export interface ExhibitSetMemberRow {
  readonly id: ExhibitSetMemberId;
  readonly exhibit_set_id: ExhibitSetId;
  readonly matter_exhibit_id: MatterExhibitId;
  readonly position: number;
  readonly label: string | null;
  readonly title_as_issued: string | null;
  readonly file_version_id_as_issued: FileVersionId | null;
  readonly status: ExhibitMemberStatus;
  readonly withdrawn_at: string | null;
  readonly withdrawn_by: UserId | null;
  readonly withdrawal_basis: string | null;
  readonly corrected_title: string | null;
  readonly corrected_file_version_id: FileVersionId | null;
  readonly corrected_at: string | null;
  readonly corrected_by: UserId | null;
  readonly correction_basis: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export const MEMBER_COLUMNS =
  "id, exhibit_set_id, matter_exhibit_id, position, label, title_as_issued, " +
  "file_version_id_as_issued, status, withdrawn_at, withdrawn_by, withdrawal_basis, " +
  "corrected_title, corrected_file_version_id, corrected_at, corrected_by, correction_basis, " +
  "created_at, updated_at";

// Appends at the end of the set. The position is computed inside the statement from the set's own
// rows, so two members appended in one batch land one after the other, and two racing batches
// collide on the position unique index instead of sharing a slot.
export function appendMemberStatement(
  database: SqlDatabase,
  row: {
    readonly id: ExhibitSetMemberId;
    readonly setId: ExhibitSetId;
    readonly exhibitId: MatterExhibitId;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${EXHIBIT_SET_MEMBER_TABLE} (id, exhibit_set_id, matter_exhibit_id, position, ` +
        `status, created_at, updated_at) SELECT ?1, ?2, ?3, COALESCE(MAX(position), 0) + 1, ` +
        `'active', ?4, ?4 FROM ${EXHIBIT_SET_MEMBER_TABLE} WHERE exhibit_set_id = ?2`,
    )
    .bind(row.id, row.setId, row.exhibitId, row.now);
}

// Removal from a DRAFT. The WHERE repeats the draft precondition so a stale read cannot remove a
// member from a set issued in the meantime; the trigger refuses it as well.
export function deleteDraftMemberStatement(
  database: SqlDatabase,
  setId: ExhibitSetId,
  memberId: ExhibitSetMemberId,
): SqlStatement {
  return database
    .prepare(
      `DELETE FROM ${EXHIBIT_SET_MEMBER_TABLE} WHERE id = ?2 AND exhibit_set_id = ?1 AND ` +
        `EXISTS (SELECT 1 FROM exhibit_set WHERE id = ?1 AND state = 'draft')`,
    )
    .bind(setId, memberId);
}

// Closing the gap a removal leaves, in two steps so the position unique index never sees two rows
// on one slot: the rows after the gap are parked on negative positions one lower, then flipped back.
// An UPDATE visits rows in no promised order, so decrementing in place could collide halfway.
// fitness:unguarded-write — removing the last member leaves no row after the gap to move, which is correct.
export function closeGapStatements(
  database: SqlDatabase,
  setId: ExhibitSetId,
  removedPosition: number,
  now: string,
): SqlStatement[] {
  return [
    database
      .prepare(
        `UPDATE ${EXHIBIT_SET_MEMBER_TABLE} SET position = -(position - 1), updated_at = ?3 ` +
          `WHERE exhibit_set_id = ?1 AND position > ?2`,
      )
      .bind(setId, removedPosition, now),
    database
      .prepare(
        `UPDATE ${EXHIBIT_SET_MEMBER_TABLE} SET position = -position ` +
          `WHERE exhibit_set_id = ?1 AND position < 0`,
      )
      .bind(setId),
  ];
}

// A reorder is ONE whole-set replace, never a run of pairwise swaps: two members swapping
// concurrently could each commit and leave a gap or a duplicate. Every member is parked on the
// negative of its new position — guarded on the proposed order still naming exactly the set's
// members, so a member added or removed since the read refuses the batch — and then flipped back.
// fitness:unguarded-write — `park` is wrapped in guarded() where member-service.ts composes it; `settle`
// flips back exactly the rows `park` moved, so it matches nothing only when `park` refused the batch.
export function reorderStatements(
  database: SqlDatabase,
  setId: ExhibitSetId,
  orderedMemberIds: readonly ExhibitSetMemberId[],
  now: string,
): { readonly park: SqlStatement; readonly settle: SqlStatement } {
  const order = JSON.stringify(orderedMemberIds);
  return {
    park: database
      .prepare(
        `UPDATE ${EXHIBIT_SET_MEMBER_TABLE} SET position = -(SELECT CAST(key AS INTEGER) + 1 ` +
          `FROM json_each(?2) WHERE value = ${EXHIBIT_SET_MEMBER_TABLE}.id), updated_at = ?3 ` +
          `WHERE exhibit_set_id = ?1 AND id IN (SELECT value FROM json_each(?2)) ` +
          `AND (SELECT COUNT(*) FROM ${EXHIBIT_SET_MEMBER_TABLE} WHERE exhibit_set_id = ?1) = ` +
          `json_array_length(?2)`,
      )
      .bind(setId, order, now),
    settle: database
      .prepare(
        `UPDATE ${EXHIBIT_SET_MEMBER_TABLE} SET position = -position ` +
          `WHERE exhibit_set_id = ?1 AND position < 0`,
      )
      .bind(setId),
  };
}

export async function readMemberRows(
  database: SqlDatabase,
  setId: ExhibitSetId,
): Promise<ExhibitSetMemberRow[]> {
  const { results } = await database
    .prepare(
      `SELECT ${MEMBER_COLUMNS} FROM ${EXHIBIT_SET_MEMBER_TABLE} WHERE exhibit_set_id = ?1 ` +
        `ORDER BY position`,
    )
    .bind(setId)
    .all<ExhibitSetMemberRow>();
  return results;
}
