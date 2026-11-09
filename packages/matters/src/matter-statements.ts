import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { LocationId, MatterId, MatterTypeId, UserId } from "@magna-carta/identifiers/types";
import type { NumberingPurpose } from "@magna-carta/sequence-numbering/purposes";

// Table name tracked against @magna-carta/database's schema by the schema-name-sync fitness test.
export const MATTER_TABLE = "matter";

// The lifecycle, in the order a matter passes through it. An intake draws its own number as soon as
// it exists; it becomes a consultation when the firm's intake procedure lets it through (the
// consultation number is drawn then, BESIDE the intake number rather than over it); a consultation
// opens (the matter number is drawn then, beside both). Nothing is ever replaced, so a note filed
// under any of the three still resolves. An open matter can be put on hold for a recorded reason and
// released back to open; an open or held matter closes; a closed matter reopens to where it was. No
// number is drawn or surrendered on either side of a hold.
export type MatterStatus = "intake" | "consultation" | "open" | "hold" | "closed";

// The three sequences a matter's lifecycle draws from, each a purpose on the firm-wide numbering
// register (@magna-carta/sequence-numbering/purposes) with its own active scheme: the permanent
// matter number, the tentative number a consultation carries, and the number an intake wears from
// the moment the enquiry is written down. Kept apart so a rung that goes no further consumes nothing
// from a run it never reached — a gap in the matter run reads as a lost file, and a consultation
// run pitted with declined enquiries cannot be told apart from one with records missing.
export type MatterNumberingPurpose = Extract<
  NumberingPurpose,
  "matter" | "consultation" | "intake"
>;

// The mutable, caller-supplied matter fields (everything bar id, status, the number columns, and the
// lifecycle timestamps the service owns). A full-row UPDATE keeps updateMatterFieldsStatement static.
export interface MatterFields {
  readonly title: string;
  readonly description: string | null;
  readonly matterTypeId: MatterTypeId | null;
  readonly locationId: LocationId | null;
  /**
   * The office the firm's own PAPER file for this matter is kept at — a different fact from
   * `locationId`, the office the matter is run out of. A file travels: a matter opened at one
   * office can have its folder boxed at another, or at a remote store the firm keeps as an office
   * of its own, and closing the matter moves none of that. Null until somebody records it.
   */
  readonly physicalFileLocationId: LocationId | null;
  readonly responsibleMemberId: UserId;
  readonly clientDisplayName: string | null;
  readonly clientCode: string | null;
}

export interface InsertMatterRow extends MatterFields {
  readonly id: MatterId;
  readonly status: MatterStatus;
  readonly matterNumber: string | null;
  // Drawn in this same batch for a consultation; null for a matter created straight to open.
  readonly consultationNumber: string | null;
  // Drawn in this same batch for an intake; null for a matter created at any later rung.
  readonly intakeNumber: string | null;
  readonly numberedAt: string | null;
  readonly openedAt: string | null;
  readonly createdAt: string;
}

