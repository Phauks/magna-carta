/*
 * Pure reads over a catalog — grouping, lookup, and the search vocabulary a picker matches against.
 *
 * These are here rather than in a component because they are the same answers wherever a catalog is
 * shown: a picker, an inspector, a review list, and a test all group by source in one canonical
 * order and all search the same words. Keeping them pure and off the DOM is what lets the rules be
 * asserted directly instead of through a rendered listbox.
 */
import {
  MERGE_FIELD_GROUP_LABELS,
  MERGE_FIELD_GROUP_ORDER,
  type MergeFieldCatalog,
  type MergeFieldEntry,
  type MergeFieldGroup,
} from "./types.ts";

export interface MergeFieldGroupSection {
  readonly group: MergeFieldGroup;
  readonly label: string;
  readonly entries: readonly MergeFieldEntry[];
}

/**
 * Group entries by source in the canonical order, dropping groups the firm has no entries for.
 * A firm with no custom fields must not be shown an empty "Custom fields" heading.
 */
export function groupCatalogEntries(
  entries: readonly MergeFieldEntry[],
): readonly MergeFieldGroupSection[] {
  const sections: MergeFieldGroupSection[] = [];
  for (const group of MERGE_FIELD_GROUP_ORDER) {
    const groupEntries = entries.filter((entry) => entry.group === group);
    if (groupEntries.length === 0) continue;
    sections.push({ group, label: MERGE_FIELD_GROUP_LABELS[group], entries: groupEntries });
  }
  return sections;
}

/** The entry for a key, or `null` when the catalog has none — the unrecognized-placeholder case. */
export function findCatalogEntry(catalog: MergeFieldCatalog, key: string): MergeFieldEntry | null {
  return catalog.entries.find((entry) => entry.key === key) ?? null;
}

/**
 * The words a search should match an entry on. The KEY is included deliberately: someone who does
 * know the key path should find the field by typing it, even though nobody is asked to.
 */
export function catalogSearchKeywords(entry: MergeFieldEntry): readonly string[] {
  return [entry.label, entry.key, entry.description, MERGE_FIELD_GROUP_LABELS[entry.group]];
}

/**
 * Case-insensitive substring match across an entry's search vocabulary. Every whitespace-separated
 * term must match somewhere, so "client date" narrows rather than widening the way a match-any
 * search would.
 */
export function matchesMergeFieldQuery(entry: MergeFieldEntry, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = catalogSearchKeywords(entry).join(" ").toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

/** The catalog narrowed to what matches, still grouped in canonical order. */
export function searchCatalogSections(
  entries: readonly MergeFieldEntry[],
  query: string,
): readonly MergeFieldGroupSection[] {
  return groupCatalogEntries(entries.filter((entry) => matchesMergeFieldQuery(entry, query)));
}
