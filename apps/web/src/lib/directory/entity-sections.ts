/*
 * The entity record's panes, and how finished each one is.
 *
 * A directory record answers seven questions about one person or organization, and every one of
 * them is now answered from the firm's own record: the names it has held, the pronouns it stated,
 * the identifiers it holds, the records it may duplicate, the relationships it has, the matters it
 * is a party to, and how the firm files it.
 *
 * `waitingOn` survives because the rule it serves does: a pane whose read does not exist renders
 * its real anatomy with the mark beside it and one line naming what its arrival waits on, rather
 * than being left out. Nothing needs it today, and an eighth question that arrives ahead of its
 * read will.
 */
import type { MaturityStage } from "$lib/maturity/maturity.ts";
import type { DirectoryEntityKind } from "./directory-api.ts";

export interface EntitySection {
  /** Stable identity; the tab's value. */
  id: string;
  label: string;
  stage: MaturityStage;
  /** Which side of the directory has this pane at all. */
  appliesTo: DirectoryEntityKind | "both";
  /** What the pane's unserved half waits on, where it has one. */
  waitingOn?: string;
}

export const ENTITY_SECTIONS: readonly EntitySection[] = [
  { id: "names", label: "Names", stage: "alpha", appliesTo: "both" },
  { id: "pronouns", label: "Pronouns", stage: "alpha", appliesTo: "person" },
  { id: "identifiers", label: "Identifiers", stage: "alpha", appliesTo: "both" },
  { id: "duplicates", label: "Duplicates", stage: "alpha", appliesTo: "both" },
  { id: "relationships", label: "Relationships", stage: "alpha", appliesTo: "both" },
  { id: "matters", label: "Matters", stage: "alpha", appliesTo: "both" },
  { id: "categories", label: "Categories", stage: "alpha", appliesTo: "both" },
];

/** The panes an entity of this kind has, in reading order. */
export function entitySectionsFor(kind: DirectoryEntityKind): readonly EntitySection[] {
  return ENTITY_SECTIONS.filter(
    (section) => section.appliesTo === "both" || section.appliesTo === kind,
  );
}
