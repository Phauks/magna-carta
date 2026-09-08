/*
 * THE CARD, COMPOSED HERE. A notification row carries identifiers, closed labels, counts and dates
 * and nothing else, so the sentence a member reads does not arrive with it — it is composed on this
 * side from the kind and the declared facts. That is the point of the design rather than a cost of
 * it: a stored sentence would outlive the access check that justified writing the row, and would go
 * stale invisibly the moment the matter behind it was renumbered.
 *
 * So this module is the client half of the server's type registry (packages/notifications/src/
 * registry.ts): one entry per registered kind, giving the words for what happened and the phrase
 * its facts make. Adding a type on the server means adding its entry here — and until it is added,
 * `describeNotification` falls back to the CATEGORY's own noun rather than inventing a sentence, so
 * a kind this client has never heard of renders as a real, followable row instead of a blank or a
 * raw dotted identifier. A feed that silently drops what it does not recognise is the one failure
 * mode worth designing against here: the row exists because something needed the member's
 * attention.
 *
 * Nothing in this file may interpolate a fact whose value is free text. It cannot: the server's
 * grammar refuses a text-valued declaration, so every value reaching `facts` is an identifier, an
 * integer, a boolean, a declared enum label or a date.
 */
import type {
  NotificationCategory,
  NotificationItem,
  NotificationSeverity,
} from "./notifications-api.ts";
import type { BadgeVariant } from "@magna-carta/design-system/badge";
import AlarmClock from "@lucide/svelte/icons/alarm-clock";
import Archive from "@lucide/svelte/icons/archive";
import CalendarDays from "@lucide/svelte/icons/calendar-days";
import Cog from "@lucide/svelte/icons/cog";
import FileText from "@lucide/svelte/icons/file-text";
import Info from "@lucide/svelte/icons/info";
import Landmark from "@lucide/svelte/icons/landmark";
import ListChecks from "@lucide/svelte/icons/list-checks";
import Mail from "@lucide/svelte/icons/mail";
import ReceiptText from "@lucide/svelte/icons/receipt-text";
import Shield from "@lucide/svelte/icons/shield";
import ShieldAlert from "@lucide/svelte/icons/shield-alert";
import type { Component } from "svelte";

/** What a category is called on screen, the glyph that stands for it, and the noun its rows take. */
interface CategoryPresentation {
  readonly label: string;
  readonly icon: Component;
  /**
   * The house word for what a row in this category points at, used to describe a kind this client
   * does not know. "A trust update", not "a trust.ledger.entry.posted".
   */
  readonly noun: string;
  /** What the category is for, in one line — the settings matrix reads this beside its switches. */
  readonly description: string;
}

export const CATEGORY_PRESENTATION: Readonly<Record<NotificationCategory, CategoryPresentation>> =
  Object.freeze({
    deadlines: {
      label: "Deadlines",
      icon: AlarmClock,
      noun: "a deadline",
      description: "What a court or a rule requires of the firm, and when it falls due.",
    },
    calendar: {
      label: "Calendar",
      icon: CalendarDays,
      noun: "a calendar entry",
      description: "Hearings, appointments and events as they are booked, moved and cancelled.",
    },
    tasks: {
      label: "Tasks",
      icon: ListChecks,
      noun: "a task",
      description: "Work with your name on it, as it is assigned and passed on.",
    },
    trust: {
      label: "Trust",
      icon: Landmark,
      noun: "a trust movement",
      description: "Movements on client money. Always shown in the application.",
    },
    billing: {
      label: "Billing",
      icon: ReceiptText,
      noun: "a billing change",
      description: "Invoices as they are raised, delivered, credited and voided.",
    },
    documents: {
      label: "Documents",
      icon: FileText,
      noun: "a document",
      description: "Files arriving, checking in and out, and what scanning finds in them.",
    },
    custody: {
      label: "Custody",
      icon: Archive,
      noun: "a custody item",
      description: "Items in safe custody that are due for review or overdue back.",
    },
    email: {
      label: "Email",
      icon: Mail,
      noun: "an email",
      description: "Mail filed to a matter from a capture address.",
    },
    conflicts: {
      label: "Conflicts",
      icon: ShieldAlert,
      noun: "a conflicts finding",
      description: "What a conflicts check turned up, and when one needs running again.",
    },
    jobs: {
      label: "Jobs",
      icon: Cog,
      noun: "a job",
      description: "Long-running work you started, when it finishes.",
    },
    security: {
      label: "Security",
      icon: Shield,
      noun: "a security event",
      description: "Events touching access and credentials. Always shown in the application.",
    },
    system: {
      label: "System",
      icon: Info,
      noun: "a change",
      description: "Matter lifecycle changes and what the platform reports about itself.",
    },
  });

