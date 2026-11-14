/*
 * The relationship list's order, pinned: family under its own heading and apart from assigned
 * roles, every group A to Z with an "Other ..." choice last, and nothing offered twice or left out.
 */
import { describe, expect, it } from "vitest";
import { offeredEdgeTypesForRecord } from "../src/lib/directory/edge-draft.ts";
import { EDGE_TYPE_GROUPS, groupedEdgeTypes } from "../src/lib/directory/directory-vocabulary.ts";

describe("the relationship list", () => {
  it("leads a person's list with the family ties, in name order with Other family last", () => {
    const groups = groupedEdgeTypes(offeredEdgeTypesForRecord("person"));
    expect(groups[0]?.heading).toBe("Family");
    expect(groups[0]?.entries.map((entry) => entry.label)).toEqual([
      "Child",
      "Grandchild",
      "Grandparent",
      "Parent",
      "Sibling",
      "Spouse or partner",
      "Other family",
    ]);
  });

  it("keeps every group in A to Z order and the groups in heading order", () => {
    for (const kind of ["person", "organization"] as const) {
      const groups = groupedEdgeTypes(offeredEdgeTypesForRecord(kind));
      const order = EDGE_TYPE_GROUPS.map((section) => section.group);
      const seen = groups.map((section) => order.indexOf(section.group));
      expect(seen).toEqual([...seen].sort((left, right) => left - right));
      for (const section of groups) {
        const labels = section.entries
          .map((entry) => entry.label)
          .filter((label) => !label.startsWith("Other "));
        expect(labels).toEqual([...labels].sort((left, right) => left.localeCompare(right)));
      }
    }
  });

  it("offers each type exactly once", () => {
    for (const kind of ["person", "organization"] as const) {
      const offered = offeredEdgeTypesForRecord(kind);
      const listed = groupedEdgeTypes(offered).flatMap((section) => section.entries);
      expect(listed).toHaveLength(offered.length);
    }
  });

  it("offers an organization no family ties", () => {
    const headings = groupedEdgeTypes(offeredEdgeTypesForRecord("organization")).map(
      (section) => section.heading,
    );
    expect(headings).not.toContain("Family");
    expect(headings).toContain("Business structure");
  });
});
