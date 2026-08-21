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
  "billing.clientCredits",
  "billing.listCreditNotes",
  "billing.listDeliveries",
  "billing.listRecoveries",
  "calendar.continuanceChain",
  "calendar.listEventTypes",
  "calendar.listResources",
  "calendar.resourceAvailability",
  "custody.listItemTypes",
  "custody.listLocations",
  "custody.listOverdue",
  "custody.listReminders",
  "custody.listSightings",
  "custody.listStocktakes",
  "custody.reportHoldingsByLocation",
  "custody.reportHoldingsByOwner",
  "custody.reportHolds",
  "customFields.listRecordValues",
  "customFields.valueHistory",
  "directory.search",
  "discovery.getCodingHistory",
  "discovery.getDocumentCoding",
  "discovery.getReviewSetAccess",
  "discovery.listLoads",
  "discovery.listRecordCustodians",
  "discovery.listReviewDocumentOccurrences",
  "discovery.listReviewSets",
  "documentTypes.list",
  "emails.autoFileDecisions",
  "emails.autoFileReview",
  "emails.listAutoFileRules",
  "emails.listCaptureAddresses",
  "files.versions",
  "folders.list",
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
export const BOUNDED_BY_CONSTRUCTION = {};
