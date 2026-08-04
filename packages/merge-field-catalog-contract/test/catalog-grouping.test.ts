import { describe, expect, it } from "vitest";
import {
  catalogSearchKeywords,
  findCatalogEntry,
  groupCatalogEntries,
  matchesMergeFieldQuery,
  searchCatalogSections,
} from "../src/catalog-grouping.ts";
import {
  FIXTURE_MERGE_FIELD_CATALOG,
  FIXTURE_MERGE_FIELD_ENTRIES,
} from "../src/fixture-catalog.ts";
import { MERGE_FIELD_GROUP_ORDER, type MergeFieldEntry } from "../src/types.ts";

const TEXT_ENTRY: MergeFieldEntry = {
  key: "matter.number",
  label: "Matter number",
  group: "matter",
  valueType: "text",
  description: "The firm's identifying number for the matter.",
  exampleRendering: "2026-0142",
  availability: "automatic",
  availabilityNote: "Filled from the matter record.",
  sensitivity: "ordinary",
  formats: ["plain"],
};

describe("grouping a catalog", () => {
  it("orders sections canonically, whatever order the entries arrive in", () => {
    const shuffled = [...FIXTURE_MERGE_FIELD_ENTRIES].toReversed();
    const sections = groupCatalogEntries(shuffled);
    const seen = sections.map((section) => section.group);
    const expected = MERGE_FIELD_GROUP_ORDER.filter((group) => seen.includes(group));
    expect(seen).toEqual(expected);
  });

  it("drops a group the firm has no entries for, rather than showing an empty heading", () => {
    const withoutCustom = FIXTURE_MERGE_FIELD_ENTRIES.filter((entry) => entry.group !== "custom");
    const groups = groupCatalogEntries(withoutCustom).map((section) => section.group);
    expect(groups).not.toContain("custom");
  });

  it("keeps every entry — grouping never loses one", () => {
    const grouped = groupCatalogEntries(FIXTURE_MERGE_FIELD_ENTRIES).flatMap(
      (section) => section.entries,
    );
    expect(grouped).toHaveLength(FIXTURE_MERGE_FIELD_ENTRIES.length);
  });
});

describe("looking a key up", () => {
  it("finds an entry by key", () => {
    expect(findCatalogEntry(FIXTURE_MERGE_FIELD_CATALOG, "matter.number")?.label).toBe(
      "Matter number",
    );
  });

  it("returns null for a key the catalog does not carry — the unrecognized-placeholder case", () => {
    expect(findCatalogEntry(FIXTURE_MERGE_FIELD_CATALOG, "matter.filingDeadline")).toBeNull();
  });
});

describe("searching", () => {
  it("matches the human label, which is what a person actually types", () => {
    expect(matchesMergeFieldQuery(TEXT_ENTRY, "matter num")).toBe(true);
  });

  it("matches the key too, for someone who does know the key path", () => {
    expect(matchesMergeFieldQuery(TEXT_ENTRY, "matter.number")).toBe(true);
  });

  it("matches the group name, so 'parties' narrows to the party fields", () => {
    const sections = searchCatalogSections(FIXTURE_MERGE_FIELD_ENTRIES, "parties");
    expect(sections).toHaveLength(1);
    expect(sections[0]?.group).toBe("parties");
  });

  it("requires EVERY term, so a second word narrows instead of widening", () => {
    expect(matchesMergeFieldQuery(TEXT_ENTRY, "matter zzz")).toBe(false);
  });

  it("an empty query matches everything", () => {
    expect(matchesMergeFieldQuery(TEXT_ENTRY, "   ")).toBe(true);
    const sections = searchCatalogSections(FIXTURE_MERGE_FIELD_ENTRIES, "");
    const total = sections.reduce((count, section) => count + section.entries.length, 0);
    expect(total).toBe(FIXTURE_MERGE_FIELD_ENTRIES.length);
  });

  it("a query matching nothing yields no sections, not empty ones", () => {
    expect(searchCatalogSections(FIXTURE_MERGE_FIELD_ENTRIES, "zzzzzz")).toEqual([]);
  });

  it("the search vocabulary carries the label, the key, and the group", () => {
    const keywords = catalogSearchKeywords(TEXT_ENTRY).join(" ");
    expect(keywords).toContain("Matter number");
    expect(keywords).toContain("matter.number");
    expect(keywords).toContain("Matter");
  });
});

describe("the fixture catalog itself", () => {
  it("has unique keys — a duplicate would make a picker row ambiguous", () => {
    const keys = FIXTURE_MERGE_FIELD_ENTRIES.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every entry a label, a description, and an availability note", () => {
    for (const entry of FIXTURE_MERGE_FIELD_ENTRIES) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
      expect(entry.availabilityNote.length).toBeGreaterThan(0);
      expect(entry.formats.length).toBeGreaterThan(0);
    }
  });

  it("carries at least one protected entry, so the protected posture is always exercised", () => {
    expect(FIXTURE_MERGE_FIELD_ENTRIES.some((entry) => entry.sensitivity === "protected")).toBe(
      true,
    );
  });
});
