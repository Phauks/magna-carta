/*
 * The changelog as a flat list of entries, each split into a HEADLINE and the detail below it.
 *
 * Nearly every entry in docs/public-changelog.md opens with a bold sentence that says the change in
 * a line ("**Consultations now get a file number.**"), and the rest explains it. That lead is what a
 * reader scans for, so it becomes the entry's headline; an entry written without one is headed by
 * its first sentence instead.
 */
import type { ChangelogCategory } from "@magna-carta/product-updates/schema";
import { publicChangelogReleases } from "./public-changelog.ts";
import {
  parseChangelogText,
  type ChangelogInline,
  type ChangelogParagraph,
} from "./changelog-text.ts";

export interface ChangelogEntry {
  readonly id: string;
  readonly date: string;
  readonly category: ChangelogCategory;
  readonly headline: readonly ChangelogInline[];
  /** Everything after the headline; empty when the entry is one sentence. */
  readonly detail: readonly ChangelogParagraph[];
  /** The entry exactly as the document holds it. */
  readonly source: string;
  /** Every word of the entry, lower-cased, for the search. */
  readonly searchText: string;
}

function plain(nodes: readonly ChangelogInline[]): string {
  return nodes
    .map((node) =>
      node.kind === "text" || node.kind === "code" ? node.text : plain(node.children),
    )
    .join("");
}

function splitHeadline(paragraphs: ChangelogParagraph[]): {
  headline: ChangelogInline[];
  detail: ChangelogParagraph[];
} {
  const [first = [], ...rest] = paragraphs;
  const lead = first[0];
  if (lead?.kind === "strong") {
    const remainder = first.slice(1);
    const trimmed =
      remainder[0]?.kind === "text"
        ? [{ kind: "text" as const, text: remainder[0].text.trimStart() }, ...remainder.slice(1)]
        : remainder;
    const detail = trimmed.length === 0 || plain(trimmed).trim() === "" ? rest : [trimmed, ...rest];
    return { headline: [...lead.children], detail };
  }
  // No bold lead: the first sentence heads the entry, and the paragraph stays whole below it.
  const text = plain(first);
  const stop = text.search(/[.!?](\s|$)/u);
  const sentence = stop === -1 ? text : text.slice(0, stop + 1);
  return { headline: [{ kind: "text", text: sentence }], detail: paragraphs };
}

export function changelogEntries(): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  for (const release of publicChangelogReleases()) {
    for (const group of release.categories) {
      for (const [index, entry] of group.entries.entries()) {
        const paragraphs = parseChangelogText(entry.text);
        const { headline, detail } = splitHeadline(paragraphs);
        entries.push({
          id: `${release.date}-${group.category}-${index}`,
          date: release.date,
          category: group.category,
          headline,
          detail,
          source: entry.text,
          searchText: paragraphs.map(plain).join(" ").toLowerCase(),
        });
      }
    }
  }
  return entries;
}

export const CATEGORY_BADGE = {
  Added: "success",
  Changed: "info",
  Deprecated: "warning",
  Removed: "danger",
  Fixed: "neutral",
  Security: "danger",
} as const satisfies Record<ChangelogCategory, string>;
