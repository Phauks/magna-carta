/*
 * The New Person screen's draft: every section of the record, reachable before the record exists.
 *
 * Nothing here talks to the network. The dialog holds one of these, the sections edit their part of
 * it, the rail counts what each part holds, the context pane summarizes the whole, and the commit
 * turns it into the one request that records it all in one batch (`personCreateRequest`). What
 * the dialog can and cannot commit is decided here too, so the refusal beside the commit and the
 * request that leaves are the same rule.
 */
import type { DirectoryEdgeType, DirectoryNameRole, PronounSet } from "./directory-api.ts";
import type { CreateDirectoryPersonRequest } from "./directory-api.ts";
import type { ContactDraft } from "./contact-draft.ts";
import { contactKindLabel, contactRequestsFrom, contactRowFromDraft } from "./contact-draft.ts";
import { EDGE_TYPES, nameRoleLabel } from "./directory-vocabulary.ts";
import { formatDate } from "@magna-carta/design-system/formatters";
import { recordIsOrigin } from "./edge-draft.ts";
import type { IdentifierDraft } from "./identifier-draft.ts";
import { identifierRequestFrom } from "./identifier-draft.ts";

export interface PersonNameDraft {
  prefix: string;
  given: string;
  middle: string;
  family: string;
  /**
   * As many as the person holds, comma-separated on the one line — "III, Esq.". That is how they
   * are written after a name and it is what the column stores; the honorific field
   * ($lib/names/honorific-field.svelte) is what enters them.
   */
  suffix: string;
}

export interface OtherNameDraft extends PersonNameDraft {
  readonly id: string;
  nameRole: DirectoryNameRole;
}

/** A blank other name, as the Add Other Name button opens it. */
export function blankOtherName(): OtherNameDraft {
  return {
    id: crypto.randomUUID(),
    prefix: "",
    given: "",
    middle: "",
    family: "",
    suffix: "",
    nameRole: "former",
  };
}

/**
 * The other names that hold something to answer to. A block opened and left empty is not a name:
 * it is not counted, summarised or sent, the same rule the add row it replaced applied.
 */
export function filledOtherNames(draft: PersonDraft): readonly OtherNameDraft[] {
  return draft.otherNames.filter(
    (other) => other.given.trim() !== "" || other.family.trim() !== "",
  );
}

/** The sets most people state, offered first; "Another set…" opens the five forms. */
export interface PronounPreset {
  readonly id: string;
  readonly label: string;
  readonly set: PronounSet;
}

export const PRONOUN_PRESETS: readonly PronounPreset[] = [
  {
    id: "she",
    label: "she / her / hers",
    set: {
      subject: "she",
      object: "her",
      possessiveDeterminer: "her",
      possessivePronoun: "hers",
      reflexive: "herself",
      verbNumber: "singular",
    },
  },
  {
    id: "he",
    label: "he / him / his",
    set: {
      subject: "he",
      object: "him",
      possessiveDeterminer: "his",
      possessivePronoun: "his",
      reflexive: "himself",
      verbNumber: "singular",
    },
  },
  {
    id: "they",
    label: "they / them / theirs",
    set: {
      subject: "they",
      object: "them",
      possessiveDeterminer: "their",
      possessivePronoun: "theirs",
      reflexive: "themselves",
      verbNumber: "plural",
    },
  },
];

/** The value the pronoun dropdown holds when the person has stated none. */
export const PRONOUNS_NOT_STATED = "not-stated";
/** The value that opens the five forms. */
export const PRONOUNS_ANOTHER_SET = "another";

/** Which preset a stated set is, or "another" when it matches none, or not stated when null. */
export function pronounChoiceFor(set: PronounSet | null): string {
  if (set === null) return PRONOUNS_NOT_STATED;
  const preset = PRONOUN_PRESETS.find((candidate) =>
    (
      [
        "subject",
        "object",
        "possessiveDeterminer",
        "possessivePronoun",
        "reflexive",
        "verbNumber",
      ] as const
    ).every((form) => candidate.set[form] === set[form]),
  );
  return preset?.id ?? PRONOUNS_ANOTHER_SET;
}

/** What a preset choice states, or null for not stated; "another" is the caller's custom set. */
export function pronounSetForChoice(choice: string): PronounSet | null {
  return PRONOUN_PRESETS.find((preset) => preset.id === choice)?.set ?? null;
}

