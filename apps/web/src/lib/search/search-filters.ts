/*
 * What the Search page's filter panel offers and decides, apart from the component that draws it
 * so its choices can be tested without a browser.
 */
import type { PickableEntity } from "@magna-carta/design-system/entity-picker";
import { addCalendarDays } from "@magna-carta/civil-time/civil-date";
import type { ApiOutcome } from "$lib/api/request.ts";
import {
  entityKindFromIdentifier,
  type DirectoryEntityName,
} from "$lib/directory/directory-api.ts";
import {
  CHOSEN_MATTERS_LIMIT,
  EVERYTHING,
  isRecordPlace,
  placeTicked,
  type SearchDays,
  type SearchFilters,
  type SearchReach,
} from "./search-address.ts";

/** The panel's Matters choices. */
export type MattersChoice = SearchReach["kind"];

export const MATTERS_CHOICES: readonly { readonly value: MattersChoice; readonly label: string }[] =
  [
    { value: "everything", label: "Every matter I can see" },
    { value: "mine", label: "My matters" },
    { value: "client", label: "One client's matters" },
    { value: "matters", label: "Matters I pick" },
  ];

/** The panel's Date choices. */
export type DateChoice = "any" | "last-30-days" | "this-year" | "between";

export const DATE_CHOICES: readonly { readonly value: DateChoice; readonly label: string }[] = [
  { value: "any", label: "Any time" },
  { value: "last-30-days", label: "Last 30 days" },
  { value: "this-year", label: "This year" },
  { value: "between", label: "Between" },
];

/** The days a named choice stands for, counted from the reader's today. */
export function daysOfChoice(
  choice: Exclude<DateChoice, "between">,
  today: string,
): SearchDays | null {
  if (choice === "any") return null;
  if (choice === "last-30-days") {
    return { from: addCalendarDays(today, -29), to: today };
  }
  return { from: `${today.slice(0, 4)}-01-01` };
}

/** Which Date choice a span of days reads as. A span no named choice makes is "between". */
export function dateChoiceOf(days: SearchDays | null, today: string): DateChoice {
  if (days === null) return "any";
  for (const choice of ["last-30-days", "this-year"] as const) {
    const named = daysOfChoice(choice, today);
    if (named?.from === days.from && named?.to === days.to) return choice;
  }
  return "between";
}

/** The places a tick or an untick leaves ticked, written out in full. */
export function withPlace(
  filters: SearchFilters,
  everyPlace: readonly string[],
  place: string,
  ticked: boolean,
): readonly string[] | null {
  const next = everyPlace.filter((key) => (key === place ? ticked : placeTicked(filters, key)));
  // Back to exactly the places nothing chosen ticks: the address says nothing.
  const asDefault =
    next.length === everyPlace.filter(isRecordPlace).length && next.every(isRecordPlace);
  return asDefault ? null : next;
}

/** The chosen matters with one more, never past the server's limit and never twice. */
export function withMatter(reach: SearchReach, matterId: string): SearchReach {
  const current = reach.kind === "matters" ? reach.matterIds : [];
  if (current.includes(matterId) || current.length >= CHOSEN_MATTERS_LIMIT) {
    return { kind: "matters", matterIds: current };
  }
  return { kind: "matters", matterIds: [...current, matterId] };
}

/** The chosen matters with one fewer. None left is every matter again. */
export function withoutMatter(reach: SearchReach, matterId: string): SearchReach {
  if (reach.kind !== "matters") return reach;
  const rest = reach.matterIds.filter((id) => id !== matterId);
  return rest.length === 0 ? EVERYTHING : { kind: "matters", matterIds: rest };
}

/** How many filters differ from a search with none, for the phone's Filters button. */
export function filterCount(filters: SearchFilters): number {
  return (
    (filters.places === null ? 0 : 1) +
    (filters.reach.kind === "everything" ? 0 : 1) +
    (filters.days === null ? 0 : 1) +
    (filters.by === null ? 0 : 1)
  );
}

/** What a client is called where the directory could not say. */
export const UNNAMED_CLIENT = "A client whose name could not be read";

/**
 * The client an address names, as the picker shows a chosen entity. A read that failed, or a
 * handle the directory does not hold, still fills the field: the search IS narrowed to that
 * handle, and an empty field would say it was not.
 */
export function clientNamed(
  entityId: string,
  outcome: ApiOutcome<{ data: DirectoryEntityName[] }>,
): PickableEntity {
  const found =
    outcome.kind === "ok"
      ? outcome.value.data.find((entry) => entry.entityId === entityId)
      : undefined;
  return {
    identifier: entityId,
    name: found?.displayName ?? UNNAMED_CLIENT,
    kind: found?.entityKind ?? entityKindFromIdentifier(entityId) ?? "person",
  };
}
