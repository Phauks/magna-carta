import {
  fieldKindTakesOptions,
  isIntakeFormFieldKind,
  MAX_ANSWER_LENGTH,
  MAX_FIELD_HELP_TEXT_LENGTH,
  MAX_FIELD_LABEL_LENGTH,
  MAX_FIELD_OPTION_LENGTH,
  MAX_FIELD_OPTIONS,
  MAX_FORM_CONFIRMATION_LENGTH,
  MAX_FORM_INTRODUCTION_LENGTH,
  MAX_FORM_NAME_LENGTH,
  MAX_FORM_TITLE_LENGTH,
  MAX_SUBMISSION_TOTAL_LENGTH,
  MAX_TRIAGE_NOTE_LENGTH,
  type IntakeFormFieldKind,
  type IntakeFormFieldShape,
} from "./types.ts";

// Every refusal this subsystem raises, as a code the route maps to a problem type. Codes — never
// messages — drive the mapping, so a message can be reworded without changing the contract.
export type IntakeFormValidationCode =
  // Authoring, on the firm's own side, where a refusal names exactly what is wrong.
  | "form-empty-name"
  | "form-name-too-long"
  | "form-empty-title"
  | "form-title-too-long"
  | "form-introduction-too-long"
  | "form-confirmation-too-long"
  | "form-unknown"
  | "form-not-draftable"
  | "form-no-fields"
  | "form-budget-invalid"
  | "field-empty-label"
  | "field-label-too-long"
  | "field-help-text-too-long"
  | "field-unknown-kind"
  | "field-options-not-applicable"
  | "field-options-required"
  | "field-option-empty"
  | "field-option-too-long"
  | "field-too-many-options"
  | "field-too-many"
  | "field-unknown"
  | "triage-note-too-long"
  | "triage-unknown-state"
  | "submission-already-accepted"
  | "acceptance-needs-a-name"
  // The anonymous side. These are the ONLY refusals a stranger can provoke that are about their own
  // input, and each is a fact about what they typed rather than about what the firm holds.
  | "answer-required"
  | "answer-too-long"
  | "answer-not-an-option"
  | "submission-too-large"
  | "submission-unknown-field";

export class IntakeFormValidationError extends Error {
  readonly code: IntakeFormValidationCode;
  constructor(code: IntakeFormValidationCode, message: string) {
    super(message);
    this.name = "IntakeFormValidationError";
    this.code = code;
  }
}

export function normalizeFormName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === "") {
    throw new IntakeFormValidationError("form-empty-name", "a form needs a name");
  }
  if (trimmed.length > MAX_FORM_NAME_LENGTH) {
    throw new IntakeFormValidationError(
      "form-name-too-long",
      `a form name is at most ${String(MAX_FORM_NAME_LENGTH)} characters`,
    );
  }
  return trimmed;
}

export function normalizeFormTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed === "") {
    throw new IntakeFormValidationError("form-empty-title", "a form needs a title");
  }
  if (trimmed.length > MAX_FORM_TITLE_LENGTH) {
    throw new IntakeFormValidationError(
      "form-title-too-long",
      `a form title is at most ${String(MAX_FORM_TITLE_LENGTH)} characters`,
    );
  }
  return trimmed;
}

export function normalizeFormIntroduction(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (trimmed === "") return null;
  if (trimmed.length > MAX_FORM_INTRODUCTION_LENGTH) {
    throw new IntakeFormValidationError(
      "form-introduction-too-long",
      `an introduction is at most ${String(MAX_FORM_INTRODUCTION_LENGTH)} characters`,
    );
  }
  return trimmed;
}

export function normalizeConfirmationMessage(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (trimmed === "") return null;
  if (trimmed.length > MAX_FORM_CONFIRMATION_LENGTH) {
    throw new IntakeFormValidationError(
      "form-confirmation-too-long",
      `a confirmation message is at most ${String(MAX_FORM_CONFIRMATION_LENGTH)} characters`,
    );
  }
  return trimmed;
}

export function normalizeTriageNote(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (trimmed === "") return null;
  if (trimmed.length > MAX_TRIAGE_NOTE_LENGTH) {
    throw new IntakeFormValidationError(
      "triage-note-too-long",
      `a triage note is at most ${String(MAX_TRIAGE_NOTE_LENGTH)} characters`,
    );
  }
  return trimmed;
}

export function normalizeSubmissionBudget(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value <= 0) {
    throw new IntakeFormValidationError(
      "form-budget-invalid",
      "a daily submission budget is a whole number above zero, or absent for no budget",
    );
  }
  return value;
}

export function assertFieldKind(kind: string): IntakeFormFieldKind {
  if (!isIntakeFormFieldKind(kind)) {
    throw new IntakeFormValidationError(
      "field-unknown-kind",
      `${JSON.stringify(kind)} is not a kind of question a public form may ask`,
    );
  }
  return kind;
}

/**
 * Normalize one authored question.
 *
 * The options rule runs in BOTH directions, matching the database CHECK: an option-bearing kind
 * without options would render an empty picker a visitor cannot answer, and options on a telephone
 * field are an authoring mistake that would otherwise sit in the row unnoticed until somebody
 * wondered why they were there.
 */
