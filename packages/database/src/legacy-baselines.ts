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
