import {
  INTAKE_STEP_KINDS,
  MAX_PROCEDURE_DESCRIPTION_LENGTH,
  MAX_PROCEDURE_NAME_LENGTH,
  MAX_RECORD_NOTE_LENGTH,
  MAX_RECORD_RATIONALE_LENGTH,
  MAX_STEP_INSTRUCTIONS_LENGTH,
  MAX_STEP_TITLE_LENGTH,
  isIntakeStepKind,
  type IntakeStepKind,
} from "./types.ts";

// Every refusal this subsystem raises, as a code the route maps to a problem type. Codes — never
// messages — drive the mapping, so a message can be reworded without changing the contract.
export type IntakeValidationCode =
  | "procedure-empty-name"
  | "procedure-name-too-long"
  | "procedure-name-taken"
  | "procedure-description-too-long"
  | "procedure-unknown"
  | "procedure-inactive"
  | "step-empty-title"
  | "step-title-too-long"
  | "step-instructions-too-long"
  | "step-unknown-kind"
  | "step-reference-not-applicable"
  | "step-unknown"
  | "step-inactive"
  | "step-too-many"
  // The matter side: the matter, whether it is still a consultation, whether the step is one its
  // procedure asks for, and whether the kind is one a member may answer by hand at all.
  | "matter-unknown"
  | "matter-not-intake"
  | "step-not-bound"
  | "step-not-recordable"
  | "record-rationale-required"
  | "record-rationale-too-long"
  | "record-note-too-long"
  | "record-none-live";

export class IntakeValidationError extends Error {
  readonly code: IntakeValidationCode;
  constructor(code: IntakeValidationCode, message: string) {
    super(message);
    this.name = "IntakeValidationError";
    this.code = code;
  }
}

export function normalizeProcedureName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === "") {
    throw new IntakeValidationError("procedure-empty-name", "a procedure needs a name");
  }
  if (trimmed.length > MAX_PROCEDURE_NAME_LENGTH) {
    throw new IntakeValidationError(
      "procedure-name-too-long",
      `a procedure name is at most ${String(MAX_PROCEDURE_NAME_LENGTH)} characters`,
    );
  }
  return trimmed;
}

export function normalizeProcedureDescription(
  description: string | null | undefined,
): string | null {
  const trimmed = description?.trim() ?? "";
  if (trimmed === "") return null;
  if (trimmed.length > MAX_PROCEDURE_DESCRIPTION_LENGTH) {
    throw new IntakeValidationError(
      "procedure-description-too-long",
      `a procedure description is at most ${String(MAX_PROCEDURE_DESCRIPTION_LENGTH)} characters`,
    );
  }
  return trimmed;
}

export function normalizeStepTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed === "") throw new IntakeValidationError("step-empty-title", "a step needs a title");
  if (trimmed.length > MAX_STEP_TITLE_LENGTH) {
    throw new IntakeValidationError(
      "step-title-too-long",
      `a step title is at most ${String(MAX_STEP_TITLE_LENGTH)} characters`,
    );
  }
  return trimmed;
}

export function normalizeStepInstructions(instructions: string | null | undefined): string | null {
  const trimmed = instructions?.trim() ?? "";
  if (trimmed === "") return null;
  if (trimmed.length > MAX_STEP_INSTRUCTIONS_LENGTH) {
    throw new IntakeValidationError(
      "step-instructions-too-long",
      `step instructions are at most ${String(MAX_STEP_INSTRUCTIONS_LENGTH)} characters`,
    );
  }
  return trimmed;
}

export function normalizeStepKind(kind: string): IntakeStepKind {
  if (!isIntakeStepKind(kind)) {
    throw new IntakeValidationError(
      "step-unknown-kind",
      `a step is one of ${INTAKE_STEP_KINDS.join(", ")}, not ${kind}`,
    );
  }
  return kind;
}

// A waiver's rationale is the whole content of the record, so an empty one is refused rather than
// stored as a blank the CHECK would refuse anyway — the refusal here carries a code a route can name.
export function normalizeRationale(rationale: string | null | undefined): string {
  const trimmed = rationale?.trim() ?? "";
  if (trimmed === "") {
    throw new IntakeValidationError(
      "record-rationale-required",
      "waiving a step needs the reason it is waived",
    );
  }
  if (trimmed.length > MAX_RECORD_RATIONALE_LENGTH) {
    throw new IntakeValidationError(
      "record-rationale-too-long",
      `a rationale is at most ${String(MAX_RECORD_RATIONALE_LENGTH)} characters`,
    );
  }
  return trimmed;
}

export function normalizeNote(note: string | null | undefined): string | null {
  const trimmed = note?.trim() ?? "";
  if (trimmed === "") return null;
  if (trimmed.length > MAX_RECORD_NOTE_LENGTH) {
    throw new IntakeValidationError(
      "record-note-too-long",
      `a note is at most ${String(MAX_RECORD_NOTE_LENGTH)} characters`,
    );
  }
  return trimmed;
}
