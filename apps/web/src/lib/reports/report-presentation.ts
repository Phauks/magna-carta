/*
 * WHAT A REPORT LOOKS LIKE, once it has been read: a title, the stamp the response wrote about its
 * own reproducibility, the completeness declaration, and titled sections of headers and rows.
 *
 * The shape is the tabular export document's shape on purpose. The run screen draws each section
 * as a table and the export menu renders the same sections through $lib/export, so a file cannot
 * disagree with the screen: both are one presentation, built once by the report's presenter.
 *
 * A PRESENTER COMPUTES NOTHING. Opening and closing balances, running balances, the difference
 * between an attestation and the live proof — every figure arrives in the payload from the
 * reporting package, where the agreement tests prove it. A presenter formats and arranges. The
 * moment one sums a column it has become a second answer to a question the ledger already
 * answered, which is the one thing the reporting design forbids.
 */
import type {
  TabularExportCell,
  TabularExportDocument,
  TabularExportSection,
} from "$lib/export/tabular-export.ts";

/** One cell: text, or a figure with the text a reader sees and the number a spreadsheet sums. */
export type ReportCell = TabularExportCell;

export interface ReportSection {
  /** Stable within the report, so a screen can key on it and a test can name it. */
  readonly id: string;
  readonly title: string;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly ReportCell[])[];
  /** Column indexes that read as figures and sit against the right edge. */
  readonly endAlignedColumns?: readonly number[];
  /**
   * One sentence the section says about itself, where the response said one: "No reconciliation
   * was closed in this period", or that a block is as at production rather than as at the
   * knowledge instant. Never explanatory prose about what the section is.
   */
  readonly note?: string;
  /** What an empty section says in its one placeholder row. */
  readonly whenEmpty: string;
}

/** What a report says about how much of the firm it covered, as the response declared it. */
export type ReportCompleteness =
  | { readonly scope: "complete" }
  | { readonly scope: "complete-not-itemized"; readonly notItemizedMatterCount: number }
  | { readonly scope: "screened"; readonly excludedMatterCount: number };

export interface ReportPresentation {
  readonly title: string;
  /** The subject, where the report has one: the trust account's name. */
  readonly subtitle: string | null;
  /** The reproducibility statement the response wrote, in its own words. */
  readonly stamp: string;
  readonly reproducible: boolean;
  readonly completeness: ReportCompleteness;
  readonly sections: readonly ReportSection[];
}

/** A figure with both faces: the text the screen prints and the number a spreadsheet sums. */
export function figureCell(text: string, number: number): ReportCell {
  return { text, number };
}

/**
 * The export document for a presentation — the same sections, the title carrying the subject.
 * Nothing is added or dropped here: the stamp travels in the report's own provenance section,
 * which every presenter writes, so the file carries the statement the screen showed.
 */
export function reportExportDocument(
  presentation: ReportPresentation,
  generatedAt: Date,
): TabularExportDocument {
  const sections: TabularExportSection[] = presentation.sections.map((section) => ({
    title: section.title,
    headers: section.headers,
    rows: section.rows,
    ...(section.endAlignedColumns === undefined
      ? {}
      : { endAlignedColumns: section.endAlignedColumns }),
  }));
  return {
    title:
      presentation.subtitle === null
        ? presentation.title
        : `${presentation.title} - ${presentation.subtitle}`,
    generatedAt,
    sections,
  };
}

/** How the completeness declaration reads on the cover. */
export function completenessLine(completeness: ReportCompleteness): string {
  switch (completeness.scope) {
    case "complete":
      return "All matters in scope were read.";
    case "complete-not-itemized":
      return `Totals include ${String(completeness.notItemizedMatterCount)} matters that are not itemized.`;
    case "screened":
      return `${String(completeness.excludedMatterCount)} matters were excluded, so these figures do not tie to the firm's books.`;
  }
}
