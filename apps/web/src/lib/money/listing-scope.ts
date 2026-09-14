/*
 * The bridge between a table's column filters and the listing that serves it.
 *
 * A COLUMN FILTER THAT NARROWS ONLY THE LOADED PAGE IS NOT A FILTER. On a cursor-paged register it
 * answers confidently about a fraction of the record: a reader filtering Status to Draft would be
 * told there are three drafts when the month holds thirty. So the money screens send the filters
 * the server can honour — a date range, one status, one billing choice, one timekeeper — as the
 * listing's own parameters, and the table's in-browser filter then runs over rows that already
 * match. The screens used to carry a second control in their header for exactly these choices,
 * which answered the question the column already asked (docs/conventions/time-tab-rulings.md,
 * round twelve); the header control went, and these helpers are what took its place.
 *
 * THE SAME CHOICES RIDE THE ADDRESS, so a bookkeeper's month or a partner's view of one person's
 * time is still a link somebody can send. The address carries the wire value (`status=draft`,
 * `billable=true`) rather than the column's word, so a link outlives a relabel.
 *
 * Pure functions, so the translation is pinned by a test rather than by a browser.
 */
import { CIVIL_DATE_PATTERN } from "@magna-carta/civil-time/civil-date";
import type { GridColumnFilter, GridFilters } from "@magna-carta/design-system/data-table";

/** One value a set-filtered column may take: as the wire says it, and as the column shows it. */
export interface FilterChoice<TValue extends string = string> {
  readonly value: TValue;
  readonly label: string;
}

/** The two bounds a date column's filter carries. An absent bound is an open one. */
export interface DateBounds {
  readonly from?: string;
  readonly to?: string;
}

/** The bounds a date column's filter has set, ready to be sent as the listing's `from` and `to`. */
export function dateBoundsOf(filter: GridColumnFilter | undefined): DateBounds {
  if (filter?.kind !== "dateRange") return {};
  return {
    ...(filter.from === null ? {} : { from: filter.from }),
    ...(filter.to === null ? {} : { to: filter.to }),
  };
}

/**
 * The one choice a set filter has settled on, or undefined where it holds none or several.
 *
 * A listing takes one status, one billing choice, one timekeeper. A set filter can hold several,
 * and when it does the server is asked for everything and the table narrows the loaded rows — the
 * one place this bridge still leaves a filter over the page in hand, named here so nobody mistakes
 * it for the general case. A listing that took a list would close it.
 */
export function singleChoiceOf<TValue extends string>(
  filter: GridColumnFilter | undefined,
  choices: readonly FilterChoice<TValue>[],
): TValue | undefined {
  if (filter?.kind !== "set" || filter.values.length !== 1) return undefined;
  const [label] = filter.values;
  return choices.find((choice) => choice.label === label)?.value;
}

/**
 * Every choice a set filter holds, as the wire spells them, for a listing that takes a list.
 *
 * The Status columns send their whole selection: Draft and Submitted together is "the work in
 * progress", and a listing that took one status would have left that narrowing to the loaded rows.
 * Empty where nothing is filtered, or where the filter holds only words the column does not offer.
 */
export function choicesOf<TValue extends string>(
  filter: GridColumnFilter | undefined,
  choices: readonly FilterChoice<TValue>[],
): readonly TValue[] {
  if (filter?.kind !== "set") return [];
  return choices.filter((choice) => filter.values.includes(choice.label)).map((c) => c.value);
}

/** The set filter holding these choices, by their wire values; undefined where none is offered. */
export function choicesFilter<TValue extends string>(
  values: readonly string[],
  choices: readonly FilterChoice<TValue>[],
): GridColumnFilter | undefined {
  const labels = choices.filter((choice) => values.includes(choice.value)).map((c) => c.label);
  return labels.length === 0 ? undefined : { kind: "set", values: labels };
}

/** The set filter holding exactly one choice, by its wire value. Undefined for a value nobody offers. */
export function singleChoiceFilter<TValue extends string>(
  value: string | null | undefined,
  choices: readonly FilterChoice<TValue>[],
): GridColumnFilter | undefined {
  if (value === null || value === undefined) return undefined;
  const choice = choices.find((candidate) => candidate.value === value);
  return choice === undefined ? undefined : { kind: "set", values: [choice.label] };
}

/** A civil date exactly as the address spelled it, or null for anything that is not one. */
export function civilDateOrNull(text: string | null | undefined): string | null {
  return typeof text === "string" && CIVIL_DATE_PATTERN.test(text) ? text : null;
}

/** The date filter the address names: either bound, both, or none at all. */
export function dateRangeFilter(
  from: string | null,
  to: string | null,
): GridColumnFilter | undefined {
  if (from === null && to === null) return undefined;
  return { kind: "dateRange", from, to };
}

/**
 * The address after the filters, as one record of parameters: a key set to a string is written, one
 * set to a list is written once per value (`status=draft&status=submitted`, as the listings take
 * it), and one set to undefined or an empty list is removed, so a cleared filter leaves the address
 * rather than lingering as a value that would re-narrow the screen the next time the link is opened.
 */
export function addressAfterFilters(
  url: URL,
  parameters: Readonly<Record<string, string | readonly string[] | undefined>>,
): URL {
  const next = new URL(url);
  for (const [key, value] of Object.entries(parameters)) {
    next.searchParams.delete(key);
    if (value === undefined) continue;
    for (const each of typeof value === "string" ? [value] : value) {
      next.searchParams.append(key, each);
    }
  }
  return next;
}

/**
 * The grid's filters with the address's written over them, so a linked view opens already
 * narrowed. A seed that names nothing leaves the column alone rather than clearing it.
 */
export function filtersSeededBy(
  filters: GridFilters,
  seeded: Readonly<Record<string, GridColumnFilter | undefined>>,
): GridFilters {
  const next: Record<string, GridColumnFilter> = { ...filters };
  for (const [columnId, filter] of Object.entries(seeded)) {
    if (filter !== undefined) next[columnId] = filter;
  }
  return next;
}

/**
 * The one member a Timekeeper set filter names, as the user identifier the listing takes.
 *
 * The column shows names and the server wants a handle, so this walks the roster. Two active
 * members sharing a display name make the name ambiguous, and the honest answer then is to send
 * nothing and let the table narrow the loaded rows rather than to pick one of them.
 */
export function singleMemberOf(
  filter: GridColumnFilter | undefined,
  members: readonly { readonly userId: string; readonly displayName: string }[],
): string | undefined {
  if (filter?.kind !== "set" || filter.values.length !== 1) return undefined;
  const [name] = filter.values;
  const named = members.filter((member) => member.displayName === name);
  return named.length === 1 ? named[0]?.userId : undefined;
}

/** The set filter that names one member, by user identifier; undefined for one the roster lacks. */
export function singleMemberFilter(
  userId: string | null | undefined,
  members: readonly { readonly userId: string; readonly displayName: string }[],
): GridColumnFilter | undefined {
  if (userId === null || userId === undefined) return undefined;
  const member = members.find((candidate) => candidate.userId === userId);
  return member === undefined ? undefined : { kind: "set", values: [member.displayName] };
}
