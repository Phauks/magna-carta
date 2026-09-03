/*
 * How the firm's directory presents an entity — the one answer, so every surface that names a
 * person or an organization names them identically.
 *
 * This module is deliberately free of any one surface. The directory, a matter's parties, a
 * conflicts result and a picker all show the SAME record, and the moment two of them assemble a
 * name differently a reader has to work out whether they are looking at one entity or two. The
 * shapes it takes are the contract's own shapes; the output is text and a small presentation
 * record, never markup.
 */
import { personName } from "@magna-carta/design-system/formatters";
import type {
  DirectoryEntityDetail,
  DirectoryEntityKind,
  DirectoryOrganizationDetail,
  DirectoryPersonDetail,
  PronounSet,
} from "./directory-api.ts";

/** What stands where the directory holds no name at all. It states the gap rather than filling it. */
export const UNNAMED_ENTITY = "Not recorded";

/** What each side of the directory is called, as a reader sees it. */
const KIND_LABEL: Readonly<Record<DirectoryEntityKind, string>> = {
  person: "Person",
  organization: "Organization",
};

export function entityKindLabel(kind: DirectoryEntityKind): string {
  return KIND_LABEL[kind];
}

/** A search hit's kind arrives as free text on the contract; anything unrecognized reads as it came. */
export function searchHitKindLabel(entityKind: string): string {
  if (entityKind === "person" || entityKind === "organization") return KIND_LABEL[entityKind];
  return entityKind;
}

/**
 * A person's name from the parts the firm recorded.
 *
 * The rendered `displayName` wins when the firm has one, because that is the form the firm chose.
 * Otherwise the parts are assembled in reading order and the empty ones simply do not appear — a
 * person with no middle name has a shorter name, never a gap. The result goes through the
 * platform's own name formatter, so an entity carrying nothing readable says so in the one wording
 * the product uses everywhere.
 */
export function directoryPersonName(person: DirectoryPersonDetail): string {
  const assembled = [person.prefix, person.given, person.middle, person.family, person.suffix]
    .filter((part): part is string => part !== null && part.trim() !== "")
    .join(" ");
  return personName(person.displayName ?? assembled, { whenUnrecorded: UNNAMED_ENTITY });
}

/**
 * An organization's name. The legal name is the record; a display name is what the firm calls it,
 * and where both exist the display name is what a reader recognizes.
 */
export function directoryOrganizationName(organization: DirectoryOrganizationDetail): string {
  const chosen = organization.displayName ?? organization.legalName;
  return personName(chosen, { whenUnrecorded: UNNAMED_ENTITY });
}

/** Either kind's name, for a surface holding one value through both. */
export function directoryEntityName(entity: DirectoryEntityDetail): string {
  return entity.kind === "person"
    ? directoryPersonName(entity.person)
    : directoryOrganizationName(entity.organization);
}

/**
 * An organization's legal name where it differs from what the firm calls it, else null.
 *
 * Printed beside the name when the two are not the same, because a pleading carries the legal name
 * and the screen has to be able to show which one that is.
 */
export function organizationLegalNameAside(
  organization: DirectoryOrganizationDetail,
): string | null {
  const legal = organization.legalName?.trim() ?? "";
  if (legal === "") return null;
  return legal === directoryOrganizationName(organization) ? null : legal;
}

/**
 * The short form of a stated pronoun set — the two forms a person writes on a signature block.
 *
 * Built from the forms the person STATED and from nothing else. There is no lookup table of known
 * sets here and there must never be one: the sets a table lacks are exactly the ones whose owners
 * are used to being rendered wrong, and a name has never said anything about which set is right.
 */
export function pronounShortForm(pronouns: PronounSet): string {
  return `${pronouns.subject}/${pronouns.possessiveDeterminer}`;
}

/** Whether an entity has been folded into another record, which changes what a screen may offer. */
export function entityMergedIntoIdentifier(entity: DirectoryEntityDetail): string | null {
  return entity.kind === "person" ? entity.person.mergedIntoId : entity.organization.mergedIntoId;
}

/** The handle either detail carries. */
export function entityDetailIdentifier(entity: DirectoryEntityDetail): string {
  return entity.kind === "person" ? entity.person.id : entity.organization.id;
}

/** Where an entity's record lives. One address, so nothing links to it two ways. */
export function entityRecordHref(entityId: string): string {
  return `/directory/${encodeURIComponent(entityId)}`;
}
