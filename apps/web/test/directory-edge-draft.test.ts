/*
 * The rules for recording a relationship from a directory record, pinned.
 *
 * Each case is a place where getting the direction wrong would be invisible on screen and wrong
 * in a way a conflicts report would print back: an officer recorded from the organization's
 * screen must still be the person who is the officer, a subsidiary must never be read as the
 * parent, and a pane that lists only people must not offer an organization it would then hide.
 */
import { describe, expect, it } from "vitest";
import {
  edgeDraftRefusal,
  edgeEndsFor,
  edgeSentence,
  edgeSentenceParts,
  farEndFieldName,
  farKindsFor,
  offeredEdgeTypesForRecord,
  paneEdgeTypes,
  paneShowsEdge,
  pickerKindsFor,
} from "../src/lib/directory/edge-draft.ts";
import {
  EDGE_TYPES,
  MEMBERSHIP_EDGE_TYPES,
  type EdgeTypeEntry,
} from "../src/lib/directory/directory-vocabulary.ts";
import type { DirectoryEdgeType } from "../src/lib/directory/directory-api.ts";

function entry(edgeType: DirectoryEdgeType): EdgeTypeEntry {
  const found = EDGE_TYPES.find((candidate) => candidate.edgeType === edgeType);
  if (found === undefined) throw new Error(`No catalog entry for ${edgeType}`);
  return found;
}

const jane = { id: "person_jane", kind: "person" } as const;
const meridian = { id: "organization_meridian", kind: "organization" } as const;
const pickedJane = { identifier: "person_jane", kind: "person" } as const;
const pickedMeridian = { identifier: "organization_meridian", kind: "organization" } as const;

describe("what a record may record", () => {
  it("offers a person every type with a person end, and no corporate type", () => {
    const offered = offeredEdgeTypesForRecord("person").map((candidate) => candidate.edgeType);
    expect(offered).toContain("officer_of");
    expect(offered).toContain("relationship");
    expect(offered).toContain("representation");
    expect(offered).not.toContain("corporate_parent");
    expect(offered).not.toContain("corporate_subsidiary");
    expect(offered).not.toContain("corporate_successor");
  });

  it("offers an organization the types it is the target of, as well as its own", () => {
    const offered = offeredEdgeTypesForRecord("organization").map(
      (candidate) => candidate.edgeType,
    );
    expect(offered).toContain("officer_of");
    expect(offered).toContain("corporate_subsidiary");
    expect(offered).not.toContain("relationship");
    expect(offered).not.toContain("guardian_of");
  });

  it("never offers a retired type", () => {
    expect(offeredEdgeTypesForRecord("person").some((candidate) => !candidate.offered)).toBe(false);
    expect(offeredEdgeTypesForRecord("organization").some((candidate) => !candidate.offered)).toBe(
      false,
    );
  });
});

describe("the ends of a new edge", () => {
  it("keep the type's direction from the person's record", () => {
    expect(edgeEndsFor(jane, pickedMeridian, entry("officer_of"))).toEqual({
      from: "person_jane",
      to: "organization_meridian",
    });
  });

  it("keep the type's direction from the organization's record", () => {
    expect(edgeEndsFor(meridian, pickedJane, entry("officer_of"))).toEqual({
      from: "person_jane",
      to: "organization_meridian",
    });
  });

  it("put the record at the origin of a type that admits it there", () => {
    const other = { identifier: "organization_other", kind: "organization" } as const;
    expect(edgeEndsFor(meridian, other, entry("corporate_subsidiary"))).toEqual({
      from: "organization_meridian",
      to: "organization_other",
    });
    expect(edgeEndsFor(meridian, other, entry("corporate_parent"))).toEqual({
      from: "organization_meridian",
      to: "organization_other",
    });
  });

  it("put the person at the origin of a membership type whose ends admit either arrangement", () => {
    expect(edgeEndsFor(meridian, pickedJane, entry("trustee_of"))).toEqual({
      from: "person_jane",
      to: "organization_meridian",
    });
    expect(edgeEndsFor(jane, pickedMeridian, entry("trustee_of"))).toEqual({
      from: "person_jane",
      to: "organization_meridian",
    });
  });

  it("leave the record at the origin of a type outside the membership family", () => {
    expect(edgeEndsFor(meridian, pickedJane, entry("representation"))).toEqual({
      from: "organization_meridian",
      to: "person_jane",
    });
  });
});

describe("what the picker offers at the far end", () => {
  it("is the target for a type the record originates", () => {
    expect(farKindsFor("person", entry("officer_of"))).toEqual(["organization"]);
    expect(farKindsFor("person", entry("personal_representative_of"))).toEqual([
      "person",
      "organization",
    ]);
  });

  it("is the origin for a type the record is the target of", () => {
    expect(farKindsFor("organization", entry("officer_of"))).toEqual(["person"]);
    expect(farKindsFor("organization", entry("shareholder_of"))).toEqual([
      "person",
      "organization",
    ]);
  });

  it("is both kinds until a type is chosen, within what the pane lists", () => {
    expect(pickerKindsFor("person", null, "all")).toEqual(["person", "organization"]);
    expect(pickerKindsFor("person", null, "organizations")).toEqual(["organization"]);
    expect(pickerKindsFor("organization", null, "people")).toEqual(["person"]);
  });

  it("is narrowed by the type and by the pane together", () => {
    expect(pickerKindsFor("organization", entry("trustee_of"), "people")).toEqual(["person"]);
    expect(pickerKindsFor("organization", entry("trustee_of"), "all")).toEqual([
      "person",
      "organization",
    ]);
  });
});

