/*
 * The bridge between a money screen's column filters and its listing, pinned.
 *
 * Each case is a place where a quiet mistake would look right on screen and be wrong across the
 * pages: a bound dropped on its way to the server, a status sent for a filter that holds two, a
 * name sent as a handle, a cleared filter that stays in the address and re-narrows the next open.
 */
import { describe, expect, it } from "vitest";
import {
  addressAfterFilters,
  choicesFilter,
  choicesOf,
  civilDateOrNull,
  dateBoundsOf,
  dateRangeFilter,
  filtersSeededBy,
  singleChoiceFilter,
  singleChoiceOf,
  singleMemberFilter,
  singleMemberOf,
} from "../src/lib/money/listing-scope.ts";

const STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "billed", label: "Billed" },
] as const;

const ROSTER = [
  { userId: "user_wren", displayName: "Wren Adeyemi" },
  { userId: "user_alba", displayName: "Alba Ferreira" },
  { userId: "user_alba_two", displayName: "Alba Ferreira" },
];

describe("the date column's bounds", () => {
  it("sends both bounds when both are set, and only the one that is", () => {
    expect(dateBoundsOf({ kind: "dateRange", from: "2026-08-01", to: "2026-08-31" })).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
    });
    expect(dateBoundsOf({ kind: "dateRange", from: "2026-08-01", to: null })).toEqual({
      from: "2026-08-01",
    });
    expect(dateBoundsOf({ kind: "dateRange", from: null, to: "2026-08-31" })).toEqual({
      to: "2026-08-31",
    });
  });

  it("sends nothing for no filter, and nothing for a filter of another kind", () => {
    expect(dateBoundsOf(undefined)).toEqual({});
    expect(dateBoundsOf({ kind: "set", values: ["Draft"] })).toEqual({});
  });

  it("rebuilds the filter the address names, and none for an address naming neither bound", () => {
    expect(dateRangeFilter("2026-08-01", null)).toEqual({
      kind: "dateRange",
      from: "2026-08-01",
      to: null,
    });
    expect(dateRangeFilter(null, null)).toBeUndefined();
  });

  it("takes only a civil date from the address, never whatever was typed there", () => {
    expect(civilDateOrNull("2026-08-01")).toBe("2026-08-01");
    expect(civilDateOrNull("August")).toBeNull();
    expect(civilDateOrNull(null)).toBeNull();
  });
});

describe("a column that the listing takes one value of", () => {
  it("sends the one choice a set filter has settled on, as the wire spells it", () => {
    expect(singleChoiceOf({ kind: "set", values: ["Draft"] }, STATUSES)).toBe("draft");
  });

  it("sends nothing for two choices, for none, or for a word the column does not offer", () => {
    expect(singleChoiceOf({ kind: "set", values: ["Draft", "Billed"] }, STATUSES)).toBeUndefined();
    expect(singleChoiceOf({ kind: "set", values: [] }, STATUSES)).toBeUndefined();
    expect(singleChoiceOf({ kind: "set", values: ["Paid"] }, STATUSES)).toBeUndefined();
    expect(singleChoiceOf(undefined, STATUSES)).toBeUndefined();
  });

  it("rebuilds the filter from the address's wire value, in the column's own word", () => {
    expect(singleChoiceFilter("billed", STATUSES)).toEqual({ kind: "set", values: ["Billed"] });
    expect(singleChoiceFilter("stranger", STATUSES)).toBeUndefined();
    expect(singleChoiceFilter(null, STATUSES)).toBeUndefined();
  });
});

describe("a column that the listing takes a list of", () => {
  it("sends every choice the set filter holds, as the wire spells them, ignoring strangers", () => {
    expect(choicesOf({ kind: "set", values: ["Billed", "Draft", "Paid"] }, STATUSES)).toEqual([
      "draft",
      "billed",
    ]);
    expect(choicesOf({ kind: "set", values: [] }, STATUSES)).toEqual([]);
    expect(choicesOf(undefined, STATUSES)).toEqual([]);
  });

  it("rebuilds the filter from the address's list, in the column's own words", () => {
    expect(choicesFilter(["billed", "draft", "stranger"], STATUSES)).toEqual({
      kind: "set",
      values: ["Draft", "Billed"],
    });
    expect(choicesFilter([], STATUSES)).toBeUndefined();
  });
});

describe("the timekeeper column, which shows names and sends a handle", () => {
  it("sends the one member the filter names", () => {
    expect(singleMemberOf({ kind: "set", values: ["Wren Adeyemi"] }, ROSTER)).toBe("user_wren");
  });

  it("sends nothing for a name two members share, rather than guessing one of them", () => {
    expect(singleMemberOf({ kind: "set", values: ["Alba Ferreira"] }, ROSTER)).toBeUndefined();
  });

  it("rebuilds the filter from the address's handle, and none for a handle the roster lacks", () => {
    expect(singleMemberFilter("user_wren", ROSTER)).toEqual({
      kind: "set",
      values: ["Wren Adeyemi"],
    });
    expect(singleMemberFilter("user_gone", ROSTER)).toBeUndefined();
  });
});

describe("the address", () => {
  it("writes a set filter and removes a cleared one, leaving unrelated parameters alone", () => {
    const url = new URL("https://example.com/time?invoice=inv_1&status=draft");
    const next = addressAfterFilters(url, { status: undefined, from: "2026-08-01" });
    expect(next.searchParams.get("status")).toBeNull();
    expect(next.searchParams.get("from")).toBe("2026-08-01");
    expect(next.searchParams.get("invoice")).toBe("inv_1");
    // The given address is untouched: the caller decides whether to replace it.
    expect(url.searchParams.get("status")).toBe("draft");
  });

  it("writes a list once per value, as the listings take it, and an empty list as nothing", () => {
    const url = new URL("https://example.com/fees?status=void");
    const listed = addressAfterFilters(url, { status: ["draft", "submitted"] });
    expect(listed.searchParams.getAll("status")).toEqual(["draft", "submitted"]);
    const cleared = addressAfterFilters(listed, { status: [] });
    expect(cleared.searchParams.has("status")).toBe(false);
  });

  it("seeds the grid with what the address names and leaves the rest of the filters alone", () => {
    const seeded = filtersSeededBy(
      { matter: { kind: "set", values: ["Pemberton"] } },
      { status: { kind: "set", values: ["Draft"] }, workDate: undefined },
    );
    expect(seeded).toEqual({
      matter: { kind: "set", values: ["Pemberton"] },
      status: { kind: "set", values: ["Draft"] },
    });
  });
});
