/*
 * What a closed choice offers, and how typing narrows it.
 *
 * The narrowing is here rather than in the component so the rule is one function with one test: a
 * person types what they have in their head, which for a country is as likely to be "44" or "United
 * Kingdom" as "GB". So an option carries its own search words beside its label, and a query matches
 * any of them.
 */

export interface ChoiceOption {
  /** What the draft stores. */
  readonly value: string;
  /** What the field and the row say. */
  readonly label: string;
  /** A quieter line beside the label in the list, where the label alone is not the whole answer. */
  readonly aside?: string;
  /** What the row's hover says, where the choice has a meaning worth stating. */
  readonly meaning?: string;
  /** Extra words the option answers to. The label is always searched; these are on top of it. */
  readonly keywords?: readonly string[];
}

/** Whether an option answers to what has been typed. An empty query matches everything. */
export function choiceMatches(option: ChoiceOption, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  return [option.label, option.aside ?? "", ...(option.keywords ?? [])].some((word) =>
    word.toLowerCase().includes(needle),
  );
}

/** The options a query leaves, in the order they were given. */
export function matchingChoices(
  options: readonly ChoiceOption[],
  query: string,
): readonly ChoiceOption[] {
  return options.filter((option) => choiceMatches(option, query));
}
