/*
 * The projection helpers ALONE, with no component behind them.
 *
 * Deciding what a client may see is a pure question about a record, and the answer is wanted in
 * places that will never render a sheet: a server deciding what to attach to a mail, a test asserting
 * an absence, a node-side tool. Reaching those helpers through the component's own entry point drags
 * the sheet — and Bits UI with it — into every one of those callers, which puts a browser dependency
 * behind a question that has nothing to do with a browser.
 *
 * So this path exists to be imported without cost. It adds no logic of its own: the rules live where
 * they lived, and this is the door to them.
 */
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
