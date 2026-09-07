import { migrationsFromJournal, type Migration } from "@magna-carta/database/migration";
import perFirmJournal from "@magna-carta/database/drizzle/per-firm/meta/_journal.json";
import baselineSql from "@magna-carta/database/drizzle/per-firm/20260704T041516_baseline.sql";
import seedToolsFileRepairSql from "@magna-carta/database/drizzle/per-firm/20260704T041517_seed-tools-file-repair.sql";
import fileRepairProvenanceSql from "@magna-carta/database/drizzle/per-firm/20260704T041518_file-repair-provenance.sql";
import seedToolsSpeedTestSql from "@magna-carta/database/drizzle/per-firm/20260704T041519_seed-tools-speed-test.sql";
import seedToolsOcrSql from "@magna-carta/database/drizzle/per-firm/20260709T000001_seed-tools-ocr.sql";
import conflictsSql from "@magna-carta/database/drizzle/per-firm/20260709T120000_conflicts.sql";
import seedConflictsPermissionsSql from "@magna-carta/database/drizzle/per-firm/20260709T120001_seed-conflicts-permissions.sql";
import seedToolsEmailInspectorSql from "@magna-carta/database/drizzle/per-firm/20260710T120000_seed-tools-email-inspector.sql";
import directoryEmailNormalizedAddressSql from "@magna-carta/database/drizzle/per-firm/20260714T210000_directory-email-normalized-address.sql";
import emailFilingRecordsSql from "@magna-carta/database/drizzle/per-firm/20260717T120000_email-filing-records.sql";
import seedEmailsPermissionsSql from "@magna-carta/database/drizzle/per-firm/20260717T120001_seed-emails-permissions.sql";
import conflictsHitCoPartySql from "@magna-carta/database/drizzle/per-firm/20260717T181411_conflicts-hit-co-party.sql";
import indexSplitCatalogSql from "@magna-carta/database/drizzle/per-firm/20260717T224037_index-split-catalog.sql";
import seedEsignSealSql from "@magna-carta/database/drizzle/per-firm/20260803T120000_seed-esign-seal.sql";
import matterNumberAllocationSql from "@magna-carta/database/drizzle/per-firm/20260804T072255_matter-number-allocation.sql";
import indexSplitDocumentVersionSql from "@magna-carta/database/drizzle/per-firm/20260804T082351_index-split-document-version.sql";
import shipmentPurchaseClaimSql from "@magna-carta/database/drizzle/per-firm/20260804T120000_shipment-purchase-claim.sql";
import documentAutomationSql from "@magna-carta/database/drizzle/per-firm/20260804T150000_document-automation.sql";
import seedDocumentAutomationPermissionsSql from "@magna-carta/database/drizzle/per-firm/20260804T150001_seed-document-automation-permissions.sql";
import custodianRegisterSql from "@magna-carta/database/drizzle/per-firm/20260804T160000_custodian-register.sql";
import seedCustodyCatalogSql from "@magna-carta/database/drizzle/per-firm/20260804T160001_seed-custody-catalog.sql";
import documentAutomationFieldMappingsSql from "@magna-carta/database/drizzle/per-firm/20260804T170000_document-automation-field-mappings.sql";
import custodyReviewScheduleSql from "@magna-carta/database/drizzle/per-firm/20260804T170001_custody-review-schedule.sql";
import trustLedgerSql from "@magna-carta/database/drizzle/per-firm/20260805T120000_trust-ledger.sql";
import seedTrustPermissionsSql from "@magna-carta/database/drizzle/per-firm/20260805T120001_seed-trust-permissions.sql";
import emailMessageDkimVerdictSql from "@magna-carta/database/drizzle/per-firm/20260805T120002_email-message-dkim-verdict.sql";
import custodyGatedReleaseSql from "@magna-carta/database/drizzle/per-firm/20260805T130000_custody-gated-release.sql";
import locationLetterheadLogoSql from "@magna-carta/database/drizzle/per-firm/20260805T130001_location-letterhead-logo.sql";
import trustMovementsSql from "@magna-carta/database/drizzle/per-firm/20260805T140000_trust-movements.sql";
import custodianStocktakeSql from "@magna-carta/database/drizzle/per-firm/20260805T150000_custodian-stocktake.sql";
import emailMatterLinkLinkedByIndexSql from "@magna-carta/database/drizzle/per-firm/20260805T160000_email-matter-link-linked-by-index.sql";
import trustDisbursementAuthorizationSql from "@magna-carta/database/drizzle/per-firm/20260805T170000_trust-disbursement-authorization.sql";
import custodianDestructionSql from "@magna-carta/database/drizzle/per-firm/20260805T180000_custodian-destruction.sql";
import trustReconciliationSql from "@magna-carta/database/drizzle/per-firm/20260805T200000_trust-reconciliation.sql";
import autoFileRulesSql from "@magna-carta/database/drizzle/per-firm/20260805T220000_auto-file-rules.sql";
import billingInvoicesSql from "@magna-carta/database/drizzle/per-firm/20260805T230000_billing-invoices.sql";
import caseCalendarSql from "@magna-carta/database/drizzle/per-firm/20260806T000000_case-calendar.sql";
import mergeFieldCatalogSql from "@magna-carta/database/drizzle/per-firm/20260806T010000_merge-field-catalog.sql";
import matterAssetsSql from "@magna-carta/database/drizzle/per-firm/20260806T020000_matter-assets.sql";
import operationalFixesSql from "@magna-carta/database/drizzle/per-firm/20260806T040000_operational-fixes.sql";
import magnusConversationsSql from "@magna-carta/database/drizzle/per-firm/20260806T050000_magnus-conversations.sql";
import billingTrustApplicationSql from "@magna-carta/database/drizzle/per-firm/20260806T060000_billing-trust-application.sql";
import matterAssetClassesAndEncumbrancesSql from "@magna-carta/database/drizzle/per-firm/20260806T070000_matter-asset-classes-and-encumbrances.sql";
import discoveryReviewSetModelSql from "@magna-carta/database/drizzle/per-firm/20260806T080000_discovery-5-1-2.sql";
import notificationsDeliverySql from "@magna-carta/database/drizzle/per-firm/20260807T020000_notifications-delivery.sql";
import matterStaffingSql from "@magna-carta/database/drizzle/per-firm/20260807T040000_matter-staffing.sql";
import matterCourtCaseSql from "@magna-carta/database/drizzle/per-firm/20260807T041000_matter-court-case.sql";
import matterEstateAndCapacitySql from "@magna-carta/database/drizzle/per-firm/20260807T042000_matter-estate-and-capacity.sql";
import trustAuthorizationPolicySql from "@magna-carta/database/drizzle/per-firm/20260807T050000_trust-authorization-policy.sql";
import billingFeeModelsSql from "@magna-carta/database/drizzle/per-firm/20260807T060000_billing-fee-models.sql";
import calendarFirmEventsResourcesLinksSql from "@magna-carta/database/drizzle/per-firm/20260807T070000_calendar-firm-events-resources-links.sql";
import discoveryReviewCodingAndAccessSql from "@magna-carta/database/drizzle/per-firm/20260808T000000_discovery-review-coding-and-access.sql";
import directoryPronounsSql from "@magna-carta/database/drizzle/per-firm/20260808T010000_directory-pronouns.sql";
import trustAuthorityDefaultPostureSql from "@magna-carta/database/drizzle/per-firm/20260808T020000_trust-authority-default-posture.sql";
import trustFirmFundsAndUnclaimedFundsSql from "@magna-carta/database/drizzle/per-firm/20260812T000000_trust-firm-funds-and-unclaimed-funds.sql";
import seedTrustFirmFundsPermissionSql from "@magna-carta/database/drizzle/per-firm/20260812T000001_seed-trust-firm-funds-permission.sql";
import documentAssemblyOutputFormatSql from "@magna-carta/database/drizzle/per-firm/20260813T000000_document-assembly-output-format.sql";
import billingCreditNotesSql from "@magna-carta/database/drizzle/per-firm/20260813T010000_billing-credit-notes.sql";
import indexSplitMembershipSql from "@magna-carta/database/drizzle/per-firm/20260813T020000_index-split-membership.sql";
import conflictsRecheckLedgerSql from "@magna-carta/database/drizzle/per-firm/20260813T030000_conflicts-recheck-ledger.sql";
import calendarAndCustodyIndexFixesSql from "@magna-carta/database/drizzle/per-firm/20260814T000000_calendar-and-custody-index-fixes.sql";
import seedReportsPermissionsSql from "@magna-carta/database/drizzle/per-firm/20260814T010000_seed-reports-permissions.sql";
import discoveryProcessingRouteSql from "@magna-carta/database/drizzle/per-firm/20260815T000000_discovery-processing-route.sql";
import notificationInAppSuppressionSql from "@magna-carta/database/drizzle/per-firm/20260816T002417_notification-in-app-suppression.sql";
import discoveryDedupAndReportSql from "@magna-carta/database/drizzle/per-firm/20260816T090000_discovery-dedup-and-report.sql";
import naturalLanguageSearchSql from "@magna-carta/database/drizzle/per-firm/20260816T152756_natural-language-search.sql";
import directoryMatchKeysSql from "@magna-carta/database/drizzle/per-firm/20260816T160000_directory-match-keys.sql";
import documentTemplateKindSql from "@magna-carta/database/drizzle/per-firm/20260816T170000_document-template-kind.sql";
import billingInvoiceDeliverySql from "@magna-carta/database/drizzle/per-firm/20260817T000000_billing-invoice-delivery.sql";
import indexSplitCorpusScopeSql from "@magna-carta/database/drizzle/per-firm/20260819T000000_index-split-corpus-scope.sql";
import indexAutomaticEmailLinksSql from "@magna-carta/database/drizzle/per-firm/20260819T123505_index-automatic-email-links.sql";
import seedNotificationPolicyPermissionSql from "@magna-carta/database/drizzle/per-firm/20260819T140000_seed-notification-policy-permission.sql";
import seedDocumentEditingAndToolsPermissionsSql from "@magna-carta/database/drizzle/per-firm/20260819T220000_seed-document-editing-and-tools-permissions.sql";
import seedReadMembersPermissionSql from "@magna-carta/database/drizzle/per-firm/20260829T120000_seed-read-members-permission.sql";
import conflictsWaiverRecordSql from "@magna-carta/database/drizzle/per-firm/20260830T000000_conflicts-waiver-record.sql";
import directoryContactPointsSql from "@magna-carta/database/drizzle/per-firm/20260830T120000_directory-contact-points.sql";
import seedReportExportPermissionSql from "@magna-carta/database/drizzle/per-firm/20260831T210000_seed-report-export-permission.sql";
import downloadRegisterSql from "@magna-carta/database/drizzle/per-firm/20260831T230000_download-register.sql";
import seedDownloadRegisterPermissionSql from "@magna-carta/database/drizzle/per-firm/20260831T230001_seed-download-register-permission.sql";
import seedFileWorkbenchPermissionSql from "@magna-carta/database/drizzle/per-firm/20260901T000000_seed-file-workbench-permission.sql";
import matterNotesSql from "@magna-carta/database/drizzle/per-firm/20260901T010000_matter-notes.sql";
import downloadItemRequestedFormatSql from "@magna-carta/database/drizzle/per-firm/20260901T020000_download-item-requested-format.sql";
import matterNotesEditAndDeleteSql from "@magna-carta/database/drizzle/per-firm/20260901T120000_matter-notes-edit-and-delete.sql";
import timeEntryRecordSurfacesSql from "@magna-carta/database/drizzle/per-firm/20260901T130000_time-entry-record-surfaces.sql";
import consultationNumberSql from "@magna-carta/database/drizzle/per-firm/20260901T130001_consultation-number.sql";
import matterSearchPermissionSql from "@magna-carta/database/drizzle/per-firm/20260901T130002_seed-matter-search-permission.sql";
import tasksSql from "@magna-carta/database/drizzle/per-firm/20260901T150000_tasks.sql";
import matterPlansSql from "@magna-carta/database/drizzle/per-firm/20260902T120000_matter-plans.sql";
import timeEntryTaskLinkSql from "@magna-carta/database/drizzle/per-firm/20260902T190000_time-entry-task-link.sql";
import taskSyncSeamsSql from "@magna-carta/database/drizzle/per-firm/20260902T230000_task-sync-seams.sql";
import arrangementAgreementFileSql from "@magna-carta/database/drizzle/per-firm/20260903T000000_arrangement-agreement-file.sql";
import conflictsCheckHistoryIndexSql from "@magna-carta/database/drizzle/per-firm/20260903T010000_conflicts-check-history-index.sql";
import conflictsHitEntityIndexSql from "@magna-carta/database/drizzle/per-firm/20260903T020000_conflicts-hit-entity-index.sql";
import directoryIdentifierLabelSql from "@magna-carta/database/drizzle/per-firm/20260903T090000_directory-identifier-label.sql";
import intakeProcedureSql from "@magna-carta/database/drizzle/per-firm/20260903T150000_intake-procedure.sql";
import intakeStepKindsClientFormsAndPaymentSql from "@magna-carta/database/drizzle/per-firm/20260905T195543_intake-step-kinds-client-forms-and-payment.sql";
import matterStatusIntakeAndConsultationSql from "@magna-carta/database/drizzle/per-firm/20260906T013304_matter-status-intake-and-consultation.sql";
import matterHoldStatusSql from "@magna-carta/database/drizzle/per-firm/20260906T030014_matter-hold-status.sql";
import fileVersionSourceModifiedAtSql from "@magna-carta/database/drizzle/per-firm/20260906T120000_file-version-source-modified-at.sql";
import fileVersionContentSha256IndexSql from "@magna-carta/database/drizzle/per-firm/20260906T160000_file-version-content-sha256-index.sql";
import timeEntryWorkDateIndexSql from "@magna-carta/database/drizzle/per-firm/20260906T170000_time-entry-work-date-index.sql";
import conflictsConfigurePermissionSql from "@magna-carta/database/drizzle/per-firm/20260907T120000_conflicts-configure-permission.sql";