/**
 * The tone a severity carries. `attention` is deliberately the warning tint rather than the danger
 * one: a feed where the ordinary case is red is a feed nobody reads twice.
 */
export const SEVERITY_BADGE: Readonly<Record<NotificationSeverity, BadgeVariant>> = Object.freeze({
  informational: "neutral",
  attention: "warning",
  critical: "danger",
});

export const SEVERITY_LABEL: Readonly<Record<NotificationSeverity, string>> = Object.freeze({
  informational: "For information",
  attention: "Needs attention",
  critical: "Urgent",
});

type Facts = Readonly<Record<string, string | number | boolean>> | null;

/** One registered kind's words: what happened, and the phrase its declared facts make. */
interface KindPresentation {
  readonly title: string;
  /** Null where the kind declares no facts, or where they add nothing a reader needs. */
  readonly detail?: (facts: Facts) => string | null;
}

function integer(facts: Facts, key: string): number | null {
  const value = facts?.[key];
  return typeof value === "number" ? value : null;
}

function boolean(facts: Facts, key: string): boolean | null {
  const value = facts?.[key];
  return typeof value === "boolean" ? value : null;
}

function text(facts: Facts, key: string): string | null {
  const value = facts?.[key];
  return typeof value === "string" ? value : null;
}

function days(count: number): string {
  return count === 1 ? "1 day" : `${String(count)} days`;
}

/** How overdue something is, from the count of days the server computed in the subject's own zone. */
function overdueBy(facts: Facts): string | null {
  const count = integer(facts, "daysOverdue");
  if (count === null) return null;
  return count === 0 ? "Due today" : `${days(count)} overdue`;
}

const TASK_PRIORITY_LABEL: Readonly<Record<string, string>> = Object.freeze({
  low: "Low priority",
  normal: "Normal priority",
  high: "High priority",
  urgent: "Urgent",
});

const RECOVERY_OUTCOME_LABEL: Readonly<Record<string, string>> = Object.freeze({
  found: "Recovered",
  exhausted: "No match found",
  needsGpu: "Needs more capacity",
  cancelled: "Cancelled",
});

/** What a task's two facts say together: how urgent it is, and whether it carries a date. */
function taskDetail(facts: Facts): string | null {
  const priority = text(facts, "priority");
  const parts: string[] = [];
  if (priority !== null) parts.push(TASK_PRIORITY_LABEL[priority] ?? priority);
  if (boolean(facts, "dated") === true) parts.push("has a due date");
  return parts.length === 0 ? null : parts.join(" · ");
}

/**
 * One entry per kind the server registers. The titles are written as statements of what happened,
 * in the same voice throughout, because a feed is read by scanning the first three words of each
 * row rather than by reading each row.
 */
