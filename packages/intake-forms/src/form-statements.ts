import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  IntakeFormFieldId,
  IntakeFormId,
  IntakeFormSubmissionId,
  IntakeFormVersionId,
  UserId,
} from "@magna-carta/identifiers/types";
import type {
  IntakeFormFieldKind,
  IntakeFormStatus,
  IntakeSubmissionTriageState,
} from "./types.ts";

// Table names tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test.
export const INTAKE_FORM_TABLE = "intake_form";
export const INTAKE_FORM_VERSION_TABLE = "intake_form_version";
export const INTAKE_FORM_FIELD_TABLE = "intake_form_field";
export const INTAKE_FORM_SUBMISSION_TABLE = "intake_form_submission";

// A form carries no matter and therefore no visible-matter predicate — it is firm configuration, the
// posture matter_type and intake_procedure take, and reaching it is governed by intakeForms:manage at
// the route. A SUBMISSION carries no matter either, and that is not an omission: nothing on the
// anonymous path may create one, so a submission belongs to the firm until a member decides
// otherwise.

export interface IntakeFormRow {
  readonly id: IntakeFormId;
  readonly name: string;
  readonly title: string;
  readonly introduction: string | null;
  readonly confirmation_message: string | null;
  readonly public_token: string;
  readonly status: IntakeFormStatus;
  readonly published_version_id: IntakeFormVersionId | null;
  readonly submission_budget_per_day: number | null;
  readonly created_by: UserId;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface IntakeFormVersionRow {
  readonly id: IntakeFormVersionId;
  readonly form_id: IntakeFormId;
  readonly version_number: number;
  readonly published_at: string | null;
  readonly published_by: UserId | null;
  readonly created_at: string;
}

export interface IntakeFormFieldRow {
  readonly id: IntakeFormFieldId;
  readonly form_version_id: IntakeFormVersionId;
  readonly position: number;
  readonly kind: IntakeFormFieldKind;
  readonly label: string;
  readonly help_text: string | null;
  readonly required: number;
  readonly options_json: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface IntakeFormSubmissionRow {
  readonly id: IntakeFormSubmissionId;
  readonly form_version_id: IntakeFormVersionId;
  readonly submitted_at: string;
  readonly answers_json: string;
  readonly triage_state: IntakeSubmissionTriageState;
  readonly triaged_at: string | null;
  readonly triaged_by: UserId | null;
  readonly triage_note: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

const FORM_COLUMNS =
  "id, name, title, introduction, confirmation_message, public_token, status, " +
  "published_version_id, submission_budget_per_day, created_by, created_at, updated_at";
const VERSION_COLUMNS = "id, form_id, version_number, published_at, published_by, created_at";
const FIELD_COLUMNS =
  "id, form_version_id, position, kind, label, help_text, required, options_json, created_at, " +
  "updated_at";
const SUBMISSION_COLUMNS =
  "id, form_version_id, submitted_at, answers_json, triage_state, triaged_at, triaged_by, " +
  "triage_note, created_at, updated_at";

// ---- the form ----

export function insertFormStatement(
  database: SqlDatabase,
  input: {
    readonly id: IntakeFormId;
    readonly name: string;
    readonly title: string;
    readonly introduction: string | null;
    readonly confirmationMessage: string | null;
    readonly publicToken: string;
    readonly createdBy: UserId;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${INTAKE_FORM_TABLE} (id, name, title, introduction, confirmation_message, ` +
        `public_token, status, published_version_id, submission_budget_per_day, created_by, ` +
        `created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'draft', NULL, NULL, ?7, ?8, ?8)`,
    )
    .bind(
      input.id,
      input.name,
      input.title,
      input.introduction,
      input.confirmationMessage,
      input.publicToken,
      input.createdBy,
      input.now,
    );
}

export function updateFormStatement(
  database: SqlDatabase,
  input: {
    readonly id: IntakeFormId;
    readonly name: string;
    readonly title: string;
    readonly introduction: string | null;
    readonly confirmationMessage: string | null;
    readonly submissionBudgetPerDay: number | null;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${INTAKE_FORM_TABLE} SET name = ?1, title = ?2, introduction = ?3, ` +
        `confirmation_message = ?4, submission_budget_per_day = ?5, updated_at = ?6 WHERE id = ?7`,
    )
    .bind(
      input.name,
      input.title,
      input.introduction,
      input.confirmationMessage,
      input.submissionBudgetPerDay,
      input.now,
      input.id,
    );
}

/**
 * Publish: point the form at a version and mark it reachable, in one statement.
 *
 * The two facts move together on purpose — the database CHECK refuses a published form with no
 * version, so splitting them into two statements would make the intermediate state impossible to
 * commit rather than merely wrong.
 */
export function publishFormStatement(
  database: SqlDatabase,
  input: {
    readonly id: IntakeFormId;
    readonly versionId: IntakeFormVersionId;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${INTAKE_FORM_TABLE} SET status = 'published', published_version_id = ?1, ` +
        `updated_at = ?2 WHERE id = ?3`,
    )
    .bind(input.versionId, input.now, input.id);
}

/**
 * Close or reopen a form.
 *
 * A closed form keeps its published version and its token: closing is how a firm stops taking
 * enquiries, not how it destroys the record of what it asked. The public route reads `status` and
 * answers a closed form exactly as it answers a token that never existed.
 */
export function setFormStatusStatement(
  database: SqlDatabase,
  id: IntakeFormId,
  status: IntakeFormStatus,
  now: string,
): SqlStatement {
  return database
    .prepare(`UPDATE ${INTAKE_FORM_TABLE} SET status = ?1, updated_at = ?2 WHERE id = ?3`)
    .bind(status, now, id);
}

/** Rotate the public link. The old token stops resolving; the form, its versions and its submissions stand. */
export function rotatePublicTokenStatement(
  database: SqlDatabase,
  id: IntakeFormId,
  publicToken: string,
  now: string,
): SqlStatement {
  return database
    .prepare(`UPDATE ${INTAKE_FORM_TABLE} SET public_token = ?1, updated_at = ?2 WHERE id = ?3`)
    .bind(publicToken, now, id);
}

export function selectFormsStatement(database: SqlDatabase, limit: number): SqlStatement {
  return database
    .prepare(`SELECT ${FORM_COLUMNS} FROM ${INTAKE_FORM_TABLE} ORDER BY name ASC, id ASC LIMIT ?1`)
    .bind(limit);
}

export async function readForm(
  database: SqlDatabase,
  id: IntakeFormId,
): Promise<IntakeFormRow | undefined> {
  const { results } = await database
    .prepare(`SELECT ${FORM_COLUMNS} FROM ${INTAKE_FORM_TABLE} WHERE id = ?1`)
    .bind(id)
    .all<IntakeFormRow>();
  return results[0];
}

/**
 * THE PUBLIC ROUTE'S ONLY LOOKUP, and the one read on this path that touches the firm's database
 * before a submission is written.
 *
 * It is keyed by the URL and by nothing the visitor typed, which is what keeps it outside the
 * disclosure rule: its cost does not vary with the content of a submission, so it hands a probing
 * script no oracle. The status filter is here rather than at the caller so that a draft form and a
 * closed form are indistinguishable from a token that never existed — a route that fetched the row
 * and then decided would answer measurably differently for a form that exists.
 */
export async function readPublishedFormByToken(
  database: SqlDatabase,
  publicToken: string,
): Promise<IntakeFormRow | undefined> {
  const { results } = await database
    .prepare(
      `SELECT ${FORM_COLUMNS} FROM ${INTAKE_FORM_TABLE} WHERE public_token = ?1 AND status = 'published'`,
    )
    .bind(publicToken)
    .all<IntakeFormRow>();
  return results[0];
}

// ---- versions ----

export function insertVersionStatement(
  database: SqlDatabase,
  input: {
    readonly id: IntakeFormVersionId;
    readonly formId: IntakeFormId;
    readonly versionNumber: number;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${INTAKE_FORM_VERSION_TABLE} (id, form_id, version_number, published_at, ` +
        `published_by, created_at) VALUES (?1, ?2, ?3, NULL, NULL, ?4)`,
    )
    .bind(input.id, input.formId, input.versionNumber, input.now);
}

export function stampVersionPublishedStatement(
  database: SqlDatabase,
  input: {
    readonly id: IntakeFormVersionId;
    readonly publishedBy: UserId;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${INTAKE_FORM_VERSION_TABLE} SET published_at = ?1, published_by = ?2 WHERE id = ?3`,
    )
    .bind(input.now, input.publishedBy, input.id);
}

/**
 * The form's working draft — the one version that has never been published.
 *
 * At most one exists at a time. A form whose latest version is published has no draft until the next
 * edit creates one, which is what makes "editing a published form" a new version rather than a
 * rewrite of the one strangers already answered.
 */
export async function readDraftVersion(
  database: SqlDatabase,
  formId: IntakeFormId,
): Promise<IntakeFormVersionRow | undefined> {
  const { results } = await database
    .prepare(
      `SELECT ${VERSION_COLUMNS} FROM ${INTAKE_FORM_VERSION_TABLE} ` +
        `WHERE form_id = ?1 AND published_at IS NULL ORDER BY version_number DESC LIMIT 1`,
    )
    .bind(formId)
    .all<IntakeFormVersionRow>();
  return results[0];
}

export async function readVersion(
  database: SqlDatabase,
  id: IntakeFormVersionId,
): Promise<IntakeFormVersionRow | undefined> {
  const { results } = await database
    .prepare(`SELECT ${VERSION_COLUMNS} FROM ${INTAKE_FORM_VERSION_TABLE} WHERE id = ?1`)
    .bind(id)
    .all<IntakeFormVersionRow>();
  return results[0];
}

export async function readHighestVersionNumber(
  database: SqlDatabase,
  formId: IntakeFormId,
): Promise<number> {
  const { results } = await database
    .prepare(
      `SELECT COALESCE(MAX(version_number), 0) AS highest FROM ${INTAKE_FORM_VERSION_TABLE} WHERE form_id = ?1`,
    )
    .bind(formId)
    .all<{ readonly highest: number }>();
  return results[0]?.highest ?? 0;
}

// ---- fields ----

export function insertFieldStatement(
  database: SqlDatabase,
  input: {
    readonly id: IntakeFormFieldId;
    readonly formVersionId: IntakeFormVersionId;
    readonly position: number;
    readonly kind: IntakeFormFieldKind;
    readonly label: string;
    readonly helpText: string | null;
    readonly required: boolean;
    readonly optionsJson: string | null;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${INTAKE_FORM_FIELD_TABLE} (id, form_version_id, position, kind, label, ` +
        `help_text, required, options_json, created_at, updated_at) ` +
        `VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)`,
    )
    .bind(
      input.id,
      input.formVersionId,
      input.position,
      input.kind,
      input.label,
      input.helpText,
      input.required ? 1 : 0,
      input.optionsJson,
      input.now,
    );
}

export function updateFieldStatement(
  database: SqlDatabase,
  input: {
    readonly id: IntakeFormFieldId;
    readonly kind: IntakeFormFieldKind;
    readonly label: string;
    readonly helpText: string | null;
    readonly required: boolean;
    readonly optionsJson: string | null;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${INTAKE_FORM_FIELD_TABLE} SET kind = ?1, label = ?2, help_text = ?3, ` +
        `required = ?4, options_json = ?5, updated_at = ?6 WHERE id = ?7`,
    )
    .bind(
      input.kind,
      input.label,
      input.helpText,
      input.required ? 1 : 0,
      input.optionsJson,
      input.now,
      input.id,
    );
}

export function setFieldPositionStatement(
  database: SqlDatabase,
  id: IntakeFormFieldId,
  position: number,
  now: string,
): SqlStatement {
  return database
    .prepare(`UPDATE ${INTAKE_FORM_FIELD_TABLE} SET position = ?1, updated_at = ?2 WHERE id = ?3`)
    .bind(position, now, id);
}

/**
 * Remove a question from a DRAFT version.
 *
 * A hard delete, and legitimately so: this is the only table in the subsystem where one is safe,
 * because a draft version has never been served to anybody and no submission can name its fields.
 * The service enforces the draft-only rule; the row itself carries no evidence of who answered it,
 * since answers hang from published versions.
 */
export function deleteFieldStatement(database: SqlDatabase, id: IntakeFormFieldId): SqlStatement {
  return database.prepare(`DELETE FROM ${INTAKE_FORM_FIELD_TABLE} WHERE id = ?1`).bind(id);
}

export async function readFields(
  database: SqlDatabase,
  formVersionId: IntakeFormVersionId,
): Promise<readonly IntakeFormFieldRow[]> {
  const { results } = await database
    .prepare(
      `SELECT ${FIELD_COLUMNS} FROM ${INTAKE_FORM_FIELD_TABLE} WHERE form_version_id = ?1 ` +
        `ORDER BY position ASC, id ASC`,
    )
    .bind(formVersionId)
    .all<IntakeFormFieldRow>();
  return results;
}

export async function readField(
  database: SqlDatabase,
  id: IntakeFormFieldId,
): Promise<IntakeFormFieldRow | undefined> {
  const { results } = await database
    .prepare(`SELECT ${FIELD_COLUMNS} FROM ${INTAKE_FORM_FIELD_TABLE} WHERE id = ?1`)
    .bind(id)
    .all<IntakeFormFieldRow>();
  return results[0];
}

// ---- submissions ----

export function insertSubmissionStatement(
  database: SqlDatabase,
  input: {
    readonly id: IntakeFormSubmissionId;
    readonly formVersionId: IntakeFormVersionId;
    readonly answersJson: string;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${INTAKE_FORM_SUBMISSION_TABLE} (id, form_version_id, submitted_at, ` +
        `answers_json, triage_state, triaged_at, triaged_by, triage_note, created_at, updated_at) ` +
        `VALUES (?1, ?2, ?3, ?4, 'new', NULL, NULL, NULL, ?3, ?3)`,
    )
    .bind(input.id, input.formVersionId, input.now, input.answersJson);
}

export function recordTriageStatement(
  database: SqlDatabase,
  input: {
    readonly id: IntakeFormSubmissionId;
    readonly state: IntakeSubmissionTriageState;
    readonly note: string | null;
    readonly triagedBy: UserId;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${INTAKE_FORM_SUBMISSION_TABLE} SET triage_state = ?1, triaged_at = ?2, ` +
        `triaged_by = ?3, triage_note = ?4, updated_at = ?2 WHERE id = ?5`,
    )
    .bind(input.state, input.now, input.triagedBy, input.note, input.id);
}

/**
 * The queue, newest first, across every version of one form.
 *
 * Joined to the version rather than filtered by it, because a firm reading its queue wants what
 * arrived — not what arrived through the questions it happens to be asking this week.
 */
export function selectSubmissionsStatement(
  database: SqlDatabase,
  options: {
    readonly formId: IntakeFormId;
    readonly state: IntakeSubmissionTriageState | null;
    readonly limit: number;
  },
): SqlStatement {
  const stateFilter = options.state === null ? "" : "AND submission.triage_state = ?3 ";
  const statement = database.prepare(
    `SELECT ${SUBMISSION_COLUMNS.split(", ")
      .map((column) => `submission.${column}`)
      .join(", ")} ` +
      `FROM ${INTAKE_FORM_SUBMISSION_TABLE} AS submission ` +
      `JOIN ${INTAKE_FORM_VERSION_TABLE} AS version ON version.id = submission.form_version_id ` +
      `WHERE version.form_id = ?1 ${stateFilter}` +
      `ORDER BY submission.submitted_at DESC, submission.id DESC LIMIT ?2`,
  );
  return options.state === null
    ? statement.bind(options.formId, options.limit)
    : statement.bind(options.formId, options.limit, options.state);
}

export async function readSubmission(
  database: SqlDatabase,
  id: IntakeFormSubmissionId,
): Promise<IntakeFormSubmissionRow | undefined> {
  const { results } = await database
    .prepare(`SELECT ${SUBMISSION_COLUMNS} FROM ${INTAKE_FORM_SUBMISSION_TABLE} WHERE id = ?1`)
    .bind(id)
    .all<IntakeFormSubmissionRow>();
  return results[0];
}

/** How many submissions are waiting on a member, per form — the count the forms list shows. */
export async function readWaitingCounts(
  database: SqlDatabase,
): Promise<ReadonlyMap<IntakeFormId, number>> {
  const { results } = await database
    .prepare(
      `SELECT version.form_id AS form_id, COUNT(*) AS waiting ` +
        `FROM ${INTAKE_FORM_SUBMISSION_TABLE} AS submission ` +
        `JOIN ${INTAKE_FORM_VERSION_TABLE} AS version ON version.id = submission.form_version_id ` +
        `WHERE submission.triage_state = 'new' GROUP BY version.form_id`,
    )
    .all<{ readonly form_id: IntakeFormId; readonly waiting: number }>();
  return new Map(results.map((row) => [row.form_id, row.waiting]));
}

/**
 * How many submissions one form has taken since an instant — the per-form daily budget's read.
 *
 * Counted over the form's versions rather than its published one, so republishing mid-day does not
 * hand a flood a fresh allowance.
 */
export async function countSubmissionsSince(
  database: SqlDatabase,
  formId: IntakeFormId,
  since: string,
): Promise<number> {
  const { results } = await database
    .prepare(
      `SELECT COUNT(*) AS taken FROM ${INTAKE_FORM_SUBMISSION_TABLE} AS submission ` +
        `JOIN ${INTAKE_FORM_VERSION_TABLE} AS version ON version.id = submission.form_version_id ` +
        `WHERE version.form_id = ?1 AND submission.submitted_at >= ?2`,
    )
    .bind(formId, since)
    .all<{ readonly taken: number }>();
  return results[0]?.taken ?? 0;
}
