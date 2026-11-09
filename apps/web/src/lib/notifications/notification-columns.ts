/*
 * The notification feed's declarative column model — what the platform's one table is told about a
 * member's notifications. Pure, so what a column IS has one home and one test; the screen owns only
 * fetching and rendering.
 *
 * EVERY WORD COMES FROM ./notification-presentation.ts. A row carries a kind, a category, a severity
 * and some declared facts, never a sentence; the title and the detail a reader sees are composed
 * there, and this file only says which column shows which of them.
 *
 * THE LEADING SLOT IS THE READ STATE, AND THE TRAILING ONE IS WHAT CAN BE DONE. The state column
 * leads so a reader scanning down the left edge sees what still needs them, which is the question a
 * backlog is opened with; the screen draws it as the round check that marks a row read. The actions
 * column is pinned to the trailing edge so Dismiss (or Restore, on a dismissed row) stays in reach
 * however far the table is scrolled sideways, and it is drawn on every row rather than on hover,
 * because a control that appears and disappears at the end of a row moves everything before it.
 *
 * PRIORITY IS BLANK FOR THE ORDINARY CASE. Most of a feed is informational, and the owner ruled that
 * a priority shows only where one occurs, so the column carries "Urgent" or "Needs Attention" and is
 * empty otherwise.
 */
import type { GridColumn } from "@magna-carta/design-system/data-table";
import { formatInstant } from "@magna-carta/design-system/formatters";
import { notificationCategoryLabel, NOTIFICATION_CATEGORIES } from "./category-vocabulary.ts";
import {
  describeNotification,
  PRIORITY_LABEL,
  PRIORITY_WORDS,
} from "./notification-presentation.ts";
import type { NotificationItem, NotificationState } from "./notifications-api.ts";

export const NOTIFICATION_COLUMN_IDENTIFIERS = {
  state: "state",
  notification: "notification",
  details: "details",
  matter: "matter",
  category: "category",
  priority: "priority",
  occurredAt: "occurredAt",
  actions: "actions",
} as const;

/** Newest first: a backlog is worked from what arrived last. */
export const NOTIFICATION_INITIAL_SORT = {
  columnId: NOTIFICATION_COLUMN_IDENTIFIERS.occurredAt,
  direction: "descending",
} as const;

/** The read state as a reader says it, and as the state column's filter offers it. */
export const NOTIFICATION_STATE_LABEL: Readonly<Record<NotificationState, string>> = Object.freeze({
  unread: "Unread",
  read: "Read",
  dismissed: "Dismissed",
});

export function notificationColumns(): GridColumn<NotificationItem>[] {
  return [
    {
      id: NOTIFICATION_COLUMN_IDENTIFIERS.state,
      label: "Status",
      anchored: true,
      filter: "set",
      filterValues: Object.values(NOTIFICATION_STATE_LABEL),
      value: (item) => NOTIFICATION_STATE_LABEL[item.state],
      // The cell draws the mark, so the measure for double-click fit is the mark, not the word.
      text: () => "",
      fitExtra: 24,
    },
    {
      id: NOTIFICATION_COLUMN_IDENTIFIERS.notification,
      label: "Notification",
      value: (item) => describeNotification(item).title,
    },
    {
      id: NOTIFICATION_COLUMN_IDENTIFIERS.details,
      label: "Details",
      value: (item) => describeNotification(item).detail,
    },
    {
      id: NOTIFICATION_COLUMN_IDENTIFIERS.matter,
      label: "Matter",
      value: (item) => item.matterNumber,
    },
    {
      id: NOTIFICATION_COLUMN_IDENTIFIERS.category,
      label: "Category",
      filterValues: NOTIFICATION_CATEGORIES.map(notificationCategoryLabel),
      value: (item) => notificationCategoryLabel(item.category),
    },
    {
      id: NOTIFICATION_COLUMN_IDENTIFIERS.priority,
      label: "Priority",
      filterValues: PRIORITY_WORDS,
      value: (item) => PRIORITY_LABEL[item.severity],
    },
    {
      id: NOTIFICATION_COLUMN_IDENTIFIERS.occurredAt,
      label: "When",
      type: "date",
      value: (item) => item.occurredAt,
      // A notification is about a moment, and two on one day are told apart by the hour.
      text: (item) => formatInstant(item.occurredAt),
    },
    {
      id: NOTIFICATION_COLUMN_IDENTIFIERS.actions,
      label: "Actions",
      type: "text",
      filter: "none",
      align: "end",
      pinnedEnd: true,
      value: () => null,
      text: () => "",
    },
  ];
}

/**
 * The feed in render order: everything live first, then the dismissed rows, each run sorted by the
 * reader's own column. A dismissed row is one the member has finished with, so it never interleaves
 * with the work still in front of them, whatever they sort by.
 */
export function orderNotificationRows(
  rows: readonly NotificationItem[],
  compare: (left: NotificationItem, right: NotificationItem) => number,
): readonly NotificationItem[] {
  const live = rows.filter((row) => row.state !== "dismissed").toSorted(compare);
  const dismissed = rows.filter((row) => row.state === "dismissed").toSorted(compare);
  return [...live, ...dismissed];
}
