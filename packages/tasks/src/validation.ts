import { CIVIL_DATE_PATTERN, isCivilDate } from "@magna-carta/civil-time/civil-date";
import { isResolvableTimeZone } from "@magna-carta/civil-time/time-zone";
import { isWallClockTime } from "@magna-carta/civil-time/wall-clock";
import { formatRecurrence, parseRecurrence } from "@magna-carta/civil-time/recurrence";
import {
  DEFAULT_PLAN_DUE_ANCHOR,
  MAX_ARCHIVE_REASON_LENGTH,
  MAX_PLAN_DESCRIPTION_LENGTH,
  MAX_PLAN_NAME_LENGTH,
  MAX_PLAN_OFFSET_DAYS,
  MAX_TASK_BODY_LENGTH,
  MAX_TASK_CHECKLIST_ITEM_LENGTH,
  MAX_TASK_LINK_LABEL_LENGTH,
  MAX_TASK_LINK_URL_LENGTH,
  MAX_TASK_LIST_NAME_LENGTH,
  MAX_TASK_LOCATION_LENGTH,
  MAX_TASK_STATUS_NAME_LENGTH,
  MAX_TASK_TEAM_NAME_LENGTH,
  MAX_TASK_TITLE_LENGTH,
  TASK_STATUS_COLOURS,
  type TaskStatusColour,
  PLAN_DUE_ANCHORS,
  TASK_PRIORITIES,
  TASK_RUNGS,
  type PlanDueAnchor,
  type TaskDue,
  type TaskPriority,
  type TaskRung,
  DEFAULT_TASK_RECURRENCE_MODE,
  TASK_RECURRENCE_MODES,
  type TaskRecurrenceMode,
} from "./types.ts";

// Every refusal this subsystem raises, as a code the route maps to a problem type. Codes — never
// messages — drive the mapping, so a message can be reworded without changing the contract.
export type TaskValidationCode =
  | "task-empty-title"
  | "task-title-too-long"
  | "task-body-too-long"
  | "task-unknown-priority"
  // The due-date shape refusals. Each names the one thing that is wrong rather than a generic
  // "invalid date", because each is fixed by the caller supplying a different field.
  | "task-invalid-date"
  | "task-invalid-time"
  | "task-time-without-date"
  | "task-date-without-zone"
  | "task-zone-without-date"
  | "task-unknown-time-zone"
  // A task this reader cannot reach, or one that is not on the matter the caller named. Kept
  // distinct because they are fixed differently, and neither ever reveals which by its message.
  | "task-unknown"
  | "task-matter-mismatch"
  // Assignment. Refused at the write rather than created and hidden: a task list with holes in it
  // that nobody can explain is worse than a refusal somebody can act on.
  | "task-unknown-assignee"
  | "task-assignee-cannot-see-matter"
  // Moves that do not apply where the task stands.
  | "task-not-open"
  | "task-not-done"
  | "task-already-archived"
  | "task-not-archived"
  | "task-unknown-rung"
  | "task-archive-reason-too-long"
  // Sequencing.
  | "task-unknown-predecessor"
  | "task-predecessor-matter-mismatch"
  | "task-blocking-cycle"
  // A file that is not a live file on this task's matter, or a task with no matter to have files on.
  | "task-unknown-file"
  | "task-file-matter-mismatch"
  | "task-without-matter-has-no-files"
  | "task-too-many-files"
  // The matter plan.
  | "plan-empty-name"
  | "plan-name-too-long"
  | "plan-description-too-long"
  | "plan-unknown"
  | "plan-inactive"
  | "plan-unknown-anchor"
  | "plan-offset-without-anchor"
  | "plan-anchor-without-offset"
  | "plan-offset-out-of-range"
  | "plan-too-many-task-templates"
  | "plan-unknown-task-template"
  | "plan-task-template-mismatch"
  | "plan-blocking-cycle"
  | "plan-nothing-accepted"
  // A task's identity in a system that is not this one. The platform ships no adapter, so every one
  // of these is a refusal an ADDON reads — which is why they say what is wrong rather than what to
  // do about it: the caller knows its own remedy and this package does not.
  | "external-system-required"
  | "external-system-too-long"
  | "external-id-required"
  | "external-id-too-long"
  | "external-url-too-long"
  | "remote-revision-too-long"
  // The two uniqueness rules, refused separately because they are different mistakes: the first
  // means somebody else already claimed that remote object, the second means this task already has
  // an identity in that system.
  | "external-object-already-linked"
  | "task-already-linked"
  | "external-link-not-found"
  // Lists, statuses and the flow.
  | "task-list-unknown"
  | "task-list-name-invalid"
  | "task-list-name-taken"
  | "task-list-is-default"
  | "task-list-too-many"
  | "task-status-unknown"
  | "task-status-name-invalid"
  | "task-status-name-taken"
  | "task-status-unknown-colour"
  | "task-status-in-use"
  | "task-status-last"
  | "task-status-too-many"
  | "task-status-move-not-in-flow"
  // Teams, assignees and watchers.
  | "task-team-unknown"
  | "task-team-name-invalid"
  | "task-team-name-taken"
  | "task-team-too-many"
  | "task-team-too-many-members"
  | "task-too-many-assignees"
  | "task-too-many-watchers"
  // Sub-tasks.
  | "task-parent-unknown"
  | "task-parent-cycle"
  | "task-parent-too-deep"
  // A task's start date, location, checklist and links.
  | "task-start-after-due"
  | "task-location-too-long"
  | "task-checklist-item-invalid"
  | "task-checklist-item-unknown"
  | "task-checklist-too-long"
  | "task-link-invalid"
  | "task-link-unknown"
  | "task-too-many-links"
  // Repeating.
  | "task-recurrence-invalid"
  | "task-recurrence-needs-due-date"
  | "task-recurrence-subtask";

