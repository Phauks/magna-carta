/*
 * What a file on the workbench can be turned into.
 *
 * The conversion graph is @magna-carta/conversion's — its formats, its edges, its pathfinding. This
 * module only bridges the two vocabularies: the identification names a type with a @magna-carta/
 * file-type label, and the graph names it with a FormatId. The two agree for almost everything
 * (`pdf`, `docx`, `png`), so the map holds only the handful that differ, and a label the graph does
 * not know simply offers no targets rather than guessing at one.
 */
import { getFormat } from "@magna-carta/conversion/registry";
import { availableConversions } from "@magna-carta/conversion/pathfinding";
import type { Format, FormatId } from "@magna-carta/conversion/format";

/** The file-type labels whose conversion-graph name differs from the label itself. */
const LABEL_TO_FORMAT: Readonly<Record<string, FormatId>> = {
  email: "eml",
  sevenzip: "7z",
};

/** The conversion graph's name for an identified type, or null when the graph does not hold it. */
export function formatIdForLabel(label: string | null): FormatId | null {
  if (label === null) return null;
  const candidate = LABEL_TO_FORMAT[label] ?? label;
  return getFormat(candidate) === undefined ? null : candidate;
}

/** Every format this file could become, as the graph's own Format records, alphabetical by label. */
export function conversionTargetsFor(label: string | null): readonly Format[] {
  const from = formatIdForLabel(label);
  if (from === null) return [];
  return availableConversions(from)
    .map((id) => getFormat(id))
    .filter((format): format is Format => format !== undefined)
    .sort((left, right) => left.label.localeCompare(right.label));
}

/**
 * The targets every file in a set could become: the intersection, so a bulk conversion never
 * offers a format that some of the selection cannot reach. Offering one and failing halfway is
 * worse than not offering it.
 */
export function sharedConversionTargets(labels: readonly (string | null)[]): readonly Format[] {
  if (labels.length === 0) return [];
  const perFile = labels.map((label) => conversionTargetsFor(label));
  const [first, ...rest] = perFile;
  if (first === undefined) return [];
  return first.filter((format) =>
    rest.every((targets) => targets.some((candidate) => candidate.id === format.id)),
  );
}
