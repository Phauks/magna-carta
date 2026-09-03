/*
 * What a calendar is a calendar OF.
 *
 * The one calendar component is embedded everywhere the product needs a calendar, and the only
 * thing that differs between those places is the scope: the whole firm, one member's own day, one
 * matter. A scope is a closed union so that each one maps to exactly one read plan
 * (calendar-reads.ts) written once, and a host that embeds the component states which it wants
 * rather than assembling reads of its own.
 *
 * Which matter is ADDRESSABLE state and lives in the path, so a matter scope arrives from the page
 * that already resolved the matter. Mine versus everyone is a refinement of the firm scope and
 * lives in the query string, which is why `mine` carries the member rather than reading a session.
 */

export type CalendarScope =
  /** Every matter the member can see, and the firm's own events. */
  | { readonly kind: "firm" }
  /** The firm scope narrowed to what is on this member's calendar: a participant, the responsible member, or an all-members audience. */
  | { readonly kind: "mine"; readonly memberId: string }
  /** One matter's events and deadlines. */
  | { readonly kind: "matter"; readonly matterId: string }
  /** One bookable resource's schedule: the live bookings on it, conflicts pre-paired by the read. */
  | { readonly kind: "resource"; readonly resourceId: string };

/** A stable key for a scope, so a read keyed on it is told from a read of a different scope. */
export function scopeKey(scope: CalendarScope): string {
  switch (scope.kind) {
    case "firm":
      return "firm";
    case "mine":
      return `mine:${scope.memberId}`;
    case "matter":
      return `matter:${scope.matterId}`;
    case "resource":
      return `resource:${scope.resourceId}`;
  }
}

/** The scope's own word, for an accessible name or an empty statement. */
export function describeScope(scope: CalendarScope): string {
  switch (scope.kind) {
    case "firm":
      return "Everyone";
    case "mine":
      return "Mine";
    case "matter":
      return "This matter";
    case "resource":
      return "This resource";
  }
}

/** True when the scope is one the firm-side toggles (Mine, Everyone, a colleague, the layers) apply to. */
export function isFirmSideScope(scope: CalendarScope): boolean {
  return scope.kind === "firm" || scope.kind === "mine";
}

/** True when the scope names one matter, so a chip can drop the matter number it would repeat. */
export function isMatterScope(scope: CalendarScope): scope is { kind: "matter"; matterId: string } {
  return scope.kind === "matter";
}
