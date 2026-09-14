/*
 * The office family: the one field that picks an office, the one mark that names one, and what
 * they read from. A surface that names an office imports from here and never assembles its own.
 */
export { default as OfficePicker } from "./office-picker.svelte";
export { default as OfficeLink } from "./office-link.svelte";
export { default as OfficeRecordWindow } from "./office-record-window.svelte";
export { firmOffices, FirmOffices } from "./firm-offices.svelte.ts";
export { officeCitation, officePlace, officeRecordHref } from "./office-vocabulary.ts";
export type { OfficeDetail, OfficeSummary, OfficeAddress } from "./offices-api.ts";
