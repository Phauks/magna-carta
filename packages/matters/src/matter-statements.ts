import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { LocationId, MatterId, MatterTypeId, UserId } from "@magna-carta/identifiers/types";

// Table names tracked against @magna-carta/database's schema by the schema-name-sync fitness test.
export const MATTER_TABLE = "matter";
export const NUMBERING_SCHEME_TABLE = "numbering_scheme";

export type MatterStatus = "prospective" | "open" | "closed";

// The mutable, caller-supplied matter fields (everything bar id, status, the number columns, and the
// lifecycle timestamps the service owns). A full-row UPDATE keeps updateMatterFieldsStatement static.
export interface MatterFields {
  readonly title: string;
  readonly description: string | null;
  readonly matterTypeId: MatterTypeId | null;
  readonly locationId: LocationId | null;
  readonly responsibleMemberId: UserId;
  readonly clientDisplayName: string | null;
  readonly clientCode: string | null;
}

export interface InsertMatterRow extends MatterFields {
  readonly id: MatterId;
  readonly status: MatterStatus;
  readonly matterNumber: string | null;
  readonly numberedAt: string | null;
  readonly openedAt: string | null;
  readonly createdAt: string;
}

export function insertMatterStatement(database: SqlDatabase, row: InsertMatterRow): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MATTER_TABLE} (id, title, description, status, matter_type_id, location_id, responsible_member_id, client_display_name, client_code, matter_number, numbered_at, opened_at, closed_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, NULL, ?13, ?13)`,
    )
    .bind(
      row.id,
      row.title,
      row.description,
      row.status,
      row.matterTypeId,
      row.locationId,
      row.responsibleMemberId,
      row.clientDisplayName,
      row.clientCode,
      row.matterNumber,
      row.numberedAt,
      row.openedAt,
      row.createdAt,
    );
}

export interface MatterRow extends MatterFields {
  readonly id: MatterId;
  readonly status: MatterStatus;
  readonly matterNumber: string | null;
  // The honest "was this matter ever opened" signal: set by createMatter (status 'open') and by
  // openMatter, never by renumberMatter — so reopen restores the real pre-close status.
  readonly openedAt: string | null;
}

export function selectMatterStatement(database: SqlDatabase, id: MatterId): SqlStatement {
  return database
    .prepare(
      `SELECT id, title, description, status, matter_type_id, location_id, responsible_member_id, client_display_name, client_code, matter_number, opened_at FROM ${MATTER_TABLE} WHERE id = ?1`,
    )
    .bind(id);
}

// The DISPLAY read, separate from selectMatterStatement above on purpose. That one serves the
// lifecycle service, which decides open/close preconditions and has no business paying for three
// joins to learn a name it will not print. This one serves the matter screens, which cannot render
// "matter type" as a matterType_ handle.
//
// The names are resolved HERE rather than by the caller, because the alternative is three more
// round trips per matter view and the joins are on primary keys. All three are LEFT joins: a matter
// carries no type or Location until the firm sets one, and a member row can be archived while the
// matters they were responsible for stay open. A missing name reads as null and the screen says so,
// which is the honest answer — an id rendered as a name would be worse than a gap.
export function selectMatterDetailStatement(database: SqlDatabase, id: MatterId): SqlStatement {
  return database
    .prepare(
      `SELECT matter.id AS id,
              matter.title AS title,
              matter.description AS description,
              matter.status AS status,
              matter.matter_type_id AS matter_type_id,
              matter.location_id AS location_id,
              matter.responsible_member_id AS responsible_member_id,
              matter.client_display_name AS client_display_name,
              matter.client_code AS client_code,
              matter.matter_number AS matter_number,
              matter.e_billing AS e_billing,
              matter.opened_at AS opened_at,
              matter.closed_at AS closed_at,
              matter.created_at AS created_at,
              matter_type.name AS matter_type_name,
              location.name AS location_name,
              member.display_name AS responsible_member_name
         FROM ${MATTER_TABLE} AS matter
         LEFT JOIN matter_type ON matter_type.id = matter.matter_type_id
         LEFT JOIN location ON location.id = matter.location_id
         LEFT JOIN member ON member.user_id = matter.responsible_member_id
        WHERE matter.id = ?1`,
    )
    .bind(id);
}

// The number draw on an existing prospective: prospective -> open, carrying the rendered number and
// its draw/open instants. The matter_number UNIQUE index aborts the batch on a colliding draw.
//
// `status = 'prospective'` is the in-batch belt behind the service's read-then-write precondition:
// D1 has no interactive transaction, so a concurrent open (or a close) can land between that read
// and this commit. Without the predicate the second writer silently rewrites an already-open
// matter's frozen number and its opened_at. With it the UPDATE matches zero rows instead, and the
// service confirms after the commit that the row really carries the number this call drew.
export function openMatterStatement(
  database: SqlDatabase,
  id: MatterId,
  matterNumber: string,
  openedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MATTER_TABLE} SET status = 'open', matter_number = ?2, numbered_at = ?3, opened_at = ?3, updated_at = ?3 WHERE id = ?1 AND status = 'prospective'`,
    )
    .bind(id, matterNumber, openedAt);
}

export function updateMatterFieldsStatement(
  database: SqlDatabase,
  id: MatterId,
  fields: MatterFields,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MATTER_TABLE} SET title = ?2, description = ?3, matter_type_id = ?4, location_id = ?5, responsible_member_id = ?6, client_display_name = ?7, client_code = ?8, updated_at = ?9 WHERE id = ?1`,
    )
    .bind(
      id,
      fields.title,
      fields.description,
      fields.matterTypeId,
      fields.locationId,
      fields.responsibleMemberId,
      fields.clientDisplayName,
      fields.clientCode,
      updatedAt,
    );
}

// closed_at is the instant retention and archival clocks run from, so a re-close must never move it.
// `status != 'closed'` is the in-batch belt behind the service's already-closed refusal: a close
// racing another close matches zero rows here instead of stamping a second, later closed_at.
export function closeMatterStatement(
  database: SqlDatabase,
  id: MatterId,
  closedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MATTER_TABLE} SET status = 'closed', closed_at = ?2, updated_at = ?2 WHERE id = ?1 AND status != 'closed'`,
    )
    .bind(id, closedAt);
}

export function reopenMatterStatement(
  database: SqlDatabase,
  id: MatterId,
  status: "open" | "prospective",
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MATTER_TABLE} SET status = ?2, closed_at = NULL, updated_at = ?3 WHERE id = ?1`,
    )
    .bind(id, status, updatedAt);
}

// Manual / court / legacy number entry — never touches a counter. A collision with an existing
// number aborts on the matter_number UNIQUE index (the caller surfaces it as a named code).
export function renumberMatterStatement(
  database: SqlDatabase,
  id: MatterId,
  matterNumber: string,
  numberedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MATTER_TABLE} SET matter_number = ?2, numbered_at = ?3, updated_at = ?3 WHERE id = ?1`,
    )
    .bind(id, matterNumber, numberedAt);
}

// The one active scheme (a single active row is enforced in the scheme write path). segments is the
// JSON the renderer parses via numberingSchemeSchema.
export function selectActiveSchemeStatement(database: SqlDatabase): SqlStatement {
  return database.prepare(`SELECT id, segments FROM ${NUMBERING_SCHEME_TABLE} WHERE active = 1`);
}

// A colliding matter_number aborts the draw batch on the UNIQUE index. Mirrors isIdempotencyKeyConflict.
export function isMatterNumberConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("UNIQUE constraint failed") &&
    error.message.includes(`${MATTER_TABLE}.matter_number`)
  );
}
