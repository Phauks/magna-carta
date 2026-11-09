import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_COLUMN_IDENTIFIERS,
  notificationColumns,
  orderNotificationRows,
} from "$lib/notifications/notification-columns.ts";
import type { NotificationItem } from "$lib/notifications/notifications-api.ts";

/*
 * The notification feed's column model, and the one ordering rule it adds to the grid: dismissed
 * rows sit after every live row, whatever the reader sorts by.
 */

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
    occurredAt: "2026-11-09T10:00:00.000Z",
    createdAt: "2026-11-09T10:00:00.000Z",
    readAt: null,
    dismissedAt: null,
    facts: null,
    link: "/matters/matter_x/calendar?entry=deadline_x",
    ...overrides,
  };
}

function column(id: string) {
  const found = notificationColumns().find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no column ${id}`);
  return found;
}

describe("the notification columns", () => {
  it("lead with the read state and end with what can be done", () => {
    const identifiers = notificationColumns().map((candidate) => candidate.id);
    expect(identifiers[0]).toBe(NOTIFICATION_COLUMN_IDENTIFIERS.state);
    expect(identifiers.at(-1)).toBe(NOTIFICATION_COLUMN_IDENTIFIERS.actions);
    expect(column(NOTIFICATION_COLUMN_IDENTIFIERS.actions).pinnedEnd).toBe(true);
  });

  it("name the row a Notification and the severity a Priority", () => {
    expect(column(NOTIFICATION_COLUMN_IDENTIFIERS.notification).label).toBe("Notification");
    expect(column(NOTIFICATION_COLUMN_IDENTIFIERS.priority).label).toBe("Priority");
  });

  it("leave the priority blank where none occurs", () => {
    const priority = column(NOTIFICATION_COLUMN_IDENTIFIERS.priority);
    expect(priority.value(itemOf({ severity: "informational" }))).toBeNull();
    expect(priority.value(itemOf({ severity: "attention" }))).toBe("Needs Attention");
    expect(priority.value(itemOf({ severity: "critical" }))).toBe("Urgent");
    // The filter offers the two words and nothing for the ordinary case.
    expect(priority.filterValues).toEqual(["Urgent", "Needs Attention"]);
  });

  it("offer every read state in the Status filter, dismissed included", () => {
    expect(column(NOTIFICATION_COLUMN_IDENTIFIERS.state).filterValues).toEqual([
      "Unread",
      "Read",
      "Dismissed",
    ]);
  });
});

function byDateDescending(left: NotificationItem, right: NotificationItem): number {
  return right.occurredAt.localeCompare(left.occurredAt);
}

describe("the feed's order", () => {
  it("puts every dismissed row after every live one, each run in the reader's sort", () => {
    const rows = [
      itemOf({ id: "a", state: "dismissed", occurredAt: "2026-11-09T12:00:00.000Z" }),
      itemOf({ id: "b", state: "read", occurredAt: "2026-11-08T12:00:00.000Z" }),
      itemOf({ id: "c", state: "unread", occurredAt: "2026-11-09T09:00:00.000Z" }),
      itemOf({ id: "d", state: "dismissed", occurredAt: "2026-11-01T12:00:00.000Z" }),
    ];
    expect(orderNotificationRows(rows, byDateDescending).map((row) => row.id)).toEqual([
      "c",
      "b",
      "a",
      "d",
    ]);
  });
});
