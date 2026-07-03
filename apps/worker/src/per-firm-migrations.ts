import { migrationsFromJournal, type Migration } from "@magna-carta/database/migration";
import perFirmJournal from "@magna-carta/database/drizzle/per-firm/meta/_journal.json";
import foundationalTablesSql from "@magna-carta/database/drizzle/per-firm/0000_foundational-tables.sql";
import ledgerCoreSql from "@magna-carta/database/drizzle/per-firm/0001_ledger-core.sql";
import memberRbacSql from "@magna-carta/database/drizzle/per-firm/0002_member-rbac.sql";
import incidentIntakeSql from "@magna-carta/database/drizzle/per-firm/0003_incident-intake.sql";
import mattersLocationsFileManagerSql from "@magna-carta/database/drizzle/per-firm/0004_matters-locations-file-manager.sql";
import listKeysetIndexesSql from "@magna-carta/database/drizzle/per-firm/0005_list-keyset-indexes.sql";
import protectedSecretsSql from "@magna-carta/database/drizzle/per-firm/0006_protected-secrets-and-incident-ciphertext.sql";
import incidentDescriptionNullableSql from "@magna-carta/database/drizzle/per-firm/0007_incident-description-nullable.sql";
import shippingTablesSql from "@magna-carta/database/drizzle/per-firm/0008_elite_genesis.sql";
import directorySql from "@magna-carta/database/drizzle/per-firm/0009_directory.sql";
import seedToolsFirmUsageSql from "@magna-carta/database/drizzle/per-firm/0010_seed-tools-firm-usage.sql";
import directoryPhoneticCodeIndexSql from "@magna-carta/database/drizzle/per-firm/0011_directory-phonetic-code-index.sql";
import usageAnalyticsOptOutSql from "@magna-carta/database/drizzle/per-firm/0012_usage-analytics-opt-out.sql";
import customFieldsSql from "@magna-carta/database/drizzle/per-firm/0013_custom-fields.sql";
import inferenceTokenUsageSql from "@magna-carta/database/drizzle/per-firm/0014_inference-token-usage.sql";
import inlinePlayableSql from "@magna-carta/database/drizzle/per-firm/0015_odd_mesmero.sql";
import scanCacheAndDetailSql from "@magna-carta/database/drizzle/per-firm/0016_warm_talkback.sql";
import seedToolsWebDomainsSql from "@magna-carta/database/drizzle/per-firm/0017_seed-tools-web-domains.sql";
import seedToolsFileConverterSql from "@magna-carta/database/drizzle/per-firm/0018_seed-tools-file-converter.sql";
import seedScanFilePermissionSql from "@magna-carta/database/drizzle/per-firm/0019_seed-scan-file-permission.sql";
import seedToolsMetadataScrubberSql from "@magna-carta/database/drizzle/per-firm/0020_seed-tools-metadata-scrubber.sql";
import timeTrackingSql from "@magna-carta/database/drizzle/per-firm/0021_outgoing_talon.sql";
import seedToolsFileIntegritySql from "@magna-carta/database/drizzle/per-firm/0022_seed-tools-file-integrity.sql";
import rawScanCacheSql from "@magna-carta/database/drizzle/per-firm/0023_raw_scan_cache.sql";
import seedReleaseChannelPermissionSql from "@magna-carta/database/drizzle/per-firm/0024_seed-release-channel-permission.sql";
import editingWorkingCopySql from "@magna-carta/database/drizzle/per-firm/0025_amusing_robbie_robertson.sql";
import editingSweepIndexesSql from "@magna-carta/database/drizzle/per-firm/0026_needy_rage.sql";
import idleReleaseIndexSql from "@magna-carta/database/drizzle/per-firm/0027_smart_stellaris.sql";
import costEntrySql from "@magna-carta/database/drizzle/per-firm/0028_burly_piledriver.sql";
import scanVerdictFlaggedSql from "@magna-carta/database/drizzle/per-firm/0029_scan_verdict_flagged.sql";
import seedScanPolicyPermissionSql from "@magna-carta/database/drizzle/per-firm/0030_seed-scan-policy-permission.sql";
import supportAccessPermissionsSql from "@magna-carta/database/drizzle/per-firm/0031_support-access-permissions.sql";
import seedToolsFileTypeVerifierSql from "@magna-carta/database/drizzle/per-firm/0032_seed-tools-file-type-verifier.sql";
import aiDetectionUsageSql from "@magna-carta/database/drizzle/per-firm/0033_ai-detection-usage.sql";
import seedToolsAiTextDetectionSql from "@magna-carta/database/drizzle/per-firm/0034_seed-tools-ai-text-detection.sql";
import seedToolsFileRepairSql from "@magna-carta/database/drizzle/per-firm/0035_seed-tools-file-repair.sql";
import fileRepairProvenanceSql from "@magna-carta/database/drizzle/per-firm/0036_file-repair-provenance.sql";

