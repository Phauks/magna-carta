import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { cryptoRandomSource, type RandomSource } from "@magna-carta/identifiers/random";
import type {
  IntakeFormFieldId,
  IntakeFormId,
  IntakeFormVersionId,
  UserId,
} from "@magna-carta/identifiers/types";
import {
  deleteFieldStatement,
  insertFieldStatement,
  insertFormStatement,
  insertVersionStatement,
  publishFormStatement,
  readDraftVersion,
  readField,
  readFields,
  readForm,
  readHighestVersionNumber,
  readVersion,
  rotatePublicTokenStatement,
  setFieldPositionStatement,
  setFormStatusStatement,
  stampVersionPublishedStatement,
  updateFieldStatement,
  updateFormStatement,
  type IntakeFormRow,
  type IntakeFormVersionRow,
} from "./form-statements.ts";
import { MAX_FIELDS_PER_VERSION, PUBLIC_TOKEN_ENTROPY_BYTES } from "./types.ts";
import {
  IntakeFormValidationError,
  normalizeConfirmationMessage,
  normalizeFieldShape,
  normalizeFormIntroduction,
  normalizeFormName,
  normalizeFormTitle,
  normalizeSubmissionBudget,
} from "./validation.ts";

// AUTHORING A PUBLIC INTAKE FORM — what the firm asks a stranger, and where its link points.
//
// The one rule the whole file is arranged around: A PUBLISHED VERSION IS FROZEN. Nothing here edits
// a version that has been published, and every edit path routes through the working draft instead,
// creating one if the last version was published. A firm that changes its questions must still be
// able to read what an old submission was actually asked, and a submission names its version — so a
// rewrite would silently re-caption answers people gave to a different question.
//
// The corollary is that draft fields CAN be deleted outright, which is the only hard delete in the
// subsystem and is safe for exactly the same reason: a draft has never been served to anybody, so no
// submission can name its fields.

export interface FormServiceOptions {
  readonly clock: { now(): string };
  readonly actorUserId: UserId;
  readonly randomSource?: RandomSource;
}

export interface FormInput {
  readonly name: string;
  readonly title: string;
  readonly introduction?: string | null;
  readonly confirmationMessage?: string | null;
  readonly submissionBudgetPerDay?: number | null;
}

export interface FieldInput {
  readonly kind: string;
  readonly label: string;
  readonly helpText?: string | null;
  readonly required?: boolean | null;
  readonly options?: readonly string[] | null;
}

function audit(
  database: SqlDatabase,
  options: FormServiceOptions,
  event: string,
  subjectId: string,
  metadata?: unknown,
): SqlStatement {
  return domainAuditStatement(database, {
    event,
    subjectId,
    actorUserId: options.actorUserId,
    clock: options.clock,
    randomSource: options.randomSource,
    metadata,
  });
}

/**
 * Mint a public token.
 *
 * Sized as a secret rather than as an identifier (see `PUBLIC_TOKEN_ENTROPY_BYTES`) and encoded
 * URL-safe, because it is a path segment. `crypto.getRandomValues` is the platform CSPRNG on every
 * runtime this ships to; the injectable source exists so fixtures can mint byte-deterministic tokens
 * and for no other reason.
 */