export class TaskValidationError extends Error {
  constructor(
    readonly code: TaskValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "TaskValidationError";
  }
}

function refuse(code: TaskValidationCode, message: string): never {
  throw new TaskValidationError(code, message);
}

// The title as it will be stored. Trimmed at the edges and never in the middle.
export function normalizeTaskTitle(title: string): string {
  const normalized = title.trim();
  if (normalized.length === 0) refuse("task-empty-title", "a task needs to say what to do");
  if (normalized.length > MAX_TASK_TITLE_LENGTH) {
    refuse(
      "task-title-too-long",
      `a task title is at most ${String(MAX_TASK_TITLE_LENGTH)} characters; this one is ${String(normalized.length)}. Longer instructions belong in the body`,
    );
  }
  return normalized;
}

// The body, which is optional. An empty body and an absent one are the same thing and both store
// NULL: a task carrying an empty string would render an empty section on every surface that checks
// for presence rather than content.
export function normalizeTaskBody(body: string | null | undefined): string | null {
  if (body === null || body === undefined) return null;
  const normalized = body.trim();
  if (normalized.length === 0) return null;
  if (normalized.length > MAX_TASK_BODY_LENGTH) {
    refuse(
      "task-body-too-long",
      `a task body is at most ${String(MAX_TASK_BODY_LENGTH)} characters; this one is ${String(normalized.length)}`,
    );
  }
  return normalized;
}

/*
 * The reason an archiving may carry, or null where it carries none.
 *
 * OPTIONAL, unlike the cancellation reason it replaces. That one was required on the reasoning that
 * the decision is the record — which is true of a decision, and archiving is usually not one:
 * somebody clearing work that is simply not happening is not composing a memo, and demanding a
 * sentence is why the state it replaces went unused. An empty reason is therefore null rather than a
 * refusal, so nothing stores a row that says why with nothing in it.
 */
export function normalizeArchiveReason(reason: string | null | undefined): string | null {
  if (reason === null || reason === undefined) return null;
  const normalized = reason.trim();
  if (normalized.length === 0) return null;
  if (normalized.length > MAX_ARCHIVE_REASON_LENGTH) {
    refuse(
      "task-archive-reason-too-long",
      `an archive reason is at most ${String(MAX_ARCHIVE_REASON_LENGTH)} characters; a longer explanation belongs in the task body`,
    );
  }
  return normalized;
}

