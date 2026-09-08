// The pre-baseline migration lineages, preserved as data so already-provisioned databases stay
// recognizable. On 2026-07-04 each lineage's sequential-id migration chain was collapsed into a
// single timestamp-id baseline migration (verified schema- and seed-equivalent to the chain it
// replaced), but production databases provisioned before the collapse carry applied-ledger rows
// under these retired ids. Without this map the runner reads those rows as "a migration this code
// does not know" and refuses — wrongly treating an old ledger as a newer schema — which blocks
// every later migration for the life of the database. With it, the runner recognizes the complete
// retired chain and rewrites the ledger to the equivalent baseline, once, atomically.
//
// Only the COMPLETE legacy set reconciles. A strict prefix of it means the database's schema stops
// partway through the retired chain — the baseline (the chain's cumulative end state) would
// misrepresent it, and the retired SQL no longer ships to bring it forward — so a partial chain
// still refuses, loudly, for a human to resolve. Every database that was live at the collapse had
// been migrated to the chain's head by the scheduled pass, so the complete set is the only shape
// that exists in production.
//
// Immutable history: these ids name committed migrations that real databases applied. Never edit
// this list; a future baseline collapse adds a new entry.
export interface LegacyBaseline {
  // The lineage name, for error messages and reports.
  readonly lineage: string;
  // The baseline migration tag that replaced the legacy chain.
  readonly baselineTag: string;
  // The complete retired chain, in its original apply order.
  readonly legacyTags: readonly string[];
}

