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
  DirectoryAddressType,
  DirectoryAddressUse,
  DirectoryContactSystem,
  DirectoryContactUse,
  DirectoryEdgeType,
  DirectoryEntityKind,
  DirectoryIdentifierType,
  DirectoryNameRole,
  DirectoryVerificationStatus,
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
//
// The catalog lives with the shape checks in the directory package, so the screen and the API
// refuse the same values for the same reasons. Re-exported here so every directory screen keeps one
// import for its vocabulary.

export {
  IDENTIFIER_SHAPES,
  identifierShape,
  identifierShapesFor,
  identifierTypeLabel,
  type IdentifierField,
  type IdentifierShape,
} from "@magna-carta/directory/identifier-shape";

// ---- edge types ------------------------------------------------------------------------------

export interface EdgeTypeEntry {
  edgeType: DirectoryEdgeType;
  label: string;
  /** How the edge reads from its origin toward its target ("is a principal of"). */
  reading: string;
  /**
   * Which kinds may stand at each end, origin then target. What the record screen offers depends on
   * it: a person is an officer OF an organization, never the other way round.
   */
  ends: { from: DirectoryEntityKind | "both"; to: DirectoryEntityKind | "both" };
  /** Whether the screen still offers this type for a NEW edge. A retired type keeps its label. */
  offered: boolean;
  /** The heading the type is listed under when choosing one. */
  group: EdgeTypeGroup;
}

/**
 * The headings the relationship list is divided by, in the order they are listed. Family stands
 * apart from everything else because a tie of blood or marriage is a different kind of fact from a
 * role somebody was given: the owner asked that the two never be mixed in one run of choices.
 */
export const EDGE_TYPE_GROUPS = [
  { group: "family", heading: "Family" },
  { group: "personal", heading: "Personal" },
  { group: "organization", heading: "Within an organization" },
  { group: "legal", heading: "Legal and fiduciary" },
  { group: "business", heading: "Business structure" },
  { group: "other", heading: "Other" },
] as const;

export type EdgeTypeGroup = (typeof EDGE_TYPE_GROUPS)[number]["group"];

/**
 * Types grouped under their headings, in heading order, each group A to Z by label with any
 * "Other ..." choice last. Empty groups are left out.
 */
export function groupedEdgeTypes(
  entries: readonly EdgeTypeEntry[],
): { group: EdgeTypeGroup; heading: string; entries: EdgeTypeEntry[] }[] {
  const lastOfGroup = (entry: EdgeTypeEntry): number => (entry.label.startsWith("Other ") ? 1 : 0);
  return EDGE_TYPE_GROUPS.map(({ group, heading }) => ({
    group,
    heading,
    entries: entries
      .filter((entry) => entry.group === group)
      .toSorted(
        (left, right) =>
          lastOfGroup(left) - lastOfGroup(right) || left.label.localeCompare(right.label),
      ),
  })).filter((section) => section.entries.length > 0);
}

/**
 * The typed relationships between entities. These are what makes an imputed conflict explicable: a
 * hit on a company is only a hit on its principal because an edge says so, and the edge is the
 * sentence a report can print.
 */