export function mintPublicToken(randomSource: RandomSource = cryptoRandomSource): string {
  const bytes = randomSource(PUBLIC_TOKEN_ENTROPY_BYTES);
  let binary = "";
  for (const byte of bytes) binary += String.fromCodePoint(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function requireForm(database: SqlDatabase, id: IntakeFormId): Promise<IntakeFormRow> {
  const form = await readForm(database, id);
  if (form === undefined) {
    throw new IntakeFormValidationError("form-unknown", `no such intake form: ${id}`);
  }
  return form;
}

/**
 * The version a firm's next edit lands on.
 *
 * Returns the existing working draft, or composes the statements that open a new one. A caller that
 * gets back `statements` MUST commit them in the same batch as the edit itself — the draft and the
 * change to it are one act, and a draft created by an edit that then failed would leave a form with
 * an empty version nobody asked for.
 */
async function draftVersionFor(
  database: SqlDatabase,
  options: FormServiceOptions,
  formId: IntakeFormId,
): Promise<{
  readonly versionId: IntakeFormVersionId;
  readonly statements: readonly SqlStatement[];
  readonly carriedFields: readonly SqlStatement[];
}> {
  const existing = await readDraftVersion(database, formId);
  if (existing !== undefined) {
    return { versionId: existing.id, statements: [], carriedFields: [] };
  }

  const now = options.clock.now();
  const versionId = newIdentifier("intakeFormVersion", options.randomSource);
  const highest = await readHighestVersionNumber(database, formId);
  const openDraft = insertVersionStatement(database, {
    id: versionId,
    formId,
    versionNumber: highest + 1,
    now,
  });

  // A new draft starts as a COPY of the published version, not as a blank page. Editing one question
  // on a live form must not silently drop the other nine, and the alternative — asking the firm to
  // retype the form to change a label — is how a firm ends up never correcting a typo.
  const previous = await readPublishedFieldsForCarry(database, formId);
  const carriedFields = previous.map((field, index) =>
    insertFieldStatement(database, {
      id: newIdentifier("intakeFormField", options.randomSource),
      formVersionId: versionId,
      position: index,
      kind: field.kind,
      label: field.label,
      helpText: field.help_text,
      required: field.required === 1,
      optionsJson: field.options_json,
      now,
    }),
  );

  return { versionId, statements: [openDraft], carriedFields };
}

async function readPublishedFieldsForCarry(database: SqlDatabase, formId: IntakeFormId) {
  const form = await readForm(database, formId);
  if (form?.published_version_id == null) return [];
  return readFields(database, form.published_version_id);
}

export async function createForm(
  database: SqlDatabase,
  input: FormInput,
  options: FormServiceOptions,
): Promise<{ readonly formId: IntakeFormId; readonly effect: EffectWrite }> {
  const name = normalizeFormName(input.name);
  const title = normalizeFormTitle(input.title);
  const introduction = normalizeFormIntroduction(input.introduction);
  const confirmationMessage = normalizeConfirmationMessage(input.confirmationMessage);

  const now = options.clock.now();
  const formId = newIdentifier("intakeForm", options.randomSource);
  const versionId = newIdentifier("intakeFormVersion", options.randomSource);

  return {
    formId,
    effect: {
      statements: [
        insertFormStatement(database, {
          id: formId,
          name,
          title,
          introduction,
          confirmationMessage,
          publicToken: mintPublicToken(options.randomSource),
          createdBy: options.actorUserId,
          now,
        }),
        // Every form is born with a working draft, so the builder has somewhere to put the first
        // question without a special case for "the form has no version yet".
        insertVersionStatement(database, { id: versionId, formId, versionNumber: 1, now }),
        audit(database, options, "intakeForm.created", formId, { name }),
      ],
      outboxMessages: [],
    },
  };
}

export async function editForm(
  database: SqlDatabase,
  formId: IntakeFormId,
  input: FormInput,
  options: FormServiceOptions,
): Promise<EffectWrite> {
  await requireForm(database, formId);
  const name = normalizeFormName(input.name);
  const title = normalizeFormTitle(input.title);

  // The form's own settings — its name, what a visitor reads at the top, what they are told
  // afterwards — are NOT part of the frozen version. They are not questions, so nothing answered
  // them, and a firm fixing a typo in its own title should not be made to republish.
  return {
    statements: [
      updateFormStatement(database, {
        id: formId,
        name,
        title,
        introduction: normalizeFormIntroduction(input.introduction),
        confirmationMessage: normalizeConfirmationMessage(input.confirmationMessage),
        submissionBudgetPerDay: normalizeSubmissionBudget(input.submissionBudgetPerDay),
        now: options.clock.now(),
      }),
      audit(database, options, "intakeForm.edited", formId),
    ],
    outboxMessages: [],
  };
}

export async function addField(
  database: SqlDatabase,
  formId: IntakeFormId,
  input: FieldInput,
  options: FormServiceOptions,
): Promise<EffectWrite> {
  await requireForm(database, formId);
  const shape = normalizeFieldShape(input);
  const draft = await draftVersionFor(database, options, formId);

  const existing = await readFields(database, draft.versionId);
  const total = existing.length + draft.carriedFields.length;
  if (total >= MAX_FIELDS_PER_VERSION) {
    throw new IntakeFormValidationError(
      "field-too-many",
      `a form asks at most ${String(MAX_FIELDS_PER_VERSION)} questions`,
    );
  }

  const now = options.clock.now();
  return {
    statements: [
      ...draft.statements,
      ...draft.carriedFields,
      insertFieldStatement(database, {
        id: newIdentifier("intakeFormField", options.randomSource),
        formVersionId: draft.versionId,
        position: total,
        kind: shape.kind,
        label: shape.label,
        helpText: shape.helpText,
        required: shape.required,
        optionsJson: shape.options === null ? null : JSON.stringify(shape.options),
        now,
      }),
      audit(database, options, "intakeForm.fieldAdded", formId, { kind: shape.kind }),
    ],
    outboxMessages: [],
  };
}

/**
 * Refuse an edit aimed at a version that has been published.
 *
 * The builder only ever offers the draft, so reaching this is a stale page or a hand-rolled caller —
 * but it is the invariant the whole subsystem rests on, so it is enforced here rather than assumed
 * from the interface.
 */
async function requireDraftField(
  database: SqlDatabase,
  fieldId: IntakeFormFieldId,
): Promise<{ readonly versionId: IntakeFormVersionId }> {
  const field = await readField(database, fieldId);
  if (field === undefined) {
    throw new IntakeFormValidationError("field-unknown", `no such question: ${fieldId}`);
  }
  const version = await readVersionRow(database, field.form_version_id);
  if (version.published_at !== null) {
    throw new IntakeFormValidationError(
      "form-not-draftable",
      "this question belongs to a published version and cannot be changed; edit the draft instead",
    );
  }
  return { versionId: field.form_version_id };
}

async function readVersionRow(
  database: SqlDatabase,
  versionId: IntakeFormVersionId,
): Promise<IntakeFormVersionRow> {
  const version = await readVersion(database, versionId);
  if (version === undefined) {
    throw new IntakeFormValidationError("form-unknown", `no such form version: ${versionId}`);
  }
  return version;
}

export async function editField(
  database: SqlDatabase,
  formId: IntakeFormId,
  fieldId: IntakeFormFieldId,
  input: FieldInput,
  options: FormServiceOptions,
): Promise<EffectWrite> {
  await requireForm(database, formId);
  await requireDraftField(database, fieldId);
  const shape = normalizeFieldShape(input);

  return {
    statements: [
      updateFieldStatement(database, {
        id: fieldId,
        kind: shape.kind,
        label: shape.label,
        helpText: shape.helpText,
        required: shape.required,
        optionsJson: shape.options === null ? null : JSON.stringify(shape.options),
        now: options.clock.now(),
      }),
      audit(database, options, "intakeForm.fieldEdited", formId, { fieldId }),
    ],
    outboxMessages: [],
  };
}

export async function removeField(
  database: SqlDatabase,
  formId: IntakeFormId,
  fieldId: IntakeFormFieldId,
  options: FormServiceOptions,
): Promise<EffectWrite> {
  await requireForm(database, formId);
  const { versionId } = await requireDraftField(database, fieldId);

  // Close the gap the removal leaves, so positions stay dense and a later insert lands where the
  // builder says it will.
  const remaining = (await readFields(database, versionId)).filter((field) => field.id !== fieldId);
  const now = options.clock.now();

  return {
    statements: [
      deleteFieldStatement(database, fieldId),
      ...remaining.map((field, index) => setFieldPositionStatement(database, field.id, index, now)),
      audit(database, options, "intakeForm.fieldRemoved", formId, { fieldId }),
    ],
    outboxMessages: [],
  };
}

export async function reorderFields(
  database: SqlDatabase,
  formId: IntakeFormId,
  orderedFieldIds: readonly IntakeFormFieldId[],
  options: FormServiceOptions,
): Promise<EffectWrite> {
  await requireForm(database, formId);
  const now = options.clock.now();
  const statements: SqlStatement[] = [];
  for (const [index, fieldId] of orderedFieldIds.entries()) {
    await requireDraftField(database, fieldId);
    statements.push(setFieldPositionStatement(database, fieldId, index, now));
  }
  statements.push(audit(database, options, "intakeForm.fieldsReordered", formId));
  return { statements, outboxMessages: [] };
}

/**
 * Publish the working draft: freeze it, and point the form at it.
 *
 * A form with no questions is refused rather than published. A published form with no fields serves
 * a page a visitor cannot answer and collects empty submissions, which is worse than the firm being
 * told to finish the form.
 */
export async function publishForm(
  database: SqlDatabase,
  formId: IntakeFormId,
  options: FormServiceOptions,
): Promise<EffectWrite> {
  await requireForm(database, formId);
  const draft = await readDraftVersion(database, formId);
  if (draft === undefined) {
    throw new IntakeFormValidationError(
      "form-not-draftable",
      "there is nothing to publish: this form has no unpublished changes",
    );
  }
  const fields = await readFields(database, draft.id);
  if (fields.length === 0) {
    throw new IntakeFormValidationError(
      "form-no-fields",
      "a form needs at least one question before it can be published",
    );
  }

  const now = options.clock.now();
  return {
    statements: [
      stampVersionPublishedStatement(database, {
        id: draft.id,
        publishedBy: options.actorUserId,
        now,
      }),
      publishFormStatement(database, { id: formId, versionId: draft.id, now }),
      audit(database, options, "intakeForm.published", formId, {
        versionNumber: draft.version_number,
        fieldCount: fields.length,
      }),
    ],
    outboxMessages: [],
  };
}

/**
 * Close a form, or reopen a closed one.
 *
 * Close is the only way to take a form off the internet, and it is deliberately not a delete: a form
 * holds the submissions strangers sent it, and those are the firm's record of people who asked it for
 * help. Closing keeps everything and is reversible; the public route answers a closed form exactly as
 * it answers a token that never existed.
 */
export async function setFormClosed(
  database: SqlDatabase,
  formId: IntakeFormId,
  closed: boolean,
  options: FormServiceOptions,
): Promise<EffectWrite> {
  const form = await requireForm(database, formId);
  // Reopening returns a form to `published` only if it has something to serve; one that was closed
  // before it ever published goes back to `draft`, which the CHECK requires anyway.
  const next = closed ? "closed" : form.published_version_id === null ? "draft" : "published";

  return {
    statements: [
      setFormStatusStatement(database, formId, next, options.clock.now()),
      audit(database, options, closed ? "intakeForm.closed" : "intakeForm.reopened", formId),
    ],
    outboxMessages: [],
  };
}

/**
 * Rotate the public link.
 *
 * The reason this exists: a link that has been scraped and is being flooded needs to stop working
 * without the firm losing the form, its versions, or the submissions already sitting in its queue.
 * Every link already handed out stops resolving, which is the point and is also why the surface says
 * so before doing it.
 */
export async function rotatePublicToken(
  database: SqlDatabase,
  formId: IntakeFormId,
  options: FormServiceOptions,
): Promise<{ readonly publicToken: string; readonly effect: EffectWrite }> {
  await requireForm(database, formId);
  const publicToken = mintPublicToken(options.randomSource);
  return {
    publicToken,
    effect: {
      statements: [
        rotatePublicTokenStatement(database, formId, publicToken, options.clock.now()),
        audit(database, options, "intakeForm.tokenRotated", formId),
      ],
      outboxMessages: [],
    },
  };
}
