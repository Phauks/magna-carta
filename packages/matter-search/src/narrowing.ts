import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { VisibleMatterPredicate } from "@magna-carta/calendar/visibility";

// A search across matters, narrowed by its reader: to their own matters, or to one client's.
//
// A NARROWING ONLY TAKES AWAY. It is composed INSIDE the visible-matter predicate's own condition,
// joined to it with AND, so the reach of a narrowed search is what the reader may see and chose,
// and can never be more than what they may see. Nothing here widens a search, and nothing here
// reads a request: the caller builds the narrowing from the session and from what the route
// validated, and hands it over as SQL with its bindings.
//
// The shape is the one @magna-carta/matters writes its narrowings in (matter-narrowing.ts there
// is the home of what "my matters" and "a client's matters" mean). It is declared here as well
// because this package takes any narrowing of that shape and names none.
export interface MatterNarrowing {
  readonly fragmentFor: (matterIdExpression: string) => string;
  readonly bindings: readonly unknown[];
}

// The predicate a narrowed search composes in place of the plain one. It is still a visible-matter
// predicate, carrying the same marker, so every builder and every fitness check that holds a
// statement to the predicate holds a narrowed statement to it too.
export function narrowedVisibility(
  visibility: VisibleMatterPredicate,
  narrowing: MatterNarrowing,
): VisibleMatterPredicate {
  return {
    fragmentFor: (matterIdExpression) =>
      `(${visibility.fragmentFor(matterIdExpression)} AND ${narrowing.fragmentFor(matterIdExpression)})`,
    bindings: [...visibility.bindings, ...narrowing.bindings],
    marker: visibility.marker,
  };
}

// The matters a narrowed search reaches, up to `limit` of them, for the one use run-across-matters
// has for the list: naming them to the record index so its work, and its cap, are over those
// matters' records and not the firm's. The list is never the access check. Every statement that
// reads a record still composes the narrowed predicate over its own row.
export function narrowedMatterIdsStatement(
  database: SqlDatabase,
  narrowed: VisibleMatterPredicate,
  limit: number,
): SqlStatement {
  return database
    .prepare(
      `SELECT narrowed_matter.id AS id FROM matter AS narrowed_matter ` +
        `WHERE ${narrowed.fragmentFor("narrowed_matter.id")} LIMIT ?`,
    )
    .bind(...narrowed.bindings, limit);
}
