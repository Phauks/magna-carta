/*
 * The list endpoints that answer with a bare array and no cursor, as of the day this gate was added.
 *
 * The platform HAS a pagination contract, and its own module says so: "every list query returns the
 * uniform cursor-paginated envelope (cursor-based, never offset)". Forty-seven endpoints did not,
 * and nothing said so, because nothing was checking. Two of them — a matter's costs and a matter's
 * time — read a record that grows for as long as the matter runs, with no LIMIT at any layer; those
 * two are fixed and are absent from this list.
 *
 * This is a SHRINK-ONLY baseline, not an approval. Nothing here is asserted to be safe. Some of these
 * read a firm-configured vocabulary and are bounded by construction; others read a table that grows
 * with the firm's activity and are the same defect the two fixed ones were. Telling those apart means
 * tracing each route to the statement behind it, which is the campaign this list exists to make
 * finite and visible. An entry leaves by being either paginated or verified bounded and moved to
 * BOUNDED_BY_CONSTRUCTION below with the reason; the gate refuses a list that has grown.
 */

/** Operation ids that answer with `{ data: [...] }` and no `nextCursor`. Only ever remove from this. */
export const UNPAGED_LIST_OPERATIONS = [
  "custody.listReminders",
  "custody.listSightings",
  "documentTypes.list",
  "emails.autoFileDecisions",
  "emails.autoFileReview",
  "emails.listAutoFileRules",
  "emails.listCaptureAddresses",
  "locations.list",
  "matterAssets.listAssetClasses",
  "matterAssets.listAssetTypes",
  "matterAssets.listValuations",
  "matterTypes.list",
  "matters.listAssignments",
  "narrativeTemplates.list",
  "narrativeTemplates.recentNarratives",
  "nonBillableCategories.list",
  "rateCards.list",
  "utbmsCodes.list",
];

/**
 * Endpoints whose answer is bounded by something other than a page size, with what bounds it. An
 * entry here is a CLAIM about the read, and the claim must be checkable at the named place — never
 * "it is probably small".
 */
