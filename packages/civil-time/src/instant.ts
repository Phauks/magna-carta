/*
 * WHAT A STORED INSTANT IS — a moment in absolute time, as the platform writes it down.
 *
 * Exactly what `Date.prototype.toISOString` emits: a fixed three-digit fraction and a literal `Z`.
 * Not "any ISO-8601 string". The shape is narrow on purpose, and the reason is the federated
 * chronology in packages/calendar — it compares sort keys AS TEXT, and only canonical instants sort
 * chronologically that way. `2026-09-08T12:00:00Z` and `2026-09-08T12:00:00.000Z` are the same moment
 * and sort differently; one row in the wrong shape puts a hearing in the wrong place in a timeline.
 *
 * The shape had six copies before this one — the calendar's, the notification grammar's, the
 * reporting package's, two route modules' and a screen's — every one of them the same literal, each
 * free to be loosened by whoever next hit a value that did not match.
 *
 * How an instant READS to a person is not this: that is the design system's
 * `formatters/instant.ts`, which renders in the viewer's own zone and bans elapsed time.
 */

/** A canonical UTC instant, as `Date.prototype.toISOString` writes one. */
export type CanonicalInstant = string;

/**
 * The one stored-instant shape in the platform. No flags — see the note on `CIVIL_DATE_PATTERN`.
 */
export const CANONICAL_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Whether a value is written in the canonical shape. */
export function isCanonicalInstant(value: unknown): value is CanonicalInstant {
  return typeof value === "string" && CANONICAL_INSTANT_PATTERN.test(value);
}

/** A moment written in the canonical shape. The one way the platform stamps a row. */
export function canonicalInstant(at: Date | number = Date.now()): CanonicalInstant {
  return (typeof at === "number" ? new Date(at) : at).toISOString();
}
