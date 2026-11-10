/*
 * What the two Calendar Sync pages say and compute, kept apart from the pages so each has a test.
 *
 * ONE ROW PER EVENT TYPE, by the owner's ruling: a type is never folded into a group on these
 * pages. The category is a column a reader can filter on, and nothing is set by category.
 */
import type {
  CalendarSyncProviderCalendar,
  CalendarSyncRule,
  CalendarSyncSubject,
} from "@magna-carta/api-client";
import type { GridColumn } from "@magna-carta/design-system/data-table";
import type { ChoiceOption } from "$lib/components/choice-picker.ts";
import { actionsColumn, CATALOG_ACTIONS_COLUMN_ID } from "$lib/settings/catalog-columns.ts";
import { eventTypeCategoryLabel } from "$lib/calendar/calendar-api.ts";

export type SyncScope = CalendarSyncRule["scope"];
export type SyncDetail = CalendarSyncSubject["detail"];

export const SYNC_ACTIONS_COLUMN_ID = CATALOG_ACTIONS_COLUMN_ID;

/** The value the destination field holds for "do not send this". Never a calendar's identifier. */
export const NOT_SYNCED = "";

export function subjectName(subject: Pick<CalendarSyncSubject, "kind" | "name">): string {
  return subject.kind === "deadline" ? "Deadline" : (subject.name ?? "Event");
}

export function subjectCategory(subject: Pick<CalendarSyncSubject, "kind" | "category">): string {
  if (subject.kind === "deadline") return "Deadlines";
  return subject.category === null ? "Other" : eventTypeCategoryLabel(subject.category);
}

const SCOPE_LABELS: Readonly<Record<SyncScope, string>> = {
  mine: "Ones I Take Part In",
  my_matters: "All on My Matters",
};
const DEADLINE_SCOPE_LABELS: Readonly<Record<SyncScope, string>> = {
  mine: "On Matters I Am Responsible For",
  my_matters: "All on My Matters",
};

export function scopeLabel(kind: CalendarSyncSubject["kind"], scope: SyncScope): string {
  return (kind === "deadline" ? DEADLINE_SCOPE_LABELS : SCOPE_LABELS)[scope];
}

export function scopeChoices(kind: CalendarSyncSubject["kind"]): ChoiceOption[] {
  return (["mine", "my_matters"] as const).map((scope) => ({
    value: scope,
    label: scopeLabel(kind, scope),
  }));
}

const DETAIL_LABELS: Readonly<Record<SyncDetail, string>> = {
  full: "Full Detail",
  minimal: "Matter Number and Type Only",
};

export function detailLabel(detail: SyncDetail): string {
  return DETAIL_LABELS[detail];
}

export const DETAIL_CHOICES: readonly ChoiceOption[] = (["full", "minimal"] as const).map(
  (detail) => ({ value: detail, label: DETAIL_LABELS[detail] }),
);

export const MAY_LEAVE_CHOICES: readonly ChoiceOption[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

/**
 * The calendars a rule may point at: the ones the account can add events to. The member's main
 * calendar says that it is, because two calendars can share a name.
 */
export function destinationChoices(
  calendars: readonly CalendarSyncProviderCalendar[],
): ChoiceOption[] {
  return [
    { value: NOT_SYNCED, label: "Not Synced" },
    ...calendars
      .filter((calendar) => calendar.canWrite)
      .map((calendar) => ({
        value: calendar.remoteId,
        label: calendar.isDefault ? `${calendar.name} (My Main One)` : calendar.name,
      })),
  ];
}

/** One row of the member's page: a subject, and the member's rule for it where they have one. */
export interface MemberSyncRow {
  readonly subject: CalendarSyncSubject;
  readonly rule: CalendarSyncRule | null;
}

export function memberSyncRows(
  subjects: readonly CalendarSyncSubject[],
  rules: readonly CalendarSyncRule[],
): MemberSyncRow[] {
  const ruleBySubject = new Map(rules.map((rule) => [rule.subject, rule]));
  return subjects.map((subject) => ({ subject, rule: ruleBySubject.get(subject.subject) ?? null }));
}

/** Where a row's events go, in the page's words. */
export function destinationText(row: MemberSyncRow): string {
  if (!row.subject.mayLeave) return "Not Allowed by the Firm";
  return row.rule === null ? "Not Synced" : row.rule.calendarName;
}

export function memberSyncColumns(canChange: boolean): GridColumn<MemberSyncRow>[] {
  return [
    { id: "name", label: "Event Type", anchored: true, value: (row) => subjectName(row.subject) },
    {
      id: "category",
      label: "Category",
      filter: "set",
      value: (row) => subjectCategory(row.subject),
    },
    { id: "destination", label: "Send To", value: destinationText },
    {
      id: "scope",
      label: "Which Ones",
      value: (row) => (row.rule === null ? "" : scopeLabel(row.subject.kind, row.rule.scope)),
    },
    ...(canChange ? [actionsColumn<MemberSyncRow>()] : []),
  ];
}

export function firmLimitColumns(canEdit: boolean): GridColumn<CalendarSyncSubject>[] {
  return [
    { id: "name", label: "Event Type", anchored: true, value: subjectName },
    { id: "category", label: "Category", filter: "set", value: subjectCategory },
    {
      id: "mayLeave",
      label: "May Leave Magna Carta",
      filter: "set",
      value: (subject) => (subject.mayLeave ? "Yes" : "No"),
      filterValues: ["Yes", "No"],
    },
    {
      id: "detail",
      label: "Detail Sent",
      value: (subject) => (subject.mayLeave ? detailLabel(subject.detail) : ""),
    },
    ...(canEdit ? [actionsColumn<CalendarSyncSubject>()] : []),
  ];
}

/**
 * The member's whole rule set with one subject changed, as the save sends it. The save replaces
 * the set, so every other rule rides along exactly as it stands.
 */
export function rulesWithChange(
  rules: readonly CalendarSyncRule[],
  subject: string,
  change: { readonly calendarRemoteId: string; readonly scope: SyncScope },
): { subject: string; calendarRemoteId: string; scope: SyncScope }[] {
  const kept = rules
    .filter((rule) => rule.subject !== subject)
    .map((rule) => ({
      subject: rule.subject,
      calendarRemoteId: rule.calendarRemoteId,
      scope: rule.scope,
    }));
  return change.calendarRemoteId === NOT_SYNCED
    ? kept
    : [...kept, { subject, calendarRemoteId: change.calendarRemoteId, scope: change.scope }];
}

/** How many of a member's rules send something, for the page's one-line summary. */
export function syncingSummary(rules: readonly CalendarSyncRule[]): string {
  if (rules.length === 0) return "Nothing is set to sync.";
  return rules.length === 1
    ? "1 event type is set to sync."
    : `${rules.length} event types are set to sync.`;
}
