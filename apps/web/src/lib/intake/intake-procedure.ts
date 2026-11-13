/*
 * The intake procedure, as a model: what each kind of step means to a reader, and what a checklist
 * says about a consultation before anything renders it.
 *
 * WHY THIS IS A MODEL AND NOT MARKUP. The sentences on a screen that gates whether a firm takes a
 * client on are worth a test, and a test cannot reach a sentence written inside a template. The
 * vocabulary below is also the one place the product says what a "questionnaire" step or a
 * "retainer" step IS, so the settings screen that authors one and the matter screen that answers
 * one cannot describe it differently.
 *
 * THE MODEL NEVER SUMMARISES A STANDING INTO A WORD OF ITS OWN. A step's standing arrives with the
 * statement of whoever answered it — the conflicts posture, the billing arrangement, a member — and
 * that statement is what a reader sees. The one number this model computes is how many required
 * steps are outstanding, because that is a fact about the firm's own procedure rather than about
 * the client.
 */
import type { IntakeChecklist, IntakeChecklistStep, IntakeStepKind } from "./intake-api.ts";

export interface IntakeStepKindVocabulary {
  readonly kind: IntakeStepKind;
  /** The kind's name in a list. Title case. */
  readonly label: string;
  /** One sentence for the person choosing a kind while authoring a procedure: what it asks for. */
  readonly description: string;
  /** Who answers a step of this kind, in the reader's words. */
  readonly answeredBy: string;
  /** What the step's reference names, where the kind is about one thing; null where it is not. */
  readonly reference: { readonly label: string; readonly hint: string } | null;
  /** Where on the matter the fact is made, as a section slug, or null where a member records it. */
  readonly sectionSlug: string | null;
}

/**
 * The ten kinds, in the order a procedure usually meets them. `answeredBy` is deliberately honest
 * about the four the platform cannot see yet: an identity check, the client's online forms, a
 * payment and an acknowledgement are a member's word today, and the sentence says so rather than
 * implying a system behind it.
 */
export const INTAKE_STEP_KIND_VOCABULARY: readonly IntakeStepKindVocabulary[] = [
  {
    kind: "identity-verification",
    label: "Identity Verification",
    description: "Confirm who the client is before the firm acts for them.",
    answeredBy: "A member records that they verified the client's identity.",
    reference: null,
    sectionSlug: null,
  },
  {
    kind: "conflicts-check",
    label: "Conflicts Check",
    description:
      "A conflicts check has run at the firm's minimum, every hit has been answered, and no re-check is due.",
    answeredBy: "The matter's conflicts record. It can't be entered by hand, but it can be waived.",
    reference: null,
    sectionSlug: "conflicts",
  },
  {
    kind: "fee-agreement",
    label: "Fee Agreement",
    description: "A fee arrangement is recorded on the matter.",
    answeredBy: "The fee arrangement in force, recorded from the matter's status window.",
    reference: null,
    sectionSlug: "overview",
  },
  {
    kind: "engagement-letter",
    label: "Engagement Letter",
    description: "The engagement letter has been produced for this matter.",
    answeredBy:
      "An assembly of the named template landing on the matter, or a member recording that the signed letter came back.",
    reference: {
      label: "Template",
      hint: "The registered template the letter is produced from. Leave it blank to have a member record the step instead.",
    },
    sectionSlug: "files",
  },
  {
    kind: "client-forms",
    label: "Client Forms",
    description: "The client has been sent the firm's online forms and has returned them.",
    answeredBy:
      "A member records that the forms went out and came back. The client portal will answer this step when it exists.",
    reference: null,
    sectionSlug: null,
  },
  {
    kind: "retainer",
    label: "Retainer",
    description: "The client's retainer has been received.",
    answeredBy:
      "Client funds held in trust for the matter, or a member recording a retainer the trust ledger cannot see.",
    reference: null,
    sectionSlug: "trust",
  },
  {
    kind: "payment",
    label: "Payment",
    description:
      "A payment has been sent or received before the firm acts: a consultation fee, a deposit.",
    answeredBy:
      "A member records that the payment was made. Payments will answer this step when they are built.",
    reference: null,
    sectionSlug: null,
  },
  {
    kind: "document",
    label: "Document",
    description: "A document the firm needs on the matter before it opens.",
    answeredBy:
      "An assembly of the named template landing on the matter, or a member recording that the document was collected.",
    reference: {
      label: "Template",
      hint: "The registered template to produce. Leave it blank for a document the client brings in.",
    },
    sectionSlug: "files",
  },
  {
    kind: "questionnaire",
    label: "Questionnaire",
    description: "A question the firm needs answered on the matter before it opens.",
    answeredBy:
      "The named custom field holding a value on the matter, or a member recording that the questionnaire was completed.",
    reference: {
      label: "Custom field",
      hint: "The identifier of the custom field the answer lands in. Leave it blank to have a member record the step.",
    },
    sectionSlug: null,
  },
  {
    kind: "acknowledgement",
    label: "Acknowledgement",
    description: "Something a member confirms they did: a notice given, a conversation had.",
    answeredBy: "A member records that they did it.",
    reference: null,
    sectionSlug: null,
  },
];

