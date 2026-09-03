/*
 * How a task reads on the matter's Activity section: by its title, with whether the firm still owes
 * it. The timeline places a task on the day it is due, so the Date column is the due date and the
 * facts say what state it is in — overdue computed where the reader is, never stored.
 */
import ListChecks from "@lucide/svelte/icons/list-checks";
import {
  capitalised,
  factText,
  navigateInto,
  type ActivityContribution,
  type Fact,
} from "$lib/activity/contribution.ts";

export const taskActivityContribution: ActivityContribution = {
  sourceKey: "matterTask",
  section: "Tasks",
  noun: "Task",
  happened: "A task was recorded",
  icon: ListChecks,
  labelMeaning: "State",
  types: ["Task"],
  factsOf: (row, context) => {
    const result: Fact[] = [];
    const state = factText(row.facts, "state");
    const dueOn = factText(row.facts, "dueOn");
    if (state === "open" && dueOn !== null && dueOn < context.today) {
      result.push({ value: "Overdue", tone: "danger" });
    } else if (state !== null && state !== "open") {
      result.push({ value: capitalised(state), tone: "muted" });
    }
    const dueAtTime = factText(row.facts, "dueAtTime");
    if (dueAtTime !== null) result.push({ label: "Due", value: dueAtTime });
    const priority = factText(row.facts, "priority");
    if (priority === "high" || priority === "urgent") {
      result.push({
        value: capitalised(priority),
        tone: priority === "urgent" ? "danger" : "info",
      });
    }
    return result;
  },
  open: navigateInto,
};
