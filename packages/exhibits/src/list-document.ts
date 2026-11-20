import {
  coverSheet,
  houseDocument,
  styledTable,
  type HouseBlock,
  type HouseColumn,
  type HouseDocument,
  type HouseRow,
} from "@magna-carta/house-document";

// The printed exhibit list and the cover sheet in front of each exhibit, in the house style with no
// letterhead, because both go out under the filing's own caption. Plain data for the PDF composer:
// this module draws nothing, and it prints a label exactly as the set wrote it, so a set numbered
// 1, 2, 3 prints "EXHIBIT 1" as readily as a lettered one prints "EXHIBIT A".

/** One row of the list: an exhibit as the set has it. */
export interface ExhibitListEntry {
  readonly label: string;
  readonly title: string;
  readonly withdrawn: boolean;
  readonly pageCount: number | null;
  /** The Bates range printed for the exhibit, such as "SMITH000004 to SMITH000011", if any. */
  readonly bates: string | null;
}

export interface ExhibitListInput {
  /** The matter's name, which heads the caption. */
  readonly matterTitle: string;
  readonly caseNumber: string | null;
  /** The set's name, such as "Plaintiff's Trial Exhibits". */
  readonly setName: string;
  /** The word before each label, such as "Exhibit". Heads the first column. */
  readonly noun: string;
  /** The day the list was made, as it should read: "November 19, 2026". */
  readonly preparedOn: string;
  /** When the list was made, as an instant, for the file's own metadata. */
  readonly created?: string;
  readonly entries: readonly ExhibitListEntry[];
}

/** The caption lines above the list: the matter, then its case number when it has one. */
function caption(input: ExhibitListInput): HouseBlock[] {
  const blocks: HouseBlock[] = [
    { type: "paragraph", text: input.matterTitle, alignment: "center" },
  ];
  if (input.caseNumber !== null && input.caseNumber.trim() !== "") {
    blocks.push({ type: "paragraph", text: `Case No. ${input.caseNumber}`, alignment: "center" });
  }
  return blocks;
}

/** The exhibit list: caption, the set's name, and a table of every exhibit, withdrawn ones greyed. */
export function exhibitListDocument(input: ExhibitListInput): HouseDocument {
  const showBates = input.entries.some((entry) => entry.bates !== null);
  const columns: HouseColumn[] = [
    { heading: input.noun.trim() === "" ? "Exhibit" : input.noun, weight: 14 },
    { heading: "Description", weight: showBates ? 50 : 76 },
    ...(showBates ? [{ heading: "Bates", weight: 26 } as const] : []),
    { heading: "Pages", weight: 10, alignment: "end" as const },
  ];
  const rows: HouseRow[] = input.entries.map((entry) => {
    const cells = [
      entry.label,
      entry.withdrawn ? `${entry.title} (withdrawn)` : entry.title,
      ...(showBates ? [entry.bates ?? ""] : []),
      entry.pageCount === null ? "" : String(entry.pageCount),
    ];
    return entry.withdrawn ? { cells, kind: "muted" } : cells;
  });
  return houseDocument({
    name: `${input.setName}: Exhibit List`,
    letterhead: false,
    ...(input.created === undefined ? {} : { created: input.created }),
    blocks: [
      ...caption(input),
      { type: "heading", level: 1, text: input.setName },
      { type: "paragraph", text: `Exhibit list, prepared ${input.preparedOn}.` },
      styledTable(columns, rows),
    ],
  });
}

/**
 * The sheet in front of one exhibit: its caption set large ("EXHIBIT A", or "EXHIBIT 1" for a
 * numbered set) and its title under it.
 */
export function exhibitCoverDocument(exhibitCaption: string, title: string): HouseDocument {
  // A cover sheet is one page that stands in front of an exhibit, so "Page 1 of 1" under it only
  // competes with the Bates number in the corner.
  return {
    ...houseDocument({
      name: exhibitCaption,
      letterhead: false,
      blocks: coverSheet(exhibitCaption.toUpperCase(), [title], { letterhead: false }),
    }),
    footer: { center: "" },
  };
}