export function insertMatterStatement(database: SqlDatabase, row: InsertMatterRow): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MATTER_TABLE} (id, title, description, status, matter_type_id, location_id, physical_file_location_id, responsible_member_id, client_display_name, client_code, matter_number, consultation_number, intake_number, numbered_at, opened_at, closed_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, NULL, ?16, ?16)`,
    )
    .bind(
      row.id,
      row.title,
      row.description,
      row.status,
      row.matterTypeId,
      row.locationId,
      row.physicalFileLocationId,
      row.responsibleMemberId,
      row.clientDisplayName,
      row.clientCode,
      row.matterNumber,
      row.consultationNumber,
      row.intakeNumber,
      row.numberedAt,
      row.openedAt,
      row.createdAt,
    );
}

export interface MatterRow extends MatterFields {
  readonly id: MatterId;
  readonly status: MatterStatus;
  readonly matterNumber: string | null;
  readonly consultationNumber: string | null;
  readonly intakeNumber: string | null;
  // The honest "was this matter ever opened" signal: set by createMatter (status 'open') and by
  // openMatter, never by renumberMatter — so reopen restores the real pre-close status.
  readonly openedAt: string | null;
  // Set while the matter is on hold, and left standing by a close so a reopen returns the matter to
  // the hold it was in. Null on every matter that is not held.
  readonly heldAt: string | null;
  readonly holdReason: string | null;
}

export function selectMatterStatement(database: SqlDatabase, id: MatterId): SqlStatement {
  return database
    .prepare(
      `SELECT id, title, description, status, matter_type_id, location_id, physical_file_location_id, responsible_member_id, client_display_name, client_code, matter_number, consultation_number, intake_number, opened_at, held_at, hold_reason FROM ${MATTER_TABLE} WHERE id = ?1`,
    )
    .bind(id);
}

// The DISPLAY read, separate from selectMatterStatement above on purpose. That one serves the
// lifecycle service, which decides open/close preconditions and has no business paying for three
// joins to learn a name it will not print. This one serves the matter screens, which cannot render
// "matter type" as a matterType_ handle.
//
// The names are resolved HERE rather than by the caller, because the alternative is a round trip per
// name per matter view and the joins are on primary keys. Every one is a LEFT join: a matter carries
// no type, no Location and no recorded paper-file office until somebody sets one, and a member row
// can be archived while the matters they were responsible for stay open. A missing name reads as
// null and the screen says so, which is the honest answer — an id rendered as a name would be worse
// than a gap.
//
// `location` is joined twice under two aliases because a matter names two different offices: the one
// it is RUN OUT OF, and the one its paper file is KEPT AT. They are commonly the same office and are
// never the same fact.
export function selectMatterDetailStatement(database: SqlDatabase, id: MatterId): SqlStatement {
  return database
    .prepare(
      `SELECT matter.id AS id,
              matter.title AS title,
              matter.description AS description,
              matter.status AS status,
              matter.matter_type_id AS matter_type_id,
              matter.location_id AS location_id,
              matter.physical_file_location_id AS physical_file_location_id,
              matter.responsible_member_id AS responsible_member_id,
              matter.client_display_name AS client_display_name,
              matter.client_code AS client_code,
              matter.matter_number AS matter_number,
              matter.consultation_number AS consultation_number,
              matter.intake_number AS intake_number,
              matter.e_billing AS e_billing,
              matter.opened_at AS opened_at,
              matter.held_at AS held_at,
              matter.hold_reason AS hold_reason,
              matter.closed_at AS closed_at,
              matter.created_at AS created_at,
              matter_type.name AS matter_type_name,
              location.name AS location_name,
              physical_file_location.name AS physical_file_location_name,
              matter_file_retention.destroy_on AS file_destroy_on,
              member.display_name AS responsible_member_name
         FROM ${MATTER_TABLE} AS matter
         LEFT JOIN matter_type ON matter_type.id = matter.matter_type_id
         LEFT JOIN location ON location.id = matter.location_id
         LEFT JOIN location AS physical_file_location ON physical_file_location.id = matter.physical_file_location_id
         LEFT JOIN matter_file_retention ON matter_file_retention.matter_id = matter.id
         LEFT JOIN member ON member.user_id = matter.responsible_member_id
        WHERE matter.id = ?1`,
    )
    .bind(id);
}

// The number draw on an existing consultation: consultation -> open, carrying the rendered number and
// its draw/open instants. The matter_number UNIQUE index aborts the batch on a colliding draw.
//
// `status = 'consultation'` is the in-batch belt behind the service's read-then-write precondition:
// D1 has no interactive transaction, so a concurrent open (or a close) can land between that read
// and this commit. Without the predicate the second writer silently rewrites an already-open
// matter's frozen number and its opened_at. With it the UPDATE matches zero rows instead, and the
// service confirms after the commit that the row really carries the number this call drew.
// fitness:unguarded-write — constraint-backed — the matter_number UNIQUE index aborts the batch on a colliding draw
export function openMatterStatement(
  database: SqlDatabase,
  id: MatterId,
  matterNumber: string,
  openedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MATTER_TABLE} SET status = 'open', matter_number = ?2, numbered_at = ?3, opened_at = ?3, updated_at = ?3 WHERE id = ?1 AND status = 'consultation'`,
    )
    .bind(id, matterNumber, openedAt);
}