// The per-firm migration lineage bundled INTO the worker (no filesystem at runtime): the FirmDatabase
// Durable Object runs this lineage against its own SQLite storage on wake (firm-database-object.ts),
// so the SQL must ship in the bundle, not only in test support. Plain `.sql` imports — the dual
// Vite/wrangler bundling contract lives in src/sql-modules.d.ts.
// migrationsFromJournal fails loud when the journal gains a migration this map does not carry:
// add the new import alongside its journal entry, keyed by its monotonic timestamp id. The test
// support reuses this same lineage.
export function perFirmMigrations(): Migration[] {
  return migrationsFromJournal(perFirmJournal, {
    "20260704T041516_baseline": baselineSql,
    "20260704T041517_seed-tools-file-repair": seedToolsFileRepairSql,
    "20260704T041518_file-repair-provenance": fileRepairProvenanceSql,
    "20260704T041519_seed-tools-speed-test": seedToolsSpeedTestSql,
    "20260709T000001_seed-tools-ocr": seedToolsOcrSql,
    "20260709T120000_conflicts": conflictsSql,
    "20260709T120001_seed-conflicts-permissions": seedConflictsPermissionsSql,
    "20260710T120000_seed-tools-email-inspector": seedToolsEmailInspectorSql,
    "20260714T210000_directory-email-normalized-address": directoryEmailNormalizedAddressSql,
    "20260717T120000_email-filing-records": emailFilingRecordsSql,
    "20260717T120001_seed-emails-permissions": seedEmailsPermissionsSql,
    "20260717T181411_conflicts-hit-co-party": conflictsHitCoPartySql,
    "20260717T224037_index-split-catalog": indexSplitCatalogSql,
    "20260803T120000_seed-esign-seal": seedEsignSealSql,
    "20260804T072255_matter-number-allocation": matterNumberAllocationSql,
    "20260804T082351_index-split-document-version": indexSplitDocumentVersionSql,
    "20260804T120000_shipment-purchase-claim": shipmentPurchaseClaimSql,
    "20260804T150000_document-automation": documentAutomationSql,
    "20260804T150001_seed-document-automation-permissions": seedDocumentAutomationPermissionsSql,
    "20260804T160000_custodian-register": custodianRegisterSql,
    "20260804T160001_seed-custody-catalog": seedCustodyCatalogSql,
    "20260804T170000_document-automation-field-mappings": documentAutomationFieldMappingsSql,
    "20260804T170001_custody-review-schedule": custodyReviewScheduleSql,
    "20260805T120000_trust-ledger": trustLedgerSql,
    "20260805T120001_seed-trust-permissions": seedTrustPermissionsSql,
    "20260805T120002_email-message-dkim-verdict": emailMessageDkimVerdictSql,
    "20260805T130000_custody-gated-release": custodyGatedReleaseSql,
    "20260805T130001_location-letterhead-logo": locationLetterheadLogoSql,
    "20260805T140000_trust-movements": trustMovementsSql,
    "20260805T150000_custodian-stocktake": custodianStocktakeSql,
    "20260805T160000_email-matter-link-linked-by-index": emailMatterLinkLinkedByIndexSql,
    "20260805T170000_trust-disbursement-authorization": trustDisbursementAuthorizationSql,
    "20260805T180000_custodian-destruction": custodianDestructionSql,
    "20260805T200000_trust-reconciliation": trustReconciliationSql,
    "20260805T220000_auto-file-rules": autoFileRulesSql,
    "20260805T230000_billing-invoices": billingInvoicesSql,
    "20260806T000000_case-calendar": caseCalendarSql,
    "20260806T010000_merge-field-catalog": mergeFieldCatalogSql,
    "20260806T020000_matter-assets": matterAssetsSql,
    "20260806T040000_operational-fixes": operationalFixesSql,
    "20260806T050000_magnus-conversations": magnusConversationsSql,
    "20260806T060000_billing-trust-application": billingTrustApplicationSql,
    "20260806T070000_matter-asset-classes-and-encumbrances": matterAssetClassesAndEncumbrancesSql,
    "20260806T080000_discovery-5-1-2": discoveryReviewSetModelSql,
    "20260807T020000_notifications-delivery": notificationsDeliverySql,
    "20260807T040000_matter-staffing": matterStaffingSql,
    "20260807T041000_matter-court-case": matterCourtCaseSql,
    "20260807T042000_matter-estate-and-capacity": matterEstateAndCapacitySql,
    "20260807T050000_trust-authorization-policy": trustAuthorizationPolicySql,
    "20260807T060000_billing-fee-models": billingFeeModelsSql,
    "20260807T070000_calendar-firm-events-resources-links": calendarFirmEventsResourcesLinksSql,
    "20260808T000000_discovery-review-coding-and-access": discoveryReviewCodingAndAccessSql,
    "20260808T010000_directory-pronouns": directoryPronounsSql,
    "20260808T020000_trust-authority-default-posture": trustAuthorityDefaultPostureSql,
    "20260812T000000_trust-firm-funds-and-unclaimed-funds": trustFirmFundsAndUnclaimedFundsSql,
    "20260812T000001_seed-trust-firm-funds-permission": seedTrustFirmFundsPermissionSql,
    "20260813T000000_document-assembly-output-format": documentAssemblyOutputFormatSql,
    "20260813T010000_billing-credit-notes": billingCreditNotesSql,
    "20260813T020000_index-split-membership": indexSplitMembershipSql,
    "20260813T030000_conflicts-recheck-ledger": conflictsRecheckLedgerSql,
    "20260814T000000_calendar-and-custody-index-fixes": calendarAndCustodyIndexFixesSql,
    "20260814T010000_seed-reports-permissions": seedReportsPermissionsSql,
    "20260815T000000_discovery-processing-route": discoveryProcessingRouteSql,
    "20260816T002417_notification-in-app-suppression": notificationInAppSuppressionSql,
    "20260816T090000_discovery-dedup-and-report": discoveryDedupAndReportSql,
    "20260816T152756_natural-language-search": naturalLanguageSearchSql,
    "20260816T160000_directory-match-keys": directoryMatchKeysSql,
    "20260816T170000_document-template-kind": documentTemplateKindSql,
    "20260817T000000_billing-invoice-delivery": billingInvoiceDeliverySql,
    "20260819T000000_index-split-corpus-scope": indexSplitCorpusScopeSql,
    "20260819T123505_index-automatic-email-links": indexAutomaticEmailLinksSql,
    "20260819T140000_seed-notification-policy-permission": seedNotificationPolicyPermissionSql,
    "20260819T220000_seed-document-editing-and-tools-permissions":
      seedDocumentEditingAndToolsPermissionsSql,
    "20260829T120000_seed-read-members-permission": seedReadMembersPermissionSql,
    "20260830T000000_conflicts-waiver-record": conflictsWaiverRecordSql,
    "20260830T120000_directory-contact-points": directoryContactPointsSql,
    "20260831T210000_seed-report-export-permission": seedReportExportPermissionSql,
    "20260831T230000_download-register": downloadRegisterSql,
    "20260831T230001_seed-download-register-permission": seedDownloadRegisterPermissionSql,
    "20260901T000000_seed-file-workbench-permission": seedFileWorkbenchPermissionSql,
    // Dated after main's on each merge: a tag has to stay monotonic with its idx, so the branch that
    // lands second renames its own migration rather than slotting in under an earlier stamp.
    "20260901T010000_matter-notes": matterNotesSql,
    "20260901T020000_download-item-requested-format": downloadItemRequestedFormatSql,
    "20260901T120000_matter-notes-edit-and-delete": matterNotesEditAndDeleteSql,
    "20260901T130000_time-entry-record-surfaces": timeEntryRecordSurfacesSql,
    "20260901T130001_consultation-number": consultationNumberSql,
    "20260901T130002_seed-matter-search-permission": matterSearchPermissionSql,
    "20260901T150000_tasks": tasksSql,
    "20260902T120000_matter-plans": matterPlansSql,
    "20260902T190000_time-entry-task-link": timeEntryTaskLinkSql,
    "20260902T230000_task-sync-seams": taskSyncSeamsSql,
    "20260903T000000_arrangement-agreement-file": arrangementAgreementFileSql,
    "20260903T010000_conflicts-check-history-index": conflictsCheckHistoryIndexSql,
    "20260903T020000_conflicts-hit-entity-index": conflictsHitEntityIndexSql,
    "20260903T090000_directory-identifier-label": directoryIdentifierLabelSql,
    "20260903T150000_intake-procedure": intakeProcedureSql,
    "20260905T195543_intake-step-kinds-client-forms-and-payment":
      intakeStepKindsClientFormsAndPaymentSql,
    "20260906T013304_matter-status-intake-and-consultation": matterStatusIntakeAndConsultationSql,
    "20260906T030014_matter-hold-status": matterHoldStatusSql,
    "20260906T120000_file-version-source-modified-at": fileVersionSourceModifiedAtSql,
    "20260906T160000_file-version-content-sha256-index": fileVersionContentSha256IndexSql,
    "20260906T170000_time-entry-work-date-index": timeEntryWorkDateIndexSql,
    "20260907T120000_conflicts-configure-permission": conflictsConfigurePermissionSql,
  });
}

// The lineage head (latest journal tag), ordered by the monotonic migration id — the same shape
// control-plane-migrations.ts exposes. Tests assert against this instead of a literal tag, so
// adding a migration does not break an unrelated provisioning assertion.
export function perFirmHeadSchemaVersion(): string {
  // A single pass for the greatest tag rather than a sort: the journal is already in order, only the
  // maximum is wanted, and neither `sort` (which mutates, so it needs a defensive copy) nor
  // `toSorted` (absent from this worker's TypeScript lib target) survives a formatter pass intact.
  let headTag: string | undefined;
  for (const entry of perFirmJournal.entries) {
    if (headTag === undefined || entry.tag > headTag) headTag = entry.tag;
  }
  if (headTag === undefined) throw new Error("per-firm migration journal is empty");
  return headTag;
}
