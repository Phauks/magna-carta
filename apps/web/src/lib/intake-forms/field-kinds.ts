import type { IntakeFormFieldKind } from "./intake-forms-api.ts";

/*
 * What each kind of question IS, in the words a person authoring a form would use.
 *
 * The `note` on each entry answers the question a firm actually has when it opens the picker —
 * "what will a visitor see, and what can I do with the answer" — rather than restating the label.
 * Two of them exist to be reached for when nothing else fits, and saying so is what stops somebody
 * looking for a custom field: a public form's questions never come from the firm's own field
 * definitions, because one of those can point at a record in the directory and a stranger must not
 * be able to aim a value at a person the firm knows.
 */
export interface FieldKindEntry {
  readonly kind: IntakeFormFieldKind;
  readonly label: string;
  readonly note: string;
  /** Whether the builder shows the option editor for this kind. */
  readonly takesOptions: boolean;
}

export const FIELD_KIND_VOCABULARY: readonly FieldKindEntry[] = Object.freeze([
  {
    kind: "person-name",
    label: "A person's name",
    note: "Asked in parts, the way your directory holds a name, so it files cleanly if you take the enquiry on.",
    takesOptions: false,
  },
  {
    kind: "organization-name",
    label: "An organization's name",
    note: "For an enquiry that comes from a company rather than a person.",
    takesOptions: false,
  },
  {
    kind: "email",
    label: "An email address",
    note: "How you would write back. Checked for shape only — nothing is sent to it.",
    takesOptions: false,
  },
  {
    kind: "telephone",
    label: "A telephone number",
    note: "Kept exactly as the visitor typed it, including how they chose to punctuate it.",
    takesOptions: false,
  },
  {
    kind: "postal-address",
    label: "A postal address",
    note: "One block of address lines, not split into fields a visitor has to guess at.",
    takesOptions: false,
  },
  {
    kind: "matter-description",
    label: "What happened",
    note: "The long free-text account of the problem. Most forms want exactly one of these, and it is the answer people write the most in.",
    takesOptions: false,
  },
  {
    kind: "choice",
    label: "A choice from a list",
    note: "Your own list of answers, and the visitor picks one. Use it for anything you would otherwise have to read out of a paragraph.",
    takesOptions: true,
  },
  {
    kind: "question",
    label: "A question of your own",
    note: "Free text, asked however you word it. This is what to reach for when nothing above fits.",
    takesOptions: false,
  },
]);

const BY_KIND = new Map(FIELD_KIND_VOCABULARY.map((entry) => [entry.kind, entry]));

export function fieldKindEntry(kind: IntakeFormFieldKind): FieldKindEntry | undefined {
  return BY_KIND.get(kind);
}

export function fieldKindLabel(kind: IntakeFormFieldKind): string {
  return BY_KIND.get(kind)?.label ?? kind;
}

export function fieldKindTakesOptions(kind: IntakeFormFieldKind): boolean {
  return BY_KIND.get(kind)?.takesOptions ?? false;
}

/** Whether a kind's answer wants a multi-line box on the public page rather than one line. */
export function fieldKindIsLong(kind: IntakeFormFieldKind): boolean {
  return kind === "matter-description" || kind === "postal-address";
}

/**
 * The `autocomplete` token a browser fills this kind from, so a visitor is not made to retype.
 *
 * Typed as the DOM's own token union rather than as a string: these values are a closed vocabulary
 * the browser understands, and a typo in one silently turns autofill off rather than failing.
 */
export function fieldKindAutocomplete(kind: IntakeFormFieldKind): AutoFill {
  switch (kind) {
    case "person-name":
      return "name";
    case "organization-name":
      return "organization";
    case "email":
      return "email";
    case "telephone":
      return "tel";
    case "postal-address":
      return "street-address";
    default:
      return "off";
  }
}

/** The `inputmode` that gets a phone keyboard onto a phone number and an email one onto an address. */
export function fieldKindInputMode(kind: IntakeFormFieldKind): "email" | "tel" | undefined {
  if (kind === "email") return "email";
  if (kind === "telephone") return "tel";
  return undefined;
}

/** What a triage decision is called on the screen. */
export function triageStateLabel(state: string): string {
  switch (state) {
    case "new":
      return "Waiting";
    case "accepted":
      return "Accepted";
    case "declined":
      return "Declined";
    case "spam":
      return "Spam";
    default:
      return state;
  }
}
