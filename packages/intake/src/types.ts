// The intake procedure's vocabularies and ceilings. Every closed vocabulary here is also a SQLite
// CHECK on the per-firm schema, so a value that reaches a write without appearing here fails at the
// database and not only at the type checker.

// What a step IS, and therefore who answers it. Eight kinds, held in a CHECK so a ninth is a reviewed
// migration. The order here is the order an authoring surface offers them, which is roughly the
// order a firm meets them: who the client is, whether the firm may act, what the client agreed to,
// what the client paid and told the firm.
export const INTAKE_STEP_KINDS = Object.freeze([
  "identity-verification",
  "conflicts-check",
  "fee-agreement",
  "engagement-letter",
  "retainer",
  "document",
  "questionnaire",
  "acknowledgement",
] as const);
export type IntakeStepKind = (typeof INTAKE_STEP_KINDS)[number];

export function isIntakeStepKind(value: string): value is IntakeStepKind {
  return (INTAKE_STEP_KINDS as readonly string[]).includes(value);
}

// What a step's reference names, where its kind is about one particular thing: a document template
// the step expects assembled onto the matter, or a custom field it expects answered. The handle is
// stored unvalidated (the schema does not know what the axis on the other side holds) and the reader
// for the kind resolves it at the moment of reading.
export type IntakeStepReferenceKind = "documentTemplate" | "customField";

export interface IntakeStepKindProfile {
  readonly kind: IntakeStepKind;
  // Whether a member may record the step COMPLETED by hand. A kind whose fact lives in a subsystem
  // the platform runs — the conflicts posture, the billing arrangement — is answered only by that
  // subsystem, because a hand-recorded "done" beside a posture that says otherwise is exactly the
  // record the gate exists to refuse. A waiver is a member's act on every kind; it is recorded as a
  // waiver, never as a completion, so it is never mistaken for the fact.
  readonly recordable: boolean;
  readonly reference: IntakeStepReferenceKind | null;
}

export const INTAKE_STEP_KIND_PROFILES: Readonly<Record<IntakeStepKind, IntakeStepKindProfile>> =
  Object.freeze({
    "identity-verification": { kind: "identity-verification", recordable: true, reference: null },
    "conflicts-check": { kind: "conflicts-check", recordable: false, reference: null },
    "fee-agreement": { kind: "fee-agreement", recordable: false, reference: null },
    "engagement-letter": {
      kind: "engagement-letter",
      recordable: true,
      reference: "documentTemplate",
    },
    retainer: { kind: "retainer", recordable: true, reference: null },
    document: { kind: "document", recordable: true, reference: "documentTemplate" },
    questionnaire: { kind: "questionnaire", recordable: true, reference: "customField" },
    acknowledgement: { kind: "acknowledgement", recordable: true, reference: null },
  });

// A member's two possible answers to a step. There is deliberately no third: "not applicable" is a
// waiver with that rationale, and "in progress" is the absence of a record.
export const INTAKE_RECORD_OUTCOMES = Object.freeze(["completed", "waived"] as const);
export type IntakeRecordOutcome = (typeof INTAKE_RECORD_OUTCOMES)[number];

// Ceilings. A procedure's name and a step's title are lines somebody reads in a list; instructions
// are where the firm says what doing the step actually means; a rationale is the whole content of a
// waiver and short by design.
export const MAX_PROCEDURE_NAME_LENGTH = 120;
export const MAX_PROCEDURE_DESCRIPTION_LENGTH = 2_000;
export const MAX_STEP_TITLE_LENGTH = 200;
export const MAX_STEP_INSTRUCTIONS_LENGTH = 5_000;
export const MAX_RECORD_RATIONALE_LENGTH = 2_000;
export const MAX_RECORD_NOTE_LENGTH = 2_000;

// The most steps one procedure may hold, and the most procedures one read lists. A procedure is a
// firm's own account of how it takes work on, and one past fifty steps is a manual rather than a
// gate; the page cap is a backstop against a pathological firm, not the bound that keeps the list
// small — the insert path behind a manage permission is.
export const MAX_PROCEDURE_STEPS = 50;
export const MAX_PROCEDURE_PAGE_SIZE = 200;
