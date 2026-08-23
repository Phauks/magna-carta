// Cursor pagination: every list endpoint returns the uniform { data, nextCursor } envelope,
// paginated by cursor only — never offset (offset double-shows or skips rows under concurrent
// writes).
import { z } from "@hono/zod-openapi";

// The uniform cursor-paginated list envelope. nextCursor is explicit on every page: an opaque
// continuation string when more rows exist, null on the final page — never omitted. Component
// registration is the caller's job (`paginated(Matter).openapi("MatterPage")`); each list endpoint
// names its own component. Uniqueness of that name is the CALLER'S responsibility: zod-to-openapi
// 8.5.0 does not throw on a duplicate component-name registration — it silently overwrites the
// earlier entry under the same `#/components/schemas/<name>` key (verified in buildComponents).
// The collision is caught by the conformance fitness function over the emitted document, not by
// the library.
export function paginated<Item extends z.ZodType>(item: Item) {
  return z.object({ data: z.array(item), nextCursor: z.string().nullable() });
}

/**
 * The envelope for a list that is CAPPED rather than paged: the best or most recent N, with `capped`
 * saying whether the firm holds more than were returned.
 *
 * A cursor is the right answer when a caller can walk the whole record and the sort key is a column
 * the row carries. It is the wrong answer twice over: when the ordering key is COMPUTED per query
 * (a search relevance score, an aggregate count) so a keyset would page by a value no row holds, and
 * when the read exists to answer "what is happening now" rather than "show me everything".
 *
 * What is never acceptable is cutting the answer silently. `capped` is the difference between "there
 * are no more" and "we stopped counting", which are otherwise indistinguishable to a caller.
 */
export function capped<Item extends z.ZodType>(item: Item) {
  return z.object({ data: z.array(item), capped: z.boolean() });
}

// The query fragment for list endpoints: `cursor` is an optional opaque string (absent on the
// first page; reveals nothing — consistent with the opaque-handle philosophy).
// Routes with filters extend this object; no offset or page parameter ever joins it.
export const cursorQuery = z.object({ cursor: z.string().optional() });