// The consultation-number draw on an intake: intake -> consultation, carrying the tentative number.
// `status = 'intake'` is the same in-batch belt the open carries, for the same race: a concurrent
// graduation (or a close) between the service's read and this commit matches zero rows here rather
// than rewriting a number already drawn, and the service confirms the row carries the number this
// call drew.
// fitness:unguarded-write — a repeat is meant to be a no-op — zero rows means the state it moves to was already reached
export function graduateMatterStatement(
  database: SqlDatabase,
  id: MatterId,
  consultationNumber: string,
  graduatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MATTER_TABLE} SET status = 'consultation', consultation_number = ?2, updated_at = ?3 WHERE id = ?1 AND status = 'intake'`,
    )
    .bind(id, consultationNumber, graduatedAt);
}

export function updateMatterFieldsStatement(
  database: SqlDatabase,
  id: MatterId,
  fields: MatterFields,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MATTER_TABLE} SET title = ?2, description = ?3, matter_type_id = ?4, location_id = ?5, physical_file_location_id = ?6, responsible_member_id = ?7, client_display_name = ?8, client_code = ?9, updated_at = ?10 WHERE id = ?1`,
    )
    .bind(
      id,
      fields.title,
      fields.description,
      fields.matterTypeId,
      fields.locationId,
      fields.physicalFileLocationId,
      fields.responsibleMemberId,
      fields.clientDisplayName,
      fields.clientCode,
      updatedAt,
    );
}

// closed_at is the instant retention and archival clocks run from, so a re-close must never move it.
// `status != 'closed'` is the in-batch belt behind the service's already-closed refusal: a close
// racing another close matches zero rows here instead of stamping a second, later closed_at.
// fitness:unguarded-write — a repeat is meant to be a no-op — zero rows means the state it moves to was already reached
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

// The hold and its release. `status IN ('open', 'consultation')` and `status = 'hold'` are the
// in-batch belts behind the service's read-then-write checks, for the same reason the open carries
// one: a close landing between the read and this commit must not be overwritten by a hold, and a
// release racing a close must not resurrect a closed matter. The release clears the reason with the
// instant, because the two are one fact (matter_hold_check).
//
// A consultation goes on hold as an active matter does: a firm parks a consultation it has not
// decided on. Which of the two a release returns to is the service's to say (it reads opened_at,
// the one honest signal of whether the matter was ever active), so the statement takes the status
// to restore rather than assuming 'open'.
export function holdMatterStatement(
  database: SqlDatabase,
  id: MatterId,
  reason: string,
  heldAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MATTER_TABLE} SET status = 'hold', held_at = ?3, hold_reason = ?2, updated_at = ?3 WHERE id = ?1 AND status IN ('open', 'consultation')`,
    )
    .bind(id, reason, heldAt);
}

export function releaseMatterStatement(
  database: SqlDatabase,
  id: MatterId,
  restored: "open" | "consultation",
  releasedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MATTER_TABLE} SET status = ?2, held_at = NULL, hold_reason = NULL, updated_at = ?3 WHERE id = ?1 AND status = 'hold'`,
    )
    .bind(id, restored, releasedAt);
}

export function reopenMatterStatement(
  database: SqlDatabase,
  id: MatterId,
  status: "open" | "hold" | "consultation" | "intake",
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

// A colliding matter_number aborts the draw batch on the UNIQUE index. Mirrors isIdempotencyKeyConflict.
export function isMatterNumberConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("UNIQUE constraint failed") &&
    error.message.includes(`${MATTER_TABLE}.matter_number`)
  );
}

// The same backstop for the consultation sequence. Matched on the exact column name, not a prefix:
// "matter_number" is a substring of nothing here, but "consultation_number" and "matter_number" are
// distinct indexes and a draw must retry only on its own.
export function isConsultationNumberConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("UNIQUE constraint failed") &&
    error.message.includes(`${MATTER_TABLE}.consultation_number`)
  );
}

// And for the intake sequence. Third of three, each matched on its own column for the same reason:
// a draw that retried on another run's collision would step its own counter past a number nobody
// had taken.
export function isIntakeNumberConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("UNIQUE constraint failed") &&
    error.message.includes(`${MATTER_TABLE}.intake_number`)
  );
}