/** The rung a caller named, refused by name rather than by silently landing on the default. */
export function normalizeTaskRung(rung: string): TaskRung {
  if (!(TASK_RUNGS as readonly string[]).includes(rung)) {
    refuse("task-unknown-rung", `${rung} is not a rung; the four are ${TASK_RUNGS.join(", ")}`);
  }
  return rung as TaskRung;
}

export function normalizeTaskPriority(priority: string | null | undefined): TaskPriority | null {
  if (priority === null || priority === undefined) return null;
  if (!(TASK_PRIORITIES as readonly string[]).includes(priority)) {
    refuse(
      "task-unknown-priority",
      `${priority} is not a priority; the four are ${TASK_PRIORITIES.join(", ")}`,
    );
  }
  return priority as TaskPriority;
}

// The due date as it will be stored, with the three-way coherence checked once here rather than at
// each call site.
//
// NOTHING IS INFERRED. This never invents a midnight, never fills a zone the caller did not give,
// and never defaults a date to today. It also performs no arithmetic of any kind: there is no
// business-day rule here, no holiday calendar, no service-method offset, and no derivation of one
// date from another. That is the calendar package's stated invariant and this package inherits it —
// a computed date that is wrong gets trusted precisely because it was computed.
export function normalizeTaskDue(input: {
  readonly dueOn?: string | null;
  readonly dueAtTime?: string | null;
  readonly timeZone?: string | null;
}): TaskDue {
  const dueOn = input.dueOn ?? null;
  const dueAtTime = input.dueAtTime ?? null;
  const timeZone = input.timeZone ?? null;

  if (dueOn !== null) {
    if (!CIVIL_DATE_PATTERN.test(dueOn)) {
      refuse("task-invalid-date", "a due date must be a civil date of the form YYYY-MM-DD");
    }
    // The pattern alone accepts 2026-02-30; isCivilDate also checks the day is on the calendar.
    if (!isCivilDate(dueOn)) {
      refuse("task-invalid-date", `${dueOn} is not a date on the calendar`);
    }
    if (timeZone === null) {
      refuse(
        "task-date-without-zone",
        'a task due "Friday" is due at two different moments in Reno and Boston; give the zone the date is read in',
      );
    }
  }

  if (dueAtTime !== null) {
    if (!isWallClockTime(dueAtTime)) {
      refuse("task-invalid-time", "a due time must be a wall-clock time of the form HH:MM");
    }
    if (dueOn === null) {
      refuse(
        "task-time-without-date",
        "an hour with no day is not a moment anybody can place; give the due date as well",
      );
    }
  }

  if (timeZone !== null) {
    if (dueOn === null) {
      refuse(
        "task-zone-without-date",
        "a time zone on a task with no due date says nothing; give the date or drop the zone",
      );
    }
    if (!isResolvableTimeZone(timeZone)) {
      refuse("task-unknown-time-zone", `${timeZone} is not a time zone this platform can resolve`);
    }
  }

  return { dueOn, dueAtTime, timeZone };
}

// ---- the matter plan ----

export function normalizePlanName(name: string): string {
  const normalized = name.trim();
  if (normalized.length === 0)
    refuse("plan-empty-name", "a plan needs a name a firm will recognize");
  if (normalized.length > MAX_PLAN_NAME_LENGTH) {
    refuse(
      "plan-name-too-long",
      `a plan name is at most ${String(MAX_PLAN_NAME_LENGTH)} characters`,
    );
  }
  return normalized;
}

export function normalizePlanDescription(description: string | null | undefined): string | null {
  if (description === null || description === undefined) return null;
  const normalized = description.trim();
  if (normalized.length === 0) return null;
  if (normalized.length > MAX_PLAN_DESCRIPTION_LENGTH) {
    refuse(
      "plan-description-too-long",
      `a plan description is at most ${String(MAX_PLAN_DESCRIPTION_LENGTH)} characters`,
    );
  }
  return normalized;
}

