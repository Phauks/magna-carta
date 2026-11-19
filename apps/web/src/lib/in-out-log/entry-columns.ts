/*
 * The In/Out Log's columns. Waiting for Pickup and the whole Log share them, except that the Log
 * adds what happened to each entry, which on the waiting list is always the same answer.
 */
import type { GridColumn } from "@magna-carta/design-system/data-table";
import { formatInstant } from "@magna-carta/design-system/formatters";
import type { InOutEntry, InOutEntryStatus } from "./in-out-log-api.ts";

export const ENTRY_COLUMN = {
  number: "number",
  item: "item",
  to: "to",
  matter: "matter",
  droppedOffAt: "droppedOffAt",
  status: "status",
  actions: "actions",
} as const;

export const STATUS_LABEL: Record<InOutEntryStatus, string> = {
  waiting: "Waiting for Pickup",
  picked_up: "Picked Up",
  moved_to_custodian: "Moved to Custodian",
};

/** The line under a Log entry's status: who took it, or the custody number it became. */
export function outcomeText(entry: InOutEntry): string {
  if (entry.pickedUp !== null) {
    return `${entry.pickedUp.by.name}, ${formatInstant(entry.pickedUp.at)}`;
  }
  if (entry.movedToCustodian !== null) {
    return entry.movedToCustodian.custodyNumber ?? "";
  }
  return "";
}

export function entryColumns(view: "waiting" | "all"): GridColumn<InOutEntry>[] {
  const columns: GridColumn<InOutEntry>[] = [
    { id: ENTRY_COLUMN.number, label: "No.", anchored: true, value: (entry) => entry.number },
    {
      id: ENTRY_COLUMN.item,
      label: "Item",
      value: (entry) => entry.description,
      text: (entry) => `${entry.description}. From ${entry.from.name}`,
    },
    {
      id: ENTRY_COLUMN.to,
      label: "To",
      value: (entry) => entry.to.map((person) => person.name).join(", "),
    },
    {
      id: ENTRY_COLUMN.matter,
      label: "Matter",
      filter: "set",
      value: (entry) => entry.matter?.title ?? "",
    },
    {
      id: ENTRY_COLUMN.droppedOffAt,
      label: view === "waiting" ? "Ready Since" : "Dropped Off",
      type: "date",
      value: (entry) => entry.droppedOffAt,
      text: (entry) => formatInstant(entry.droppedOffAt),
    },
  ];
  if (view === "all") {
    columns.push({
      id: ENTRY_COLUMN.status,
      label: "Status",
      filter: "set",
      value: (entry) => STATUS_LABEL[entry.status],
    });
  }
  columns.push({
    id: ENTRY_COLUMN.actions,
    label: "Actions",
    type: "text",
    filter: "none",
    align: "end",
    pinnedEnd: true,
    value: () => null,
    text: () => "",
  });
  return columns;
}

/** The waiting list is worked oldest first; the Log is read newest first. */
export function initialSort(view: "waiting" | "all") {
  return {
    columnId: ENTRY_COLUMN.droppedOffAt,
    direction: view === "waiting" ? "ascending" : "descending",
  } as const;
}
