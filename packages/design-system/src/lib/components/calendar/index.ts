/*
 * Calendar is a single self-contained component (it bakes the full month-grid composition), so unlike
 * the multi-part components there is no namespace — just the styled wrapper. DatePicker composes its
 * own calendar against the date-picker context, so it does not reuse this component directly.
 */
export { default as Calendar } from "./calendar.svelte";
export { default as MonthJump } from "./month-jump.svelte";
