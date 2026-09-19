/*
 * Faceted multi-select model (the Google Sheets pattern): a column's filter value is the EXPLICIT set
 * of still-selected values, with two sentinels —
 *   - `undefined` means "all selected" (no active filter), and
 *   - an empty array means "none selected" (an active filter that matches nothing).
 * Selecting every value collapses back to `undefined` so the filter clears and the funnel goes quiet.
 *
 * The math takes the column's `universe` — the full, STABLE set of distinct values, sourced from the
 * unfiltered rows — so options never vanish as the selection narrows and the all/none/some test never
 * divides by an empty set. Sourcing the universe from the filtered rows (table-core's
 * getFacetedUniqueValues) is what made "deselect everything" collapse the list to nothing and flip the
 * header checkbox back to checked (0 === 0).
 *
 * Pairs with `facetFilterFn` (typed-columns.ts), which defines no `autoRemove` so table-core KEEPS the
 * empty-array sentinel: the built-in arrIncludesSome auto-removes an empty array and so silently
 * reverts "none" back to "all".
 */

/** A column's facet filter value: the selected subset, or `undefined` for "all selected". */
export type FacetSelection = readonly string[] | undefined;

/** True when every value is selected — the `undefined` sentinel, or a subset covering the universe. */
export function isAllFacetsSelected(
  universe: readonly string[],
  selection: FacetSelection,
): boolean {
  return selection === undefined || (universe.length > 0 && selection.length >= universe.length);
}

/** True for a partial selection (the header checkbox's indeterminate state): some, but not all. */
export function isSomeFacetsSelected(
  universe: readonly string[],
  selection: FacetSelection,
): boolean {
  return selection !== undefined && selection.length > 0 && selection.length < universe.length;
}

/** Whether one value is selected — every value is selected under the `undefined` sentinel. */
export function isFacetSelected(selection: FacetSelection, value: string): boolean {
  return selection === undefined || selection.includes(value);
}

/**
 * The next filter value after toggling one value on/off. Selecting the whole universe collapses to
 * `undefined` (clears the filter); deselecting the last value yields `[]` (none) — never reverting to
 * "all". The result preserves the universe's order so the checklist stays stable.
 */
export function facetSelectionAfterToggle(
  universe: readonly string[],
  selection: FacetSelection,
  value: string,
  selected: boolean,
): FacetSelection {
  const next = new Set<string>(selection ?? universe);
  if (selected) next.add(value);
  else next.delete(value);
  if (universe.every((item) => next.has(item))) return undefined;
  return universe.filter((item) => next.has(item));
}

/** The next filter value after toggling the header "Select all": all → `undefined`, none → `[]`. */
export function facetSelectionAfterToggleAll(selected: boolean): FacetSelection {
  return selected ? undefined : [];
}

/** Whether every one of `values` is selected — vacuously true of an empty list. */
export function areFacetsSelected(selection: FacetSelection, values: readonly string[]): boolean {
  return values.every((value) => isFacetSelected(selection, value));
}

/**
 * The next filter value after toggling SEVERAL values on/off at once: the choices a narrowed list
 * shows, under the one select-all/none control, which acts on what is listed rather than on the
 * whole universe. Handed the whole universe it is exactly `facetSelectionAfterToggleAll`; the
 * same collapse (everything on → `undefined`) and the same floor (nothing on → `[]`) apply.
 */
export function facetSelectionAfterToggleValues(
  universe: readonly string[],
  selection: FacetSelection,
  values: readonly string[],
  selected: boolean,
): FacetSelection {
  const next = new Set<string>(selection ?? universe);
  for (const value of values) {
    if (selected) next.add(value);
    else next.delete(value);
  }
  if (universe.every((item) => next.has(item))) return undefined;
  return universe.filter((item) => next.has(item));
}
