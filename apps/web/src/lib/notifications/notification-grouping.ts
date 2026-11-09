/*
 * What the notification feed can be grouped by, and how each grouping splits and orders the rows.
 * Pure, so the bands a reader sees have one home and one test; the screen holds only the choice.
 *
 * DAY IS THE DEFAULT. A feed is read from what arrived last, and a run of notifications from one
 * day is one sitting's worth of work, so the bands are the reader's own calendar days. Their order
 * follows the table's sort direction: newest day first while the table reads newest first, and the
 * other way round when the reader flips it, so the bands never argue with the rows inside them.
 *
 * DISMISSED IS ALWAYS ITS OWN BAND, LAST. Whatever the reader groups by, a dismissed row is one they
 * have finished with, so it never shares a band with work still in front of them. It is the shelf
 * the footer's Show Dismissed opens, given a heading of its own.
 *
 * A BAND EXISTS BECAUSE A ROW IS IN IT. The grid never draws an empty band, so the orders below
 * name every band that could occur and the grid keeps only the ones present.
 */
import type { GridGrouping } from "@magna-carta/design-system/data-table";
import { formatDate } from "@magna-carta/design-system/formatters";
import { addCalendarDays, type CivilDate } from "@magna-carta/civil-time/civil-date";
import { viewerTimeZone, zonedReading } from "@magna-carta/civil-time/time-zone";
import { notificationCategoryLabel, NOTIFICATION_CATEGORIES } from "./category-vocabulary.ts";
import { PRIORITY_LABEL } from "./notification-presentation.ts";
import type { NotificationItem } from "./notifications-api.ts";
import { NOTIFICATION_STATE_LABEL } from "./notification-columns.ts";

export const NOTIFICATION_GROUP_BY = {
  day: "day",
  category: "category",
  priority: "priority",
  matter: "matter",
  readState: "readState",
  none: "none",
} as const;

export type NotificationGroupBy =
  (typeof NOTIFICATION_GROUP_BY)[keyof typeof NOTIFICATION_GROUP_BY];

/** The Group By menu, in the order it offers them. */
export const NOTIFICATION_GROUP_BY_OPTIONS: readonly {
  value: NotificationGroupBy;
  label: string;
}[] = Object.freeze([
  { value: NOTIFICATION_GROUP_BY.day, label: "Day" },
  { value: NOTIFICATION_GROUP_BY.category, label: "Category" },
  { value: NOTIFICATION_GROUP_BY.priority, label: "Priority" },
  { value: NOTIFICATION_GROUP_BY.matter, label: "Matter" },
  { value: NOTIFICATION_GROUP_BY.readState, label: "Read State" },
  { value: NOTIFICATION_GROUP_BY.none, label: "No Grouping" },
]);

export const NOTIFICATION_DEFAULT_GROUP_BY: NotificationGroupBy = NOTIFICATION_GROUP_BY.day;

/** The band every dismissed row goes to, whatever the grouping. */
export const DISMISSED_BAND = "dismissed";
const NO_PRIORITY = "No Priority";
const NO_MATTER = "No Matter";

/** Where the reader is, for the Day bands: their own calendar and their own today. */
export interface ReaderCalendar {
  timeZone: string;
  today: CivilDate;
}

export function readerCalendar(now: number = Date.now()): ReaderCalendar {
  const timeZone = viewerTimeZone();
  return { timeZone, today: zonedReading(now, timeZone).civilDate };
}

/** The bands in the order `named` gives, then the dismissed band. */
function fixedOrder(named: readonly string[]): () => readonly string[] {
  return () => [...named, DISMISSED_BAND];
}

/** Keys sorted as text, an optional catch-all after them, then the dismissed band. */
function alphabetical(trailing: string): (keys: readonly string[]) => readonly string[] {
  return (keys) => [
    ...keys
      .filter((key) => key !== trailing && key !== DISMISSED_BAND)
      .toSorted((left, right) => left.localeCompare(right)),
    trailing,
    DISMISSED_BAND,
  ];
}

/** Wrap a live-row key so a dismissed row always lands in its own band. */
function withDismissedBand(
  keyOf: (row: NotificationItem) => string,
): (row: NotificationItem) => string {
  return (row) => (row.state === "dismissed" ? DISMISSED_BAND : keyOf(row));
}

function withDismissedLabel(labelOf: (key: string) => string): (key: string) => string {
  return (key) => (key === DISMISSED_BAND ? NOTIFICATION_STATE_LABEL.dismissed : labelOf(key));
}

function dayGrouping(calendar: ReaderCalendar): GridGrouping<NotificationItem> {
  const yesterday = addCalendarDays(calendar.today, -1);
  return {
    keyOf: withDismissedBand(
      (row) => zonedReading(Date.parse(row.occurredAt), calendar.timeZone).civilDate,
    ),
    labelOf: withDismissedLabel((day) => {
      if (day === calendar.today) return "Today";
      if (day === yesterday) return "Yesterday";
      return formatDate(day);
    }),
    // A civil date sorts as text, so the newest day is the greatest key.
    order: (keys, direction) => {
      const days = keys.filter((key) => key !== DISMISSED_BAND).toSorted();
      return [...(direction === "ascending" ? days : days.toReversed()), DISMISSED_BAND];
    },
  };
}

/**
 * The grouping for the reader's choice, or null for a flat list. `calendar` is the reader's zone
 * and today, passed in so a test can pin them.
 */
export function notificationGrouping(
  groupBy: NotificationGroupBy,
  calendar: ReaderCalendar,
): GridGrouping<NotificationItem> | null {
  switch (groupBy) {
    case NOTIFICATION_GROUP_BY.day:
      return dayGrouping(calendar);
    case NOTIFICATION_GROUP_BY.category:
      return {
        keyOf: withDismissedBand((row) => notificationCategoryLabel(row.category)),
        labelOf: withDismissedLabel((key) => key),
        order: fixedOrder(NOTIFICATION_CATEGORIES.map(notificationCategoryLabel)),
      };
    case NOTIFICATION_GROUP_BY.priority:
      return {
        keyOf: withDismissedBand((row) => PRIORITY_LABEL[row.severity] ?? NO_PRIORITY),
        labelOf: withDismissedLabel((key) => key),
        order: fixedOrder([
          PRIORITY_LABEL.critical ?? "",
          PRIORITY_LABEL.attention ?? "",
          NO_PRIORITY,
        ]),
      };
    case NOTIFICATION_GROUP_BY.matter:
      return {
        keyOf: withDismissedBand((row) => row.matterNumber ?? NO_MATTER),
        labelOf: withDismissedLabel((key) => key),
        order: alphabetical(NO_MATTER),
      };
    case NOTIFICATION_GROUP_BY.readState:
      return {
        keyOf: withDismissedBand((row) => NOTIFICATION_STATE_LABEL[row.state]),
        labelOf: withDismissedLabel((key) => key),
        order: fixedOrder([NOTIFICATION_STATE_LABEL.unread, NOTIFICATION_STATE_LABEL.read]),
      };
    case NOTIFICATION_GROUP_BY.none:
      break;
  }
  return null;
}
