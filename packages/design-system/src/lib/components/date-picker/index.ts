/*
 * DatePicker is a single self-contained component (it bakes the typed field + popover calendar),
 * so there is no namespace — just the styled wrapper. The popover calendar reuses the mc-calendar-*
 * recipes; only the date field adds recipes (mc-date-field-*).
 */
export { default as DatePicker } from "./date-picker.svelte";
export { civilDateText, civilDateTextOrEmpty, civilDateValue } from "./civil-date-value.ts";
export { dateFieldClasses } from "./variants.ts";
