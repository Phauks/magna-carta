/*
 * The citation model. A citation is a KIND plus a flat set of named fields; every field remembers
 * where its value came from, because the member's own typing must always win over what a link or a
 * lookup read, and must survive the link being read again.
 */

/** What is being cited. Each kind has its own required fields (see `FORM_FIELDS` in fields.ts). */
export type CitationKind =
  | "case"
  | "united-states-code"
  | "code-of-federal-regulations"
  | "federal-register"
  | "public-law"
  | "nevada-revised-statutes"
  | "california-code";

export const CITATION_KINDS: readonly CitationKind[] = [
  "case",
  "united-states-code",
  "code-of-federal-regulations",
  "federal-register",
  "public-law",
  "nevada-revised-statutes",
  "california-code",
];

/** The member-facing name of each kind, in the interface's title case. */
export const CITATION_KIND_NAMES: Readonly<Record<CitationKind, string>> = {
  case: "Case",
  "united-states-code": "U.S. Code",
  "code-of-federal-regulations": "Code of Federal Regulations",
  "federal-register": "Federal Register",
  "public-law": "Public Law",
  "nevada-revised-statutes": "Nevada Revised Statutes",
  "california-code": "California Code",
};

/**
 * Every field any kind uses. Flat on purpose: a field means the same thing whichever kind carries
 * it, so provenance, overriding and the form fields in the interface need no per-kind plumbing.
 */
export type CitationFieldName =
  | "caseName"
  | "volume"
  | "reporter"
  | "firstPage"
  | "pinCite"
  | "court"
  | "year"
  | "docketNumber"
  | "databaseCitation"
  | "dateDecided"
  | "unpublished"
  | "title"
  | "section"
  | "part"
  | "page"
  | "date"
  | "congress"
  | "lawNumber"
  | "statutesAtLargeVolume"
  | "statutesAtLargePage"
  | "californiaCode"
  | "parenthetical";

/** The member-facing label of each field. */
export const FIELD_LABELS: Readonly<Record<CitationFieldName, string>> = {
  caseName: "Case Name",
  volume: "Volume",
  reporter: "Reporter",
  firstPage: "First Page",
  pinCite: "Pin Cite",
  court: "Court",
  year: "Year",
  docketNumber: "Docket Number",
  databaseCitation: "Database Citation",
  dateDecided: "Date Decided",
  unpublished: "Unpublished Disposition",
  title: "Title",
  section: "Section",
  part: "Part",
  page: "Page",
  date: "Date",
  congress: "Congress",
  lawNumber: "Law Number",
  statutesAtLargeVolume: "Statutes at Large Volume",
  statutesAtLargePage: "Statutes at Large Page",
  californiaCode: "Code",
  parenthetical: "Parenthetical",
};

export type CitationFields = Partial<Record<CitationFieldName, string>>;

/**
 * Where a field's value came from. `link` was read from the pasted address or text itself, `lookup`
 * from a provider asked about it, `typed` by the member. Precedence is typed > lookup > link.
 */
export type FieldSource = "link" | "lookup" | "typed";

export interface FieldValue {
  readonly value: string;
  readonly source: FieldSource;
}

/** A citation being built: its kind and every field with its provenance. */
export interface CitationDraft {
  readonly kind: CitationKind;
  readonly fields: Readonly<Partial<Record<CitationFieldName, FieldValue>>>;
  /** What was read, kept apart so clearing a typed value can restore it. */
  readonly read: Readonly<Partial<Record<CitationFieldName, FieldValue>>>;
}

/** The sources the engine can read, best first (sources.ts holds the member-facing list). */
export type SourceIdentifier =
  | "westlaw"
  | "lexis"
  | "courtlistener"
  | "govinfo"
  | "cornell-legal-information-institute"
  | "electronic-code-of-federal-regulations"
  | "nevada-legislature"
  | "california-legislative-information"
  | "citation-text";

/** A provider that must be asked to fill the fields a link or citation cannot carry by itself. */
export interface LookupRequest {
  readonly provider: "westlaw" | "lexis" | "courtlistener";
  /** The provider's identifier: an opinion id, or the whole link for providers read by address. */
  readonly identifier: string;
}

/** What `recognize` found in a pasted link or rough citation. */
export interface Recognition {
  /** Null when only a provider can tell what the document is (a Westlaw or Lexis link). */
  readonly kind: CitationKind | null;
  readonly source: SourceIdentifier;
  readonly fields: CitationFields;
  readonly lookup: LookupRequest | null;
}

/** Full on first mention, short after it, `Id.` when it immediately repeats the same source. */
export type CitationForm = "full" | "short" | "id";

/** A span of citation text. Italic is a property of the run, never markup in a string. */
export interface CitationRun {
  readonly text: string;
  readonly italic: boolean;
}

export interface CitationNotice {
  readonly severity: "error" | "suggestion";
  readonly message: string;
  /** The rule the notice applies: an Indigo Book number (`R15`) or a court rule (`NRAP 36(c)(3)`). */
  readonly rule: string;
}

export interface FormattedCitation {
  readonly runs: readonly CitationRun[];
  /** The same text with no italics, for email, notes and anywhere styling is lost. */
  readonly plainText: string;
  /** Rules applied, Indigo Book or court-rule numbers, so a member can check the result. */
  readonly rules: readonly string[];
  /** Required fields with no value; the citation is rendered without them and is incomplete. */
  readonly missing: readonly CitationFieldName[];
  readonly notices: readonly CitationNotice[];
}
