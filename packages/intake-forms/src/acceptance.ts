import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { IntakeFormSubmissionId } from "@magna-carta/identifiers/types";
import {
  readFields,
  readForm,
  readSubmission,
  readVersion,
  type IntakeFormSubmissionRow,
} from "./form-statements.ts";
import { MAX_FORM_TITLE_LENGTH } from "./types.ts";
import { IntakeFormValidationError } from "./validation.ts";

/*
 * TURNING WHAT A STRANGER TYPED INTO SOMETHING THE FIRM VERIFIED.
 *
 * A form is a vector for somebody outside the firm to put information in. What arrives is therefore
 * UNTRUSTED INPUT TO BE CHECKED BY A PERSON, not data to be copied into the firm's records — and the
 * reason is that the Directory is effectively permanent. It is soft-delete only, and a merged-away
 * alias deliberately stays in the corpus so it still surfaces a conflicts hit. Anything an anonymous
 * stranger can write into it is in the conflicts corpus forever. Somebody who typed their name in a
 * hurry, or their company's trading name rather than its legal one, would be in the firm's permanent
 * record under that spelling — and the firm would find out when a conflicts check missed.
 *
 * So this file PROPOSES and never writes. It reads a submission and maps its answers onto the shape
 * of the record a member would create, and it commits nothing: a proposal nobody accepts leaves the
 * database exactly as it found it. What a member confirms — corrected, filled in, overridden — is
 * what the acceptance service writes, and only that.
 *
 * The same propose-and-confirm the matter plan already uses, deliberately rather than a new shape.
 */

/** How a form's answers map onto a person's name, as the Directory holds it. */
export interface ProposedPersonName {
  readonly given: string;
  readonly family: string;
  readonly middle: string | null;
}

/** What acceptance would create, offered for a member to check and change. */
export interface AcceptanceProposal {
  readonly submissionId: IntakeFormSubmissionId;
  /**
   * Which kind of record the answers look like — a starting point for the member, never a verdict.
   * A form cannot know whether it is being filled in by a person or on behalf of a company, and
   * plenty of enquiries answer both name questions.
   */
  readonly suggestedEntityKind: "person" | "organization";
  /** Null when the form asked for no person's name, or the visitor left it blank. */
  readonly personName: ProposedPersonName | null;
  readonly organizationName: string | null;
  readonly email: string | null;
  readonly telephone: string | null;
  readonly postalAddress: string | null;
  /** A matter title seeded from the enquiry. Almost always edited, and meant to be. */
  readonly matterTitle: string;
  /** Everything the visitor wrote, beside the question as it was asked, so a member reads it whole. */
  readonly answers: readonly {
    readonly label: string;
    readonly kind: string;
    readonly value: string;
  }[];
}

/**
 * Split a name somebody typed into the parts the Directory holds.
 *
 * A FORM CANNOT ASK FOR THIS RELIABLY and this function does not pretend otherwise. Names do not
 * split on spaces: "van der Berg", "Maria del Carmen Sanchez", a single mononym, a family name
 * written first. The split here is the ordinary Western case offered as a STARTING POINT for a
 * member to correct, which is the whole reason acceptance shows it rather than committing it. The
 * one thing it will not do is lose a word — everything between the first and last token becomes the
 * middle, so a member sees what the visitor actually typed rather than a tidied version of it.
 */
export function splitPersonName(typed: string): ProposedPersonName | null {
  const parts = typed.trim().split(/\s+/u).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) {
    // A mononym, or somebody who gave one name. Recorded as the family name because that is the
    // part the Directory renders and indexes; the member moves it if it is the given name.
    return { given: "", family: parts[0]!, middle: null };
  }
  const given = parts[0]!;
  const family = parts.at(-1)!;
  const middle = parts.slice(1, -1).join(" ");
  return { given, family, middle: middle === "" ? null : middle };
}

/** The first non-empty answer of a kind, or null. */
function answerOfKind(
  answers: readonly { readonly kind: string; readonly value: string }[],
  kind: string,
): string | null {
  return answers.find((answer) => answer.kind === kind)?.value ?? null;
}

/**
 * Read what acceptance would create. WRITES NOTHING.
 *
 * Every value here came from somebody the firm has not met, and every one is editable before it is
 * committed. That is not a courtesy to the member — it is the only thing standing between a typo on
 * a web form and a permanent row in a conflicts corpus.
 */
export async function proposeAcceptance(
  database: SqlDatabase,
  submissionId: IntakeFormSubmissionId,
): Promise<AcceptanceProposal> {
  const submission = await requireSubmission(database, submissionId);
  if (submission.accepted_entity_id !== null) {
    throw new IntakeFormValidationError(
      "submission-already-accepted",
      "this enquiry has already been accepted; it is on the matter it created",
    );
  }

  const version = await readVersion(database, submission.form_version_id);
  if (version === undefined) {
    throw new IntakeFormValidationError("form-unknown", "the form this arrived through is missing");
  }
  const form = await readForm(database, version.form_id);
  const fields = await readFields(database, submission.form_version_id);
  const stored = parseAnswers(submission.answers_json);

  // Beside the question AS IT WAS ASKED, from this submission's own version — never from what the
  // form asks today. A member reading an answer under a question the visitor never saw is reading a
  // different sentence.
  const answers = fields
    .map((field) => ({
      label: field.label,
      kind: field.kind as string,
      value: stored[field.id] ?? "",
    }))
    .filter((answer) => answer.value !== "");

  const personTyped = answerOfKind(answers, "person-name");
  const organizationTyped = answerOfKind(answers, "organization-name");
  const description = answerOfKind(answers, "matter-description");

  return {
    submissionId,
    // An organization name with no person's name reads as a company enquiry; anything else starts as
    // a person, which is the commoner case. The member decides.
    suggestedEntityKind:
      organizationTyped !== null && personTyped === null ? "organization" : "person",
    personName: personTyped === null ? null : splitPersonName(personTyped),
    organizationName: organizationTyped,
    email: answerOfKind(answers, "email"),
    telephone: answerOfKind(answers, "telephone"),
    postalAddress: answerOfKind(answers, "postal-address"),
    matterTitle: seedMatterTitle(
      form?.name ?? "Enquiry",
      personTyped,
      organizationTyped,
      description,
    ),
    answers,
  };
}

/**
 * A first line for the matter's title, which a member almost always rewrites.
 *
 * Deliberately dull: whose enquiry it is and which form it came through. The alternative — leading
 * with the visitor's own description — puts a stranger's words in the title of a firm record, where
 * they are read as the firm's characterization of the matter.
 */
function seedMatterTitle(
  formName: string,
  personTyped: string | null,
  organizationTyped: string | null,
  description: string | null,
): string {
  const who = organizationTyped ?? personTyped;
  const seed = who === null ? `${formName} enquiry` : `${who} — ${formName}`;
  // A description is deliberately NOT folded in; it is on the proposal in full for the member to
  // read, and the parameter is named so the next reader sees the omission was a decision.
  void description;
  return seed.slice(0, MAX_FORM_TITLE_LENGTH);
}

export async function requireSubmission(
  database: SqlDatabase,
  submissionId: IntakeFormSubmissionId,
): Promise<IntakeFormSubmissionRow> {
  const submission = await readSubmission(database, submissionId);
  if (submission === undefined) {
    throw new IntakeFormValidationError("form-unknown", `no such submission: ${submissionId}`);
  }
  return submission;
}

export function parseAnswers(answersJson: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(answersJson);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}
