/*
 * How a note reads on the matter's Activity section, and how one is written from it.
 *
 * The note is the first record the Activity section can MAKE: "+ New Note" opens the same window
 * the Notes section opens, on this screen, and the row appears when it saves. Opening an existing
 * note follows the deep link into the Notes section until the notes API can read one note by its
 * id — the window must not be handed a note found by scanning a first page.
 */
import NotebookPen from "@lucide/svelte/icons/notebook-pen";
import {
  factNumber,
  factText,
  navigateInto,
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
  open: navigateInto,
  create: { label: "New Note", window: "note" },
};
