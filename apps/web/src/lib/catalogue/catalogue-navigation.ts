/*
 * Which catalogue entry the reader is standing on — the one rule the navigation column of a
 * two-sided catalogue screen (Reports) highlights by.
 *
 * An entry is current when the address IS its route or sits beneath it: a screen under an entry —
 * the File Workbench's password-recovery job at /file-workbench/recovery/<job> is the shape —
 * keeps its parent lit. Matching on the prefix alone would be wrong the other way, since
 * /file-workbench must not light an entry whose route happens to start with "/file", so the
 * boundary is the path separator, the same rule the settings nav applies to its sections.
 *
 * A module rather than three lines inside the component so the rule can be pinned by a test in
 * the plugin-less node pool; imports by relative path for that reason.
 */
import type { CatalogueEntry, CatalogueSection } from "./catalogue.ts";

/** Whether the address names this entry's own screen, or a screen beneath it. */
export function isCurrentCatalogueEntry(entry: CatalogueEntry, pathname: string): boolean {
  if (entry.href === null) return false;
  return pathname === entry.href || pathname.startsWith(`${entry.href}/`);
}

/** The entry the address is on, or null on the catalogue's own landing screen. */
export function currentCatalogueEntry(
  sections: readonly CatalogueSection[],
  pathname: string,
): CatalogueEntry | null {
  for (const section of sections) {
    for (const entry of section.entries) {
      if (isCurrentCatalogueEntry(entry, pathname)) return entry;
    }
  }
  return null;
}