export interface OrganizationDraft {
  readonly id: string;
  readonly organizationId: string;
  readonly organizationName: string;
  readonly edgeType: DirectoryEdgeType;
  readonly role: string;
}

export interface PersonDraft {
  name: PersonNameDraft;
  otherNames: OtherNameDraft[];
  pronouns: PronounSet | null;
  dateOfBirth: string;
  dateOfDeath: string;
  contacts: (ContactDraft & { readonly id: string })[];
  identifiers: (IdentifierDraft & { readonly id: string })[];
  organizations: OrganizationDraft[];
}

export function emptyPersonDraft(): PersonDraft {
  return {
    name: { prefix: "", given: "", middle: "", family: "", suffix: "" },
    otherNames: [],
    pronouns: null,
    dateOfBirth: "",
    dateOfDeath: "",
    contacts: [],
    identifiers: [],
    organizations: [],
  };
}

/** The rail's sections, in the record's order, with what each holds. */
export type PersonSectionId =
  | "names"
  | "contact"
  | "address"
  | "about"
  | "identifiers"
  | "organizations";

export interface PersonSectionCount {
  readonly id: PersonSectionId;
  readonly label: string;
  /** How many the section holds, or null where the section is one answer rather than a list. */
  readonly count: number | null;
}

export function personSectionCounts(draft: PersonDraft): readonly PersonSectionCount[] {
  const currentName = draft.name.given.trim() !== "" || draft.name.family.trim() !== "" ? 1 : 0;
  // The two halves of the draft's contact points, counted apart, because they are entered apart:
  // an address is a form of its own and its own rail item, beside the one-line ways to reach them.
  const addresses = draft.contacts.filter((contact) => contact.kind === "address").length;
  return [
    { id: "names", label: "Names", count: currentName + filledOtherNames(draft).length },
    { id: "contact", label: "Contact", count: draft.contacts.length - addresses },
    { id: "address", label: "Address", count: addresses },
    // Pronouns and the life dates share one section: each is a single answer, and a section of one
    // control is a stop on the rail that holds almost nothing.
    {
      id: "about",
      label: "About",
      count:
        (draft.pronouns === null ? 0 : 1) +
        (draft.dateOfBirth === "" ? 0 : 1) +
        (draft.dateOfDeath === "" ? 0 : 1),
    },
    { id: "identifiers", label: "Identifiers", count: draft.identifiers.length },
    { id: "organizations", label: "Organizations", count: draft.organizations.length },
  ];
}

/** The name the draft would be known by: what a field that took the new record shows at rest. */
export function personDraftDisplayName(draft: PersonDraft): string {
  return displayName(draft.name);
}

function displayName(name: PersonNameDraft): string {
  return [name.prefix, name.given, name.middle, name.family, name.suffix]
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .join(" ");
}

