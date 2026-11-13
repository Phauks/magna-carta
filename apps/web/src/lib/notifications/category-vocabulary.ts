/*
 * The notification vocabulary as this surface reads it: the categories, what each one MEANS to a
 * member deciding whether to hear it, and what the two channels' choices are called.
 *
 * WRITTEN OUT HERE RATHER THAN IMPORTED, and deliberately. apps/web mirrors the API contract by
 * hand — the convention stated in $lib/api/request.ts, which is why no surface here depends on
 * @magna-carta/api-client or on a domain package. Reaching for `@magna-carta/notifications` for
 * these twelve words looks like the tidier answer and is not: the package's dependency closure is
 * most of the backend, and pulling it into the web app changes the shape of the graph the gate
 * computes its lint scope from (tooling/affected-lint/scope-fitness.mjs fails on exactly that).
 * The categories are an enum on the wire; this file is what they are called and what they carry.
 *
 * The page never derives the list from here. Every row it renders comes from the server's resolved
 * answer, in the server's order; these are the words hung on whatever it sends, so a category added
 * to the platform appears the day it ships rather than the day this file is edited.
 */

/** Every category the platform notifies about — the wire vocabulary, mirrored. */
export const NOTIFICATION_CATEGORIES = [
  "deadlines",
  "calendar",
  "tasks",
  "trust",
  "billing",
  "documents",
  "custody",
  "email",
  "conflicts",
  "jobs",
  "security",
  "system",
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/**
 * In app, a member's choice is on or off. Off means NO FEED ROW IS WRITTEN rather than a row that
 * is hidden — which is why the page can report what a choice held back, and why it is worth
 * reporting.
 */
export type NotificationInAppChoice = "on" | "off";

/**
 * Email is digest-only, which is why these are periods and not an "as it happens": a message per
 * event is a mail-bomb on any active matter, and it discloses the timing and volume of activity on
 * a matter even when each line says nothing about it.
 */
export type NotificationEmailCadence = "off" | "daily" | "weekly";

/**
 * The reader-facing name of each category. The digest mail names the same categories from its own
 * side of the wire (packages/notifications/src/digest-render.ts) — these two say the same words on
 * purpose, and a category renamed for a reader is renamed in both.
 */
const CATEGORY_LABELS: Readonly<Record<NotificationCategory, string>> = Object.freeze({
  deadlines: "Deadlines",
  calendar: "Calendar",
  tasks: "Tasks",
  trust: "Trust",
  billing: "Billing",
  documents: "Documents",
  custody: "Custody",
  email: "Email",
  conflicts: "Conflicts",
  jobs: "Jobs",
  security: "Security",
  system: "System",
});

/**
 * The one line under the name. A category list is unusable without it — "Jobs" and "System" are
 * indistinguishable to somebody who has not read the registry — and the lines say what ARRIVES
 * rather than what the subsystem is, because the question being asked is "what will I stop seeing".
 */
const CATEGORY_DESCRIPTIONS: Readonly<Record<NotificationCategory, string>> = Object.freeze({
  deadlines: "Court and rule deadlines coming due, and deadlines met or vacated.",
  calendar: "Hearings and settings put in the diary, moved, or cancelled.",
  tasks: "Work assigned to you, and your work that someone completed or reopened.",
  trust: "Client money in and out, holds placed and released, and what a reconciliation found.",
  billing: "Invoices drafted, finalized and delivered, and the money that came back against them.",
  documents: "Files added to your matters, new versions, and check-outs not returned.",
  custody: "Originals the firm holds moving in or out, and holds placed on them.",
  email: "Mail captured to a matter, and mail that arrived for one nobody has filed yet.",
  conflicts: "Conflicts checks with hits, and hits that were answered.",
  jobs: "Long-running work you started finishing: a conversion, a bundle, an export, a report.",
  security: "Sign-ins, support access, and changes to what people in the firm may do.",
  system: "Magna Carta itself: maintenance, outages, and work it couldn't finish.",
});

/** A category's name, or the raw key for one this build does not carry — never nothing. */
export function notificationCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category as NotificationCategory] ?? category;
}

/** A category's one line, or empty for one this build does not carry. */
export function notificationCategoryDescription(category: string): string {
  return CATEGORY_DESCRIPTIONS[category as NotificationCategory] ?? "";
}

/**
 * What the email cadences are called. `off` reads as a real choice rather than an empty select,
 * because a member who wants no mail has chosen something rather than failed to choose.
 */
export const EMAIL_CADENCE_OPTIONS: readonly { value: NotificationEmailCadence; label: string }[] =
  Object.freeze([
    { value: "off", label: "No email" },
    { value: "daily", label: "Daily summary" },
    { value: "weekly", label: "Weekly summary" },
  ]);