export const LEGACY_BASELINES: readonly LegacyBaseline[] = [
  {
    lineage: "per-firm",
    baselineTag: "20260908T000000_baseline",
    // The 2026-07-04 baseline and everything appended to it through 2026-09-07. Collapsed because a
    // lineage grows a migration per change forever and every new firm replays the whole history —
    // including the table rebuilds that cannot run against a populated database, which stay a
    // permanent hazard for as long as they are in the chain.
    legacyTags: [
      "20260704T041516_baseline",
      "20260704T041517_seed-tools-file-repair",
      "20260704T041518_file-repair-provenance",
      "20260704T041519_seed-tools-speed-test",
      "20260709T000001_seed-tools-ocr",
      "20260709T120000_conflicts",
      "20260709T120001_seed-conflicts-permissions",
      "20260710T120000_seed-tools-email-inspector",
      "20260714T210000_directory-email-normalized-address",
      "20260717T120000_email-filing-records",
      "20260717T120001_seed-emails-permissions",
      "20260717T181411_conflicts-hit-co-party",
      "20260717T224037_index-split-catalog",
      "20260803T120000_seed-esign-seal",
      "20260804T072255_matter-number-allocation",
      "20260804T082351_index-split-document-version",
      "20260804T120000_shipment-purchase-claim",
      "20260804T150000_document-automation",
      "20260804T150001_seed-document-automation-permissions",
      "20260804T160000_custodian-register",
      "20260804T160001_seed-custody-catalog",
      "20260804T170000_document-automation-field-mappings",
      "20260804T170001_custody-review-schedule",
      "20260805T120000_trust-ledger",
      "20260805T120001_seed-trust-permissions",
      "20260805T120002_email-message-dkim-verdict",
      "20260805T130000_custody-gated-release",
      "20260805T130001_location-letterhead-logo",
      "20260805T140000_trust-movements",
      "20260805T150000_custodian-stocktake",
      "20260805T160000_email-matter-link-linked-by-index",
      "20260805T170000_trust-disbursement-authorization",
      "20260805T180000_custodian-destruction",
      "20260805T200000_trust-reconciliation",
      "20260805T220000_auto-file-rules",
      "20260805T230000_billing-invoices",
      "20260806T000000_case-calendar",
      "20260806T010000_merge-field-catalog",
      "20260806T020000_matter-assets",
      "20260806T040000_operational-fixes",
      "20260806T050000_magnus-conversations",
      "20260806T060000_billing-trust-application",
      "20260806T070000_matter-asset-classes-and-encumbrances",
      "20260806T080000_discovery-5-1-2",
      "20260807T020000_notifications-delivery",
      "20260807T040000_matter-staffing",
      "20260807T041000_matter-court-case",
      "20260807T042000_matter-estate-and-capacity",
      "20260807T050000_trust-authorization-policy",
      "20260807T060000_billing-fee-models",
      "20260807T070000_calendar-firm-events-resources-links",
      "20260808T000000_discovery-review-coding-and-access",
      "20260808T010000_directory-pronouns",
      "20260808T020000_trust-authority-default-posture",
      "20260812T000000_trust-firm-funds-and-unclaimed-funds",
      "20260812T000001_seed-trust-firm-funds-permission",
      "20260813T000000_document-assembly-output-format",
      "20260813T010000_billing-credit-notes",
      "20260813T020000_index-split-membership",
      "20260813T030000_conflicts-recheck-ledger",
      "20260814T000000_calendar-and-custody-index-fixes",
      "20260814T010000_seed-reports-permissions",
      "20260815T000000_discovery-processing-route",
      "20260816T002417_notification-in-app-suppression",
      "20260816T090000_discovery-dedup-and-report",
      "20260816T152756_natural-language-search",
      "20260816T160000_directory-match-keys",
      "20260816T170000_document-template-kind",
      "20260817T000000_billing-invoice-delivery",
      "20260819T000000_index-split-corpus-scope",
      "20260819T123505_index-automatic-email-links",
      "20260819T140000_seed-notification-policy-permission",
      "20260819T220000_seed-document-editing-and-tools-permissions",
      "20260829T120000_seed-read-members-permission",
      "20260830T000000_conflicts-waiver-record",
      "20260830T120000_directory-contact-points",
      "20260831T210000_seed-report-export-permission",
      "20260831T230000_download-register",
      "20260831T230001_seed-download-register-permission",
      "20260901T000000_seed-file-workbench-permission",
      "20260901T010000_matter-notes",
      "20260901T020000_download-item-requested-format",
      "20260901T120000_matter-notes-edit-and-delete",
      "20260901T130000_time-entry-record-surfaces",
      "20260901T130001_consultation-number",
      "20260901T130002_seed-matter-search-permission",
      "20260901T150000_tasks",
      "20260902T120000_matter-plans",
      "20260902T190000_time-entry-task-link",
      "20260902T230000_task-sync-seams",
      "20260903T000000_arrangement-agreement-file",
      "20260903T010000_conflicts-check-history-index",
      "20260903T020000_conflicts-hit-entity-index",
      "20260903T090000_directory-identifier-label",
      "20260903T150000_intake-procedure",
      "20260905T195543_intake-step-kinds-client-forms-and-payment",
      "20260906T013304_matter-status-intake-and-consultation",
      "20260906T030014_matter-hold-status",
      "20260906T120000_file-version-source-modified-at",
      "20260906T160000_file-version-content-sha256-index",
      "20260906T170000_time-entry-work-date-index",
      "20260907T030000_communication-log",
      "20260907T090000_seed-report-policy-permission",
      "20260907T100000_cost-entry-incurred-date-index",
      "20260907T120000_conflicts-configure-permission",
    ],
  },
  {
    lineage: "per-firm",
    baselineTag: "20260704T041516_baseline",
    legacyTags: [
      "0000_foundational-tables",
      "0001_ledger-core",
      "0002_member-rbac",
      "0003_incident-intake",
      "0004_matters-locations-file-manager",
      "0005_list-keyset-indexes",
      "0006_protected-secrets-and-incident-ciphertext",
      "0007_incident-description-nullable",
      "0008_elite_genesis",
      "0009_directory",
      "0010_seed-tools-firm-usage",
      "0011_directory-phonetic-code-index",
      "0012_usage-analytics-opt-out",
      "0013_custom-fields",
      "0014_inference-token-usage",
      "0015_odd_mesmero",
      "0016_warm_talkback",
      "0017_seed-tools-web-domains",
      "0018_seed-tools-file-converter",
      "0019_seed-scan-file-permission",
      "0020_seed-tools-metadata-scrubber",
      "0021_outgoing_talon",
      "0022_seed-tools-file-integrity",
      "0023_raw_scan_cache",
      "0024_seed-release-channel-permission",
      "0025_amusing_robbie_robertson",
      "0026_needy_rage",
      "0027_smart_stellaris",
      "0028_burly_piledriver",
      "0029_scan_verdict_flagged",
      "0030_seed-scan-policy-permission",
      "0031_support-access-permissions",
      "0032_seed-tools-file-type-verifier",
      "0033_ai-detection-usage",
      "0034_seed-tools-ai-text-detection",
      "0035_seed-tools-decryption",
    ],
  },
  {
    lineage: "control-plane",
    baselineTag: "20260704T041516_baseline",
    legacyTags: [
      "0000_firm-registry",
      "0001_auth-and-provisioning",
      "0002_firm-key-columns",
      "0003_handy_rattler",
      "0004_support-access",
      "0005_platform-operator",
      "0006_natural_overlord",
    ],
  },
];

// A database qualifies for reconciliation only when its applied ledger is EXACTLY one legacy chain
// (this code must also know the matching baseline — a chain from a lineage this bundle does not
// carry stays unrecognized). Anything else — extra tags, missing tags, an unrelated set — is not a
// legacy ledger and gets no special treatment.
export function findLegacyBaseline(
  appliedTags: ReadonlySet<string>,
  knownTags: ReadonlySet<string>,
): LegacyBaseline | undefined {
  return LEGACY_BASELINES.find(
    (candidate) =>
      knownTags.has(candidate.baselineTag) &&
      appliedTags.size === candidate.legacyTags.length &&
      candidate.legacyTags.every((tag) => appliedTags.has(tag)),
  );
}
