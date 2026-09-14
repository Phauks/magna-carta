/*
 * The messaging screen's scope, read off its Matter column rather than off a tab strip.
 *
 * The four scope tabs the screen used to carry asked exactly what the Matter column's filter asks,
 * and they are gone (docs/conventions/design-corrections.md, 2026-09-11). What has to stay true is
 * the half the tabs were defending: the narrowing reaches the server. Each case below is a
 * selection and the scope the listing is asked for — or the honest nothing where a selection
 * crosses two scopes and only the table can narrow it.
 */
import { describe, expect, it } from "vitest";
import {
  communicationColumns,
  EMPTY_COMMUNICATION_VOCABULARY,
  MATTER_FILTER_VOCABULARY,
  scopeForMatterSelection,
} from "../src/lib/communications/communication-columns.ts";

describe("the Matter column's filter, as the listing's scope", () => {
  it("is the queue for Not filed alone", () => {
    expect(scopeForMatterSelection({ kind: "set", values: ["Not filed"] })).toBe("unrouted");
  });

  it("is what was set aside for the set-aside reasons, one or all of them", () => {
    expect(scopeForMatterSelection({ kind: "set", values: ["Spam or wrong number"] })).toBe(
      "setAside",
    );
    expect(
      scopeForMatterSelection({
        kind: "set",
        values: ["Spam or wrong number", "Firm business", "Nothing came of it"],
      }),
    ).toBe("setAside");
  });

  it("is what is filed for any selection of matters", () => {
    expect(
      scopeForMatterSelection({
        kind: "set",
        values: ["2026-0147 · Whitfield", "2026-0150 · Pemberton"],
      }),
    ).toBe("routed");
  });

  it("is nothing for a selection that crosses two scopes, and nothing for no filter", () => {
    expect(
      scopeForMatterSelection({ kind: "set", values: ["Not filed", "2026-0147 · Whitfield"] }),
    ).toBeUndefined();
    expect(scopeForMatterSelection({ kind: "set", values: [] })).toBeUndefined();
    expect(scopeForMatterSelection(undefined)).toBeUndefined();
    expect(scopeForMatterSelection({ kind: "text", query: "Whitfield" })).toBeUndefined();
  });
});

describe("what the Matter column always offers", () => {
  it("leads with the queue and the three set-aside reasons, whatever is loaded", () => {
    expect(MATTER_FILTER_VOCABULARY).toEqual([
      "Not filed",
      "Spam or wrong number",
      "Firm business",
      "Nothing came of it",
    ]);
    const matter = communicationColumns(EMPTY_COMMUNICATION_VOCABULARY, { showMatter: true }).find(
      (column) => column.id === "matter",
    );
    expect(matter?.filterValues).toEqual(MATTER_FILTER_VOCABULARY);
  });

  it("is absent inside a matter, where every row is on the same one", () => {
    const columns = communicationColumns(EMPTY_COMMUNICATION_VOCABULARY, { showMatter: false });
    expect(columns.some((column) => column.id === "matter")).toBe(false);
  });
});
