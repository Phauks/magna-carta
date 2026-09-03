/*
 * How a note reads on the matter's Activity section, and how one is written from it.
 *
 * The note is the first record the Activity section can MAKE and OPEN in place: "+ New Note" opens
 * the same window the Notes section opens, on this screen, and a note row opens that window on the
 * note itself, read by its id through the note's own route. The row appears, or changes, when the
 * window saves.
 */
import NotebookPen from "@lucide/svelte/icons/notebook-pen";
import {
  factNumber,
  factText,
  type ActivityContribution,
  type Fact,
} from "$lib/activity/contribution.ts";

export const noteActivityContribution: ActivityContribution = {
  sourceKey: "matterNote",
  section: "Notes",
  noun: "Note",
  happened: "A note was written",
  icon: NotebookPen,
  types: ["Note"],
  factsOf: (row, context) => {
    const result: Fact[] = [];
    const occurredOn = factText(row.facts, "occurredOn");
    if (occurredOn !== null) {
      const time = factText(row.facts, "occurredAtTime");
      result.push({
        label: "Happened",
        value: time === null ? context.date(occurredOn) : `${context.date(occurredOn)} ${time}`,
      });
    }
    const attachments = factNumber(row.facts, "attachmentCount") ?? 0;
    if (attachments > 0) {
      result.push({
        value: attachments === 1 ? "1 attachment" : `${String(attachments)} attachments`,
      });
    }
    return result;
  },
  open: (entry) => ({ kind: "window", window: "note", recordId: entry.rowId }),
  create: { label: "New Note", window: "note" },
};