// The per-firm migration lineage bundled INTO the worker (no filesystem at runtime): the FirmDatabase
// Durable Object runs this lineage against its own SQLite storage on wake (firm-database-object.ts),
// so the SQL must ship in the bundle, not only in test support. Plain `.sql` imports — the dual
// Vite/wrangler bundling contract lives in src/sql-modules.d.ts.
// migrationsFromJournal fails loud when the journal gains a migration this map does not carry:
// add the new import alongside its journal entry. The test support reuses this same lineage.
export function perFirmMigrations(): Migration[] {
  return migrationsFromJournal(perFirmJournal, {
    "0000_foundational-tables": foundationalTablesSql,
    "0001_ledger-core": ledgerCoreSql,
    "0002_member-rbac": memberRbacSql,
    "0003_incident-intake": incidentIntakeSql,
    "0004_matters-locations-file-manager": mattersLocationsFileManagerSql,
    "0005_list-keyset-indexes": listKeysetIndexesSql,
    "0006_protected-secrets-and-incident-ciphertext": protectedSecretsSql,
    "0007_incident-description-nullable": incidentDescriptionNullableSql,
    "0008_elite_genesis": shippingTablesSql,
    "0009_directory": directorySql,
    "0010_seed-tools-firm-usage": seedToolsFirmUsageSql,
    "0011_directory-phonetic-code-index": directoryPhoneticCodeIndexSql,
    "0012_usage-analytics-opt-out": usageAnalyticsOptOutSql,
    "0013_custom-fields": customFieldsSql,
    "0014_inference-token-usage": inferenceTokenUsageSql,
    "0015_odd_mesmero": inlinePlayableSql,
    "0016_warm_talkback": scanCacheAndDetailSql,
    "0017_seed-tools-web-domains": seedToolsWebDomainsSql,
    "0018_seed-tools-file-converter": seedToolsFileConverterSql,
    "0019_seed-scan-file-permission": seedScanFilePermissionSql,
    "0020_seed-tools-metadata-scrubber": seedToolsMetadataScrubberSql,
    "0021_outgoing_talon": timeTrackingSql,
    "0022_seed-tools-file-integrity": seedToolsFileIntegritySql,
    "0023_raw_scan_cache": rawScanCacheSql,
    "0024_seed-release-channel-permission": seedReleaseChannelPermissionSql,
    "0025_amusing_robbie_robertson": editingWorkingCopySql,
    "0026_needy_rage": editingSweepIndexesSql,
    "0027_smart_stellaris": idleReleaseIndexSql,
    "0028_burly_piledriver": costEntrySql,
    "0029_scan_verdict_flagged": scanVerdictFlaggedSql,
    "0030_seed-scan-policy-permission": seedScanPolicyPermissionSql,
    "0031_support-access-permissions": supportAccessPermissionsSql,
    "0032_seed-tools-file-type-verifier": seedToolsFileTypeVerifierSql,
    "0033_ai-detection-usage": aiDetectionUsageSql,
    "0034_seed-tools-ai-text-detection": seedToolsAiTextDetectionSql,
    "0035_seed-tools-file-repair": seedToolsFileRepairSql,
    "0036_file-repair-provenance": fileRepairProvenanceSql,
  });
}
