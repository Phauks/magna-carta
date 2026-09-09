/*
 * The printed sheet, as the app assembles one. The document model itself is the design system's
 * (@magna-carta/design-system/print-sheet); what lives here is the formatting seam every sheet
 * takes, so no sheet decides for itself what a date on paper means.
 */
export { printSheetDates, type PrintSheetDates } from "./formatting.ts";
