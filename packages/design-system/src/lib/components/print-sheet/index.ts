/*
 * PrintSheet — the printable unit: one component that prints any record, and one place that
 * decides what a client may see on it.
 *
 * The default export is the sheet. The projection helpers beside it are how a consumer turns a
 * record into a document, and they are the reason the firm's internal text cannot reach the paper:
 * a record still carrying it does not type-check, and the selector that picks printed fields
 * cannot name it.
 */
export { default } from "./print-sheet.svelte";
export {
  INTERNAL_ONLY_FIELD_KEYS,
  type ClientFacingRecord,
  type InternalOnlyFieldKey,
  type PrintSheetFieldSpecification,
  type PrintableFieldKey,
  type WithoutInternalText,
  clientFacingRecord,
  printSheetFields,
} from "./client-facing-projection.ts";
export { PRINT_SHEET_EMPTY_HISTORY_TEXT, printSheetTextContent } from "./print-sheet-text.ts";
export type {
  PrintSheetDocument,
  PrintSheetField,
  PrintSheetFieldsSection,
  PrintSheetHistorySection,
  PrintSheetSection,
  PrintSheetTextSection,
} from "./types.ts";
