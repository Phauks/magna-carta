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

// The query fragment for list endpoints: `cursor` is an optional opaque string (absent on the
// first page; reveals nothing — consistent with the opaque-handle philosophy).
// Routes with filters extend this object; no offset or page parameter ever joins it.
export const cursorQuery = z.object({ cursor: z.string().optional() });
