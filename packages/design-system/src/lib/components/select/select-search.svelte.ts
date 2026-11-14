/*
 * Typing to narrow a long Select list. A Select keeps focus on its trigger while the list is open,
 * and Bits answers a typed letter by jumping to the first option that starts with it. That serves
 * a list of five; in a list of twenty it lands on the first "C" and leaves the reader to arrow past
 * the rest. Past SEARCH_THRESHOLD options the trigger instead collects what is typed into a query,
 * every row that does not contain it steps out of the list, and the panel shows the query at its
 * top where the mockup drew a search box, so a list can be narrowed to "corp" from anywhere in
 * the name and chosen with Enter.
 *
 * The query lives here, shared from Root to Trigger, Content and Item through context. Root clears
 * it whenever the list closes, so a list never reopens already narrowed.
 */
import { getContext, setContext } from "svelte";

/** A list longer than this offers typing to narrow it; a shorter one keeps Bits' jump-to-letter. */
export const SEARCH_THRESHOLD = 7;

const SELECT_SEARCH_KEY = Symbol("mc-select-search");

/** Folds case and accents away, so "Ecole" finds "École" and "corp" finds "Corporate". */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase();
}

/** Whether an option's label answers the typed query: anywhere in the label, case and accents aside. */
export function matchesSearch(label: string, query: string): boolean {
  const wanted = fold(query.trim());
  return wanted === "" || fold(label).includes(wanted);
}

export class SelectSearch {
  /** What has been typed while the list is open. */
  query = $state("");
  readonly #labels: () => readonly string[];
  readonly #isOpen: () => boolean;

  constructor(options: { labels: () => readonly string[]; isOpen: () => boolean }) {
    this.#labels = options.labels;
    this.#isOpen = options.isOpen;
  }

  /** Whether this list is long enough to be narrowed by typing. */
  get searchable(): boolean {
    return this.#labels().length > SEARCH_THRESHOLD;
  }

  /** Whether the typed query leaves no row standing, so the panel can say so. */
  get matchesNothing(): boolean {
    return (
      this.query.trim() !== "" && !this.#labels().some((label) => matchesSearch(label, this.query))
    );
  }

  /** Whether the list is open, which is the only time typing narrows it. */
  get isOpen(): boolean {
    return this.#isOpen();
  }

  /** Whether a row with this label stays in the list for the current query. */
  shows(label: string | undefined): boolean {
    if (!this.searchable || label === undefined) return true;
    return matchesSearch(label, this.query);
  }

  clear(): void {
    this.query = "";
  }
}

export function setSelectSearch(search: SelectSearch): SelectSearch {
  return setContext(SELECT_SEARCH_KEY, search);
}

/** The search of the Select this part sits in, or undefined for a part used outside a Select.Root. */
export function getSelectSearch(): SelectSearch | undefined {
  return getContext<SelectSearch | undefined>(SELECT_SEARCH_KEY);
}
