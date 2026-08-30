/*
 * The printed document for the record the review gallery shows, built the way a consumer has to
 * build one.
 *
 * IT IS ITS OWN MODULE FOR ONE REASON: the projection helpers live in the design system's print
 * package, whose entry point also carries the sheet component, so importing them pulls a Svelte
 * component and everything under it. The fixture data next door has no such dependency and stays
 * loadable anywhere; this file is imported by the page alone.
 *
 * The firm's own note about the matter goes in one end and cannot come out the other. It is removed
 * by `clientFacingRecord` rather than left out by whoever remembered to, the field selection cannot
 * name it, and the sheet accepts no snippet, no markup and no caller-supplied formatter through
 * which it could arrive by another route.
 */
import {
  clientFacingRecord,
  printSheetFields,
  type PrintSheetDocument,
} from "@magna-carta/design-system/print-sheet";
import {
  GALLERY_CHARGE,
  GALLERY_MATTER,
  GALLERY_HISTORY,
  GALLERY_RECORD,
} from "./record-window-fixtures.ts";

/** The record with its internal-only text removed, in the value and in the type. */
export const GALLERY_CHARGE_ON_PAPER = clientFacingRecord(GALLERY_CHARGE);

/**
 * The stated facts of the record, in one list.
 *
 * The window's record pane and the printed sheet both read this, so the screen and the paper cannot
 * come to disagree about what the record says. The duration carries its clock form as the secondary
 * rendering of the same value, which is the rule wherever a duration appears.
 */
export const GALLERY_RECORD_FIELDS = printSheetFields(GALLERY_CHARGE_ON_PAPER, [
  { key: "workDate", label: "Date" },
  { key: "timekeeper", label: "Timekeeper" },
  { key: "hours", label: "Hours", secondaryKey: "hoursClockForm" },
  { key: "rate", label: "Rate" },
  { key: "amount", label: "Amount" },
]);

/** The full printed sheet: the facts, the narrative the client is charged against, the history. */
export const GALLERY_SHEET: PrintSheetDocument = {
  heading: "Time Entry",
  reference: GALLERY_RECORD.reference,
  subtitle: `${GALLERY_MATTER.title}, ${GALLERY_MATTER.client}`,
  sections: [
    { id: "work", kind: "fields", title: "The Work", fields: GALLERY_RECORD_FIELDS },
    {
      id: "description",
      kind: "text",
      title: "Description",
      text: GALLERY_CHARGE_ON_PAPER.description,
    },
    { id: "history", kind: "history", title: "History", events: GALLERY_HISTORY },
  ],
  footer: "Printed 24 August 2026 by Marian Holt.",
};