export const BOUNDED_BY_CONSTRUCTION = {
  "directory.search":
    "Capped at NAME_SEARCH_LIMIT in packages/directory/src/search.ts, and the response's `capped` " +
    "flag says when the firm holds more. Not cursor-paged on purpose: the ordering key is bm25, a " +
    "score recomputed per query rather than a column the row carries, so a keyset over it would " +
    "page by a value that does not exist in the table.",
  "folders.list":
    "A matter's folder tree is flat and small — the load profile models 2 to 6 folders per matter " +
    "(foldersPerMatter in packages/fixtures/src/load-profile/profile.ts). Deliberately NOT paged: " +
    "one of the three callers is the ZIP builder in apps/api-worker/src/routes/downloads.ts, which " +
    "needs the whole tree to resolve paths, and half a tree is not a tree.",
  "custody.listStocktakes":
    "Capped at the caller's `limit` in readCustodyStocktakes " +
    "(packages/custodian/src/stocktake-statements.ts), which fetches one row past it so the " +
    "response's `capped` flag can say when the firm has counted more. Not cursor-paged on purpose: " +
    "this list answers which count is running now and what the last one found, and nothing walks a " +
    "decade of counts backwards.",
  "custody.listItemTypes":
    "The firm's own item-type vocabulary — configured by hand, read from custody_item_type, and " +
    "the same shape as every other settings catalog here. It grows when a person adds a kind of " +
    "thing the firm holds, never with the register's activity.",
  "custody.listLocations":
    "The container tree, and it must stay whole for the same reason a matter's folder tree does: " +
    "the callers resolve a packet's shelf to a path through its ancestors, and half a tree resolves " +
    "to a wrong path rather than to a short one. Bounded by the physical thing it models — a firm " +
    "has offices, safes, and shelves, not a row per packet.",
  "custody.reportHoldingsByOwner":
    "Capped at the caller's `limit` in readCustodyHoldingsByOwner " +
    "(packages/custodian/src/reports.ts), with the response's `capped` flag saying when the firm " +
    "holds for more owners than the answer names. Not cursor-paged on purpose: the ordering key is " +
    "`packets_held DESC`, a count the query computes rather than a column any row carries, so a " +
    "keyset over it would page by a value that does not exist in the table.",
  "custody.reportHoldingsByLocation":
    "One row per node of the location tree, so it is bounded by the same physical thing " +
    "custody.listLocations is, and it is read as an occupancy picture of the whole register — a " +
    "page of it would be a picture of part of a building.",
  "discovery.getReviewSetAccess":
    "One row per member who may reach the corpus, and the schema will not hold two: " +
    "review_set_access_member_unique_index in packages/database/src/per-firm-schema.ts is unique on " +
    "(review_set_id, member_user_id). The bound is the firm's own headcount, and a list that never " +
    "reaches empty is one whose whole point is to be read entire.",
  "discovery.getDocumentCoding":
    "The LIVE coding on one document — selectDocumentCodingStatement in " +
    "packages/discovery/src/coding-statements.ts filters to removed_at IS NULL, and " +
    "review_document_tag_live_unique_index holds one live row per tag per document. The bound is " +
    "the review set's own tag catalog, which a person configures. The document's HISTORY is the " +
    "unbounded one; it is a separate read.",
  "billing.listDeliveries":
    "Capped at DEFAULT_PAGE_SIZE in readInvoiceDeliveries " +
    "(packages/billing/src/statements.ts), with the response's `capped` flag saying when the bill " +
    "carries more attempts. Not cursor-paged: the order is (delivery_date, recorded_at, id), a " +
    "three-column key the platform's two-part opaque cursor cannot carry, and dropping " +
    "`recorded_at` would scramble same-day attempts into identifier order. The response leads with " +
    "readInvoiceDeliveryState, which answers whether the bill was delivered from aggregates " +
    "without reading this list at all.",
  "calendar.resourceAvailability":
    "Bounded by the WINDOW, which the route requires and caps at MAX_CALENDAR_WINDOW_DAYS " +
    "(packages/calendar/src/types.ts). Deliberately not paged, and this one is not a preference: " +
    "readResourceAvailability in packages/calendar/src/booking-service.ts pairs overlapping " +
    "bookings over the rows it holds, so a booking past a page boundary that overlaps one inside " +
    "it would be a conflict the grid never paints. Past MAX_AVAILABILITY_BOOKINGS the read REFUSES " +
    "rather than truncating, because the answer would be wrong rather than short.",
  "calendar.listResources":
    "Capped at MAX_FIRM_RESOURCES in readFirmResources " +
    "(packages/calendar/src/resource-statements.ts), with the response's `capped` flag saying when " +
    "the firm holds more. The bound is the catalog itself — rooms, vehicles and equipment a firm " +
    "physically owns and a person configures one at a time. Not paged: this is the picker, and a " +
    "picker missing a room says the room does not exist.",
  "calendar.listEventTypes":
    "The firm's event-type vocabulary: the platform seed plus whatever the firm has added, read " +
    "from matter_event_type. It grows when a person adds a kind of event the firm records, never " +
    "with the calendar's activity — the same shape as every other settings catalog here.",
  "calendar.continuanceChain":
    "One hearing's settings, walked in both directions and bounded by MAX_CONTINUANCE_CHAIN_DEPTH " +
    "(packages/calendar/src/types.ts): readContinuanceChain calls assertChainDepth on every step " +
    "and throws past it, because a chain longer than that is corrupt rather than continued. The " +
    "chain must also stay whole — it is the procedural history of one hearing, and half of it is a " +
    "different account of what happened.",
  "customFields.listRecordValues":
    "One current row per custom field configured for that target, so the firm's own field catalog " +
    "is the bound — readCurrentValues in packages/custom-fields/src/reads.ts filters to the " +
    "current row. The field's HISTORY is the unbounded one, and that read pages.",
};