// The anchor and its offset, checked together because neither is meaningful alone.
//
// An offset with no anchor computes nothing. An anchor with no offset would silently mean "+0", and a
// template that means the anchor date itself should say so with an explicit zero rather than by
// omission — the difference between "on the day the matter opens" and "somebody forgot to type a
// number" is exactly what a reviewer of a plan needs to see.
export function normalizePlanDue(input: {
  readonly dueAnchor?: string | null;
  readonly offsetDays?: number | null;
}): { anchor: PlanDueAnchor; offsetDays: number | null } {
  const raw = input.dueAnchor ?? DEFAULT_PLAN_DUE_ANCHOR;
  if (!(PLAN_DUE_ANCHORS as readonly string[]).includes(raw)) {
    refuse(
      "plan-unknown-anchor",
      `${raw} is not a due-date anchor; the two are ${PLAN_DUE_ANCHORS.join(", ")}. ` +
        "Anchors beyond these are the front half of a docketing rule and are added by a reviewed migration",
    );
  }
  const anchor = raw as PlanDueAnchor;
  const offsetDays = input.offsetDays ?? null;

  if (anchor === "none") {
    if (offsetDays !== null) {
      refuse(
        "plan-offset-without-anchor",
        "an offset with no anchor computes nothing; give the anchor it counts from, or drop the offset",
      );
    }
    return { anchor, offsetDays: null };
  }

  if (offsetDays === null) {
    refuse(
      "plan-anchor-without-offset",
      "say how many days after the anchor this is due; zero means the anchor day itself and is written as zero",
    );
  }
  if (!Number.isInteger(offsetDays)) {
    refuse("plan-offset-out-of-range", "an offset is a whole number of days");
  }
  if (Math.abs(offsetDays) > MAX_PLAN_OFFSET_DAYS) {
    refuse(
      "plan-offset-out-of-range",
      `an offset is at most ${String(MAX_PLAN_OFFSET_DAYS)} days either way; a larger one is a typo rather than a schedule`,
    );
  }
  return { anchor, offsetDays };
}

// THE ONE PIECE OF DATE ARITHMETIC IN THIS PACKAGE, and the single named exception in
// test/no-arithmetic.test.ts. It is @magna-carta/civil-time's function, re-exported here so the
// plan service and that scan keep reading in this package's vocabulary.
//
// It adds a whole number of CALENDAR days to a civil date and returns a civil date. No business-day
// rule, no holiday calendar, no service-method offset, no jurisdiction, and no reading of any clock.
// Adding fourteen days to a date is not the arithmetic packages/calendar forbids; deriving a court
// deadline from a rule is, and this does not do that.
//
// The honest consequence, stated here because it is the reason instantiation asks before it writes:
// this will happily land a task on a Sunday or on Christmas Day. A person moves that date in a
// second. A template cannot know to.
export { addCalendarDays } from "@magna-carta/civil-time/civil-date";

// ---- lists, statuses, teams, and what a task carries besides its words ----

// A short name a reader sees in a menu, trimmed and bounded. One helper for the three kinds of name
// so a list, a status and a team cannot disagree about what an acceptable name is.
function normalizeShortName(
  name: string,
  limit: number,
  code: "task-list-name-invalid" | "task-status-name-invalid" | "task-team-name-invalid",
  noun: string,
): string {
  const normalized = name.trim().replace(/\s+/gu, " ");
  if (normalized.length === 0) refuse(code, `a ${noun} needs a name`);
  if (normalized.length > limit) {
    refuse(code, `a ${noun} name is at most ${String(limit)} characters`);
  }
  return normalized;
}

export function normalizeTaskListName(name: string): string {
  return normalizeShortName(name, MAX_TASK_LIST_NAME_LENGTH, "task-list-name-invalid", "list");
}

export function normalizeTaskStatusName(name: string): string {
  return normalizeShortName(
    name,
    MAX_TASK_STATUS_NAME_LENGTH,
    "task-status-name-invalid",
    "status",
  );
}

export function normalizeTaskTeamName(name: string): string {
  return normalizeShortName(name, MAX_TASK_TEAM_NAME_LENGTH, "task-team-name-invalid", "team");
}

export function normalizeTaskStatusColour(colour: string): TaskStatusColour {
  if (!(TASK_STATUS_COLOURS as readonly string[]).includes(colour)) {
    refuse(
      "task-status-unknown-colour",
      `${colour} is not a status colour; the colours are ${TASK_STATUS_COLOURS.join(", ")}`,
    );
  }
  return colour as TaskStatusColour;
}

