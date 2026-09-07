// THE visibility seam. Every timeline source's statement builder takes one of these as a REQUIRED
// argument and composes it into the WHERE clause BEFORE the LIMIT.
//
// Required rather than optional-with-a-default on purpose: a source that forgets it is a leak, and a
// required argument makes that mistake a type error first and a fitness-test failure second, rather
// than a review comment nobody makes.
//
// Composed IN SQL and never applied in the Worker after the rows come back. A post-filter would
// under-fill the page (a page of fifty returns eleven), make the next cursor mean something
// different from page to page, and turn the page size into an existence oracle for the rows it
// removed — which is the whole reason filtering happens before ranking rather than after it.
//
// Today the predicate resolves to one clause, and it is doing genuine work rather than standing in
// for future work: it excludes the platform-owned holding matter the custody register creates for
// scans of originals held for somebody with no matter. That is a real row in every firm's database
// and it must never appear on a firm's calendar. When an information-barrier overlay is built, it is
// ONE MORE CLAUSE in this one predicate, and every registered source inherits it without being
// touched.

export interface VisibleMatterPredicate {
  // A SQL fragment over a matter-id expression the source supplies, e.g.
  //   `EXISTS (SELECT 1 FROM matter AS visible_matter WHERE visible_matter.id = matter_event.matter_id AND ...)`.
  // The source hands in the column that names its matter; the predicate decides everything else.
  readonly fragmentFor: (matterIdExpression: string) => string;
  readonly bindings: readonly unknown[];
  // A stable marker every built statement carries, so the fitness test can prove composition
  // without parsing SQL. It is part of the fragment's own text, never a comment appended to it —
  // a comment could be stripped by a formatter while the predicate quietly went missing.
  readonly marker: string;
}

// The marker is the table-and-column reference the predicate always names. A statement that does not
// contain it did not compose the predicate.
export const VISIBLE_MATTER_MARKER = "visible_matter.system_key IS NULL";

/*
 * THE SUBQUERY ALIASES ITS OWN TABLE, AND THAT ALIAS IS A SECURITY CONTROL RATHER THAN A STYLE.
 *
 * The fragment is an EXISTS over `matter`, correlated to an expression the caller supplies. Written
 * against the bare table name, the correlation silently dies whenever the CALLER's own query also
 * has an unaliased `matter` in scope: inside the subquery, `matter` then resolves to the subquery's
 * own copy, the correlation degenerates to `matter.id = matter.id` — true of every row — and the
 * EXISTS is satisfied by any visible matter in the firm rather than by the one being checked. The
 * gate reads as if it is doing its job and is checking nothing.
 *
 * That is not hypothetical: it shipped, in the call and text log's own anchor check, and it was
 * caught by a test asserting the platform-owned holding matter is unreachable rather than by
 * anything looking at the SQL. The marker-based fitness functions could not have caught it — the
 * marker was present, because the predicate WAS composed; it was composed uselessly.
 *
 * Aliasing the subquery's table makes the failure unwritable rather than merely tested for. A
 * caller's `matter` can no longer be shadowed, so an expression naming `matter.id` correlates to
 * the caller's row, which is what every author writing one intends. The alias is deliberately not a
 * name anybody would choose for a table of their own.
 */
const VISIBLE_MATTER_ALIAS = "matter AS visible_matter";

// The firm's visible matters: every matter except the platform-owned holding matters. A firm-wide
// calendar read is a matter-scoped read repeated under this same predicate, so a matter that becomes
// invisible disappears from the firm calendar by construction rather than by a second rule.
export function visibleMatterPredicate(): VisibleMatterPredicate {
  return {
    fragmentFor: (matterIdExpression) =>
      `EXISTS (SELECT 1 FROM ${VISIBLE_MATTER_ALIAS} WHERE visible_matter.id = ${matterIdExpression} AND ${VISIBLE_MATTER_MARKER})`,
    bindings: [],
    marker: VISIBLE_MATTER_MARKER,
  };
}

// Narrows the predicate to a set of matter ids the caller has already resolved — the shape an
// information-barrier overlay takes when it is built, and the shape a test uses to simulate one.
// The extra clause rides INSIDE the same fragment, so a source that composes the predicate at all
// composes the narrowing too.
export function visibleMatterPredicateExcluding(
  excludedMatterIds: readonly string[],
): VisibleMatterPredicate {
  if (excludedMatterIds.length === 0) return visibleMatterPredicate();
  const placeholders = excludedMatterIds.map(() => "?").join(", ");
  return {
    fragmentFor: (matterIdExpression) =>
      `EXISTS (SELECT 1 FROM ${VISIBLE_MATTER_ALIAS} WHERE visible_matter.id = ${matterIdExpression} AND ${VISIBLE_MATTER_MARKER} AND visible_matter.id NOT IN (${placeholders}))`,
    bindings: excludedMatterIds,
    marker: VISIBLE_MATTER_MARKER,
  };
}