const VOCABULARY_BY_KIND = new Map(
  INTAKE_STEP_KIND_VOCABULARY.map((entry) => [entry.kind, entry] as const),
);

export function intakeStepKindVocabulary(kind: IntakeStepKind): IntakeStepKindVocabulary {
  const entry = VOCABULARY_BY_KIND.get(kind);
  if (entry === undefined) throw new Error(`no vocabulary for intake step kind ${kind}`);
  return entry;
}

export function intakeStepKindLabel(kind: IntakeStepKind): string {
  return intakeStepKindVocabulary(kind).label;
}

/** Where a step stands, as the mark a row wears. */
export type IntakeStepMark = "satisfied" | "outstanding" | "optional";

/**
 * The mark: satisfied wears the affirmative mark, a required unanswered step is a finding, and an
 * optional unanswered step is quiet, because nothing waits on it.
 */
export function intakeStepMark(
  step: Pick<IntakeChecklistStep, "required" | "standing">,
): IntakeStepMark {
  if (step.standing.satisfied) return "satisfied";
  return step.required ? "outstanding" : "optional";
}

/**
 * The one line under the checklist heading: how far the intake is from complete, as a fact about the
 * firm's procedure. Never a word about the client.
 */
export function intakeChecklistSummary(
  checklist: Pick<IntakeChecklist, "matterStatus" | "steps" | "outstandingRequired">,
): string {
  if (checklist.steps.length === 0) {
    return checklist.matterStatus === "intake"
      ? "No intake procedure binds this kind of matter, so nothing stands between it and the consultation."
      : "No intake procedure binds this kind of matter.";
  }
  if (checklist.matterStatus !== "intake") {
    return checklist.matterStatus === "consultation"
      ? "The intake is complete. Open the consultation from its status window."
      : "The matter has opened. This is the record of its intake.";
  }
  const outstanding = checklist.outstandingRequired;
  if (outstanding === 0) {
    return "All required steps are answered. Complete the intake from the desk or the status window.";
  }
  return outstanding === 1
    ? "One required step is outstanding before the intake is complete."
    : `${String(outstanding)} required steps are outstanding before the intake is complete.`;
}

/**
 * What a member may do to a step from the checklist, given the step and the member's permissions.
 * The server refuses anything the list omits; the screen simply does not offer it.
 */
export interface IntakeStepActions {
  readonly record: boolean;
  readonly waive: boolean;
  readonly reopen: boolean;
}

export function intakeStepActions(
  step: Pick<IntakeChecklistStep, "recordable" | "record">,
  matterStatus: IntakeChecklist["matterStatus"],
  permissions: readonly string[],
): IntakeStepActions {
  if (matterStatus !== "intake") return { record: false, waive: false, reopen: false };
  const mayRecord = permissions.includes("intake:record");
  const mayWaive = permissions.includes("intake:waive");
  const live = step.record !== null;
  return {
    record: mayRecord && step.recordable && !live,
    waive: mayWaive && !live,
    reopen: mayRecord && live,
  };
}

/** How a record reads on its row: who, when, and the words they left. */
export function describeIntakeRecord(record: {
  readonly outcome: "completed" | "waived";
  readonly rationale: string | null;
  readonly note: string | null;
}): string {
  if (record.outcome === "waived") return `Waived: ${record.rationale ?? ""}`.trim();
  return record.note === null ? "Recorded as completed." : `Recorded as completed: ${record.note}`;
}
