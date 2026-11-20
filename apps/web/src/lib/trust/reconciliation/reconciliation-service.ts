/*
 * Everything the reconciliation screens ask of the outside world, as one object handed in. The
 * routes hand in the live one; the developer-console gallery hands in one over fixtures, so the
 * screens a reviewer looks at there are these screens and not a second rendering of them.
 */
import type { HouseDocument } from "@magna-carta/house-document";
import { openPdf } from "$lib/trust/checks/check-pdf.ts";
import { openBeside } from "$lib/navigation/open-beside.ts";
import * as api from "./reconciliation-api.ts";
import { composeReportPdf } from "./reconciliation-report-pdf.ts";

export type ReconciliationService = {
  readonly readList: typeof api.readReconciliations;
  readonly read: typeof api.readReconciliation;
  readonly start: typeof api.startReconciliation;
  readonly edit: typeof api.editReconciliation;
  readonly revert: typeof api.revertReconciliationChange;
  readonly save: typeof api.saveReconciliation;
  readonly restore: typeof api.restoreReconciliation;
  readonly addInterest: typeof api.addReconciliationInterest;
  readonly removeInterest: typeof api.removeReconciliationInterest;
  readonly addNote: typeof api.addReconciliationNote;
  readonly attachFile: typeof api.attachReconciliationFile;
  readonly removeFile: typeof api.removeReconciliationFile;
  readonly finish: typeof api.finishReconciliation;
  readonly fileUrl: typeof api.readReconciliationFileUrl;
  /** Compose the report into a PDF, off the main thread. Throws ReportPdfError. */
  readonly composeReport: (document: HouseDocument) => Promise<Blob>;
  /** Hand a PDF to the browser to read or print. */
  readonly openPdf: (pdf: Blob) => void;
  /** Open a kept file in a new tab. */
  readonly openUrl: (url: string) => void;
};

export const liveReconciliationService: ReconciliationService = {
  readList: api.readReconciliations,
  read: api.readReconciliation,
  start: api.startReconciliation,
  edit: api.editReconciliation,
  revert: api.revertReconciliationChange,
  save: api.saveReconciliation,
  restore: api.restoreReconciliation,
  addInterest: api.addReconciliationInterest,
  removeInterest: api.removeReconciliationInterest,
  addNote: api.addReconciliationNote,
  attachFile: api.attachReconciliationFile,
  removeFile: api.removeReconciliationFile,
  finish: api.finishReconciliation,
  fileUrl: api.readReconciliationFileUrl,
  composeReport: composeReportPdf,
  openPdf,
  openUrl: (url) => openBeside(url, "file"),
};
