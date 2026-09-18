/*
 * The shared display vocabulary: the platform's one answer for each of the small questions every
 * surface asks — how long, when, which day, how much, who, which version, and what a field's
 * ghost text says.
 *
 * Each of these encodes a ruling that has already been issued, and every one of them was worth
 * landing before the surfaces that need it: a second answer to any of these questions is a
 * correction that has to be re-issued screen by screen.
 *
 * This is the package's curated boundary for the group. Inside the package, import the specific
 * module instead, so nothing pulls the whole set for one function.
 */
export {
  formatDate,
  formatDateRange,
  formatMonth,
  type CivilDateInput,
  type CivilDateOptions,
} from "./civil-date.ts";
export {
  formatClock,
  formatDuration,
  type ClockOptions,
  type DurationOptions,
  type FormattedDuration,
} from "./duration.ts";
export { formatMoney, formatNumber, type MoneyOptions, type NumberOptions } from "./money.ts";
export {
  formatInstant,
  formatInstantDate,
  formatTimeOfDay,
  formatTimeZoneAbbreviation,
  instantAttribute,
  readInstant,
  type Instant,
  type InstantDateLength,
  type InstantOptions,
} from "./instant.ts";
export {
  personName,
  UNRECORDED_PERSON,
  type PersonNameOptions,
  personInitials,
} from "./person-name.ts";
export { placeholderOf, readsAsFieldName } from "./placeholder.ts";
export { formatVersion, type VersionOptions } from "./version.ts";
