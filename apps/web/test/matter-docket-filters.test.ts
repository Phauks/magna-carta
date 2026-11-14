/*
 * The docket's narrowing, pinned.
 *
 * The failure this guards against is specific and has a history on list screens: a reader leaves a
 * narrowing set, comes back, and reads an almost-empty table as a statement about the firm. So the
 * question "is anything holding matters back from this view" has one answer, and the control that
 * answers it must be able to show itself as live.
 *
 * The scope control this file once described is gone: the four scopes it offered are values of the
 * Status column, the table filters on that column, and one question answered in two places is the
 * defect above waiting to happen. Only the search and the column filters narrow the docket now.
 */
import { describe, expect, it } from "vitest";
import {
  docketIsNarrowed,
  docketNarrowingSummary,
} from "../src/lib/matters/matter-docket-filters.ts";

describe("whether the view is narrowed", () => {
  it("is not, at rest — the docket's own state is every matter", () => {
    expect(docketIsNarrowed({ search: "", columnFilterCount: 0 })).toBe(false);
  });

  it("is, for a live search or a filtered column", () => {
    expect(docketIsNarrowed({ search: "Pemberton", columnFilterCount: 0 })).toBe(true);
    expect(docketIsNarrowed({ search: "", columnFilterCount: 2 })).toBe(true);
  });

  it("does not count whitespace as a search", () => {
    expect(docketIsNarrowed({ search: "   ", columnFilterCount: 0 })).toBe(false);
  });
});

describe("what the control says about itself", () => {
  it("states what is in play, the search first", () => {
    expect(docketNarrowingSummary({ search: "Wren", columnFilterCount: 1 })).toBe(
      'searching "Wren" · 1 column filtered',
    );
  });

  it("counts several filtered columns in the plural", () => {
    expect(docketNarrowingSummary({ search: "", columnFilterCount: 3 })).toBe("3 columns filtered");
  });

  it("names the whole record when nothing is narrowing it", () => {
    expect(docketNarrowingSummary({ search: "", columnFilterCount: 0 })).toBe("All matters");
  });
});
