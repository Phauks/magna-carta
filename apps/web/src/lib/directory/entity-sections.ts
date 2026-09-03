/*
 * The entity record's panes, and how finished each one is.
 *
 * A directory record answers ten questions about one person or organization, and every one of them
 * is now answered from the firm's own record: the names it has held, how the firm can reach it, the
 * pronouns it stated, when the person was born and died, the identifiers it holds, the records it
 * may duplicate, the relationships it has, the people inside it or the organizations it is inside,
 * the matters it is a party to, and how the firm files it.
 *
 * `waitingOn` survives because the rule it serves does: a pane whose read does not exist renders
 * its real anatomy with the mark beside it and one line naming what its arrival waits on, rather
 * than being left out. Nothing needs it today, and an eighth question that arrives ahead of its
 * read will.
 */
import type { MaturityStage } from "@magna-carta/design-system/maturity";
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
  { id: "contact", label: "Contact", stage: "alpha", appliesTo: "both" },
  { id: "pronouns", label: "Pronouns", stage: "alpha", appliesTo: "person" },
  { id: "dates", label: "Dates", stage: "alpha", appliesTo: "person" },
  { id: "identifiers", label: "Identifiers", stage: "alpha", appliesTo: "both" },
  { id: "duplicates", label: "Duplicates", stage: "alpha", appliesTo: "both" },
  { id: "relationships", label: "Relationships", stage: "alpha", appliesTo: "both" },
  // The membership family read from each side: the people inside an organization, and the
  // organizations a person is inside. Both are the relationships list narrowed, not a second read.
  { id: "people", label: "People", stage: "alpha", appliesTo: "organization" },
  { id: "organizations", label: "Organizations", stage: "alpha", appliesTo: "person" },
  { id: "matters", label: "Matters", stage: "alpha", appliesTo: "both" },
  { id: "categories", label: "Categories", stage: "alpha", appliesTo: "both" },
];

/** The panes an entity of this kind has, in reading order. */
export function entitySectionsFor(kind: DirectoryEntityKind): readonly EntitySection[] {
  return ENTITY_SECTIONS.filter(
    (section) => section.appliesTo === "both" || section.appliesTo === kind,
  );
}
