/*
 * How a matter is NAMED and FOUND wherever one is chosen.
 *
 * Lifted out of the time sheet's own model when a second surface needed to choose a matter. A
 * matter is not the time sheet's idea, and the moment custody had to ask for one the alternative
 * was a second combobox with its own notion of what a matter looks like in a list — which is how a
 * product ends up showing the same matter three ways on three screens.
 *
 * BOTH HALVES FIND IT. Somebody choosing a matter knows the number or the name and rarely both, so
 * either reaches it. The display puts the number first, because that is the half a person reads
 * down a list and says out loud.
 */

/** The little of a matter that naming and choosing need. */
export interface SheetMatter {
  readonly id: string;
  readonly matterNumber: string | null;
  readonly title: string;
}

/** How a matter reads in a cell and in the picker: the number and the name, together. */
export function matterDisplay(matter: SheetMatter): string {
  return matter.matterNumber === null ? matter.title : `${matter.matterNumber} · ${matter.title}`;
}

/** What a column says for a row with none. It is a value, so a set filter can hold it. */
export const NO_MATTER_TEXT = "No matter";

/** Whether what somebody typed reaches this matter, by number or by name. Either finds it. */
export function matterMatches(matter: SheetMatter, query: string): boolean {
  const wanted = query.trim().toLowerCase();
  if (wanted === "") return true;
  return (
    (matter.matterNumber ?? "").toLowerCase().includes(wanted) ||
    matter.title.toLowerCase().includes(wanted)
  );
}
