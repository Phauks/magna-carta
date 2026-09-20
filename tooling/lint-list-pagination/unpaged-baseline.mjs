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
  // --- The checks ONE file has had -------------------------------------------------------------
  "files.scans":
    "Every safety check, request and hold recorded against ONE file's versions. Read through " +
    "listVersionScanEvents in packages/file-manager/src/queries.ts, whose VERSION_SCAN_EVENT_LIMIT " +
    "(200) is a backstop on a read whose natural size is one line per version plus the re-scans a " +
    "member asked for by hand; the panel reads it whole to tell an open request from an answered " +
    "one, which a page could not.",
  // --- The bookings ONE event holds --------------------------------------------------------------
  "calendar.listEventBookings":
    "The live bookings one matter event holds: a room, a car, a projector. Read through " +
    "selectBookingsForEventStatement in packages/calendar/src/booking-statements.ts, whose " +
    "EVENT_BOOKINGS_LIMIT (200) is a backstop on a read whose natural size is a handful, not a " +
    "page; every booking hangs off exactly one event and is made one at a time from that " +
    "event's window, behind calendar:manage.",
  "calendar.listEventLinks":
    "Every link touching ONE matter event: its continuance (at most one each way, held by the " +
    "schema's partial uniques) and the settings a person related it to by hand. Read through " +
    "selectLinksTouchingEventStatement in packages/calendar/src/link-statements.ts, whose LIMIT " +
    "(200) is a backstop on a read whose natural size is a handful.",
  "calendar.listFirmEventLinks":
    "The same read for a firm event, through the same statement and the same backstop " +
    "(packages/calendar/src/link-statements.ts).",
  "calendar.listFirmEventBookings":
    "The same read for a firm event, through the same statement and the same backstop " +
    "(packages/calendar/src/booking-statements.ts, EVENT_BOOKINGS_LIMIT).",
  // --- The firm's own configured vocabularies -------------------------------------------------
  //
  // Six tables with the same shape and the same argument, so the claim is the same one six times:
  // a row appears when a PERSON adds a kind of thing the firm works with, through a route behind a
  // manage permission, and by no other path. Each table has exactly ONE insert statement in the
  // workspace, named below, and none of them is reachable from a queue consumer, a cron sweep, an
  // import, or the ingest pipeline — which is what separates a vocabulary from a record. A
  // vocabulary grows with the firm's decisions and stops; a record grows with the firm's activity
  // and does not.
  // A matter plan is the same species as the six vocabularies below, with the same claim: a row
  // appears when a PERSON authors a plan through a route behind tasks:managePlans
  // (apps/api-worker/src/routes/matter-plans.ts, createPlan), and by no other path. There is exactly
  // one insert statement in the workspace — insertPlanTemplateStatement in
  // packages/tasks/src/plan-statements.ts — and it is unreachable from a queue consumer, a cron
  // sweep, an import or the ingest pipeline. The platform seeds none, so the table starts empty and
  // grows only with a firm's own decisions about how it practises.
  //
  // Both reads additionally carry MAX_PLAN_TEMPLATE_PAGE_SIZE as a backstop in SQL. That is a guard
  // against a pathological firm rather than the bound being claimed here; the bound is the insert
  // path.
  "matterPlans.listPlans":
    "The firm's matter plans. Rows come only from the createPlan route behind tasks:managePlans " +
    "(apps/api-worker/src/routes/matter-plans.ts), whose one insert is " +
    "insertPlanTemplateStatement in packages/tasks/src/plan-statements.ts; no queue, sweep or " +
    "import reaches the table, and the platform seeds nothing into it.",
  "matterPlans.listOffered":
    "The plans offered on one matter — a filter over matterPlans.listPlans above (active, and " +
    "bound to this matter's type or to no type), so it is bounded by the same insert path and is " +
    "strictly smaller than it.",
  // The intake procedure is the same species again: a row appears when a PERSON authors a procedure
  // through a route behind intake:manageProcedures (apps/api-worker/src/routes/intake.ts,
  // createProcedure), whose one insert is insertProcedureStatement in
  // packages/intake/src/procedure-statements.ts; no queue, sweep or import reaches the table, and
  // the platform seeds nothing into it. The read carries MAX_PROCEDURE_PAGE_SIZE as a backstop.
  "intake.listProcedures":
    "The firm's intake procedures. Rows come only from the createProcedure route behind " +
    "intake:manageProcedures (apps/api-worker/src/routes/intake.ts), whose one insert is " +
    "insertProcedureStatement in packages/intake/src/procedure-statements.ts; no queue, sweep or " +
    "import reaches the table, and the platform seeds nothing into it.",
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
  "roles.list":
    "The firm's roles, bounded by the five the per-firm migration seeds " +
    "(packages/database/drizzle/per-firm/20260704T041516_baseline.sql) plus whatever the firm " +
    "authors by hand. The `role` table has NO insert statement in the workspace at all — the " +
    "seeded rows are committed literals in that migration, and role authoring is not built — so " +
    "this read cannot grow with anything a firm does until a write path lands, at which point it " +
    "is a person naming a role rather than an activity producing rows. Read whole on purpose: " +
    "the surface that assigns a role has to offer every role before it can offer any, and a " +
    "half-read list silently withholds the one somebody was looking for.",

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
  "notes.readNoteHistory":
    "The version chain of ONE note, capped at MAX_NOTE_REVISION_PAGE_SIZE " +
    "(packages/notes/src/types.ts), with the response's `capped` flag saying when the note has " +
    "more versions than were returned — readMatterNoteRevisions over-reads by exactly one to " +
    "learn that bit. The real bound is how many times a person corrected one note, and the cap is " +
    "the belt on it: a chain that long is a corrupted note or an automated writer rather than a " +
    "lawyer fixing typos. Not paged, because a note's history is read as one account of how its " +
    "wording got to where it is, and a withdrawn note has none at all (the route refuses it).",
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

  // --- The ways one person or organization asked to be reached ---------------------------------
  //
  // The same claim three times, and it is checkable in the same place each time: the only writes to
  // directory_email, directory_phone and directory_address are the add/update/remove operations in
  // packages/directory/src/contact-email.ts, contact-phone.ts and contact-address.ts, each reached
  // only from the entity's own route behind directory:edit. Nothing else in the repository inserts a
  // row into any of the three — no import, no queue consumer, no ingest pipeline — which is what
  // separates a contact record from a record that grows with the firm's activity. A person has the
  // numbers and addresses somebody typed for them, one at a time, and a soft-deleted row is excluded
  // from the read, so the count is the ways that person can currently be reached.
  //
  // Read whole on purpose: this IS the contact list on a record, and a page boundary through it
  // would show a member some of the ways to reach a client and let them believe it was all of them.
  "directory.listEmails":
    "The email addresses on one directory entity. Written only by addEmail/updateEmail/removeEmail " +
    "in packages/directory/src/contact-email.ts, reached from the entity's own route behind " +
    "directory:edit and from inbound email capture, which writes one row per newly seen " +
    "correspondent address on that entity.",
  "directory.listPhones":
    "The telephone and fax numbers on one directory entity. Written only by " +
    "addPhone/updatePhone/removePhone in packages/directory/src/contact-phone.ts, reached from the " +
    "entity's own route behind directory:edit and from nowhere else at all.",
  "directory.listAddresses":
    "The postal addresses on one directory entity. Written only by " +
    "addAddress/updateAddress/removeAddress in packages/directory/src/contact-address.ts, reached " +
    "from the entity's own route behind directory:edit and from nowhere else at all.",
  "timeEntries.listAttachments":
    "The files one time entry points at. Written only by attachFileToTimeEntry in " +
    "packages/timekeeping/src/time-entry-attachments.ts — the single insert statement in the " +
    "workspace — reached from the attach route behind time:track and from no queue consumer, " +
    "sweep, or ingest path; the row is a person deciding that this document belongs with this " +
    "entry. time_entry_attachment is keyed on (time_entry_id, file_id) in " +
    "packages/database/src/per-firm-schema.ts, so a file counts once however often it is offered. " +
    "Read whole on purpose: it IS the attachments tab on the record, and a page boundary through " +
    "it would show a member some of the work's documents and let them believe it was all of them. " +
    "The entry's HISTORY is the unbounded read here, and it is cursor-paged.",
  // --- Who is running ONE meeting --------------------------------------------------------------
  "meetings.hosts":
    "The LIVE grants on one meeting: at most one host, plus the co-hosts named in it. Read through " +
    "readLiveHostGrants in packages/meetings/src/hosting-statements.ts, which filters " +
    "revoked_at IS NULL — so the closed grants, which are the interval record and the part that " +
    "grows as a room changes hands, are not in this answer at all. Two partial unique indexes in " +
    "packages/database/src/per-firm-schema.ts bound what is left: " +
    "meeting_host_live_host_unique_index allows one live host per meeting, and " +
    "meeting_host_live_grant_unique_index allows one live grant per MEMBER per meeting. A grant is " +
    "written only by grantHosting/claimHosting in packages/meetings/src/hosting-service.ts and by " +
    "the starter's own grant in openMeetingOnEvent — a host naming ONE member who is in the room at " +
    "that instant, one act at a time, behind meetings:host and a grant of their own. No queue " +
    "consumer, sweep, import or ingest path reaches it, which is what separates this from a record " +
    "that grows with a firm's activity: it grows only while somebody deliberately shares the " +
    "running of one meeting, and the live set is two or three. Read whole on purpose: it IS the " +
    "badge every browser in the room draws, and a page boundary through it would tell a member " +
    "some of who is running the meeting.",
};
