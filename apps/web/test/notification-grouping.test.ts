import { describe, expect, it } from "vitest";
import { bandedGridRows, type GridGrouping } from "@magna-carta/design-system/data-table";
import {
  DISMISSED_BAND,
  NOTIFICATION_DEFAULT_GROUP_BY,
  NOTIFICATION_GROUP_BY,
  NOTIFICATION_GROUP_BY_OPTIONS,
  notificationGrouping,
  type ReaderCalendar,
} from "$lib/notifications/notification-grouping.ts";
import type { NotificationItem } from "$lib/notifications/notifications-api.ts";

/*
 * The Group By choices on the notification feed: which band a row lands in, what the band is
 * called, and the order the bands come in. Run through the grid's own band split, so what is pinned
 * here is what a reader sees.
 */

const CALENDAR: ReaderCalendar = { timeZone: "America/Los_Angeles", today: "2026-11-09" };

function itemOf(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: "notificationRecipient_x",
    kind: "deadlines.deadline.overdue",
    category: "deadlines",
    severity: "informational",
    state: "unread",
    subjectKind: "deadline",
    subjectId: "deadline_x",
    matterId: "matter_x",
    matterNumber: "2026-0147",
    occurredAt: "2026-11-09T18:00:00.000Z",
    createdAt: "2026-11-09T18:00:00.000Z",
    readAt: null,
    dismissedAt: null,
    facts: null,
    link: "/matters/matter_x/calendar?entry=deadline_x",
    ...overrides,
  };
}

function grouping(groupBy: Parameters<typeof notificationGrouping>[0]) {
  const found = notificationGrouping(groupBy, CALENDAR);
  if (found === null) throw new Error(`no grouping for ${groupBy}`);
  return found;
}

function bandLabels(
  rows: readonly NotificationItem[],
  by: GridGrouping<NotificationItem>,
  direction: "ascending" | "descending" | null = "descending",
): string[] {
  return bandedGridRows(rows, by, direction).map((band) => band.label);
}

describe("the notification Group By menu", () => {
  it("offers Day first, as the default, and a flat list last", () => {
    expect(NOTIFICATION_GROUP_BY_OPTIONS.map((option) => option.label)).toEqual([
      "Day",
      "Category",
      "Priority",
      "Matter",
      "Read State",
      "No Grouping",
    ]);
    expect(NOTIFICATION_DEFAULT_GROUP_BY).toBe(NOTIFICATION_GROUP_BY.day);
    expect(notificationGrouping(NOTIFICATION_GROUP_BY.none, CALENDAR)).toBeNull();
  });
});

describe("grouping by day", () => {
  const rows = [
    itemOf({ id: "a", occurredAt: "2026-11-09T18:00:00.000Z" }),
    itemOf({ id: "b", occurredAt: "2026-11-08T18:00:00.000Z" }),
    itemOf({ id: "c", occurredAt: "2026-11-05T18:00:00.000Z" }),
  ];

  it("names today and yesterday, and dates every other day", () => {
    const labels = bandLabels(rows, grouping(NOTIFICATION_GROUP_BY.day));
    expect(labels.slice(0, 2)).toEqual(["Today", "Yesterday"]);
    expect(labels[2]).toContain("2026");
  });

  it("puts a row on the day it fell in the reader's own zone", () => {
    // 05:00 UTC on the 10th is still the evening of the 9th in Los Angeles.
    const late = itemOf({ occurredAt: "2026-11-10T05:00:00.000Z" });
    expect(grouping(NOTIFICATION_GROUP_BY.day).keyOf(late)).toBe("2026-11-09");
  });

  it("follows the sort direction, so the bands never argue with the rows inside them", () => {
    const by = grouping(NOTIFICATION_GROUP_BY.day);
    expect(bandLabels(rows, by, "descending")[0]).toBe("Today");
    expect(bandLabels(rows, by, "ascending").at(-1)).toBe("Today");
  });
});

describe("the dismissed band", () => {
  it("is last whatever the grouping and whichever way the table is sorted", () => {
    const rows = [
      itemOf({ id: "gone", state: "dismissed", severity: "critical", matterNumber: "0001" }),
      itemOf({ id: "live", state: "unread", severity: "attention", matterNumber: "9999" }),
    ];
    for (const option of NOTIFICATION_GROUP_BY_OPTIONS) {
      const by = notificationGrouping(option.value, CALENDAR);
      if (by === null) continue;
      for (const direction of ["ascending", "descending"] as const) {
        const bands = bandedGridRows(rows, by, direction);
        expect(bands.at(-1)?.key).toBe(DISMISSED_BAND);
        expect(bands.at(-1)?.label).toBe("Dismissed");
      }
    }
  });
});

describe("the other groupings", () => {
  it("order priority from Urgent down, with the ordinary case last", () => {
    const rows = [
      itemOf({ id: "a", severity: "informational" }),
      itemOf({ id: "b", severity: "critical" }),
      itemOf({ id: "c", severity: "attention" }),
    ];
    expect(bandLabels(rows, grouping(NOTIFICATION_GROUP_BY.priority))).toEqual([
      "Urgent",
      "Needs Attention",
      "No Priority",
    ]);
  });

  it("order matters by number, with notifications about no matter last", () => {
    const rows = [
      itemOf({ id: "a", matterNumber: null }),
      itemOf({ id: "b", matterNumber: "2026-0200" }),
      itemOf({ id: "c", matterNumber: "2026-0100" }),
    ];
    expect(bandLabels(rows, grouping(NOTIFICATION_GROUP_BY.matter))).toEqual([
      "2026-0100",
      "2026-0200",
      "No Matter",
    ]);
  });

  it("put unread before read", () => {
    const rows = [itemOf({ id: "a", state: "read" }), itemOf({ id: "b", state: "unread" })];
    expect(bandLabels(rows, grouping(NOTIFICATION_GROUP_BY.readState))).toEqual(["Unread", "Read"]);
  });
});