// The start date: a civil date or nothing, and never after the due date when both are set. It is
// compared as text, which is exactly right for the YYYY-MM-DD shape and needs no arithmetic.
export function normalizeTaskStart(
  startsOn: string | null | undefined,
  dueOn: string | null,
): string | null {
  if (startsOn === null || startsOn === undefined) return null;
  if (!CIVIL_DATE_PATTERN.test(startsOn) || !isCivilDate(startsOn)) {
    refuse("task-invalid-date", `${startsOn} is not a date on the calendar`);
  }
  if (dueOn !== null && startsOn > dueOn) {
    refuse("task-start-after-due", "a task cannot start after the day it is due");
  }
  return startsOn;
}

// Where the work happens. Empty is the same as none.
export function normalizeTaskLocation(location: string | null | undefined): string | null {
  if (location === null || location === undefined) return null;
  const normalized = location.trim();
  if (normalized.length === 0) return null;
  if (normalized.length > MAX_TASK_LOCATION_LENGTH) {
    refuse(
      "task-location-too-long",
      `a location is at most ${String(MAX_TASK_LOCATION_LENGTH)} characters`,
    );
  }
  return normalized;
}

export function normalizeChecklistItemText(text: string): string {
  const normalized = text.trim();
  if (normalized.length === 0)
    refuse("task-checklist-item-invalid", "a checklist line needs words");
  if (normalized.length > MAX_TASK_CHECKLIST_ITEM_LENGTH) {
    refuse(
      "task-checklist-item-invalid",
      `a checklist line is at most ${String(MAX_TASK_CHECKLIST_ITEM_LENGTH)} characters`,
    );
  }
  return normalized;
}

/**
 * A link a task points at: an http or https address, and an optional label. Any other scheme is
 * refused, because a link on a task is something a person clicks, and a `javascript:` address on a
 * shared record is a way to run code in a colleague's session.
 */
export function normalizeTaskLink(
  url: string,
  label: string | null | undefined,
): { url: string; label: string | null } {
  const trimmed = url.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_TASK_LINK_URL_LENGTH) {
    refuse("task-link-invalid", "a link needs an address of a sensible length");
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    refuse("task-link-invalid", "that is not a web address");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    refuse("task-link-invalid", "a link must be a web address starting with https:// or http://");
  }
  const normalizedLabel = label?.trim() ?? "";
  if (normalizedLabel.length > MAX_TASK_LINK_LABEL_LENGTH) {
    refuse(
      "task-link-invalid",
      `a link label is at most ${String(MAX_TASK_LINK_LABEL_LENGTH)} characters`,
    );
  }
  return { url: trimmed, label: normalizedLabel.length === 0 ? null : normalizedLabel };
}

/**
 * A repeat rule as a caller sent it: the stored line, or null for a task that happens once.
 *
 * Refused unless @magna-carta/civil-time can read it, and stored as that package writes it, so the
 * column only ever holds a rule the task window can show and edit. A line with parts this product
 * does not offer is refused rather than stored and half-understood.
 */
export function normalizeTaskRecurrence(
  rule: string | null | undefined,
  mode: string | null | undefined,
): { rule: string; mode: TaskRecurrenceMode } | null {
  if (rule === null || rule === undefined || rule.trim() === "") return null;
  const parsed = parseRecurrence(rule);
  if (parsed === null) {
    refuse("task-recurrence-invalid", "that is not a repeat this product can show");
  }
  if (parsed.end.kind === "on" && !isCivilDate(parsed.end.date)) {
    refuse("task-recurrence-invalid", "a repeat ends on a date on the calendar");
  }
  const resolvedMode = mode ?? DEFAULT_TASK_RECURRENCE_MODE;
  if (!(TASK_RECURRENCE_MODES as readonly string[]).includes(resolvedMode)) {
    refuse("task-recurrence-invalid", `${resolvedMode} is not a way for the next copy to appear`);
  }
  return { rule: formatRecurrence(parsed), mode: resolvedMode as TaskRecurrenceMode };
}
