import type { CitationFieldName, CitationFields, CitationKind } from "./types.ts";

/**
 * The fields the Build form shows for each kind, in order. The first ones are what a full citation
 * cannot do without; the rest are optional or needed only in some forms (a pin cite for a short
 * form, a court where the reporter does not imply one).
 */
export const FORM_FIELDS: Readonly<Record<CitationKind, readonly CitationFieldName[]>> = {
  case: [
    "caseName",
    "volume",
    "reporter",
    "firstPage",
    "pinCite",
    "court",
    "year",
    "parenthetical",
  ],
  "united-states-code": ["title", "section", "year"],
  "code-of-federal-regulations": ["title", "part", "section", "year"],
  "federal-register": ["volume", "page", "pinCite", "date"],
  "public-law": ["congress", "lawNumber", "statutesAtLargeVolume", "statutesAtLargePage", "year"],
  "nevada-revised-statutes": ["section", "year"],
  "california-code": ["californiaCode", "section", "year"],
};

/** An unpublished disposition is cited by docket and database rather than by reporter. */
const UNPUBLISHED_CASE_FIELDS: readonly CitationFieldName[] = [
  "caseName",
  "docketNumber",
  "databaseCitation",
  "pinCite",
  "court",
  "dateDecided",
  "parenthetical",
];

/** The fields the Build form shows for a citation as it stands. */
export function formFieldsFor(
  kind: CitationKind,
  fields: CitationFields,
): readonly CitationFieldName[] {
  if (kind === "case" && fields.unpublished === "yes") return UNPUBLISHED_CASE_FIELDS;
  return FORM_FIELDS[kind];
}
