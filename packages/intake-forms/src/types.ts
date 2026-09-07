// The public intake form's vocabularies and ceilings. Every closed vocabulary here is also a SQLite
// CHECK on the per-firm schema, so a value that reaches a write without appearing here fails at the
// database and not only at the type checker.

/**
 * WHAT A QUESTION MAY BE — the bounded platform vocabulary, and the boundary is the whole point.
 *
 * A public form's fields never come from the custom-fields definition set. That engine has
 * `contact-reference` and `matter-reference` kinds, and a public form able to bind one would let an
 * unidentified stranger point a value at a record in the firm's directory. A firm extends its form
 * by adding a `question` or a `choice`, which are the two open-ended kinds and are open-ended only
 * in their TEXT — neither can address anything the firm holds.
 *
 * The order is the order an authoring surface offers them, which is roughly the order a form asks
 * them: who you are, how to reach you, and what happened.
 */
export const INTAKE_FORM_FIELD_KINDS = Object.freeze([
  "person-name",
  "organization-name",
  "email",
  "telephone",
  "postal-address",
  "matter-description",
  "choice",
  "question",
] as const);
export type IntakeFormFieldKind = (typeof INTAKE_FORM_FIELD_KINDS)[number];

export function isIntakeFormFieldKind(value: string): value is IntakeFormFieldKind {
  return (INTAKE_FORM_FIELD_KINDS as readonly string[]).includes(value);
}

/** The kinds that carry a firm-authored option list. Today exactly one; a set so a second is additive. */
const OPTION_BEARING_KINDS: ReadonlySet<string> = new Set<IntakeFormFieldKind>(["choice"]);

export function fieldKindTakesOptions(kind: IntakeFormFieldKind): boolean {
  return OPTION_BEARING_KINDS.has(kind);
}

/** What a form is, from the public route's point of view: `published` is reachable and nothing else is. */
export const INTAKE_FORM_STATUSES = Object.freeze(["draft", "published", "closed"] as const);
export type IntakeFormStatus = (typeof INTAKE_FORM_STATUSES)[number];

/**
 * What a member decided about one submission.
 *
 * A PLATFORM vocabulary rather than a firm-defined label set, and it carries no authority: nothing
 * reads a triage state as a gate, nothing derives from it, and moving a submission between states
 * permits nothing. It records what a member did and no more — which is what keeps it from becoming
 * the kind of firm-renameable value that silently moves an ethics gate.
 */
export const INTAKE_SUBMISSION_TRIAGE_STATES = Object.freeze([
  "new",
  "accepted",
  "declined",
  "spam",
] as const);
export type IntakeSubmissionTriageState = (typeof INTAKE_SUBMISSION_TRIAGE_STATES)[number];

export function isTriageState(value: string): value is IntakeSubmissionTriageState {
  return (INTAKE_SUBMISSION_TRIAGE_STATES as readonly string[]).includes(value);
}

// The ceilings. Each is enforced in validation and, for the ones a stranger controls, on the
// anonymous path specifically — a public endpoint with an unbounded text field is a storage bill
// anyone on the internet can run up.
export const MAX_FORM_NAME_LENGTH = 120;
export const MAX_FORM_TITLE_LENGTH = 200;
export const MAX_FORM_INTRODUCTION_LENGTH = 2000;
export const MAX_FORM_CONFIRMATION_LENGTH = 1000;
export const MAX_FIELD_LABEL_LENGTH = 200;
export const MAX_FIELD_HELP_TEXT_LENGTH = 500;
export const MAX_FIELD_OPTION_LENGTH = 120;
export const MAX_FIELD_OPTIONS = 50;
export const MAX_FIELDS_PER_VERSION = 60;
export const MAX_TRIAGE_NOTE_LENGTH = 2000;

/**
 * The ceiling on ONE answer a stranger types, and the reason it is generous.
 *
 * `matter-description` is where somebody explains what happened to them, and a person describing a
 * dispute in their own words writes more than a form designer expects. Truncating that is worse than
 * storing it: the firm is reading it to decide whether to help. Ten thousand characters is roughly
 * four pages, which is past any honest account and well short of a payload worth sending.
 */
export const MAX_ANSWER_LENGTH = 10_000;

/** The ceiling on the whole submission, so many fields cannot multiply into an unbounded write. */
export const MAX_SUBMISSION_TOTAL_LENGTH = 50_000;

/** The public list page's cap, on the platform's standard page-size ceiling for a derived read. */
export const MAX_FORM_PAGE_SIZE = 100;
export const MAX_SUBMISSION_PAGE_SIZE = 50;

/**
 * How long a form's public token is, in bytes of entropy before encoding.
 *
 * The token is the only thing standing between a stranger and a firm's form, so it is sized as a
 * secret rather than as an identifier: 32 bytes is not guessable, and the link is pasted rather than
 * typed, so length costs nothing a person notices.
 */
export const PUBLIC_TOKEN_ENTROPY_BYTES = 32;

/** One question, as both the authoring surface and the public renderer need it. */
export interface IntakeFormFieldShape {
  readonly kind: IntakeFormFieldKind;
  readonly label: string;
  readonly helpText: string | null;
  readonly required: boolean;
  /** Present only for an option-bearing kind; the CHECK enforces the correspondence in the database. */
  readonly options: readonly string[] | null;
}

/**
 * What the public route hands the page: enough to render, and NOTHING about the firm.
 *
 * There is no firm name, no member, no matter type and no count here, deliberately. The page is
 * served to anyone holding the link, and every field on this object is one the firm chose to put in
 * front of a stranger by authoring it.
 */
export interface PublicIntakeFormView {
  readonly title: string;
  readonly introduction: string | null;
  readonly fields: readonly (IntakeFormFieldShape & { readonly fieldId: string })[];
}
