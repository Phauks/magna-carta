import type { ExhibitScheme } from "./scheme.ts";

// Starter schemes a member may copy into a set. A preset is a set of column values and never a live
// rule: copying one writes its values onto the set, and nothing afterwards reads the preset again or
// ties the set to a court. Numbering is not a property of a jurisdiction — two departments of one
// courthouse currently direct incompatible schemes — so nothing here names a court.
//
// The default is the scheme a new set takes when the member chooses nothing: Exhibit A, B, C, with
// doubled letters after Z (AA, BB, CC), which is what the surveyed trial-practice guidance says.

export interface ExhibitSchemePreset {
  readonly key: string;
  readonly name: string;
  readonly scheme: ExhibitScheme;
}

export const DEFAULT_EXHIBIT_SCHEME: ExhibitScheme = {
  noun: "Exhibit",
  prefix: "",
  sequence: "upperLetter",
  startAt: 1,
  overflowForm: "doubled",
};

export const EXHIBIT_SCHEME_PRESETS: readonly ExhibitSchemePreset[] = [
  { key: "letters", name: "Exhibit A, B, C", scheme: DEFAULT_EXHIBIT_SCHEME },
  {
    key: "numbers",
    name: "Exhibit 1, 2, 3",
    scheme: { ...DEFAULT_EXHIBIT_SCHEME, sequence: "arabic" },
  },
  {
    key: "numbersFromFiveHundred",
    name: "Exhibit 500, 501, 502",
    scheme: { ...DEFAULT_EXHIBIT_SCHEME, sequence: "arabic", startAt: 500 },
  },
];
