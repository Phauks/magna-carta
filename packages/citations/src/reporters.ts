/*
 * The reporters the engine recognizes in a rough citation. A curated subset covering the federal
 * courts and the Pacific and California reporters the firm cites most; Free Law Project's
 * reporters-db (BSD-licensed JSON of ~1,000 American reporters) is the intended full table, imported
 * at build time when the recognizer outgrows this list.
 *
 * `courtImplied` marks a reporter that publishes only one court's decisions, so the court is left
 * out of the date parenthetical (Indigo Book R12): "347 U.S. 483 (1954)", never "(U.S. 1954)".
 */
export interface Reporter {
  /** The standard abbreviation, as printed (Indigo Book T1.1, T3). */
  readonly abbreviation: string;
  /** The court the reporter implies, when it publishes only one; null for multi-court reporters. */
  readonly courtImplied: string | null;
}

export const REPORTERS: readonly Reporter[] = [
  { abbreviation: "U.S.", courtImplied: "Supreme Court of the United States" },
  { abbreviation: "S. Ct.", courtImplied: "Supreme Court of the United States" },
  { abbreviation: "L. Ed.", courtImplied: "Supreme Court of the United States" },
  { abbreviation: "L. Ed. 2d", courtImplied: "Supreme Court of the United States" },
  { abbreviation: "F.", courtImplied: null },
  { abbreviation: "F.2d", courtImplied: null },
  { abbreviation: "F.3d", courtImplied: null },
  { abbreviation: "F.4th", courtImplied: null },
  { abbreviation: "F. App'x", courtImplied: null },
  { abbreviation: "F. Supp.", courtImplied: null },
  { abbreviation: "F. Supp. 2d", courtImplied: null },
  { abbreviation: "F. Supp. 3d", courtImplied: null },
  { abbreviation: "B.R.", courtImplied: null },
  { abbreviation: "P.", courtImplied: null },
  { abbreviation: "P.2d", courtImplied: null },
  { abbreviation: "P.3d", courtImplied: null },
  { abbreviation: "Nev.", courtImplied: "Supreme Court of Nevada" },
  { abbreviation: "Cal.", courtImplied: "Supreme Court of California" },
  { abbreviation: "Cal. 2d", courtImplied: "Supreme Court of California" },
  { abbreviation: "Cal. 3d", courtImplied: "Supreme Court of California" },
  { abbreviation: "Cal. 4th", courtImplied: "Supreme Court of California" },
  { abbreviation: "Cal. 5th", courtImplied: "Supreme Court of California" },
  { abbreviation: "Cal. App.", courtImplied: "California Court of Appeal" },
  { abbreviation: "Cal. App. 2d", courtImplied: "California Court of Appeal" },
  { abbreviation: "Cal. App. 3d", courtImplied: "California Court of Appeal" },
  { abbreviation: "Cal. App. 4th", courtImplied: "California Court of Appeal" },
  { abbreviation: "Cal. App. 5th", courtImplied: "California Court of Appeal" },
  { abbreviation: "Cal. Rptr.", courtImplied: null },
  { abbreviation: "Cal. Rptr. 2d", courtImplied: null },
  { abbreviation: "Cal. Rptr. 3d", courtImplied: null },
];

/** The comparison key for a reporter as typed: case, spaces, periods and apostrophes dropped. */
export function reporterKey(text: string): string {
  return text.toLowerCase().replace(/[\s.'’]/g, "");
}

const BY_KEY: ReadonlyMap<string, Reporter> = new Map(
  REPORTERS.map((reporter) => [reporterKey(reporter.abbreviation), reporter]),
);

/** The reporter a member typed, however loosely ("us", "f 3d", "cal app 4th"), or null. */
export function findReporter(text: string): Reporter | null {
  return BY_KEY.get(reporterKey(text)) ?? null;
}

/**
 * Common words abbreviated in case names in citations (Indigo Book T11). A subset; a word not here
 * is printed as written.
 */
export const CASE_NAME_ABBREVIATIONS: Readonly<Record<string, string>> = {
  American: "Am.",
  Association: "Ass'n",
  Authority: "Auth.",
  Board: "Bd.",
  Brothers: "Bros.",
  Building: "Bldg.",
  Commission: "Comm'n",
  Committee: "Comm.",
  Company: "Co.",
  Corporation: "Corp.",
  Department: "Dep't",
  Development: "Dev.",
  District: "Dist.",
  Education: "Educ.",
  Federal: "Fed.",
  Government: "Gov't",
  Hospital: "Hosp.",
  Incorporated: "Inc.",
  Insurance: "Ins.",
  International: "Int'l",
  Limited: "Ltd.",
  Manufacturing: "Mfg.",
  Mutual: "Mut.",
  National: "Nat'l",
  Products: "Prods.",
  Railroad: "R.R.",
  Railway: "Ry.",
  Service: "Serv.",
  Services: "Servs.",
  Technology: "Tech.",
  Transportation: "Transp.",
  University: "Univ.",
};

/** A case name with its common words abbreviated and "v" normalized to "v.". */
export function abbreviateCaseName(caseName: string): string {
  return caseName
    .trim()
    .replace(/\s+vs?\.?\s+/i, " v. ")
    .split(/(\s+)/)
    .map((word) => CASE_NAME_ABBREVIATIONS[word] ?? word)
    .join("");
}

/** Parties a short form passes over, because they name a government rather than the case (R15). */
const GOVERNMENTAL_FIRST_PARTIES = new Set(["United States", "State", "People", "Commonwealth"]);

/** The party name a short form uses: the first party, unless it is a government (Indigo Book R15). */
export function shortCaseName(caseName: string): string {
  const abbreviated = abbreviateCaseName(caseName);
  const [first, second] = abbreviated.split(" v. ");
  if (first === undefined) return abbreviated;
  if (second !== undefined && GOVERNMENTAL_FIRST_PARTIES.has(first.trim())) return second.trim();
  return first.trim();
}