export const EDGE_TYPES: readonly EdgeTypeEntry[] = [
  // The legacy, unclassified membership: kept for the rows already recorded, no longer offered.
  {
    edgeType: "affiliation",
    label: "Affiliation",
    reading: "is affiliated with",
    ends: { from: "person", to: "organization" },
    offered: false,
    group: "other",
  },
  {
    edgeType: "relationship",
    label: "Personal relationship",
    reading: "is related to",
    ends: { from: "person", to: "person" },
    offered: true,
    group: "personal",
  },
  {
    edgeType: "corporate_parent",
    label: "Corporate parent",
    reading: "is the parent of",
    ends: { from: "organization", to: "organization" },
    offered: true,
    group: "business",
  },
  {
    edgeType: "corporate_subsidiary",
    label: "Subsidiary",
    reading: "is a subsidiary of",
    ends: { from: "organization", to: "organization" },
    offered: true,
    group: "business",
  },
  {
    edgeType: "corporate_successor",
    label: "Successor",
    reading: "is the successor to",
    ends: { from: "organization", to: "organization" },
    offered: true,
    group: "business",
  },
  {
    edgeType: "representation",
    label: "Representation",
    reading: "represents",
    ends: { from: "both", to: "both" },
    offered: true,
    group: "legal",
  },
  {
    edgeType: "role_assignment",
    label: "Role",
    reading: "holds a role with",
    ends: { from: "both", to: "both" },
    offered: true,
    group: "other",
  },
  {
    edgeType: "officer_of",
    label: "Officer",
    reading: "is an officer of",
    ends: { from: "person", to: "organization" },
    offered: true,
    group: "organization",
  },
  {
    edgeType: "director_of",
    label: "Director",
    reading: "is a director of",
    ends: { from: "person", to: "organization" },
    offered: true,
    group: "organization",
  },
  {
    edgeType: "partner_of",
    label: "Partner",
    reading: "is a partner of",
    ends: { from: "person", to: "organization" },
    offered: true,
    group: "organization",
  },
  {
    edgeType: "trustee_of",
    label: "Trustee",
    reading: "is a trustee of",
    ends: { from: "both", to: "both" },
    offered: true,
    group: "legal",
  },
  {
    edgeType: "personal_representative_of",
    label: "Personal representative",
    reading: "is the personal representative of",
    ends: { from: "person", to: "both" },
    offered: true,
    group: "legal",
  },
  {
    edgeType: "agent_of",
    label: "Agent",
    reading: "is an agent of",
    ends: { from: "both", to: "both" },
    offered: true,
    group: "legal",
  },
  {
    edgeType: "employment",
    label: "Employee",
    reading: "is employed by",
    ends: { from: "person", to: "organization" },
    offered: true,
    group: "organization",
  },
  {
    edgeType: "member_of",
    label: "Member",
    reading: "is a member of",
    ends: { from: "person", to: "organization" },
    offered: true,
    group: "organization",
  },
  {
    edgeType: "shareholder_of",
    label: "Shareholder",
    reading: "is a shareholder of",
    ends: { from: "both", to: "organization" },
    offered: true,
    group: "organization",
  },
  {
    edgeType: "beneficiary_of",
    label: "Beneficiary",
    reading: "is a beneficiary of",
    ends: { from: "both", to: "both" },
    offered: true,
    group: "legal",
  },
  {
    edgeType: "guardian_of",
    label: "Guardian",
    reading: "is the guardian of",
    ends: { from: "person", to: "person" },
    offered: true,
    group: "personal",
  },
  {
    edgeType: "point_of_contact_for",
    label: "Point of contact",
    reading: "is the point of contact for",
    ends: { from: "person", to: "organization" },
    offered: true,
    group: "organization",
  },
  {
    edgeType: "spouse_of",
    label: "Spouse or partner",
    reading: "is the spouse or partner of",
    ends: { from: "person", to: "person" },
    offered: true,
    group: "family",
  },
  {
    edgeType: "parent_of",
    label: "Parent",
    reading: "is the parent of",
    ends: { from: "person", to: "person" },
    offered: true,
    group: "family",
  },
  {
    edgeType: "child_of",
    label: "Child",
    reading: "is the child of",
    ends: { from: "person", to: "person" },
    offered: true,
    group: "family",
  },
  {
    edgeType: "sibling_of",
    label: "Sibling",
    reading: "is the sibling of",
    ends: { from: "person", to: "person" },
    offered: true,
    group: "family",
  },
  {
    edgeType: "grandparent_of",
    label: "Grandparent",
    reading: "is the grandparent of",
    ends: { from: "person", to: "person" },
    offered: true,
    group: "family",
  },
  {
    edgeType: "grandchild_of",
    label: "Grandchild",
    reading: "is the grandchild of",
    ends: { from: "person", to: "person" },
    offered: true,
    group: "family",
  },
  {
    edgeType: "family_member_of",
    label: "Other family",
    reading: "is family of",
    ends: { from: "person", to: "person" },
    offered: true,
    group: "family",
  },
];

export function edgeTypeLabel(edgeType: string): string {
  return EDGE_TYPES.find((entry) => entry.edgeType === edgeType)?.label ?? edgeType;
}

/**
 * The types a NEW edge may be given, from an entity of this kind at its origin. What is offered is
 * what the origin's kind can honestly stand at the near end of; the far end is narrowed by the
 * type once one is chosen (`edgeTargetKinds`).
 */
export function offeredEdgeTypesFrom(kind: DirectoryEntityKind): readonly EdgeTypeEntry[] {
  return EDGE_TYPES.filter(
    (entry) => entry.offered && (entry.ends.from === "both" || entry.ends.from === kind),
  );
}

/** Which kinds may stand at the far end of an edge of this type. */
export function edgeTargetKinds(edgeType: DirectoryEdgeType): readonly DirectoryEntityKind[] {
  const to = EDGE_TYPES.find((entry) => entry.edgeType === edgeType)?.ends.to ?? "both";
  return to === "both" ? ["person", "organization"] : [to];
}

/**
 * The membership family: the edge types that put a person INSIDE an organization, which is what the
 * organization's People pane and the person's Organizations pane list. The legacy `affiliation`
 * belongs here so the rows recorded before the family existed are still shown as what they are.
 */
export const MEMBERSHIP_EDGE_TYPES: readonly DirectoryEdgeType[] = [
  "affiliation",
  "officer_of",
  "director_of",
  "partner_of",
  "trustee_of",
  "agent_of",
  "employment",
  "member_of",
  "shareholder_of",
  "point_of_contact_for",
];

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

// ---- contact points ---------------------------------------------------------------------------

/**
 * WHAT THE PERSON ENTERING A NUMBER PICKS, AND WHAT IS STORED BEHIND IT.
 *
 * Storage keeps the technology and the context apart because programs need it to: a delivery path
 * asking "may this be faxed" must not answer from a column where `fax` and `office/fax` mean the
 * same thing to a person and nothing to a program. Nobody entering a telephone number should have to
 * see two dropdowns to say "mobile", so one picker writes both columns.
 */
