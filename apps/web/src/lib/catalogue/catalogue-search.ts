/*
 * Searching a catalogue — the narrowing itself, as a pure function over the sections.
 *
 * A catalogue is entirely in the browser already, so this answers on the keystroke and no request
 * leaves the machine. It is a module rather than a few lines inside the screen because the matching
 * RULES are what a reader will form a habit around, and a habit is worth a test: which fields a
 * query reaches, whether two words both have to match, and what happens to an entry whose section
 * heading is the only thing that matches.
 *
 * THE RULES:
 *   - The query is split on whitespace and EVERY word must match somewhere in the entry. Typing
 *     more words narrows; it never widens. "trust report" finds the trust compliance report,
 *     "trust safe" finds nothing.
 *   - A word matches anywhere inside the text, not only at a word's start, so "recon" reaches
 *     "reconciliation" and "workbench" reaches "File Workbench".
 *   - What a word is matched against is the entry's whole visible sentence — its name, its
 *     description, the dependency it names while unbuilt — plus its section's heading and its
 *     unshown keywords. The heading is in there because a reader searching "trust" means the
 *     family as readily as the report, and an entry that is only reachable by a word it does not
 *     display is why `keywords` exists.
 *   - Case and surrounding whitespace are nothing. Nothing else is normalized: folding accents or
 *     stemming would make the match rule something a reader has to learn rather than guess.
 *   - A section with no surviving entry is dropped whole, so the answer never shows an empty
 *     heading with nothing under it.
 */
import type { CatalogueEntry, CatalogueSection } from "./catalogue.ts";

/** The words a query narrows by: lower-cased, whitespace-separated, empties dropped. */
function queryWords(query: string): readonly string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== "");
}

/** Everything about an entry a query is matched against, as one lower-cased haystack. */
function searchableText(entry: CatalogueEntry, sectionLabel: string): string {
  return [
    entry.name,
    entry.description,
    entry.waitsOn ?? "",
    sectionLabel,
    ...(entry.keywords ?? []),
  ]
    .join(" ")
    .toLowerCase();
}

/** Whether one entry answers the query, given the heading it sits under. */
export function entryMatches(entry: CatalogueEntry, sectionLabel: string, query: string): boolean {
  const words = queryWords(query);
  if (words.length === 0) return true;
  const haystack = searchableText(entry, sectionLabel);
  return words.every((word) => haystack.includes(word));
}

/**
 * The catalogue narrowed to what the query reaches, sections in their original order and entries
 * in theirs. An empty or whitespace-only query returns the sections untouched — the same array, so
 * the resting screen costs no work and no new identity for the view to key on.
 */
export function filterCatalogue(
  sections: readonly CatalogueSection[],
  query: string,
): readonly CatalogueSection[] {
  if (queryWords(query).length === 0) return sections;
  const narrowed: CatalogueSection[] = [];
  for (const section of sections) {
    const entries = section.entries.filter((entry) => entryMatches(entry, section.label, query));
    if (entries.length > 0) narrowed.push({ ...section, entries });
  }
  return narrowed;
}

/**
 * The count that sits inside the search field's trailing edge — "4 of 20", so the size of the
 * answer is where the eye already is. A screen shows it only while a query is live: one showing
 * its whole record does not need to be told how much of it it is showing.
 */
export function matchSummary(matched: number, total: number): string {
  return `${matched} of ${total}`;
}
