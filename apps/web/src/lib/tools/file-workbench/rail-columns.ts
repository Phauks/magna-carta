/*
 * The columns the workbench's file list is read and sorted by.
 *
 * The list is the product's ONE table (DataTable.Grid), not a bespoke rail: sorting by name, by
 * type, by size, by when it arrived, and by what the scanner made of it are all behaviours the grid
 * already has, and a second list that sorted its own way would be a second answer to a question the
 * matter file manager has already settled.
 *
 * Declared here rather than inside the component so the column model is a value a test can read.
 */
import type { GridColumn } from "@magna-carta/design-system/data-table";
import { scanStatus } from "./capabilities/malware-scan.ts";
import { describeType } from "./file-facts.ts";
import { formatSize, scanVerdictOf, type WorkbenchFile } from "./workbench-file.ts";

/** Stable column ids — the cell snippet keys off these, and so does the persisted layout. */
export const RAIL_COLUMNS = {
  name: "name",
  type: "type",
  size: "size",
  added: "added",
  safety: "safety",
  actions: "actions",
} as const;

export function railColumns(): GridColumn<WorkbenchFile>[] {
  return [
    {
      id: RAIL_COLUMNS.name,
      label: "Name",
      type: "text",
      // The row's anchor: it always shows and always leads, because the name is how a person knows
      // which file they are looking at. Pinned too, so that when the rail is narrow enough for the
      // table to scroll, the column that says which row this is stays put — a scrolled-away name
      // leaves a reader looking at four facts about a file they can no longer identify.
      anchored: true,
      pinned: true,
      value: (file) => file.name,
      // The icon rides in the cell, so the fit measure has to account for furniture the text does
      // not include.
      fitExtra: 28,
    },
    {
      id: RAIL_COLUMNS.type,
      label: "Type",
      type: "text",
      // A set filter rather than a text one: the useful question here is "show me the PDFs", and a
      // checkbox list of the types actually present answers it without anyone typing a format name.
      filter: "set",
      value: (file) => describeType(file),
    },
    {
      id: RAIL_COLUMNS.size,
      label: "Size",
      type: "number",
      value: (file) => file.sizeBytes,
      text: (file) => formatSize(file.sizeBytes),
    },
    {
      id: RAIL_COLUMNS.added,
      label: "Added",
      type: "date",
      // Sortable and filterable, and not shown until asked for. The rail is a narrow pane beside
      // the file and its readings, and four data columns in it means the name scrolls away — which
      // costs more than the arrival time is worth on a bench holding a handful of files. The
      // columns menu at the top of the rail shows it, and the grid remembers that.
      hidden: true,
      value: (file) => file.receivedAt,
    },
    {
      id: RAIL_COLUMNS.safety,
      label: "Safety",
      type: "text",
      filter: "set",
      // Hidden until it says something. With no scanner wired every row reads "Not scanned", and a
      // column whose every cell is the same word is width taken from the name. The columns menu
      // shows it on demand, and it earns its place the moment verdicts differ.
      hidden: true,
      value: (file) => scanStatus(scanVerdictOf(file)).label,
    },
    {
      id: RAIL_COLUMNS.actions,
      // No header text: the column is a row's own menu, and a heading over it would name a column
      // that holds no data.
      label: "",
      type: "text",
      filter: "none",
      align: "end",
      value: () => "",
      fitExtra: 28,
    },
  ];
}
