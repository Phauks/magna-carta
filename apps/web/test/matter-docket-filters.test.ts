/*
 * The docket's one narrowing control, pinned.
 *
 * The failure this guards against is specific and has a history on list screens: a reader leaves a
 * narrowing set, comes back, and reads an almost-empty table as a statement about the firm. So the
 * question "is anything holding matters back from this view" has one answer, and the control that
 * answers it must be able to show itself as live.
 */
import { describe, expect, it } from "vitest";
import {
  docketIsNarrowed,
  docketNarrowingSummary,
  matterScopeLabel,
  DEFAULT_MATTER_SCOPE,
  MATTER_SCOPE_ITEMS,
} from "../src/lib/matters/matter-docket-filters.ts";

describe("the scopes", () => {
  it("leads with the listing's own default, so the first entry is the read that already happened", () => {
    expect(MATTER_SCOPE_ITEMS[0]?.value).toBe(DEFAULT_MATTER_SCOPE);
  });

  it("names every scope", () => {
    for (const item of MATTER_SCOPE_ITEMS) {
      expect(matterScopeLabel(item.value)).toBe(item.label);
    }
  });
});

describe("whether the view is narrowed", () => {
  it("is not, at rest", () => {
    expect(
      docketIsNarrowed({ scope: DEFAULT_MATTER_SCOPE, search: "", columnFilterCount: 0 }),
    ).toBe(false);
  });

  it("is, when the scope is anything but the default", () => {
    expect(docketIsNarrowed({ scope: "closed", search: "", columnFilterCount: 0 })).toBe(true);
  });

  it("is, for a live search or a filtered column", () => {
    expect(
      docketIsNarrowed({ scope: DEFAULT_MATTER_SCOPE, search: "Pemberton", columnFilterCount: 0 }),
    ).toBe(true);
    expect(
      docketIsNarrowed({ scope: DEFAULT_MATTER_SCOPE, search: "", columnFilterCount: 2 }),
    ).toBe(true);
  });

  it("does not count whitespace as a search", () => {
    expect(
      docketIsNarrowed({ scope: DEFAULT_MATTER_SCOPE, search: "   ", columnFilterCount: 0 }),
    ).toBe(false);
  });
});

describe("what the control says about itself", () => {
  it("states what is in play, scope first", () => {
    expect(docketNarrowingSummary({ scope: "closed", search: "Wren", columnFilterCount: 1 })).toBe(
      'Closed matters · searching "Wren" · 1 column filtered',
    );
  });

  it("counts several filtered columns in the plural", () => {
    expect(
      docketNarrowingSummary({ scope: DEFAULT_MATTER_SCOPE, search: "", columnFilterCount: 3 }),
    ).toBe("The working docket · 3 columns filtered");
  });
});
