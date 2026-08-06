import {
  MATTER_ASSET_CLASS_REGISTRY,
  matterAssetClassDeclaration,
} from "@magna-carta/matter-assets/classes";
import { MATTER_ASSET_CLASSES } from "@magna-carta/matter-assets/types";
import { describe, expect, it } from "vitest";

describe("the class registry", () => {
  it("declares every platform class exactly once", () => {
    expect(MATTER_ASSET_CLASS_REGISTRY.map((declaration) => declaration.key)).toEqual([
      ...MATTER_ASSET_CLASSES,
    ]);
  });

  // The pressure valve: a class with no structure carries the core row and nothing else. Nothing is
  // ever blocked by an unforeseen kind of thing; what it loses is structured search, which is honest.
  it("gives personal property and `other` no attribute table", () => {
    expect(matterAssetClassDeclaration("personalProperty")?.attributeTable).toBeNull();
    expect(matterAssetClassDeclaration("other")?.attributeTable).toBeNull();
  });

  it("names an attribute table for every class that has structure", () => {
    for (const declaration of MATTER_ASSET_CLASS_REGISTRY) {
      if (declaration.key === "personalProperty" || declaration.key === "other") continue;
      expect(declaration.attributeTable, declaration.key).toMatch(/^matter_asset_/);
    }
  });
});

describe("the firearm handling notice", () => {
  const note = matterAssetClassDeclaration("firearm")?.handlingNote ?? "";

  it("is the only class-handling notice, and it is present", () => {
    const withNotes = MATTER_ASSET_CLASS_REGISTRY.filter(
      (declaration) => declaration.handlingNote !== null,
    );
    expect(withNotes.map((declaration) => declaration.key)).toEqual(["firearm"]);
    expect(note.length).toBeGreaterThan(0);
  });

  // The mechanical guard against a standing notice drifting into advice. A notice that named a
  // jurisdiction, cited a statute, or carried a number would be a claim the platform has not
  // verified and cannot keep current — and it would be trusted precisely because it looks specific.
  it("names no jurisdiction, cites no statute, and states no number", () => {
    expect(note).not.toMatch(/\d/);
    expect(note).not.toMatch(/\b(U\.?S\.?C|C\.?F\.?R|section|§|chapter|title)\b/i);
    const jurisdictions = [
      "Nevada",
      "California",
      "Texas",
      "New York",
      "Florida",
      "United States",
      "county",
    ];
    for (const jurisdiction of jurisdictions) {
      expect(note.toLowerCase()).not.toContain(jurisdiction.toLowerCase());
    }
  });

  // It says what the register DOES and what it does not decide. Nothing branches on it, so it can
  // never become a rule that is ninety percent right.
  it("says the register records rather than adjudicates", () => {
    expect(note.toLowerCase()).toContain("records what is held");
    expect(note.toLowerCase()).toContain("does not determine who may receive");
  });
});
