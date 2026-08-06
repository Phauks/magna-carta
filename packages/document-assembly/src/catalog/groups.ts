// The picker's top-level headings.
//
// A group is a heading, not a source. `client` and `opposingParty` both resolve from the party read and
// belong under different headings, because a person hunting for the client's name is not browsing "the
// party source" — they are looking under "The client". Keeping the two axes apart is what lets the
// catalogue grow to hundreds of keys without the heading list growing with it.
//
// ADDING A GROUP IS A ROW. The order below is the order a picker renders, and it is total by
// construction: every subject names exactly one group, and a group with no subject is simply never
// rendered.

export interface MergeFieldGroupDefinition {
  readonly key: string;
  // What the heading reads. Sentence case, because it is a heading in running product prose rather
  // than a label on a control.
  readonly label: string;
}

export const MERGE_FIELD_GROUPS: readonly MergeFieldGroupDefinition[] = [
  { key: "matter", label: "Matter" },
  { key: "client", label: "The client" },
  { key: "otherParties", label: "Other parties" },
  { key: "firm", label: "The firm" },
  { key: "office", label: "This office" },
  { key: "document", label: "Dates and the document" },
  { key: "assets", label: "What the client or estate owns" },
  { key: "custom", label: "The firm's own fields" },
];

const GROUP_BY_KEY: ReadonlyMap<string, MergeFieldGroupDefinition> = new Map(
  MERGE_FIELD_GROUPS.map((group) => [group.key, group]),
);

export function mergeFieldGroup(key: string): MergeFieldGroupDefinition | undefined {
  return GROUP_BY_KEY.get(key);
}

// A group's position in the rendering order, and -1 for a key no group registry row declares. Exposed
// so a consumer sorts by the registry's order rather than by a copy of the list it keeps for itself.
export function mergeFieldGroupOrder(key: string): number {
  return MERGE_FIELD_GROUPS.findIndex((group) => group.key === key);
}
