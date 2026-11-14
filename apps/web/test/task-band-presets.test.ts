import { describe, expect, it } from "vitest";
import { presetsForBand, type BandLookup } from "$lib/matters/task-columns.ts";
import type { TaskListSummary } from "$lib/matters/tasks-api.ts";

// A task added at the foot of a band must be drawn in that band. These are the answers that put it
// there, and the cases where a band key cannot be turned back into a record and so presets nothing.

function list(id: string, name: string, isDefault: boolean, statuses: string[]): TaskListSummary {
  return {
    id,
    name,
    isDefault,
    openCount: 0,
    statuses: statuses.map((status, position) => ({
      id: `${id}-${status}`,
      name: status,
      colour: "gray",
      position,
      nextStatusIds: [],
    })),
  };
}

const lookup: BandLookup = {
  lists: [
    list("general", "General", true, ["To Do", "Doing"]),
    list("litigation", "Litigation", false, ["To Do", "Drafting"]),
  ],
  members: [
    { userId: "user_eleanor", displayName: "Eleanor Whitfield" },
    { userId: "user_priya", displayName: "Priya Nair" },
    { userId: "user_priya_two", displayName: "Priya Nair" },
  ],
  teams: [{ id: "team_litigation", name: "Litigation Team" }],
  matterIdOf: (title) =>
    title === "The Firm's Own Work"
      ? null
      : title === "Okafor Estate"
        ? "matter_okafor"
        : undefined,
  today: "2026-11-14",
};

describe("presetsForBand", () => {
  it("presets nothing where the rows are not banded", () => {
    expect(presetsForBand("none", null, lookup)).toEqual({});
    expect(presetsForBand("list", null, lookup)).toEqual({});
  });

  it("puts the task on the band's list, and only on a list that exists", () => {
    expect(presetsForBand("list", "litigation", lookup)).toEqual({ listId: "litigation" });
    expect(presetsForBand("list", "", lookup)).toEqual({});
  });

  it("starts the task at the band's status on the default list, where that list has it", () => {
    expect(presetsForBand("status", "Doing", lookup)).toEqual({
      listId: "general",
      statusId: "general-Doing",
    });
    expect(presetsForBand("status", "Drafting", lookup)).toEqual({});
  });

  it("dates the task today in the Today band and leaves it undated in No Due Date", () => {
    expect(presetsForBand("due", "today", lookup)).toEqual({ dueOn: "2026-11-14" });
    expect(presetsForBand("due", "none", lookup)).toEqual({ dueOn: null });
    expect(presetsForBand("due", "earlier", lookup)).toEqual({});
    expect(presetsForBand("due", "week", lookup)).toEqual({});
  });

  it("assigns the band's one person or team, and nobody in Nobody Yet", () => {
    expect(presetsForBand("assignee", "Eleanor Whitfield", lookup)).toEqual({
      assignees: [{ userId: "user_eleanor" }],
    });
    expect(presetsForBand("assignee", "Litigation Team", lookup)).toEqual({
      assignees: [{ teamId: "team_litigation" }],
    });
    expect(presetsForBand("assignee", "Nobody Yet", lookup)).toEqual({ assignees: [] });
  });

  it("guesses nobody where two members share the band's name", () => {
    expect(presetsForBand("assignee", "Priya Nair", lookup)).toEqual({});
  });

  it("puts the task on the band's matter, or on the firm's own work", () => {
    expect(presetsForBand("matter", "Okafor Estate", lookup)).toEqual({
      matterId: "matter_okafor",
    });
    expect(presetsForBand("matter", "The Firm's Own Work", lookup)).toEqual({ matterId: null });
    expect(presetsForBand("matter", "A matter you cannot open", lookup)).toEqual({});
  });
});