describe("what a pane offers and lists", () => {
  it("offers everything on the Relationships pane", () => {
    expect(paneEdgeTypes("person", "all")).toEqual(offeredEdgeTypesForRecord("person"));
  });

  it("offers only the membership family on the People and Organizations panes", () => {
    for (const filter of ["people", "organizations"] as const) {
      const offered = paneEdgeTypes("organization", filter);
      expect(offered.length).toBeGreaterThan(0);
      expect(offered.every((candidate) => MEMBERSHIP_EDGE_TYPES.includes(candidate.edgeType))).toBe(
        true,
      );
      expect(offered.some((candidate) => candidate.edgeType === "affiliation")).toBe(false);
    }
  });

  it("lists every edge on the Relationships pane", () => {
    expect(paneShowsEdge("all", { edgeType: "relationship", farEntityKind: "person" })).toBe(true);
    expect(paneShowsEdge("all", { edgeType: "nonsense", farEntityKind: "unknown" })).toBe(true);
  });

  it("lists a membership edge to a person on the People pane, and nothing else", () => {
    expect(paneShowsEdge("people", { edgeType: "officer_of", farEntityKind: "person" })).toBe(true);
    expect(paneShowsEdge("people", { edgeType: "affiliation", farEntityKind: "person" })).toBe(
      true,
    );
    expect(paneShowsEdge("people", { edgeType: "officer_of", farEntityKind: "organization" })).toBe(
      false,
    );
    expect(paneShowsEdge("people", { edgeType: "representation", farEntityKind: "person" })).toBe(
      false,
    );
    expect(paneShowsEdge("people", { edgeType: "officer_of", farEntityKind: "unknown" })).toBe(
      false,
    );
  });

  it("lists a membership edge to an organization on the Organizations pane", () => {
    expect(
      paneShowsEdge("organizations", { edgeType: "employment", farEntityKind: "organization" }),
    ).toBe(true);
    expect(
      paneShowsEdge("organizations", { edgeType: "employment", farEntityKind: "person" }),
    ).toBe(false);
  });
});

describe("the sentence a row reads", () => {
  it("reads in the type's direction from the origin's record", () => {
    expect(edgeSentence("Jane Okafor", entry("officer_of"), "Meridian Holdings", "outbound")).toBe(
      "Jane Okafor is an officer of Meridian Holdings",
    );
  });

  it("reads in the type's direction from the target's record", () => {
    expect(edgeSentence("Meridian Holdings", entry("officer_of"), "Jane Okafor", "inbound")).toBe(
      "Jane Okafor is an officer of Meridian Holdings",
    );
  });

  it("keeps the far name as its own piece so it can be a link", () => {
    expect(
      edgeSentenceParts("Meridian Holdings", entry("corporate_parent"), "Meridian West", "inbound"),
    ).toEqual({ before: "", far: "Meridian West", after: " is the parent of Meridian Holdings" });
    expect(
      edgeSentenceParts(
        "Meridian Holdings",
        entry("corporate_parent"),
        "Meridian West",
        "outbound",
      ),
    ).toEqual({ before: "Meridian Holdings is the parent of ", far: "Meridian West", after: "" });
  });
});

describe("why Add is refused", () => {
  it("asks for who first, then for the relationship, then nothing", () => {
    expect(edgeDraftRefusal("organization", { picked: null, entry: null })).toBe(
      "Choose who first.",
    );
    expect(edgeDraftRefusal("organization", { picked: null, entry: entry("officer_of") })).toBe(
      "Choose who first.",
    );
    expect(edgeDraftRefusal("organization", { picked: pickedJane, entry: null })).toBe(
      "Choose the relationship first.",
    );
    expect(
      edgeDraftRefusal("organization", { picked: pickedJane, entry: entry("officer_of") }),
    ).toBeUndefined();
  });

  it("refuses a pick the chosen type admits at neither end", () => {
    const other = { identifier: "organization_other", kind: "organization" } as const;
    expect(edgeDraftRefusal("organization", { picked: other, entry: entry("officer_of") })).toBe(
      "Officer takes a person at the other end.",
    );
    expect(edgeDraftRefusal("person", { picked: pickedJane, entry: entry("employment") })).toBe(
      "Employee takes an organization at the other end.",
    );
  });

  it("names the far-end field from what it may hold", () => {
    expect(farEndFieldName(["person"])).toBe("Person");
    expect(farEndFieldName(["organization"])).toBe("Organization");
    expect(farEndFieldName(["person", "organization"])).toBe("Person or organization");
  });
});
