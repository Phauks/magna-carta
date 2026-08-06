/*
 * Pure reads over a catalog — grouping, lookup, and the search vocabulary a picker matches against.
 *
 * These are here rather than in a component because they are the same answers wherever a catalog is
 * shown: a picker, an inspector, a review list, and a test all group by source in one canonical
 * order and all search the same words. Keeping them pure and off the DOM is what lets the rules be
 * asserted directly instead of through a rendered listbox.
 */
import {
  MERGE_FIELD_GROUP_ORDER,
  mergeFieldGroupLabel,
  type MergeFieldCatalog,
  type MergeFieldEntry,
  type MergeFieldGroup,
} from "./types.ts";

export interface MergeFieldGroupSection {
  readonly group: MergeFieldGroup;
  readonly label: string;
  readonly entries: readonly MergeFieldEntry[];
  /**
   * The same entries, split by what they are ABOUT. A "Parties" heading with a hundred and thirty rows
   * under it is a list nobody scrolls; the subject subheadings are what make it readable at that size.
   */
  readonly subjects: readonly MergeFieldSubjectSection[];
}

export interface MergeFieldSubjectSection {
  readonly subject: string;
  readonly label: string;
  readonly entries: readonly MergeFieldEntry[];
}

/**
 * Group entries by heading in the canonical order, then by subject within each heading in the order
 * the entries arrived. Groups the firm has no entries for are dropped: a firm with no custom fields
 * must not be shown an empty "The firm's own fields" heading, and neither must an empty subject.
 */
export function groupCatalogEntries(
  entries: readonly MergeFieldEntry[],
): readonly MergeFieldGroupSection[] {
  const sections: MergeFieldGroupSection[] = [];
  // A group the server sent that this build's registry does not know still has to appear, at the end,
  // rather than silently swallowing its fields. Hiding a field is never the answer to not recognizing
  // its heading.
  const knownGroups = new Set(MERGE_FIELD_GROUP_ORDER);
  const unknownGroups = [
    ...new Set(entries.map((entry) => entry.group).filter((group) => !knownGroups.has(group))),
  ];
  for (const group of [...MERGE_FIELD_GROUP_ORDER, ...unknownGroups]) {
    const groupEntries = entries.filter((entry) => entry.group === group);
    if (groupEntries.length === 0) continue;
    sections.push({
      group,
      label: mergeFieldGroupLabel(group),
      entries: groupEntries,
      subjects: subjectSectionsOf(groupEntries),
    });
  }
  return sections;
}

function subjectSectionsOf(
  entries: readonly MergeFieldEntry[],
): readonly MergeFieldSubjectSection[] {
  const order: string[] = [];
  const bySubject = new Map<string, MergeFieldEntry[]>();
  for (const entry of entries) {
    const bucket = bySubject.get(entry.subject);
    if (bucket === undefined) {
      order.push(entry.subject);
      bySubject.set(entry.subject, [entry]);
    } else {
      bucket.push(entry);
    }
  }
  return order.map((subject) => ({
    subject,
    label: bySubject.get(subject)?.[0]?.subjectLabel ?? subject,
    entries: bySubject.get(subject) ?? [],
  }));
}

/** The entry for a key, or `null` when the catalog has none — the unrecognized-placeholder case. */
export function findCatalogEntry(catalog: MergeFieldCatalog, key: string): MergeFieldEntry | null {
  return catalog.entries.find((entry) => entry.key === key) ?? null;
}

/**
 * The words a search should match an entry on. The KEY is included deliberately: someone who does
 * know the key path should find the field by typing it, even though nobody is asked to.
 *
 * The SYNONYMS and the SUBJECT LABEL are what make a firm's own vocabulary work — someone typing
 * "defendant" finds the opposing party, "PR" finds the personal representative, "SSN" finds the tax
 * identifier. They are declared per facet and per subject upstream, so the declared list stays about
 * as long as the registries rather than as long as the catalog.
 */
export function catalogSearchKeywords(entry: MergeFieldEntry): readonly string[] {
  return [
    entry.label,
    entry.key,
    entry.description,
    entry.subjectLabel,
    mergeFieldGroupLabel(entry.group),
    ...entry.synonyms,
  ];
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