export interface PhoneKindEntry {
  /** The value of the picker itself; not stored. */
  value: string;
  label: string;
  system: DirectoryContactSystem;
  use: DirectoryContactUse | null;
}

export const PHONE_KINDS: readonly PhoneKindEntry[] = [
  { value: "mobile", label: "Mobile", system: "voice", use: "mobile" },
  { value: "work", label: "Office", system: "voice", use: "work" },
  { value: "home", label: "Home", system: "voice", use: "home" },
  { value: "work_fax", label: "Fax (office)", system: "fax", use: "work" },
  { value: "home_fax", label: "Fax (home)", system: "fax", use: "home" },
  { value: "text_message", label: "Text message", system: "sms", use: "mobile" },
  { value: "other", label: "Other", system: "voice", use: "other" },
];

/** What to call a stored (system, use) pair. Falls back to naming both when no picker entry fits. */
export function phoneKindLabel(
  system: DirectoryContactSystem,
  use: DirectoryContactUse | null,
): string {
  const matched = PHONE_KINDS.find((entry) => entry.system === system && entry.use === use);
  if (matched !== undefined) return matched.label;
  const systemLabel = CONTACT_SYSTEM_LABELS[system] ?? system;
  return use === null ? systemLabel : `${systemLabel} (${contactUseLabel(use)})`;
}

const CONTACT_SYSTEM_LABELS: Record<DirectoryContactSystem, string> = {
  voice: "Voice",
  fax: "Fax",
  sms: "Text message",
  pager: "Pager",
};

const CONTACT_USE_LABELS: Record<DirectoryContactUse, string> = {
  work: "Work",
  home: "Home",
  mobile: "Mobile",
  other: "Other",
  former: "Former",
  temporary: "Temporary",
};

export function contactUseLabel(use: DirectoryContactUse): string {
  return CONTACT_USE_LABELS[use] ?? use;
}

/** The contexts an email address is offered in. A mobile email address is not a thing anybody says. */
export const EMAIL_USES: readonly { value: DirectoryContactUse; label: string }[] = [
  { value: "work", label: "Work" },
  { value: "home", label: "Personal" },
  { value: "other", label: "Other" },
  { value: "former", label: "Former" },
  { value: "temporary", label: "Temporary" },
];

export const ADDRESS_USES: readonly { value: DirectoryAddressUse; label: string }[] = [
  { value: "residential", label: "Residential" },
  { value: "business", label: "Business" },
  { value: "postal", label: "Postal" },
  { value: "registered", label: "Registered office" },
  { value: "service", label: "For service" },
  { value: "former", label: "Former" },
  { value: "temporary", label: "Temporary" },
];

export function addressUseLabel(use: DirectoryAddressUse): string {
  return ADDRESS_USES.find((entry) => entry.value === use)?.label ?? use;
}

/**
 * Whether the place physically exists. Offered because personal service turns on it: a post office
 * box cannot be served, and a firm that files an affidavit saying otherwise has a problem.
 */
export const ADDRESS_TYPES: readonly { value: DirectoryAddressType; label: string }[] = [
  { value: "physical", label: "A place that exists" },
  { value: "postal", label: "A delivery point only" },
  { value: "both", label: "Both" },
];

export function addressTypeLabel(addressType: DirectoryAddressType): string {
  return ADDRESS_TYPES.find((entry) => entry.value === addressType)?.label ?? addressType;
}

export const VERIFICATION_STATUSES: readonly {
  value: DirectoryVerificationStatus;
  label: string;
}[] = [
  { value: "unverified", label: "Not confirmed" },
  { value: "verified", label: "Confirmed" },
  { value: "failed", label: "Did not reach" },
];

export function verificationStatusLabel(status: DirectoryVerificationStatus): string {
  return VERIFICATION_STATUSES.find((entry) => entry.value === status)?.label ?? status;
}

/**
 * The address as one block of lines, in reading order.
 *
 * Deliberately not per-country ordering: the field SET, the labels and the order all vary by
 * country, and getting that right needs a reference dataset the design system's planned
 * address-field component will own. Until it exists this renders the lines the firm entered, in the
 * order they were entered, which is honest and never wrong about a country it has never heard of.
 */
export function addressLines(address: {
  recipient: string | null;
  organizationName: string | null;
  street: string | null;
  streetTwo: string | null;
  dependentLocality: string | null;
  city: string | null;
  region: string | null;
  postal: string | null;
  sortingCode: string | null;
  country: string | null;
}): readonly string[] {
  const localityLine = [address.city, address.region, address.postal]
    .filter((part): part is string => part !== null && part.trim() !== "")
    .join(" ");
  return [
    address.recipient,
    address.organizationName,
    address.street,
    address.streetTwo,
    address.dependentLocality,
    localityLine === "" ? null : localityLine,
    address.sortingCode,
    address.country,
  ].filter((line): line is string => line !== null && line.trim() !== "");
}
