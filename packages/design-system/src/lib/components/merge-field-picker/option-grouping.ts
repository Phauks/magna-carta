/*
 * The picker's headless model: how options become sections, what a search matches, and which option
 * a key names. Pure functions, no DOM — the same discipline as data-table/facet-selection.ts, and
 * for the same reason: the behaviour that actually goes wrong here (a second search term widening
 * the result instead of narrowing it, a group heading surviving with no rows under it) is far
 * cheaper to assert directly than through a rendered listbox.
 */
import type { MergeFieldPickerOption, MergeFieldPickerSection } from "./types.ts";

/**
 * Group options under their headings, in the order the CONSUMER supplied them. The picker does not
 * impose an order of its own: which sources matter most is a product decision belonging to whoever
 * builds the option list, and re-sorting here would silently override it.
 */
export function groupPickerOptions(
  options: readonly MergeFieldPickerOption[],
): readonly MergeFieldPickerSection[] {
  const sections: MergeFieldPickerSection[] = [];
  const indexByGroup = new Map<string, number>();
  for (const option of options) {
    const existing = indexByGroup.get(option.group);
    if (existing === undefined) {
      indexByGroup.set(option.group, sections.length);
      sections.push({ group: option.group, label: option.groupLabel, options: [option] });
      continue;
    }
    const section = sections[existing] as MergeFieldPickerSection;
    sections[existing] = { ...section, options: [...section.options, option] };
  }
  return sections;
}

/**
 * The words an option can be found by: its label, its key, its group heading, and its description.
 * The KEY is in there deliberately — someone who does know the key path should be able to type it,
 * even though the interface never asks anyone to.
 */
export function pickerOptionKeywords(option: MergeFieldPickerOption): string[] {
  return [
    option.label,
    option.key,
    option.groupLabel,
    option.valueTypeLabel,
    option.description,
  ].filter((part): part is string => typeof part === "string" && part !== "");
}

/**
 * Case-insensitive match requiring EVERY whitespace-separated term to appear somewhere in the
 * option's vocabulary. Match-any would make a second word widen the result, which is the opposite
 * of what typing more words means.
 */
export function matchesPickerQuery(option: MergeFieldPickerOption, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = pickerOptionKeywords(option).join(" ").toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

/**
 * The matcher in the shape the command list wants: a score of 1 for a match, 0 for a miss. Options
 * are matched by the keyword list the row already publishes, so search and display never drift.
 */
export function pickerFilterScore(value: string, search: string, keywords?: string[]): number {
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return 1;
  const haystack = [value, ...(keywords ?? [])].join(" ").toLowerCase();
  return terms.every((term) => haystack.includes(term)) ? 1 : 0;
}

/** The option a key names, or `null` — what a picker resolves a bound value through. */
export function findPickerOption(
  options: readonly MergeFieldPickerOption[],
  key: string | null,
): MergeFieldPickerOption | null {
  if (key === null) return null;
  return options.find((option) => option.key === key) ?? null;
}
