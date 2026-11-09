import type { SourceIdentifier } from "./types.ts";

/*
 * The sources a pasted link or citation can be read from, in the order the interface lists them
 * under "Available Sources" (best first). `needsConnection` marks a source the firm must connect
 * before its links can be read.
 */
export interface AvailableSource {
  readonly identifier: SourceIdentifier;
  readonly name: string;
  readonly needsConnection: boolean;
}

export const AVAILABLE_SOURCES: readonly AvailableSource[] = [
  { identifier: "westlaw", name: "Westlaw", needsConnection: true },
  { identifier: "lexis", name: "Lexis", needsConnection: true },
  { identifier: "courtlistener", name: "CourtListener", needsConnection: false },
  { identifier: "govinfo", name: "govinfo: U.S. Code", needsConnection: false },
  { identifier: "govinfo", name: "govinfo: Code of Federal Regulations", needsConnection: false },
  { identifier: "govinfo", name: "govinfo: Federal Register", needsConnection: false },
  { identifier: "govinfo", name: "govinfo: Public Laws", needsConnection: false },
  {
    identifier: "cornell-legal-information-institute",
    name: "Cornell Legal Information Institute",
    needsConnection: false,
  },
  { identifier: "electronic-code-of-federal-regulations", name: "eCFR", needsConnection: false },
  { identifier: "nevada-legislature", name: "Nevada Revised Statutes", needsConnection: false },
  {
    identifier: "california-legislative-information",
    name: "California Codes",
    needsConnection: false,
  },
];

/** The member-facing name of the source a recognition came from ("Read from CourtListener"). */
export const SOURCE_NAMES: Readonly<Record<SourceIdentifier, string>> = {
  westlaw: "Westlaw",
  lexis: "Lexis",
  courtlistener: "CourtListener",
  govinfo: "govinfo",
  "cornell-legal-information-institute": "Cornell Legal Information Institute",
  "electronic-code-of-federal-regulations": "eCFR",
  "nevada-legislature": "Nevada Legislature",
  "california-legislative-information": "California Legislative Information",
  "citation-text": "the citation",
};
