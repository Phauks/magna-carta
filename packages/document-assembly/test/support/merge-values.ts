import type { MergeListItem, MergeValue } from "../../src/types.ts";

// The items of a list-kind merge value. A collection subject that resolved to a scalar — or to
// nothing at all — is exactly the failure the tests calling this exist to catch, so it is asserted
// here and named in the message, rather than cast past into an indexing error further down.
export function listItems(value: MergeValue | undefined): readonly MergeListItem[] {
  if (value?.kind !== "list") {
    throw new Error(
      `expected a list merge value, got ${value === undefined ? "nothing" : value.kind}`,
    );
  }
  return value.items;
}
