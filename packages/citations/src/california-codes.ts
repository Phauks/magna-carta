/*
 * The California codes the engine names. `lawCode` is the identifier California Legislative
 * Information uses in its section links (`codes_displaySection.xhtml?lawCode=CCP&sectionNum=337.`);
 * `uniform` is the abbreviation in the Uniform System, `californiaStyle` the one the California
 * Style Manual uses inside a citation.
 */
export interface CaliforniaCode {
  readonly lawCode: string;
  readonly name: string;
  readonly uniform: string;
  readonly californiaStyle: string;
}

export const CALIFORNIA_CODES: readonly CaliforniaCode[] = [
  {
    lawCode: "BPC",
    name: "Business and Professions Code",
    uniform: "Cal. Bus. & Prof. Code",
    californiaStyle: "Bus. & Prof. Code",
  },
  { lawCode: "CIV", name: "Civil Code", uniform: "Cal. Civ. Code", californiaStyle: "Civ. Code" },
  {
    lawCode: "CCP",
    name: "Code of Civil Procedure",
    uniform: "Cal. Civ. Proc. Code",
    californiaStyle: "Code Civ. Proc.",
  },
  {
    lawCode: "EVID",
    name: "Evidence Code",
    uniform: "Cal. Evid. Code",
    californiaStyle: "Evid. Code",
  },
  { lawCode: "FAM", name: "Family Code", uniform: "Cal. Fam. Code", californiaStyle: "Fam. Code" },
  {
    lawCode: "GOV",
    name: "Government Code",
    uniform: "Cal. Gov't Code",
    californiaStyle: "Gov. Code",
  },
  { lawCode: "PEN", name: "Penal Code", uniform: "Cal. Penal Code", californiaStyle: "Pen. Code" },
  {
    lawCode: "PROB",
    name: "Probate Code",
    uniform: "Cal. Prob. Code",
    californiaStyle: "Prob. Code",
  },
];

/** A California code by its legislative-information law code (`CCP`) or its name, or null. */
export function findCaliforniaCode(identifier: string): CaliforniaCode | null {
  const wanted = identifier.trim().toLowerCase();
  return (
    CALIFORNIA_CODES.find(
      (code) => code.lawCode.toLowerCase() === wanted || code.name.toLowerCase() === wanted,
    ) ?? null
  );
}