/** One line per section for the context pane: what the record will hold, in the reader's words. */
export interface PersonSummaryLine {
  readonly label: string;
  readonly value: string;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function personDraftSummary(draft: PersonDraft): readonly PersonSummaryLine[] {
  /*
   * THE VALUES, NOT HOW MANY. This pane is where somebody checks the entry before saving it, and
   * "1 email" cannot be checked — the email can. So every line is what the record will hold, in
   * the order the sections are entered. The one exception is an identifier: it is sealed, and a
   * sealed number is never printed back, so it is counted.
   */
  const lines: PersonSummaryLine[] = [];
  const name = displayName(draft.name);
  if (name !== "") lines.push({ label: "Name", value: name });
  for (const other of filledOtherNames(draft)) {
    const otherName = displayName(other);
    if (otherName !== "") lines.push({ label: nameRoleLabel(other.nameRole), value: otherName });
  }
  // Ways to reach them first and addresses after, because that is the order of the sections.
  const reach = draft.contacts.filter((contact) => contact.kind !== "address");
  const addresses = draft.contacts.filter((contact) => contact.kind === "address");
  for (const contact of [...reach, ...addresses]) {
    const row = contactRowFromDraft(contact, contact.id);
    if (row.value !== "") lines.push({ label: contactKindLabel(contact.kind), value: row.value });
  }
  if (draft.pronouns !== null) {
    lines.push({
      label: "Pronouns",
      value: `${draft.pronouns.subject} / ${draft.pronouns.object} / ${draft.pronouns.possessivePronoun}`,
    });
  }
  if (draft.dateOfBirth !== "") lines.push({ label: "Born", value: formatDate(draft.dateOfBirth) });
  if (draft.dateOfDeath !== "") lines.push({ label: "Died", value: formatDate(draft.dateOfDeath) });
  if (draft.identifiers.length > 0) {
    lines.push({
      label: "Identifiers",
      value: plural(draft.identifiers.length, "sealed", "sealed"),
    });
  }
  for (const organization of draft.organizations) {
    lines.push({
      label: organization.role.trim() === "" ? "Organization" : organization.role.trim(),
      value: organization.organizationName,
    });
  }
  return lines;
}

/**
 * Why the draft cannot be recorded yet, or undefined when it can.
 *
 * A NAME, NOT TWO NAMES. The one thing a person record cannot be without is something to call the
 * person by; a family name is not that thing. Plenty of people have one name — it is the ordinary
 * form of a name in much of the world — and a firm that cannot file a client under the name that
 * client actually has files them under a wrong one, or in a note where no conflicts check can reach
 * it. So the refusal asks for the first name and stops there; the missing family name is a
 * `personDraftWarning`, which states the gap and records anyway.
 */
export function personDraftRefusal(draft: PersonDraft): string | undefined {
  return draft.name.given.trim() === "" ? "Give the person's first name." : undefined;
}

/**
 * What the reader should know about the draft before recording it, or null when there is nothing.
 *
 * A warning is not a refusal and must never read as one: everything here records exactly as it
 * stands. It exists because a missing last name is far more often a half-finished entry than a
 * person with one name, and the person filling the panel is the only one who can tell the two
 * apart — after the record exists, nobody looking at it can.
 */
export function personDraftWarning(draft: PersonDraft): string | null {
  if (draft.name.given.trim() === "") return null;
  return draft.name.family.trim() === ""
    ? "This person will be recorded with no last name. Their first name is what the firm will " +
        "file, search and check conflicts under."
    : null;
}

/** Whether anything has been entered anywhere. A blank draft has nothing to lose on dismissal. */
export function personDraftStarted(draft: PersonDraft): boolean {
  return (
    displayName(draft.name) !== "" ||
    filledOtherNames(draft).length > 0 ||
    draft.pronouns !== null ||
    draft.dateOfBirth !== "" ||
    draft.dateOfDeath !== "" ||
    draft.contacts.length > 0 ||
    draft.identifiers.length > 0 ||
    draft.organizations.length > 0
  );
}

function optional(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** The one request that records the whole draft. The edge direction is the type's, as on the record. */
export function personCreateRequest(draft: PersonDraft): CreateDirectoryPersonRequest {
  const contacts = contactRequestsFrom(draft.contacts);
  const family = draft.name.family.trim();
  const request: CreateDirectoryPersonRequest = {
    given: draft.name.given.trim(),
    prefix: optional(draft.name.prefix),
    middle: optional(draft.name.middle),
    suffix: optional(draft.name.suffix),
  };
  // Absent rather than empty: a person with one name has no family name, which is a different
  // fact from a family name recorded as nothing at all.
  if (family !== "") request.family = family;
  const otherNames = filledOtherNames(draft);
  if (otherNames.length > 0) {
    request.otherNames = otherNames.map((name) => ({
      given: name.given.trim(),
      family: name.family.trim(),
      nameRole: name.nameRole,
      prefix: optional(name.prefix),
      middle: optional(name.middle),
      suffix: optional(name.suffix),
    }));
  }
  if (draft.pronouns !== null) request.pronouns = draft.pronouns;
  if (draft.dateOfBirth !== "") request.dateOfBirth = draft.dateOfBirth;
  if (draft.dateOfDeath !== "") request.dateOfDeath = draft.dateOfDeath;
  if (contacts.emails.length > 0) request.emails = contacts.emails;
  if (contacts.phones.length > 0) request.phones = contacts.phones;
  if (contacts.addresses.length > 0) request.addresses = contacts.addresses;
  if (draft.identifiers.length > 0) {
    request.identifiers = draft.identifiers.map((identifier) => identifierRequestFrom(identifier));
  }
  if (draft.organizations.length > 0) {
    request.organizations = draft.organizations.map((organization) => {
      const entry = EDGE_TYPES.find((candidate) => candidate.edgeType === organization.edgeType);
      const personIs =
        entry === undefined || recordIsOrigin("person", "organization", entry) ? "from" : "to";
      return {
        organizationId: organization.organizationId,
        edgeType: organization.edgeType,
        personIs,
        role: optional(organization.role),
      };
    });
  }
  return request;
}
