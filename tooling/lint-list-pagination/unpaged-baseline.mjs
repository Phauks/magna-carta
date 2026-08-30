/*
 * The list endpoints that answer with a bare array and no cursor.
 *
 * The platform HAS a pagination contract, and its own module says so: "every list query returns the
 * uniform cursor-paginated envelope (cursor-based, never offset)". Forty-seven endpoints did not,
 * and nothing said so, because nothing was checking. THE CARRIED-OVER LIST IS NOW EMPTY: every one
 * of the forty-seven was either paginated or traced to its statement and recorded below with what
 * bounds it.
 *
 * The empty array is not the end of the rule, it is the rule at rest. A new list endpoint that
 * answers with an array and no cursor lands in `added` and is refused, and the only two ways out
 * are the two that were used to empty this: page it, or write a claim under
 * BOUNDED_BY_CONSTRUCTION that a reader can check at a named place.
 */

/** Operation ids that answer with `{ data: [...] }` and no `nextCursor`. Only ever remove from this. */
export const UNPAGED_LIST_OPERATIONS = [];

/**
 * Endpoints whose answer is bounded by something other than a page size, with what bounds it. An
 * entry here is a CLAIM about the read, and the claim must be checkable at the named place — never
 * "it is probably small".
 */
export const BOUNDED_BY_CONSTRUCTION = {
  // --- The firm's own configured vocabularies -------------------------------------------------
  //
  // Six tables with the same shape and the same argument, so the claim is the same one six times:
  // a row appears when a PERSON adds a kind of thing the firm works with, through a route behind a
  // manage permission, and by no other path. Each table has exactly ONE insert statement in the
  // workspace, named below, and none of them is reachable from a queue consumer, a cron sweep, an
  // import, or the ingest pipeline — which is what separates a vocabulary from a record. A
  // vocabulary grows with the firm's decisions and stops; a record grows with the firm's activity
  // and does not.
  "matterTypes.list":
    "The firm's matter-type vocabulary. Rows come only from the create route of the shared " +
    "classification-type factory (apps/api-worker/src/routes/classification-type-routes.ts), " +
    "which is behind matters:manageTypes and writes through the single insert statement in " +
    "packages/matters/src/matter-type-statements.ts. A type is deactivated, never deleted, so the " +
    "row count is the number of kinds of matter the firm has ever decided it runs.",
  "documentTypes.list":
    "The firm's document-type vocabulary, through the SAME factory as matterTypes.list and with " +
    "the same bound — one insert statement, in " +
    "packages/file-manager/src/document-type-statements.ts, reached only from that factory's " +
    "create route.",
  "matterAssets.listAssetTypes":
    "The firm's asset-type catalog. One insert statement " +
    "(insertMatterAssetTypeStatement in packages/matter-assets/src/asset-type-statements.ts), " +
    "reached from the manage route; a type is deactivated rather than deleted so every asset " +
    "filed under one keeps its meaning. Grouped under the fixed class registry below, which is " +
    "what keeps the catalog a picker rather than a listing.",
  "locations.list":
    "The firm's offices. Bounded by the physical thing it models, the way custody.listLocations " +
    "is: rows come only from locations.create (permission-gated in " +
    "apps/api-worker/src/routes/locations.ts), and a firm opens offices one at a time. Read " +
    "whole on purpose — a matter's number is scoped to its location, so a picker missing an " +
    "office says the office does not exist.",
  "rateCards.list":
    "The firm's rate cards, archived ones excluded (listRateCardsStatement in " +
    "packages/timekeeping/src/rate-statements.ts). One insert statement in that same module, " +
    "reached from the manage route. A card is a pricing decision a person makes; the RATES on a " +
    "card are the row set that grows, and they are a separate read.",
  "nonBillableCategories.list":
    "The firm's non-billable categories, archived ones excluded " +
    "(listNonBillableCategoriesStatement in " +
    "packages/timekeeping/src/non-billable-category-statements.ts). One insert statement in that " +
    "module, reached from the manage route. It is the picker on the time-entry form.",
  "narrativeTemplates.list":
    "The firm's narrative template library, archived ones excluded " +
    "(listNarrativeTemplatesStatement in " +
    "packages/timekeeping/src/narrative-template-statements.ts). One insert statement in that " +
    "module, reached from the manage route — a template is written by a person, never derived " +
    "from the time entries that use it.",

  // --- The firm's own people --------------------------------------------------------------------
  "members.list":
    "The firm's member roster, bounded by its HEADCOUNT rather than by its activity — the same " +
    "distinction the vocabularies above turn on, and checkable in the same way. The `member` " +
    "table has exactly ONE insert statement in the workspace (insertMemberStatement in " +
    "packages/data-access/src/member-statements.ts), reached from exactly one queue consumer " +
    "(apps/api-worker/src/member-provision-consumer.ts, topic member.provision), whose only " +
    "producers are the invite route, firm provisioning and onboarding — three deliberate acts of " +
    "adding a PERSON to the firm. No ingest path, cron sweep or import writes a member row, which " +
    "is what would make this grow with what the firm does rather than with who it employs. Read " +
    "whole on purpose: a listing resolving responsible-attorney names needs the whole lookup " +
    "before it can render any row honestly, and a half-read roster prints blanks that read as " +
    "missing data.",

  // --- Fixed catalogs the firm cannot add to ---------------------------------------------------
  "matterAssets.listAssetClasses":
    "A CONSTANT, not a query: the handler maps MATTER_ASSET_CLASS_REGISTRY " +
    "(packages/matter-assets/src/classes.ts, twelve declarations) and touches no database at " +
    "all. The classes are the platform's, not the firm's — a firm extends the type catalog " +
    "underneath them instead.",
  "utbmsCodes.list":
    "One ABA code set at a time from a catalog the firm cannot add to: every row is seeded from " +
    "utbmsSeedData (packages/timekeeping/src/utbms-catalog.ts — 15 task, 11 activity, 10 " +
    "expense) by INSERT OR IGNORE, and the only other write is the active flag. There is no " +
    "insert route: setUtbmsCodeActiveStatement matches by id, so an unknown id changes nothing " +
    "and a firm can never invent an ABA code through this path.",

  // --- Reads whose subject is one thing, and the schema says how many ---------------------------
  "emails.autoFileReview":
    "One row per RULE that acted in the window, not one per message: the counts are SQL " +
    "aggregates over the links (readAutomaticRuleTallies), so the row set is the firm's own rule " +
    "set narrowed to the matters the caller may open. The matters it scans are capped at " +
    "REVIEW_MATTER_LIMIT and the response says so on `matterScopeCapped` — the one thing that " +
    "must never be silent here, because this is the screen a firm reads before trusting a rule " +
    "to file without confirmation.",
  "emails.autoFileDecisions":
    "The decisions recorded for ONE message, capped at MESSAGE_DECISION_LIMIT " +
    "(apps/api-worker/src/routes/auto-file-rules.ts), with the response's `capped` flag saying " +
    "when the message recorded more. The real bound is the rule set that could have matched that " +
    "message, and the cap is the belt on it. Not paged: a message's filing decisions are read as " +
    "one account of why it landed where it did.",
  "emails.listAutoFileRules":
    "One matter's auto-file rules, capped at MATTER_RULE_LIMIT " +
    "(apps/api-worker/src/routes/auto-file-rules.ts) rather than trusting that a matter holds " +
    "few. Rules are written by a person through the manage route; nothing derives one.",
  "emails.listCaptureAddresses":
    "The capture addresses minted for ONE matter. Each is minted deliberately and rotated rather " +
    "than accumulated, through the routes in apps/api-worker/src/routes/capture-addresses.ts — " +
    "no path mints one in response to a message arriving, which is what would make this grow " +
    "with the matter's mail.",
  "narrativeTemplates.recentNarratives":
    "At most 50 rows, and the ceiling is on the REQUEST: the route's own query schema is " +
    "z.number().int().positive().max(50) (apps/api-worker/src/routes/narrative-templates.ts), " +
    "and recentNarrativesStatement binds it as the SQL LIMIT. It is the one-tap re-pick picker " +
    "over a timekeeper's own distinct narratives, not a walk through their time entries.",

  // --- Capped reads whose cap is real, and whose SILENCE about it is filed separately ----------
  "custody.listSightings":
    "Capped at the caller's `limit`, default 500 and schema-capped at 1000 " +
    "(apps/api-worker/src/routes/custody.ts), with the response's `capped` flag saying when the " +
    "count recorded more — readCustodyStocktakeSightings reads one row past the limit to learn " +
    "it. Not cursor-paged: a count's observations are read against the reconciliation of the same " +
    "count, and half a count reconciles to a wrong answer rather than a short one.",
  "custody.listReminders":
    "Two independently-bounded reads merged: readCustodyReviewsDue and " +
    "readOverdueCustodyCheckouts each take DEFAULT_PAGE_SIZE in " +
    "packages/custodian/src/reminders.ts, so the answer is at most 100 rows, and `capped` is true " +
    "when EITHER reason has more due than the answer names. Not cursor-paged because the merge " +
    "has no single sort column a keyset could seek on — a cursor over it would page one arm and " +
    "lose the other. It answers what the register is waiting on NOW.",
  "directory.entityNames":
    "Bounded by the CALLER'S OWN REQUEST and by nothing else: the answer names the ids asked for, " +
    "so it can never be longer than the id list, and the handler in " +
    "apps/api-worker/src/routes/directory.ts REFUSES a list longer than " +
    "MAX_ENTITY_DISPLAY_NAME_LOOKUP (100, packages/directory/src/entity-display.ts) with a 422 " +
    "rather than truncating it. A cursor is meaningless over a read whose page the caller wrote.",
  "directory.listCategories":
    "The firm's category vocabulary. Rows come only from createCategory in " +
    "packages/directory/src/categories.ts — the single insert statement in the workspace — reached " +
    "only from the create route behind directory:edit. A category is archived rather than deleted, " +
    "so the row count is the number of labels the firm has ever decided it files people under. It " +
    "grows with the firm's decisions and stops; it does not grow with the directory's size.",
  "directory.listEntityCategories":
    "One entity's assignments, bounded by the vocabulary above: directory_entity_category has a " +
    "composite primary key on (entity_id, category_id) in packages/database/src/per-firm-schema.ts, " +
    "so an entity carries AT MOST ONE row per category and this read can never be longer than " +
    "directory.listCategories is.",
  "directory.listIdentifiers":
    "The sealed identifiers one entity holds, described and never disclosed. Rows come only from " +
    "addIdentifier in packages/directory/src/identifiers.ts, reached from the create route behind " +
    "directory:edit — one identifier per deliberate act of a member typing one in, over a closed " +
    "catalog of seven types (IDENTIFIER_TYPES in packages/directory/src/types.ts). Nothing writes " +
    "here from a queue consumer, an import, or a sweep, so the count is what the firm has recorded " +
    "about one person rather than anything the platform's activity accumulates.",
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
