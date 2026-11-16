/*
 * What the Search page's "Search in" row offers and says, apart from the component that draws it
 * so the words and the one decision in it can be tested without a browser.
 */
import type { PickableEntity } from "@magna-carta/design-system/entity-picker";
import type { ApiOutcome } from "$lib/api/request.ts";
import {
  entityKindFromIdentifier,
  type DirectoryEntityName,
} from "$lib/directory/directory-api.ts";
import type { SearchReach } from "./search-address.ts";

/**
 * A choice in the row. Three are a reach the address carries; "matter" is the one that opens a
 * matter's own search instead, because that search reaches more of the matter than this page does.
 */
export type ReachChoice = SearchReach["kind"] | "matter";

export const REACH_CHOICES: readonly { readonly value: ReachChoice; readonly label: string }[] = [
  { value: "everything", label: "Everything I Can See" },
  { value: "mine", label: "My Matters" },
  { value: "client", label: "One Client" },
  { value: "matter", label: "One Matter" },
];

/** What the page says it is searching, under the field. */
export function reachSentence(reach: SearchReach): string {
  const records =
    "the notes, time, costs, invoices, parties, calls, custody packets and file names";
  if (reach.kind === "mine") {
    return (
      `Searches the matters you are responsible for or assigned to: matters by name, and ` +
      `${records} on them.`
    );
  }
  if (reach.kind === "client") {
    return (
      `Searches the matters this person or organization is a client on: matters by name, and ` +
      `${records} on them.`
    );
  }
  return `Searches every matter you can see: matters and people by name, and ${records} on those matters.`;
}

/** The field's label for the search, which a screen reader hears in place of the sentence. */
export function reachFieldLabel(reach: SearchReach): string {
  if (reach.kind === "mine") return "Search your own matters";
  if (reach.kind === "client") return "Search one client's matters";
  return "Search every matter you can see";
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
