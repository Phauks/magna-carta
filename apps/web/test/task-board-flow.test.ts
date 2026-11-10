import { describe, expect, it } from "vitest";
import { statusesReachableFrom } from "$lib/matters/task-columns.ts";
import type { TaskListSummary } from "$lib/matters/tasks-api.ts";

// Which columns of the board take a carried card. The board fades every other column, so this is
// the rule a reader sees before they drop, and it must be the list's own flow and nothing looser.

const litigation: TaskListSummary = {
  id: "taskList_litigation",
  name: "Litigation",
  isDefault: false,
  openCount: 4,
  statuses: [
    { id: "to-do", name: "To Do", colour: "gray", position: 0, nextStatusIds: ["drafting"] },
    {
      id: "drafting",
      name: "Drafting",
      colour: "blue",
      position: 1,
      nextStatusIds: ["review", "hold"],
    },
    {
      id: "review",
      name: "Client Review",
      colour: "orange",
      position: 2,
      nextStatusIds: ["drafting"],
    },
    { id: "hold", name: "On Hold", colour: "amber", position: 3, nextStatusIds: ["drafting"] },
  ],
};

describe("the board's columns for a carried card", () => {
  it("are the statuses the flow allows from where the card stands", () => {
    expect(statusesReachableFrom(litigation, "to-do")).toEqual(["drafting"]);
    expect(statusesReachableFrom(litigation, "drafting")).toEqual(["review", "hold"]);
  });

  it("are every status for a card on none, and none for a list not read", () => {
    expect(statusesReachableFrom(litigation, null)).toEqual([
      "to-do",
      "drafting",
      "review",
      "hold",
    ]);
    expect(statusesReachableFrom(undefined, "to-do")).toEqual([]);
  });

  it("are none for a status that is not on the list", () => {
    expect(statusesReachableFrom(litigation, "retired")).toEqual([]);
  });
});
