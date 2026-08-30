/*
 * The directory's own words — what each stored code is CALLED on screen, in one place.
 *
 * Every one of these is a closed catalog the domain already fixed, and every one of them would
 * otherwise be re-worded per section: a name role in the history rail and in the add-a-name form, an
 * identifier type in the vault and in its picker, an edge type in the relationships table and in
 * whatever conflicts eventually says about the same edge. One list means two surfaces cannot
 * disagree about what a stored code means.
 *
 * These are labels and nothing else. Tone, ordering on a page and whether a control is offered are
 * the surface's business; what a word MEANS is the domain's, and it is written down where the
 * domain wrote it.
 */
import type {
  DirectoryEdgeType,
  DirectoryEntityKind,
  DirectoryIdentifierType,
  DirectoryNameRole,
  PronounVerbNumber,
} from "./directory-api.ts";

// ---- name roles ------------------------------------------------------------------------------

export interface NameRoleEntry {
  role: DirectoryNameRole;
  label: string;
  /** Which side of the directory may hold a name in this role. */
  appliesTo: DirectoryEntityKind | "both";
}

/**
 * Why a name is on the record. The role is the whole point of keeping more than one: a maiden name
 * is what matches a twenty-year-old file to a living person, and a trading name is what an invoice
 * arrived under.
 */
export const NAME_ROLES: readonly NameRoleEntry[] = [
  { role: "current", label: "Current", appliesTo: "both" },
  { role: "former", label: "Former", appliesTo: "both" },
  { role: "maiden", label: "Maiden", appliesTo: "person" },
  { role: "alias", label: "Alias", appliesTo: "both" },
  { role: "aka", label: "Also known as", appliesTo: "both" },
  { role: "dba", label: "Trading as", appliesTo: "organization" },
];

export function nameRoleLabel(role: string): string {
  return NAME_ROLES.find((entry) => entry.role === role)?.label ?? role;
}

/** The roles that may be APPENDED to an entity of this kind. The current name is not appended. */
export function appendableNameRoles(kind: DirectoryEntityKind): readonly NameRoleEntry[] {
  return NAME_ROLES.filter(
    (entry) => entry.role !== "current" && (entry.appliesTo === "both" || entry.appliesTo === kind),
  );
}

// ---- identifier types ------------------------------------------------------------------------

export interface IdentifierTypeEntry {
  type: DirectoryIdentifierType;
  label: string;
  appliesTo: DirectoryEntityKind | "both";
  /**
   * Whether the firm can match this identifier without decrypting it. An indexed type is what makes
   * a conflicts hit near-certain; an unindexed one is held for the record and compared only against
   * a candidate set a name already narrowed.
   */
  indexed: boolean;
}

export const IDENTIFIER_TYPES: readonly IdentifierTypeEntry[] = [
  { type: "ssn", label: "Social security number", appliesTo: "person", indexed: true },
  {
    type: "ssn_last_four",
    label: "Social security last four",
    appliesTo: "person",
    indexed: false,
  },
  {
    type: "ein",
    label: "Employer identification number",
    appliesTo: "organization",
    indexed: true,
  },
  { type: "drivers_license", label: "Driver's license", appliesTo: "person", indexed: true },
  { type: "dob", label: "Date of birth", appliesTo: "person", indexed: false },
  { type: "bar_number", label: "Bar number", appliesTo: "person", indexed: false },
  { type: "account", label: "Account number", appliesTo: "both", indexed: true },
];

export function identifierTypeLabel(type: string): string {
  return IDENTIFIER_TYPES.find((entry) => entry.type === type)?.label ?? type;
}

/** The identifier types this side of the directory can hold. Nothing else is ever offered. */
export function identifierTypesFor(kind: DirectoryEntityKind): readonly IdentifierTypeEntry[] {
  return IDENTIFIER_TYPES.filter((entry) => entry.appliesTo === "both" || entry.appliesTo === kind);
}

// ---- edge types ------------------------------------------------------------------------------

export interface EdgeTypeEntry {
  edgeType: DirectoryEdgeType;
  label: string;
  /** How the edge reads from its origin toward its target ("is a principal of"). */
  reading: string;
}

/**
 * The typed relationships between entities. These are what makes an imputed conflict explicable: a
 * hit on a company is only a hit on its principal because an edge says so, and the edge is the
 * sentence a report can print.
 */
export const EDGE_TYPES: readonly EdgeTypeEntry[] = [
  { edgeType: "affiliation", label: "Affiliation", reading: "is affiliated with" },
  { edgeType: "relationship", label: "Personal relationship", reading: "is related to" },
  { edgeType: "corporate_parent", label: "Corporate parent", reading: "is the parent of" },
  { edgeType: "corporate_subsidiary", label: "Subsidiary", reading: "is a subsidiary of" },
  { edgeType: "corporate_successor", label: "Successor", reading: "is the successor to" },
  { edgeType: "representation", label: "Representation", reading: "represents" },
  { edgeType: "role_assignment", label: "Role", reading: "holds a role with" },
];

export function edgeTypeLabel(edgeType: string): string {
  return EDGE_TYPES.find((entry) => entry.edgeType === edgeType)?.label ?? edgeType;
}

// ---- pronouns --------------------------------------------------------------------------------

export interface PronounFormEntry {
  /** The field on the stated set. */
  form: "subject" | "object" | "possessiveDeterminer" | "possessivePronoun" | "reflexive";
  label: string;
  /** The sentence position the form fills, for the reader who has to fill five boxes. */
  reading: string;
}

/**
 * The five grammatical positions a document can put a pronoun in, in the order they are asked for.
 *
 * All five are stored rather than a label like "she/her", because a label names two of them and
 * settles nothing about the other three for a set the platform has never seen. Storing the forms is
 * what lets a template render any set at all, including one invented tomorrow.
 */
export const PRONOUN_FORMS: readonly PronounFormEntry[] = [
  { form: "subject", label: "Subject", reading: "she signed" },
  { form: "object", label: "Object", reading: "we served her" },
  { form: "possessiveDeterminer", label: "Possessive determiner", reading: "her signature" },
  { form: "possessivePronoun", label: "Possessive pronoun", reading: "the signature is hers" },
  { form: "reflexive", label: "Reflexive", reading: "she represented herself" },
];

export const PRONOUN_VERB_NUMBERS: readonly { value: PronounVerbNumber; label: string }[] = [
  { value: "singular", label: "Singular" },
  { value: "plural", label: "Plural" },
];

export function pronounVerbNumberLabel(verbNumber: PronounVerbNumber): string {
  return PRONOUN_VERB_NUMBERS.find((entry) => entry.value === verbNumber)?.label ?? verbNumber;
}
