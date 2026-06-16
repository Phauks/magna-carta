/*
 * DatePicker is a single self-contained component (it bakes the segmented field + popover calendar),
 * so there is no namespace — just the styled wrapper. The popover calendar reuses the mc-calendar-*
 * recipes; only the segmented date field adds recipes (mc-date-field-*).
 */
export { default as DatePicker } from "./date-picker.svelte";
