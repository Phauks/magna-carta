/*
 * DateTimeField is a single self-contained component (one field for a day, a time, or both, with one
 * panel holding the month and a list of times), so there is no namespace — just the component and
 * the pure arithmetic its list is built from.
 */
export { default as DateTimeField } from "./date-time-field.svelte";
export {
  DEFAULT_TIME_STEP_MINUTES,
  minuteOfDay,
  spanLabel,
  timeChoices,
  timeOfMinute,
  type TimeChoice,
} from "./time-choices.ts";
