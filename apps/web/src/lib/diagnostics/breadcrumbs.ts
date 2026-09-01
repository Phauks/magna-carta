/*
 * The breadcrumb ring buffer — the last few things that happened, so a report says what led up to
 * the failure instead of only naming it.
 *
 * WHAT GOES IN IS A SHAPE, NOT A VALUE. A breadcrumb records that a navigation happened and to which
 * route, that a call was made and to which path, that a dialog opened and which one. It never
 * records what was typed, what a document is called, who a party is, or what a field contains.
 * Redact by default is a golden rule (docs/conventions/error-logging.md), and the way this file
 * keeps it is structural: `record` takes a category and a short label, there is no slot for a
 * payload, and the label is capped and stripped of anything that reads like an email address before
 * it is stored.
 *
 * The stored shape mirrors what the incident route accepts (`{ at, action, route }`, capped at
 * fifty) so nothing has to be reshaped at send time and no cap can be discovered by a 422 in front
 * of a member who is already having a bad morning.
 *
 * In memory only, never persisted, and never sent anywhere on its own — a report carries it, and a
 * report is user-initiated.
 */

/** What kind of thing happened. A closed set: a new category is a deliberate addition, not a string. */
export type BreadcrumbCategory = "navigation" | "request" | "action" | "failure";

export interface Breadcrumb {
  readonly at: string;
  readonly category: BreadcrumbCategory;
  /** A short, shape-only description: a route, a request line, a control name. */
  readonly label: string;
  /** Where in the app it happened. */
  readonly route: string;
}

/**
 * How many are kept. Enough to show the path into a failure, few enough that a report stays small
 * and that nothing lingers from a session's earlier, unrelated work. The incident route accepts
 * fifty; keeping well under it means a full buffer is never the thing that fails a report.
 */
export const BREADCRUMB_CAPACITY = 24;

/**
 * The caps the incident route enforces on each field (`action` 120, `route` 200). Applied here so a
 * long value is trimmed where it is recorded rather than rejected where it is sent.
 */
const ACTION_MAX_LENGTH = 120;
const ROUTE_MAX_LENGTH = 200;

const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/g;

/**
 * Reduce a value to something safe to store. An email address is the one piece of personal data that
 * reliably turns up in a route or a control name by accident, so it is replaced rather than trusted;
 * everything else is collapsed and capped.
 */
function sanitize(value: string, maxLength: number): string {
  const withoutEmails = value.replace(EMAIL_PATTERN, "[redacted]");
  const collapsed = withoutEmails.replace(/\s+/g, " ").trim();
  return collapsed.length > maxLength ? `${collapsed.slice(0, maxLength - 1)}…` : collapsed;
}

function currentRoute(): string {
  return typeof window === "undefined" ? "(unknown)" : window.location.pathname;
}

const trail: Breadcrumb[] = [];

/** Record one breadcrumb. Cheap and non-throwing: a diagnostics aid must never break a screen. */
export function record(category: BreadcrumbCategory, label: string, route?: string): void {
  // The category is part of the action text the route stores, so the label is capped against what
  // is left of the field rather than the whole of it.
  const clean = sanitize(label, ACTION_MAX_LENGTH - category.length - 2);
  if (clean.length === 0) return;
  trail.push({
    at: new Date().toISOString(),
    category,
    label: clean,
    route: sanitize(route ?? currentRoute(), ROUTE_MAX_LENGTH),
  });
  if (trail.length > BREADCRUMB_CAPACITY) trail.splice(0, trail.length - BREADCRUMB_CAPACITY);
}

/** The trail, oldest first, as a copy nobody can mutate from the outside. */
export function breadcrumbs(): readonly Breadcrumb[] {
  return [...trail];
}

/** Drop everything. Used when a person signs out, so one session's trail never reaches the next. */
export function clearBreadcrumbs(): void {
  trail.length = 0;
}

/** One breadcrumb in the shape the incident route accepts. */
export interface BreadcrumbPayload {
  readonly at: string;
  readonly action: string;
  readonly route: string;
}

/** The trail as the incident route takes it, oldest first. */
export function breadcrumbPayload(): BreadcrumbPayload[] {
  return trail.map((crumb) => ({
    at: crumb.at,
    action: `${crumb.category}: ${crumb.label}`,
    route: crumb.route,
  }));
}
