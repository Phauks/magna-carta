import { describe, expect, it } from "vitest";
import {
  areFacetsSelected,
  facetSelectionAfterToggle,
  facetSelectionAfterToggleAll,
  facetSelectionAfterToggleValues,
  isAllFacetsSelected,
  isFacetSelected,
  isSomeFacetsSelected,
} from "../src/lib/components/data-table/facet-selection.ts";

/*
 * The faceted multi-select model. The bug these guard against: deselecting every value used to revert
 * to "all" — table-core auto-removes an empty-array filter, and the header checkbox's all/none test
 * divided by an empty universe (0 === 0 → "all"). "Deselect everything" must mean NONE and stay there.
 */
const UNIVERSE = ["Acme Corp", "Briar LLP", "Crestwood Trust"];

describe("facet selection — the all/none/some sentinels", () => {
  it("undefined means all selected", () => {
    expect(isAllFacetsSelected(UNIVERSE, undefined)).toBe(true);
    expect(isSomeFacetsSelected(UNIVERSE, undefined)).toBe(false);
    expect(isFacetSelected(undefined, "Acme Corp")).toBe(true);
  });

  it("a subset covering the whole universe also reads as all selected", () => {
    expect(isAllFacetsSelected(UNIVERSE, [...UNIVERSE])).toBe(true);
    expect(isSomeFacetsSelected(UNIVERSE, [...UNIVERSE])).toBe(false);
  });

  it("an empty array means NONE selected — never all (the inversion this prevents)", () => {
    expect(isAllFacetsSelected(UNIVERSE, [])).toBe(false);
    expect(isSomeFacetsSelected(UNIVERSE, [])).toBe(false);
    expect(isFacetSelected([], "Acme Corp")).toBe(false);
  });

  it("never reports 'all' for an empty universe (the 0 === 0 divide)", () => {
    expect(isAllFacetsSelected([], [])).toBe(false);
  });

  it("a partial selection is indeterminate", () => {
    expect(isAllFacetsSelected(UNIVERSE, ["Acme Corp"])).toBe(false);
    expect(isSomeFacetsSelected(UNIVERSE, ["Acme Corp"])).toBe(true);
    expect(isFacetSelected(["Acme Corp"], "Acme Corp")).toBe(true);
    expect(isFacetSelected(["Acme Corp"], "Briar LLP")).toBe(false);
  });
});

describe("facet selection — toggling one value", () => {
  it("unchecking from 'all' narrows to the remaining values, in universe order", () => {
    expect(facetSelectionAfterToggle(UNIVERSE, undefined, "Briar LLP", false)).toEqual([
      "Acme Corp",
      "Crestwood Trust",
    ]);
  });

  it("re-checking the last missing value collapses back to 'all' (undefined clears the filter)", () => {
    const partial = ["Acme Corp", "Crestwood Trust"];
    expect(facetSelectionAfterToggle(UNIVERSE, partial, "Briar LLP", true)).toBeUndefined();
  });

  it("unchecking the last remaining value yields NONE, not a revert to all", () => {
    expect(facetSelectionAfterToggle(UNIVERSE, ["Briar LLP"], "Briar LLP", false)).toEqual([]);
  });

  it("unchecking value-by-value to empty never inverts at the end", () => {
    let selection = facetSelectionAfterToggle(UNIVERSE, undefined, "Acme Corp", false);
    selection = facetSelectionAfterToggle(UNIVERSE, selection, "Briar LLP", false);
    selection = facetSelectionAfterToggle(UNIVERSE, selection, "Crestwood Trust", false);
    expect(selection).toEqual([]);
    expect(isAllFacetsSelected(UNIVERSE, selection)).toBe(false);
  });
});

describe("facet selection — toggling Select all", () => {
  it("checking Select all clears the filter (all)", () => {
    expect(facetSelectionAfterToggleAll(true)).toBeUndefined();
  });

  it("unchecking Select all selects none", () => {
    expect(facetSelectionAfterToggleAll(false)).toEqual([]);
  });
});

/*
 * The one select control acts on the choices LISTED. A narrowed list hands it the values that match
 * the narrowing, and only those change; the rest keep their state.
 */
describe("facet selection — toggling the listed values", () => {
  it("reads every listed value as selected under the all sentinel, and vacuously for an empty list", () => {
    expect(areFacetsSelected(undefined, ["Acme Corp"])).toBe(true);
    expect(areFacetsSelected(["Acme Corp"], ["Acme Corp", "Briar LLP"])).toBe(false);
    expect(areFacetsSelected([], [])).toBe(true);
  });

  it("checking the listed values touches only those", () => {
    expect(facetSelectionAfterToggleValues(UNIVERSE, [], ["Acme Corp", "Briar LLP"], true)).toEqual(
      ["Acme Corp", "Briar LLP"],
    );
  });

  it("unchecking the listed values leaves the rest selected", () => {
    expect(facetSelectionAfterToggleValues(UNIVERSE, undefined, ["Briar LLP"], false)).toEqual([
      "Acme Corp",
      "Crestwood Trust",
    ]);
  });

  it("handed the whole universe it is Select all / Select none", () => {
    expect(facetSelectionAfterToggleValues(UNIVERSE, [], UNIVERSE, true)).toBeUndefined();
    expect(facetSelectionAfterToggleValues(UNIVERSE, undefined, UNIVERSE, false)).toEqual([]);
  });

  it("checking the last missing values collapses back to all", () => {
    expect(
      facetSelectionAfterToggleValues(
        UNIVERSE,
        ["Acme Corp"],
        ["Briar LLP", "Crestwood Trust"],
        true,
      ),
    ).toBeUndefined();
  });
});
