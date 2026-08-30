/*
 * What the paper says, string by string, in the order the paper says it.
 *
 * The sheet renders data and nothing else — no snippet, no HTML, no caller-supplied formatter —
 * so the document's own strings plus the instants it formats ARE the printed page. Enumerating
 * them here gives two things a rendered page cannot: a caller that needs the sheet as text (a
 * copy-out, a plain-text mail body) gets it without a second representation, and a test can assert
 * what a printed sheet does and does not say without a browser.
 *
 * This function and print-sheet.svelte are two readings of one document and must stay in step; the
 * component's story asserts the rendered page against this list, so a drift between them is a test
 * failure rather than something discovered on a client's copy of a bill.
 */
import { eventInstantText } from "../event-rail/event-instant.ts";
import type { PrintSheetDocument } from "./types.ts";

/**
 * What a history section says when nothing has been recorded yet. The same sentence the on-screen
 * rail uses, because it is the same fact stated in the same product.
 */
export const PRINT_SHEET_EMPTY_HISTORY_TEXT = "Nothing has been recorded here yet.";

/** Every string the sheet states, in reading order. */
export function printSheetTextContent(sheet: PrintSheetDocument): string[] {
  const stated: string[] = [sheet.heading];
  if (sheet.reference !== undefined) stated.push(sheet.reference);
  if (sheet.subtitle !== undefined) stated.push(sheet.subtitle);

  for (const section of sheet.sections) {
    if (section.title !== undefined) stated.push(section.title);
    if (section.kind === "fields") {
      for (const field of section.fields) {
        stated.push(field.label, field.value);
        if (field.secondary !== undefined) stated.push(field.secondary);
      }
    } else if (section.kind === "text") {
      stated.push(section.text);
    } else if (section.events.length === 0) {
      stated.push(PRINT_SHEET_EMPTY_HISTORY_TEXT);
    } else {
      for (const event of section.events) {
        stated.push(event.action, eventInstantText(event.at), event.source);
        if (event.detail !== undefined) stated.push(event.detail);
      }
    }
  }

  if (sheet.footer !== undefined) stated.push(sheet.footer);
  return stated;
}
