import { describe, expect, it } from "vitest";
import { mergeTimelinePages } from "../src/merge.ts";
import type { TimelineEntry } from "../src/sources/registry.ts";

function entry(sourceKey: string, sortKey: string, rowId: string): TimelineEntry {
  return {
    sourceKey,
    kind: "test",
    sortKey,
    rowId,
    matterId: "matter_test",
    actorUserId: null,
    label: null,
    link: "/matters/matter_test/overview",
  };
}

describe("one sort key across heterogeneous sources", () => {
  it("is a total order over mixed civil dates and instants", () => {
    const civilDates = [entry("a", "2026-08-06", "a1"), entry("a", "2026-08-05", "a2")];
    const instants = [
      entry("b", "2026-08-05T09:00:00.000Z", "b1"),
      entry("b", "2026-08-05T17:30:00.000Z", "b2"),
    ];
    const page = mergeTimelinePages([civilDates, instants], 10, false);
    expect(page.entries.map((item) => item.rowId)).toEqual(["a1", "b2", "b1", "a2"]);
  });

  it("sorts a day-granular entry at the HEAD of its own day", () => {
    // "On the 5th" precedes "at 9am on the 5th" — which is both what lexicographic order over
    // ISO-8601 gives and what a person reading a docket expects.
    const page = mergeTimelinePages(
      [[entry("a", "2026-08-05", "day")], [entry("b", "2026-08-05T09:00:00.000Z", "timed")]],
      10,
      true,
    );
    expect(page.entries.map((item) => item.rowId)).toEqual(["day", "timed"]);
  });

  it("breaks a tie on the row id so the order is total when sources collide", () => {
    const page = mergeTimelinePages(
      [
        [entry("a", "2026-08-05", "zzz"), entry("a", "2026-08-05", "aaa")],
        [entry("b", "2026-08-05", "mmm")],
      ],
      10,
      false,
    );
    expect(page.entries.map((item) => item.rowId)).toEqual(["zzz", "mmm", "aaa"]);
  });

  it("mints the next cursor from the last KEPT entry, not from any one source's last row", () => {
    const page = mergeTimelinePages(
      [
        [entry("a", "2026-08-06", "a1"), entry("a", "2026-08-04", "a2")],
        [entry("b", "2026-08-05", "b1")],
      ],
      2,
      false,
    );
    expect(page.entries.map((item) => item.rowId)).toEqual(["a1", "b1"]);
    const decoded = JSON.parse(atob(page.nextCursor ?? "")) as { c: string; i: string };
    expect(decoded).toEqual({ c: "2026-08-05", i: "b1" });
  });

  it("reports no cursor when the merged result is the whole answer", () => {
    const page = mergeTimelinePages([[entry("a", "2026-08-06", "a1")]], 50, false);
    expect(page.nextCursor).toBeNull();
  });

  it("walks a tied corpus without repeating or skipping an entry", () => {
    // Every entry shares one sort key, so the id tiebreak is doing all the work — the case a keyset
    // walk gets wrong when the order is only partial.
    const rows = ["r1", "r2", "r3", "r4", "r5"].map((id) => entry("a", "2026-08-05", id));
    const seen: string[] = [];
    let remaining = rows;
    for (let pass = 0; pass < 10 && remaining.length > 0; pass += 1) {
      const page = mergeTimelinePages([remaining], 2, false);
      seen.push(...page.entries.map((item) => item.rowId));
      if (page.nextCursor === null) break;
      const decoded = JSON.parse(atob(page.nextCursor)) as { c: string; i: string };
      remaining = rows.filter(
        (row) => row.sortKey < decoded.c || (row.sortKey === decoded.c && row.rowId < decoded.i),
      );
    }
    expect(seen).toEqual(["r5", "r4", "r3", "r2", "r1"]);
    expect(new Set(seen).size).toBe(5);
  });
});
