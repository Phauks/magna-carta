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
import {
  CHILD_ROW_INDENT,
  type TabularExportCell,
  type TabularExportDocument,
  type TabularExportFigure,
  type TabularExportSection,
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
  /**
   * The report's own total for the section, drawn under the rows, ruled off, and outside any sort.
   * It arrives from the payload's totals; a presenter never adds the rows above it up.
   */
  readonly totalRow?: readonly ReportCell[];
  /** The reader may sort by any column: a figure by its number, anything else by its text. */
  readonly sortable?: boolean;
  /**
   * Rows under each row, in the same columns, indexed with `rows`: a client's matters. The screen
   * opens them under the row on a press; the file prints them under it, so both carry the same
   * figures.
   */
  readonly rowDetails?: readonly (readonly (readonly ReportCell[])[])[];
  /** Column indexes whose non-zero figures read in the attention tone: debt over ninety days. */
  readonly attentionColumns?: readonly number[];
  /**
   * Columns the on-screen table draws under the first column's text rather than as columns of
   * their own (a client's office, under the client's name), so the figures keep their width in a
   * narrow column. The file and the cards keep them as columns.
   */
  readonly subordinateColumns?: readonly number[];
  /** One short line at the end of the section's heading: the completeness declaration. */
  readonly aside?: string;
}

/**
 * One figure in the row of totals the report opens with. The value is the payload's own total,
 * formatted; the detail is a count the payload also carries. A tile never derives a figure.
 */
export interface ReportSummaryTile {
  readonly label: string;
  readonly value: string;
  readonly detail: string | null;
  /** `attention` paints the figure in the danger tone; `total` is the closing tile, filled. */
  readonly tone: "plain" | "attention" | "total";
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
  /**
   * The row of totals the report opens with, where it has one: the totals-first layout. A
   * report with a summary carries its stamp as one line under the tiles rather than as a panel.
   */
  readonly summary?: readonly ReportSummaryTile[];
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
    ...exportRowsOf(section),
    ...(section.endAlignedColumns === undefined
      ? {}
      : { endAlignedColumns: section.endAlignedColumns }),
  }));
  const summary = presentation.summary?.map((tile): TabularExportFigure => ({
    label: tile.label,
    value: tile.value,
    ...(tile.detail === null ? {} : { note: tile.detail }),
    ...(tile.tone === "attention" ? { alert: true as const } : {}),
  }));
  return {
    title:
      presentation.subtitle === null
        ? presentation.title
        : `${presentation.title} - ${presentation.subtitle}`,
    generatedAt,
    sections,
    ...(summary === undefined || summary.length === 0 ? {} : { summary }),
  };
}

/**
 * A section's rows as the file prints them: each row with its detail rows under it, the first cell
 * indented so a reader of the file sees which client a matter belongs to, then the total row. The
 * kinds say the same for the PDF, which steps a child in and sets the total in bold itself.
 */
function exportRowsOf(section: ReportSection): {
  readonly rows: readonly (readonly ReportCell[])[];
  readonly rowKinds?: readonly ("total" | "child" | null)[];
} {
  const rows: (readonly ReportCell[])[] = [];
  const rowKinds: ("total" | "child" | null)[] = [];
  section.rows.forEach((row, rowIndex) => {
    rows.push(row);
    rowKinds.push(null);
    for (const detail of section.rowDetails?.[rowIndex] ?? []) {
      rows.push(detail.map((cell, columnIndex) => (columnIndex === 0 ? indented(cell) : cell)));
      rowKinds.push("child");
    }
  });
  if (section.totalRow !== undefined) {
    rows.push(section.totalRow);
    rowKinds.push("total");
  }
  return rowKinds.some((kind) => kind !== null) ? { rows, rowKinds } : { rows };
}

function indented(cell: ReportCell): ReportCell {
  return typeof cell === "string"
    ? `${CHILD_ROW_INDENT}${cell}`
    : { ...cell, text: `${CHILD_ROW_INDENT}${cell.text}` };
}

/** How the completeness declaration reads on the cover. */
export function completenessLine(completeness: ReportCompleteness): string {
  switch (completeness.scope) {
    case "complete":
      return "All matters in scope were read.";
    case "complete-not-itemized":
      return `Totals include ${String(completeness.notItemizedMatterCount)} matters that aren't itemized.`;
    case "screened":
      return `${String(completeness.excludedMatterCount)} matters were excluded, so these figures won't match the firm's books.`;
  }
}
