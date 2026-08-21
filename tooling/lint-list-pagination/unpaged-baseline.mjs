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
 *
 * The campaign has since walked all forty-seven, and there was no uniform fix — three answers were
 * needed, and applying any one of them everywhere would have been wrong most of the time. CURSOR-PAGE
 * when the sort key is a column the row carries and the caller can walk the whole record. CAP WITH A
 * SIGNAL when the ordering key is computed per query (a relevance score, an aggregate), when the read
 * answers "what is happening now" rather than "show me everything", or when the sort key is three
 * columns and the platform's opaque cursor carries two. LEAVE WHOLE when structure requires
 * completeness — a folder tree feeding a ZIP builder, an overlap sweep that pairs the rows it holds,
 * a fee that is a sum. Two of the forty-seven turned out not to be pagination problems at all but
 * wrong answers: calendar availability painted a free room over a conflict that spanned its cut, and
 * the auto-file review understated every per-rule count past its cut and dropped a matter entirely.
 */

/** Operation ids that answer with `{ data: [...] }` and no `nextCursor`. Only ever remove from this. */
export const UNPAGED_LIST_OPERATIONS = ["custody.listReminders"];

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
    "one of the three callers is the ZIP builder in apps/worker/src/routes/downloads.ts, which " +
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
  "custody.listSightings":
    "Capped at the caller's `limit` in readCustodyStocktakeSightings " +
    "(packages/custodian/src/stocktake-statements.ts), with the response's `capped` flag saying " +
    "when the count recorded more observations than were returned. Not cursor-paged: the order is " +
    "(observed_at, recorded_at, id), a three-column key the platform's two-part opaque cursor " +
    "cannot carry, and `recorded_at` is load-bearing — a correction shares the physical instant of " +
    "the observation it supersedes, and the reconciliation reads this statement newest-first and " +
    "keeps the first row per packet.",
  "matterAssets.listValuations":
    "Capped at the caller's `limit` in readMatterAssetValuations " +
    "(packages/matter-assets/src/valuation-statements.ts), with the response's `capped` flag saying " +
    "when the asset holds more assertions. Not cursor-paged for the same reason the sightings read " +
    "is not: the order is (as_of_date, recorded_at, id), and `as_of_date` is a civil date, so an " +
    "appraisal and a tax assessment as of the same day are ordinary and `recorded_at` is what puts " +
    "a correction after the figure it corrects.",
  "narrativeTemplates.recentNarratives":
    "Capped at the caller's `limit` (max 50 on the request schema) in readRecentNarratives " +
    "(packages/timekeeping/src/narrative-template-statements.ts), with the response's `capped` flag " +
    "saying when the timekeeper has written more distinct narratives. Not cursor-paged: the " +
    "ordering key is MAX(work_date), an aggregate the query computes over the group rather than a " +
    "column any row carries — and nothing pages an autocomplete.",
  "matters.listAssignments":
    "Capped at MAX_MATTER_ASSIGNMENTS in listMatterAssignments " +
    "(packages/matters/src/matter-assignment.ts), with the response's `capped` flag saying when the " +
    "matter carries more staffing windows. Not paged: the order is (assignment_role, created_at, " +
    "id), three columns where the opaque cursor carries two, and both callers want the windows " +
    "together — the merge engine picks the row covering one instant, which it can only do over the " +
    "whole set.",
  "emails.listCaptureAddresses":
    "Capped at MAX_MATTER_CAPTURE_ADDRESSES in readMatterCaptureAddresses " +
    "(packages/data-access/src/email-filing-statements.ts), with the response's `capped` flag " +
    "saying when the matter holds more. A rotation retires the old row rather than deleting it, so " +
    "the list grows with rotations rather than being bounded by the schema " +
    "(email_capture_address is unique on the token, not on (matter, live)) — and the screen exists " +
    "to answer which address is in service and what became of the others, neither of which a page " +
    "answers.",
  "emails.listAutoFileRules":
    "Capped at MATTER_RULE_LIMIT in the route (apps/worker/src/routes/auto-file-rules.ts), applied " +
    "by readAutoFileRulesForMatter (packages/data-access/src/email-auto-file-statements.ts), which " +
    "reads one past it so the response's `capped` flag can say when the matter carries more. Not " +
    "paged: these are the standing instructions to file mail unattended, judged as a set, and a " +
    "rule past the cut is one nobody withdrew because nobody saw it.",
  "emails.autoFileDecisions":
    "Capped at MESSAGE_DECISION_LIMIT in the route (apps/worker/src/routes/auto-file-rules.ts), " +
    "applied by readAutoFileDecisionsForMessage " +
    "(packages/data-access/src/email-auto-file-statements.ts), which reads one past it so the " +
    "response's `capped` flag can say when more decisions were recorded. The list is not bounded by " +
    "the matter's rule count — a message re-evaluated after its rules changed accumulates a " +
    "decision per pass — so the flag is what keeps the most recent pass from reading as the whole " +
    "account.",
  "emails.autoFileReview":
    "Bounded by REVIEW_MATTER_LIMIT on the matter set (apps/worker/src/routes/auto-file-rules.ts), " +
    "taken from the RULES table by readAutoFileRuleMatterIds rather than from the links, and the " +
    "per-rule counts are then computed in SQL by readAutomaticRuleTallies over the matters that " +
    "survived the access wall (packages/data-access/src/email-auto-file-statements.ts). Deliberately " +
    "not paged: a cursor over a set the wall can shrink hands out short pages and calls it the end " +
    "of the list. The counts used to be tallied in application code from a capped page of links, " +
    "which understated every count and dropped a matter whose links all fell past the cut.",
  "documentTypes.list":
    "The firm's own document-type vocabulary, read by the shared classification-type route factory " +
    "(apps/worker/src/routes/classification-type-routes.ts) straight off document_type. It grows " +
    "when a person adds a kind of document the firm files, never with the firm's activity — a type " +
    "is deactivated and never deleted, so the ceiling is the vocabulary a firm has ever used.",
  "matterTypes.list":
    "The firm's own matter-type vocabulary, read by the same shared factory " +
    "(apps/worker/src/routes/classification-type-routes.ts) off matter_type, on the same terms as " +
    "documentTypes.list — configured by hand, one row per kind of matter the firm takes.",
  "rateCards.list":
    "The firm's rate cards, read by listRateCardsStatement " +
    "(packages/timekeeping/src/rate-statements.ts) with archived rows filtered out. A rate card is " +
    "a named schedule a person creates, not a record of work — the rates UNDER a card are the many, " +
    "and they are a different read.",
  "utbmsCodes.list":
    "One published ABA code set, read by listUtbmsCodesBySetStatement " +
    "(packages/timekeeping/src/utbms-statements.ts) filtered to the requested code_set. The bound " +
    "is the standard itself: the rows come from utbmsSeedData in " +
    "packages/timekeeping/src/utbms-catalog.ts, and a firm enables or disables a code rather than " +
    "adding one.",
  "nonBillableCategories.list":
    "The firm's non-billable categories, read by listNonBillableCategoriesStatement " +
    "(packages/timekeeping/src/non-billable-category-statements.ts) with archived rows filtered " +
    "out — the same settings-catalog shape as the rate cards beside it.",
  "narrativeTemplates.list":
    "The firm's canonical narrative snippets, read by listNarrativeTemplatesStatement " +
    "(packages/timekeeping/src/narrative-template-statements.ts) with archived rows filtered out. " +
    "A template is written by a person to be picked from a list; the timekeeper's own narrative " +
    "HISTORY is the one that grows with activity, and it is a separate read that caps with a signal.",
  "locations.list":
    "The firm's offices, read straight off the location table in the route handler " +
    "(apps/worker/src/routes/locations.ts). Bounded by the physical thing it models: a firm has " +
    "offices, and an office is opened and closed by a person. Custodian's container tree — shelves " +
    "and safes inside those offices — is a different table and a different read.",
  "matterAssets.listAssetClasses":
    "The platform's closed class registry, MATTER_ASSET_CLASS_REGISTRY in " +
    "packages/matter-assets/src/classes.ts. It is a compile-time constant and the handler reads no " +
    "database at all — the list can only change when the platform ships a new class.",
  "matterAssets.listAssetTypes":
    "The firm's own type catalog UNDER those classes, read by readMatterAssetTypes " +
    "(packages/matter-assets/src/asset-type-statements.ts) and optionally narrowed to one class. A " +
    "type is deactivated and never deleted, and it is configured by hand — the same settings-catalog " +
    "shape as custody.listItemTypes and calendar.listEventTypes.",
  "customFields.listRecordValues":
    "One current row per custom field configured for that target, so the firm's own field catalog " +
    "is the bound — readCurrentValues in packages/custom-fields/src/reads.ts filters to the " +
    "current row. The field's HISTORY is the unbounded one, and that read pages.",
};
