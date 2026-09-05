/*
 * Which verbs a calendar record's state allows, and why the others refuse — in sentences, because
 * a refused verb is drawn disabled with its reason and never removed, so the action bar's geometry
 * never changes under the reader.
 *
 * Every answer here is a pure function of the record, whether it is still being read, and the
 * session's own refusal (calendar-permission.ts). The entry window renders the answers and decides
 * none of them; the tests assert them without a browser.
 */
import { deadlineStateLabel, type DeadlineState, type EventStatus } from "./calendar-api.ts";
import type { EntryRecord } from "./entry-reference.ts";

/** What the window knows when it asks whether a verb is open. */
export interface EntryVerbState {
  readonly record: EntryRecord | null;
  /** Whether the record's own read is still in flight. */
  readonly reading: boolean;
  /** The session's refusal, where the account may not write on the calendar at all. */
  readonly manageRefusal: string | undefined;
}

/** Why a setting's state refuses its verbs, or undefined while it is scheduled. */
export function settingRefusal(status: EventStatus): string | undefined {
  switch (status) {
    case "scheduled":
      return undefined;
    case "occurred":
      return "This setting has already occurred.";
    case "cancelled":
      return "This setting is already cancelled.";
  }
}

/** Why a deadline's state refuses its verbs, or undefined while it is open. */
export function deadlineRefusal(state: DeadlineState): string | undefined {
  return state === "open"
    ? undefined
    : `This deadline is already ${deadlineStateLabel(state).toLowerCase()}.`;
}

function noRecordRefusal(state: EntryVerbState, act: string): string {
  return state.reading ? "Reading the record." : `There is no record to ${act}.`;
}

/*
 * Why Edit refuses. It gates ENTRY into the fields: a cancelled setting and a settled deadline are
 * kept as they were recorded, because what the record said at the moment it was cancelled or
 * satisfied is itself a fact the firm relies on.
 */
export function editRefusal(state: EntryVerbState): string | undefined {
  if (state.manageRefusal !== undefined) return state.manageRefusal;
  const record = state.record;
  if (record === null) return noRecordRefusal(state, "change");
  if (record.kind === "deadline" && record.deadline.state !== "open") {
    return "A settled deadline is kept as it was recorded.";
  }
  if (record.kind !== "deadline" && record.event.status === "cancelled") {
    return "A cancelled setting is kept as it was recorded.";
  }
  return undefined;
}

/** Why a setting's verbs (cancel, continue, book, relate) refuse, or undefined when open to them. */
export function eventVerbRefusal(state: EntryVerbState): string | undefined {
  if (state.manageRefusal !== undefined) return state.manageRefusal;
  const record = state.record;
  if (record === null) return noRecordRefusal(state, "act on");
  if (record.kind === "deadline") return "Not a setting.";
  return settingRefusal(record.event.status);
}

/** Why a deadline's verbs (satisfy, vacate, supersede) refuse, or undefined when open to them. */
export function deadlineVerbRefusal(state: EntryVerbState): string | undefined {
  if (state.manageRefusal !== undefined) return state.manageRefusal;
  const record = state.record;
  if (record === null) return noRecordRefusal(state, "act on");
  if (record.kind !== "deadline") return "Not a deadline.";
  return deadlineRefusal(record.deadline.state);
}

/**
 * The count the Links tab shows: a setting's continuance ends plus the links related by hand; a
 * deadline's one trigger, or none; a firm event's related links alone. Undefined before the record
 * has been read, so the tab shows no number rather than a wrong one.
 */
export function linkCount(record: EntryRecord | null, relatedCount: number): number | undefined {
  if (record === null) return undefined;
  switch (record.kind) {
    case "event":
      return (
        [record.event.continuedFromEventId, record.event.continuedToEventId].filter(
          (id) => id !== null,
        ).length + relatedCount
      );
    case "deadline":
      return record.deadline.triggerEventId === null ? 0 : 1;
    case "firmEvent":
      return relatedCount;
  }
}

/**
 * The count the Participants tab shows. A deadline has nobody; a firm event for every member lists
 * nobody by construction, so it shows no count rather than a misleading zero.
 */
export function participantCount(record: EntryRecord | null): number | undefined {
  if (record === null || record.kind === "deadline") return undefined;
  if (record.kind === "firmEvent" && record.event.audience === "all_members") return undefined;
  return record.participants.length;
}
