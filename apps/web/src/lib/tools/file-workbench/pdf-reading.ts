/*
 * The PDF tab's words: a PDF's summary (`$lib/pdf-editor/pdf-summary.ts`) as the rows of its table,
 * and the PDF Editor's tools as this bench file can use them.
 *
 * DOM-free, so what each row says, and which tools are shut and why, is checked without rendering.
 */
import type { PdfPageSize } from "$lib/documents/pdf-pages.ts";
import {
  editorToolsFor,
  toolAvailability,
  type EditorTool,
  type ToolAvailability,
} from "$lib/pdf-editor/editor-subject.ts";
import type { BatesLabelsFound, PdfSummary } from "$lib/pdf-editor/pdf-summary.ts";

/** Paper sizes a person names, in points, portrait. */
const NAMED_SIZES: readonly {
  readonly name: string;
  readonly widthPt: number;
  readonly heightPt: number;
}[] = [
  { name: "Letter", widthPt: 612, heightPt: 792 },
  { name: "Legal", widthPt: 612, heightPt: 1008 },
  { name: "Tabloid", widthPt: 792, heightPt: 1224 },
  { name: "A4", widthPt: 595.28, heightPt: 841.89 },
  { name: "A3", widthPt: 841.89, heightPt: 1190.55 },
  { name: "A5", widthPt: 419.53, heightPt: 595.28 },
];

/** How far a page may be from a named size and still be called it. Scanners round. */
const SIZE_TOLERANCE_PT = 3;

const close = (a: number, b: number): boolean => Math.abs(a - b) <= SIZE_TOLERANCE_PT;

/** Points to inches, to one decimal place. */
const inches = (points: number): string => String(Math.round((points / 72) * 10) / 10);

/** A page's size as a person says it: "Letter", "A4 landscape", or "8.5 × 14.2 in". */
export function pageSizeName(size: PdfPageSize): string {
  for (const named of NAMED_SIZES) {
    if (close(size.widthPt, named.widthPt) && close(size.heightPt, named.heightPt))
      return named.name;
    if (close(size.widthPt, named.heightPt) && close(size.heightPt, named.widthPt)) {
      return `${named.name} landscape`;
    }
  }
  return `${inches(size.widthPt)} × ${inches(size.heightPt)} in`;
}

/** "6 · Letter", or "6 · Mixed sizes" where the pages differ. */
export function describePages(pages: readonly PdfPageSize[]): string {
  const names = new Set(pages.map(pageSizeName));
  const [only] = names;
  if (only === undefined) return "None";
  return `${pages.length} · ${names.size === 1 ? only : "Mixed sizes"}`;
}

/** "23 fields, none filled", or "None" for a PDF with no form. */
export function describeForm(form: PdfSummary["form"]): string {
  if (form === null) return "None";
  const fields = form.fields === 1 ? "1 field" : `${form.fields} fields`;
  const filled =
    form.filled === 0 ? "none" : form.filled === form.fields ? "all" : String(form.filled);
  return `${fields}, ${filled} filled`;
}

function sentenceList(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`;
}

/** The Password row: its value, and the note saying what the limits withhold. */
export function describeProtection(
  summary: Pick<PdfSummary, "needsPassword" | "encrypted" | "limits">,
): {
  readonly value: string;
  readonly note?: string;
} {
  if (summary.needsPassword) return { value: "Needed to open" };
  if (summary.encrypted) {
    return summary.limits.length > 0
      ? { value: "Limits only", note: `No ${sentenceList(summary.limits)}.` }
      : { value: "Limits only" };
  }
  return { value: "None" };
}

/** The Bates row: the range found, and how many pages carry it. */
export function describeBates(
  bates: BatesLabelsFound | null,
  pageCount: number,
): { readonly value: string; readonly note?: string } {
  if (bates === null) return { value: "None found" };
  return {
    value: bates.first === bates.last ? bates.first : `${bates.first} to ${bates.last}`,
    note: `On ${bates.pagesLabelled} of ${pageCount} ${pageCount === 1 ? "page" : "pages"}`,
  };
}

export interface ToolRow {
  readonly tool: EditorTool;
  /** What the tool does, or why it is shut on this file. */
  readonly description: string;
  readonly availability: ToolAvailability;
}

/**
 * The PDF Editor's tools as this bench file can use them. Before the file is read every tool is
 * listed as it is; once it is read, a PDF that needs a password shuts all of them, and one with no
 * form shuts Forms.
 */
export function toolRowsFor(summary: PdfSummary | null): readonly ToolRow[] {
  return editorToolsFor("bench").map((tool): ToolRow => {
    const shut = (reason: string): ToolRow => ({
      tool,
      description: reason,
      availability: { available: false, reason },
    });
    const availability = toolAvailability(tool.id, "bench");
    if (!availability.available) return shut(availability.reason);
    if (summary?.needsPassword === true)
      return shut("Unlock it first: it needs a password to open.");
    if (tool.id === "forms" && summary !== null) {
      if (summary.form === null) return shut("This PDF has no form fields.");
      return {
        tool,
        description:
          summary.form.fields === 1
            ? "Fill the field, or flatten it"
            : `Fill the ${summary.form.fields} fields, or flatten them`,
        availability,
      };
    }
    return { tool, description: tool.description, availability };
  });
}
