/*
 * The copies a member changed in their own calendar, as the Calendar Sync page states them: one
 * row per copy, with what Magna Carta sent and what Outlook holds now side by side. Pure, so the
 * wording of a difference is tested without a page.
 *
 * BOTH SIDES ARE READ IN THE EVENT'S OWN ZONE. A hearing recorded in the court's zone is compared
 * on the court's wall clock, so a copy the member never moved does not read as moved because they
 * opened the page somewhere else.
 */
import type { CalendarSyncIssue } from "@magna-carta/api-client";
import type { GridColumn } from "@magna-carta/design-system/data-table";
import { formatDate } from "@magna-carta/design-system/formatters";
import { formatWallClock } from "$lib/calendar/calendar-api.ts";
import { actionsColumn } from "$lib/settings/catalog-columns.ts";

type CalendarSyncCopyReading = CalendarSyncIssue["sent"];

export function issueKey(issue: Pick<CalendarSyncIssue, "localKind" | "localId">): string {
  return `${issue.localKind}:${issue.localId}`;
}

/** When a copy happens, in words: its day or days, and its times when it has them. */
export function whenText(reading: CalendarSyncCopyReading): string {
  const clock = (time: string | null): string | null =>
    formatWallClock(time, reading.timeZone, reading.timeZone, reading.startsOn);
  const start = clock(reading.startsAtTime);
  const end = clock(reading.endsAtTime);
  const sameDay = reading.endsOn === reading.startsOn;
  if (start === null) {
    return sameDay
      ? formatDate(reading.startsOn)
      : `${formatDate(reading.startsOn)} to ${formatDate(reading.endsOn)}`;
  }
  if (sameDay) {
    return end === null || end === start
      ? `${formatDate(reading.startsOn)}, ${start}`
      : `${formatDate(reading.startsOn)}, ${start} to ${end}`;
  }
  return `${formatDate(reading.startsOn)}, ${start} to ${formatDate(reading.endsOn)}, ${end ?? start}`;
}

/** What Outlook holds now, naming only what differs from what was sent. */
export function foundText(issue: CalendarSyncIssue): string {
  if (issue.found === null) return "Deleted in Outlook";
  const differences: string[] = [];
  if (issue.found.title !== issue.sent.title) differences.push(`Titled "${issue.found.title}"`);
  if (whenText(issue.found) !== whenText(issue.sent)) differences.push(whenText(issue.found));
  if (issue.found.location !== issue.sent.location) {
    differences.push(
      issue.found.location === null ? "No location" : `Location ${issue.found.location}`,
    );
  }
  return differences.join(" · ");
}

export function syncIssueColumns(): GridColumn<CalendarSyncIssue>[] {
  return [
    { id: "title", label: "Event", anchored: true, value: (issue) => issue.sent.title },
    { id: "sent", label: "In Magna Carta", value: (issue) => whenText(issue.sent) },
    { id: "found", label: "In Outlook", value: foundText },
    actionsColumn<CalendarSyncIssue>(),
  ];
}
