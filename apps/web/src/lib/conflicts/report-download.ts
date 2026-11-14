/*
 * Download Report — the printed sheet, as a file.
 *
 * The check's screen has exactly two controls over its report: Print Report, which hands the sheet
 * to the browser's print dialog, and Download Report, which hands the same sheet over as a PDF. The
 * two must never disagree, so the download is a projection of the very PrintSheetDocument the print
 * control shows, composed by the platform's PDF composer ($lib/export/render-pdf.ts) rather
 * than a second layout of the check.
 *
 * WHAT THE PROJECTION KEEPS. The renderer takes tables — a title, sections of headers and rows — so
 * each section of the sheet becomes one: a fields section is a two-column table of label and value,
 * a text section is one column of sentences, one per row, and a history section is the events in
 * order. Nothing is summarized on the way, for the reason nothing on the sheet is: the sentences
 * are the engine's own account of its search.
 *
 * WHERE THE FILE GOES is the member's own preference, which the export menu already honours: with
 * download-immediately on, the bytes are saved now and the shelf records the report as taken;
 * otherwise the report is kept on the member's Downloads shelf, to be taken with the rest. This
 * module follows the same two paths for the same reasons, so a report downloads exactly the way a
 * ledger export does.
 */
import type { PrintSheetDocument } from "@magna-carta/design-system/print-sheet";
import { formatInstant } from "@magna-carta/design-system/formatters";
import { keepExportOnShelf, readDownloadPreferences } from "$lib/export/download-shelf.ts";
import { markShelfChanged } from "$lib/export/download-shelf-signal.svelte.ts";
import { renderPdfExport } from "$lib/export/render-pdf.ts";
import {
  ExportRenderError,
  exportFilename,
  saveExport,
  type TabularExportDocument,
  type TabularExportSection,
} from "$lib/export/tabular-export.ts";

/** The sheet as the document renderer takes it. Pure, so the projection has a test of its own. */
export function reportExportDocument(
  sheet: PrintSheetDocument,
  generatedAt: Date,
): TabularExportDocument {
  const title =
    sheet.reference === undefined ? sheet.heading : `${sheet.heading} ${sheet.reference}`;
  const sections: TabularExportSection[] = sheet.sections.map((section) => {
    const sectionTitle = section.title ?? sheet.heading;
    switch (section.kind) {
      case "fields":
        return {
          title: sectionTitle,
          headers: ["Fact", "Value"],
          rows: section.fields.map((field) => [
            field.label,
            field.secondary === undefined ? field.value : `${field.value} (${field.secondary})`,
          ]),
        };
      case "text":
        return {
          title: sectionTitle,
          headers: ["Statement"],
          rows: section.text.split("\n").map((line) => [line]),
        };
      case "history":
        return {
          title: sectionTitle,
          headers: ["When", "Event"],
          rows: section.events.map((event) => [formatInstant(event.at), event.action]),
        };
    }
  });
  if (sheet.subtitle !== undefined) {
    sections.unshift({
      title: "About This Report",
      headers: ["Fact", "Value"],
      rows: [["Filed under", sheet.subtitle]],
    });
  }
  return { title, generatedAt, sections };
}

/** What Download Report came to, in one sentence a toast can carry. */
export type ReportDownloadOutcome =
  | { readonly kind: "saved" }
  | { readonly kind: "shelved" }
  | { readonly kind: "saved-not-kept"; readonly message: string }
  | { readonly kind: "failed"; readonly message: string };

const PDF_CONTENT_TYPE = "application/pdf";

/**
 * Download the sheet as a PDF, the way the export menu downloads a table: saved now where the
 * member has asked for that, kept on their Downloads shelf either way, and never left with neither.
 */
export async function downloadReport(
  fetchImpl: typeof fetch,
  sheet: PrintSheetDocument,
): Promise<ReportDownloadOutcome> {
  const exportDocument = reportExportDocument(sheet, new Date());
  const preferences = await readDownloadPreferences(fetchImpl);
  const saveImmediately = preferences.kind === "ok" && preferences.value.saveImmediately;
  try {
    if (saveImmediately) {
      await saveExport(
        await renderPdfExport(exportDocument),
        exportFilename(exportDocument, "pdf"),
        PDF_CONTENT_TYPE,
      );
    }
    const kept = await keepExportOnShelf(fetchImpl, exportDocument, "pdf", saveImmediately);
    if (kept.kind !== "ok") {
      const errorId = kept.kind === "problem" ? kept.problem.errorId : undefined;
      const suffix = errorId === undefined ? "" : ` (Error ID ${errorId})`;
      if (saveImmediately) {
        return {
          kind: "saved-not-kept",
          message: `Downloaded, but it could not be added to your Downloads.${suffix}`,
        };
      }
      // The shelf refused and nothing has been produced yet. A member who asked for the report
      // must not be left with neither, so hand them the file and say plainly it was not kept.
      await saveExport(
        await renderPdfExport(exportDocument),
        exportFilename(exportDocument, "pdf"),
        PDF_CONTENT_TYPE,
      );
      return {
        kind: "saved-not-kept",
        message: `Downloaded instead: it could not be added to your Downloads.${suffix}`,
      };
    }
    markShelfChanged();
    return saveImmediately ? { kind: "saved" } : { kind: "shelved" };
  } catch (failure) {
    const message =
      failure instanceof ExportRenderError
        ? failure.errorId === undefined
          ? failure.message
          : `${failure.message} (Error ID ${failure.errorId})`
        : "Couldn't produce the report.";
    return { kind: "failed", message };
  }
}
