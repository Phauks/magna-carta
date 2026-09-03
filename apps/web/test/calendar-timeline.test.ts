import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "$lib/calendar/calendar-api.ts";
import {
  groupTimelineByDay,
  presentTimelineRow,
  timelineKindWord,
} from "$lib/calendar/timeline-presentation.ts";

function entry(overrides: Partial<TimelineEntry>): TimelineEntry {
  return {
    sourceKey: "matterEvent",
    kind: "event",
    sortKey: "2026-09-14T09:00:00.000Z",
    rowId: "row",
    matterId: "matter_1",
    actorUserId: null,
    label: null,
    link: "/matters/matter_1/calendar",
    ...overrides,
  };
}

describe("the timeline's words", () => {
  it("names a kind by its own word, then its source's, then its humanized key", () => {
    expect(timelineKindWord(entry({ kind: "event" }))).toBe("Event");
    expect(timelineKindWord(entry({ kind: "cancelledEvent" }))).toBe("Event cancelled");
    expect(timelineKindWord(entry({ sourceKey: "custodyDueBack", kind: "dueBack" }))).toBe(
      "Due back",
    );
    expect(timelineKindWord(entry({ sourceKey: "timeEntry", kind: "timeEntry" }))).toBe(
      "Time recorded",
    );
    expect(timelineKindWord(entry({ sourceKey: "unknownSource", kind: "someNewKind" }))).toBe(
      "Some new kind",
    );
  });

  it("presents a row by its day, its kind and its declared label, and never invents one", () => {
    const row = presentTimelineRow(
      entry({ sourceKey: "matterNote", kind: "matterNote", rowId: "n1", label: null }),
    );
    expect(row).toEqual({
      key: "matterNote:n1",
      date: "2026-09-14",
      kind: "Note",
      label: null,
      link: "/matters/matter_1/calendar",
      actorUserId: null,
    });
  });

  it("groups rows by day in the order handed over", () => {
    const rows = [
      presentTimelineRow(entry({ rowId: "a", sortKey: "2026-09-14T09:00:00.000Z" })),
      presentTimelineRow(entry({ rowId: "b", sortKey: "2026-09-14T08:00:00.000Z" })),
      presentTimelineRow(entry({ rowId: "c", sortKey: "2026-09-13T08:00:00.000Z" })),
    ];
    expect(groupTimelineByDay(rows).map((group) => [group.date, group.rows.length])).toEqual([
      ["2026-09-14", 2],
      ["2026-09-13", 1],
    ]);
  });
});
