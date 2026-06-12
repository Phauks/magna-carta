// Cursor pagination (design spec, pagination): every list endpoint returns the uniform
// { data, nextCursor } envelope, paginated by cursor only — never offset (offset double-shows
// or skips rows under concurrent writes). Ported from the Phase 0 spike
// (test/support/api-contract-spike-app.ts keeps its own copy — it guards the library, this
// module is the product).
import { z } from "@hono/zod-openapi";

// The uniform cursor-paginated list envelope. nextCursor is explicit on every page: an opaque
// continuation string when more rows exist, null on the final page — never omitted. Component
// registration is the caller's job (`paginated(Matter).openapi("MatterPage")`), since each list
// endpoint owns its component name.
export function paginated<Item extends z.ZodType>(item: Item) {
  return z.object({ data: z.array(item), nextCursor: z.string().nullable() });
}

// The query fragment for list endpoints: `cursor` is an optional opaque string (absent on the
// first page; reveals nothing — consistent with the opaque-handle philosophy, ADR-0062).
// Routes with filters extend this object; no offset or page parameter ever joins it.
export const cursorQuery = z.object({ cursor: z.string().optional() });
