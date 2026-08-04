import { describe, expect, it } from "vitest";
import {
  findPickerOption,
  groupPickerOptions,
  matchesPickerQuery,
  pickerFilterScore,
  pickerOptionKeywords,
} from "../src/lib/components/merge-field-picker/option-grouping.ts";
import type { MergeFieldPickerOption } from "../src/lib/components/merge-field-picker/types.ts";

/*
 * The picker's headless model. Two behaviours are worth pinning off the DOM because they are the
 * ones that go quietly wrong: a second search term must NARROW (match-all, not match-any), and the
 * caller's group order must survive grouping — a picker that silently re-sorts the sources
 * overrides a product decision that is not its to make.
 */
function option(overrides: Partial<MergeFieldPickerOption> = {}): MergeFieldPickerOption {
  return {
    key: "matter.number",
    label: "Matter number",
    group: "matter",
    groupLabel: "Matter",
    valueTypeLabel: "Text",
    description: "The firm's identifying number for the matter.",
    ...overrides,
  };
}

const OPTIONS: readonly MergeFieldPickerOption[] = [
  option(),
  option({ key: "matter.openedOn", label: "Date opened", valueTypeLabel: "Date" }),
  option({
    key: "client.displayName",
    label: "Client name",
    group: "parties",
    groupLabel: "Parties",
    description: "The client's name as it should appear in a document.",
  }),
  option({
    key: "firm.name",
    label: "Firm name",
    group: "firm",
    groupLabel: "Firm",
    description: "The firm's legal name.",
  }),
  option({
    key: "client.mailingAddress",
    label: "Client mailing address",
    group: "parties",
    groupLabel: "Parties",
    valueTypeLabel: "Address",
    description: "The client's mailing address as a formatted block.",
  }),
];

describe("grouping picker options", () => {
  it("keeps the caller's group order — the picker never re-sorts the sources", () => {
    expect(groupPickerOptions(OPTIONS).map((section) => section.group)).toEqual([
      "matter",
      "parties",
      "firm",
    ]);
  });

  it("gathers every option of a group under one heading, even when they are not adjacent", () => {
    const parties = groupPickerOptions(OPTIONS).find((section) => section.group === "parties");
    expect(parties?.options.map((entry) => entry.key)).toEqual([
      "client.displayName",
      "client.mailingAddress",
    ]);
  });

  it("carries the group heading text through", () => {
    expect(groupPickerOptions(OPTIONS)[1]?.label).toBe("Parties");
  });

  it("loses no option", () => {
    const total = groupPickerOptions(OPTIONS).reduce(
      (count, section) => count + section.options.length,
      0,
    );
    expect(total).toBe(OPTIONS.length);
  });

  it("has no sections for no options", () => {
    expect(groupPickerOptions([])).toEqual([]);
  });
});

describe("searching picker options", () => {
  it("matches the human label, which is what a person types", () => {
    expect(matchesPickerQuery(option(), "matter num")).toBe(true);
  });

  it("matches the key, for someone who does know the key path", () => {
    expect(matchesPickerQuery(option(), "matter.number")).toBe(true);
  });

  it("matches the group heading and the value type", () => {
    const dateField = option({ label: "Date opened", valueTypeLabel: "Date" });
    expect(matchesPickerQuery(dateField, "matter date")).toBe(true);
  });

  it("requires EVERY term — a second word narrows, it does not widen", () => {
    expect(matchesPickerQuery(option(), "matter zzz")).toBe(false);
  });

  it("ignores case and surrounding whitespace", () => {
    expect(matchesPickerQuery(option(), "  MATTER   NUMBER  ")).toBe(true);
  });

  it("an empty query matches everything", () => {
    expect(matchesPickerQuery(option(), "")).toBe(true);
    expect(matchesPickerQuery(option(), "   ")).toBe(true);
  });

  it("publishes the same vocabulary it searches, so display and search cannot drift", () => {
    const keywords = pickerOptionKeywords(option());
    expect(keywords).toContain("Matter number");
    expect(keywords).toContain("matter.number");
    expect(keywords).toContain("Matter");
  });

  it("drops an absent description rather than searching an empty string", () => {
    expect(pickerOptionKeywords(option({ description: undefined }))).not.toContain("");
  });
});

describe("the command-list matcher", () => {
  it("scores a match 1 and a miss 0", () => {
    const keywords = pickerOptionKeywords(option());
    expect(pickerFilterScore("matter.number", "matter", keywords)).toBe(1);
    expect(pickerFilterScore("matter.number", "zzzz", keywords)).toBe(0);
  });

  it("matches everything on an empty query", () => {
    expect(pickerFilterScore("matter.number", "", [])).toBe(1);
  });

  it("applies the same match-all rule as the query matcher", () => {
    const keywords = pickerOptionKeywords(option());
    expect(pickerFilterScore("matter.number", "matter zzz", keywords)).toBe(0);
  });
});

describe("resolving a bound key to its option", () => {
  it("finds the option a key names", () => {
    expect(findPickerOption(OPTIONS, "client.displayName")?.label).toBe("Client name");
  });

  it("returns null for a key no option carries", () => {
    expect(findPickerOption(OPTIONS, "matter.filingDeadline")).toBeNull();
  });

  it("returns null for no selection at all", () => {
    expect(findPickerOption(OPTIONS, null)).toBeNull();
  });
});
