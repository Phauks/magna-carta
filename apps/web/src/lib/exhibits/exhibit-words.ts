/*
 * What the exhibit screens say about a set, worked out in one place so the list, the header and the
 * numbering dialog read alike. Labels come from the same pure function the server uses, so the
 * preview a member sees while reordering is the label the server will answer with.
 */
import { captionFor, labelFor } from "@magna-carta/exhibits/label";
import type { ExhibitScheme } from "./exhibits-api.ts";
import type { ExhibitDisposition } from "./exhibits-api.ts";

/** The first three labels of a numbering, as a member reads it: "Exhibit A, B, C". */
export function schemeSummary(scheme: ExhibitScheme): string {
  const labels = [1, 2, 3].map((position) => labelFor(position, scheme));
  return `${captionFor(labels[0] ?? "", scheme)}, ${labels.slice(1).join(", ")}`;
}

/** The label at a position, from the set's numbering. */
export function draftLabel(position: number, scheme: ExhibitScheme): string {
  return labelFor(position, scheme);
}

export function captionOf(label: string, scheme: ExhibitScheme): string {
  return captionFor(label, scheme);
}

export const DISPOSITION_WORDS: Readonly<Record<ExhibitDisposition, string>> = {
  filed: "Filed",
  served: "Served",
  exchanged: "Exchanged",
  lodged: "Lodged",
};

/** The letter, number and numeral styles a set can count in, each named by how it starts. */
export const SEQUENCE_CHOICES: readonly { value: ExhibitScheme["sequence"]; label: string }[] = [
  { value: "upperLetter", label: "A, B, C" },
  { value: "lowerLetter", label: "a, b, c" },
  { value: "arabic", label: "1, 2, 3" },
  { value: "upperRoman", label: "I, II, III" },
  { value: "lowerRoman", label: "i, ii, iii" },
];

/** What comes after Z, for the two letter styles. */
export const OVERFLOW_CHOICES: readonly { value: ExhibitScheme["overflowForm"]; label: string }[] =
  [
    { value: "doubled", label: "AA, BB, CC" },
    { value: "bijective", label: "AA, AB, AC" },
  ];

export function isLetterSequence(sequence: ExhibitScheme["sequence"]): boolean {
  return sequence === "upperLetter" || sequence === "lowerLetter";
}
