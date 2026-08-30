/*
 * The entity record's panes, and how finished each one is.
 *
 * A directory record answers seven questions about one person or organization, and the firm's
 * record can currently answer four of them. The other three are DESIGNED here rather than left out:
 * the pane renders its real anatomy, its control sits disabled, and one line names what its arrival
 * waits on. Someone reading the record then knows the fact is kept and knows why they cannot see it
 * — which is a different thing from a screen that quietly has no such pane.
 *
 * `waitingOn` is a noun phrase, completed into the platform's one sentence by the Soon affordance.
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
  {
    id: "names",
    label: "Names",
    stage: "alpha",
    appliesTo: "both",
    waitingOn: "a read of an entity's recorded names",
  },
  { id: "pronouns", label: "Pronouns", stage: "alpha", appliesTo: "person" },
  { id: "identifiers", label: "Identifiers", stage: "alpha", appliesTo: "both" },
  { id: "duplicates", label: "Duplicates", stage: "alpha", appliesTo: "both" },
  {
    id: "relationships",
    label: "Relationships",
    stage: "soon",
    appliesTo: "both",
    waitingOn: "a read of an entity's relationships",
  },
  {
    id: "matters",
    label: "Matters",
    stage: "soon",
    appliesTo: "both",
    waitingOn: "a read of the matters an entity is a party to",
  },
  {
    id: "categories",
    label: "Categories",
    stage: "soon",
    appliesTo: "both",
    waitingOn: "a read of the firm's categories and what carries them",
  },
];

/** The panes an entity of this kind has, in reading order. */
export function entitySectionsFor(kind: DirectoryEntityKind): readonly EntitySection[] {
  return ENTITY_SECTIONS.filter(
    (section) => section.appliesTo === "both" || section.appliesTo === kind,
  );
}