export function normalizeFieldShape(input: {
  readonly kind: string;
  readonly label: string;
  readonly helpText?: string | null;
  readonly required?: boolean | null;
  readonly options?: readonly string[] | null;
}): IntakeFormFieldShape {
  const kind = assertFieldKind(input.kind);

  const label = input.label.trim();
  if (label === "") {
    throw new IntakeFormValidationError("field-empty-label", "a question needs a label");
  }
  if (label.length > MAX_FIELD_LABEL_LENGTH) {
    throw new IntakeFormValidationError(
      "field-label-too-long",
      `a question label is at most ${String(MAX_FIELD_LABEL_LENGTH)} characters`,
    );
  }

  const helpTextTrimmed = input.helpText?.trim() ?? "";
  if (helpTextTrimmed.length > MAX_FIELD_HELP_TEXT_LENGTH) {
    throw new IntakeFormValidationError(
      "field-help-text-too-long",
      `help text is at most ${String(MAX_FIELD_HELP_TEXT_LENGTH)} characters`,
    );
  }

  const takesOptions = fieldKindTakesOptions(kind);
  const suppliedOptions = input.options ?? null;
  if (!takesOptions && suppliedOptions !== null) {
    throw new IntakeFormValidationError(
      "field-options-not-applicable",
      `a ${kind} question does not offer a list of choices`,
    );
  }

  let options: readonly string[] | null = null;
  if (takesOptions) {
    const trimmed = (suppliedOptions ?? []).map((option) => option.trim());
    if (trimmed.length === 0) {
      throw new IntakeFormValidationError(
        "field-options-required",
        "a choice question needs at least one choice",
      );
    }
    if (trimmed.length > MAX_FIELD_OPTIONS) {
      throw new IntakeFormValidationError(
        "field-too-many-options",
        `a choice question offers at most ${String(MAX_FIELD_OPTIONS)} choices`,
      );
    }
    for (const option of trimmed) {
      if (option === "") {
        throw new IntakeFormValidationError("field-option-empty", "a choice cannot be blank");
      }
      if (option.length > MAX_FIELD_OPTION_LENGTH) {
        throw new IntakeFormValidationError(
          "field-option-too-long",
          `a choice is at most ${String(MAX_FIELD_OPTION_LENGTH)} characters`,
        );
      }
    }
    options = trimmed;
  }

  return {
    kind,
    label,
    helpText: helpTextTrimmed === "" ? null : helpTextTrimmed,
    required: input.required ?? false,
    options,
  };
}

/** One question as the submission validator needs it: its identity, and what it will accept. */
export interface AnswerableField {
  readonly fieldId: string;
  readonly kind: IntakeFormFieldKind;
  readonly label: string;
  readonly required: boolean;
  readonly options: readonly string[] | null;
}

/**
 * Validate what a stranger sent against the version they were actually served.
 *
 * EVERYTHING HERE IS LOCAL COMPUTATION over a form already read. There is no database access in this
 * function and there must never be one: the anonymous path performs no lookup against firm data,
 * because a read whose duration varies with what the visitor typed hands a probing script an oracle
 * from the clock. Rejecting an answer for being too long is safe — that is a fact about their own
 * input. Rejecting it because the firm already acts for someone of that name is not, and is why no
 * amount of "we could check that here" belongs in this file.
 *
 * An unknown field id is refused rather than dropped. A submission naming a question the version
 * does not have came from a stale page or a hand-rolled client, and silently keeping the rest would
 * file a partial answer the firm would read as complete.
 */
export function validateSubmissionAnswers(
  fields: readonly AnswerableField[],
  answers: Readonly<Record<string, string>>,
): Record<string, string> {
  let totalLength = 0;
  const known = new Map(fields.map((field) => [field.fieldId, field]));

  for (const fieldId of Object.keys(answers)) {
    if (!known.has(fieldId)) {
      throw new IntakeFormValidationError(
        "submission-unknown-field",
        "this form has changed since the page was opened; reload it and try again",
      );
    }
  }

  const validated: Record<string, string> = {};
  for (const field of fields) {
    const raw = answers[field.fieldId];
    const value = typeof raw === "string" ? raw.trim() : "";

    if (value === "") {
      if (field.required) {
        throw new IntakeFormValidationError(
          "answer-required",
          `${field.label} is needed before this can be sent`,
        );
      }
      continue;
    }

    if (value.length > MAX_ANSWER_LENGTH) {
      throw new IntakeFormValidationError(
        "answer-too-long",
        `${field.label} is at most ${String(MAX_ANSWER_LENGTH)} characters`,
      );
    }

    if (field.options !== null && !field.options.includes(value)) {
      throw new IntakeFormValidationError(
        "answer-not-an-option",
        `${field.label} must be one of the choices offered`,
      );
    }

    totalLength += value.length;
    if (totalLength > MAX_SUBMISSION_TOTAL_LENGTH) {
      throw new IntakeFormValidationError(
        "submission-too-large",
        "this submission is too long to send",
      );
    }

    validated[field.fieldId] = value;
  }

  return validated;
}
