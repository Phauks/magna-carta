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

/**
 * A file type, as the graph identifies one: its media type and the extensions it is written with.
 * Two nodes that agree on both ARE the same file type however differently they are labelled.
 */
function fileTypeKey(format: Format): string {
  return `${format.mediaType} ${[...format.extensions].sort().join(",")}`;
}

/**
 * The node that names a file type plainly, out of several that produce it.
 *
 * The graph carries processing variants as their own nodes — a PDF carrying a recognized text layer
 * is `searchable-pdf`, with PDF's media type and PDF's extension — because pathfinding needs a
 * target that differs from its source. That is a fact about the graph, not about the file: what
 * comes out is a PDF, and a conversion offers file types. So the variants collapse into the node
 * whose id is one of its own extensions, which is the one named for the type rather than for the
 * treatment. Where no candidate is named that way, registry order decides and nothing is invented.
 *
 * Richness is not the reader's choice to make: every PDF the converter produces should carry as
 * much recovered data as it can, so "with a text layer" is how PDFs are produced rather than a
 * second button beside PDF. The recognition engine is reached from Text Recognition, which is where
 * a person asks for a text layer over a file they already have.
 */
function plainestOf(candidates: readonly Format[]): Format {
  return candidates.find((format) => format.extensions.includes(format.id)) ?? candidates[0]!;
}

/**
 * Every file type this file could become, as the graph's own Format records, alphabetical.
 *
 * A target that is the SAME file type as the source is not a conversion and is dropped: a PDF that
 * gained a recognized text layer is still a PDF, so offering it here would be offering to convert a
 * file into itself. That work is Text Recognition, which is its own capability over a file somebody
 * already has. This is why a scanned PDF offers nothing to convert to — correctly, because there is
 * nothing else the graph can make of one.
 */
export function conversionTargetsFor(label: string | null): readonly Format[] {
  const from = formatIdForLabel(label);
  const source = from === null ? undefined : getFormat(from);
  if (from === null || source === undefined) return [];
  const sourceType = fileTypeKey(source);

  const byFileType = new Map<string, Format[]>();
  for (const id of availableConversions(from)) {
    const format = getFormat(id);
    if (format === undefined) continue;
    const key = fileTypeKey(format);
    if (key === sourceType) continue;
    byFileType.set(key, [...(byFileType.get(key) ?? []), format]);
  }

  return [...byFileType.values()]
    .map((candidates) => plainestOf(candidates))
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