const KIND_PRESENTATION: Readonly<Record<string, KindPresentation>> = Object.freeze({
  "trust.ledger.entry.posted": {
    title: "Trust entry posted",
    detail: (facts) => (boolean(facts, "reversal") === true ? "Reverses an earlier entry" : null),
  },
  "billing.invoice.finalized": { title: "Invoice finalised" },
  "billing.invoice.voided": { title: "Invoice voided" },
  "documents.file.quarantined": { title: "File quarantined by scanning" },
  "documents.file.rescanInfected": { title: "Rescan found a file infected" },
  "documents.checkinConflict": {
    title: "Check-in conflict",
    detail: (facts) =>
      text(facts, "divergedFrom") === null ? null : "Another version was checked in first",
  },
  "email.filed": { title: "Email filed to a matter" },
  "system.matter.closed": { title: "Matter closed" },
  "system.matter.reopened": { title: "Matter reopened" },
  "system.matter.held": { title: "Matter placed on hold" },
  "system.matter.released": { title: "Matter released from hold" },
  "conflicts.hit.surfaced": {
    title: "Conflicts check found matches",
    detail: (facts) => {
      const hits = integer(facts, "hitCount");
      if (hits === null) return null;
      const strong = integer(facts, "strongHitCount") ?? 0;
      const total = hits === 1 ? "1 match" : `${String(hits)} matches`;
      // The strong count is the fact that separates "look at this today" from "look at this", so it
      // is stated whenever there is one rather than folded into the total.
      return strong === 0 ? total : `${total}, ${String(strong)} exact`;
    },
  },
  "system.incident.created": {
    title: "Incident raised",
    detail: (facts) => {
      const count = integer(facts, "errorIdCount");
      if (count === null || count === 0) return null;
      return count === 1 ? "1 error reference" : `${String(count)} error references`;
    },
  },
  "calendar.event.scheduled": { title: "Event scheduled" },
  "calendar.event.rescheduled": { title: "Event moved" },
  "calendar.event.cancelled": { title: "Event cancelled" },
  "tasks.task.assigned": { title: "Task assigned to you", detail: taskDetail },
  "tasks.task.reassigned": { title: "Task passed to you", detail: taskDetail },
  "tasks.firmTask.assigned": { title: "Firm task assigned to you", detail: taskDetail },
  "tasks.firmTask.reassigned": { title: "Firm task passed to you", detail: taskDetail },
  "deadlines.deadline.due": { title: "Deadline due" },
  "deadlines.deadline.overdue": { title: "Deadline overdue", detail: overdueBy },
  "custody.review.due": { title: "Custody review due", detail: overdueBy },
  "custody.checkout.overdue": { title: "Custody item overdue back", detail: overdueBy },
  "jobs.documentAssembly.completed": {
    title: "Document assembly finished",
    detail: (facts) => {
      const succeeded = boolean(facts, "succeeded");
      if (succeeded === null) return null;
      return succeeded ? "Completed" : "Did not complete";
    },
  },
  "jobs.recovery.completed": {
    title: "Password recovery finished",
    detail: (facts) => {
      const outcome = text(facts, "outcome");
      return outcome === null ? null : (RECOVERY_OUTCOME_LABEL[outcome] ?? outcome);
    },
  },
});

export interface DescribedNotification {
  /** What happened, in the house voice. Never a title, a name or a filename from the record. */
  readonly title: string;
  /** The facts worth stating beside it, already joined. Null where the kind declares none. */
  readonly detail: string | null;
  /** True where this client has no entry for the kind, so the row is standing on its fallback. */
  readonly fallback: boolean;
}

/**
 * The words for one row. A kind this client does not know still gets a real row — the category's
 * own noun and its glyph — because the alternative is hiding a notification somebody was meant to
 * see behind a client that shipped before its type did.
 */
export function describeNotification(item: NotificationItem): DescribedNotification {
  const presentation = KIND_PRESENTATION[item.kind];
  if (presentation === undefined) {
    return {
      title: `Update on ${CATEGORY_PRESENTATION[item.category].noun}`,
      detail: null,
      fallback: true,
    };
  }
  return {
    title: presentation.title,
    detail: presentation.detail?.(item.facts) ?? null,
    fallback: false,
  };
}

/** The kinds this client has words for — the fitness test's subject, and nothing else reads it. */
export const PRESENTED_KINDS: readonly string[] = Object.freeze(Object.keys(KIND_PRESENTATION));
