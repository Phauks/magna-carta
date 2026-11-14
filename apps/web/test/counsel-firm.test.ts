/*
 * Counsel and the firm they practice with: which Directory relationship names the firm, and which
 * role the firm takes on a matter beside its counsel.
 */
import { describe, expect, it } from "vitest";
import type { DirectoryEdgeEntry } from "../src/lib/directory/directory-api.ts";
import {
  COUNSEL_FIRM_ROLES,
  currentFirmOf,
  isCounselRole,
} from "../src/lib/matters/counsel-firm.ts";
import { roleLabel } from "../src/lib/matters/party-api.ts";

function edge(overrides: Partial<DirectoryEdgeEntry>): DirectoryEdgeEntry {
  return {
    id: "edge",
    edgeType: "employment",
    direction: "outbound",
    farEntityId: "org_firm",
    farEntityKind: "organization",
    farDisplayName: "Natarajan & Lee LLP",
    role: null,
    note: null,
    validFrom: null,
    validTo: null,
    ...overrides,
  };
}

describe("the firm a counsel practices with", () => {
  it("is the organization at the far end of a practice relationship", () => {
    expect(currentFirmOf([edge({})], "2026-11-14")).toEqual({
      entityId: "org_firm",
      name: "Natarajan & Lee LLP",
    });
  });

  it("is not an organization the person merely relates to, or one that points at them", () => {
    expect(currentFirmOf([edge({ edgeType: "relationship" })], "2026-11-14")).toBeNull();
    expect(currentFirmOf([edge({ direction: "inbound" })], "2026-11-14")).toBeNull();
    expect(currentFirmOf([edge({ farEntityKind: "person" })], "2026-11-14")).toBeNull();
  });

  it("is not a firm they have left", () => {
    expect(currentFirmOf([edge({ validTo: "2025-01-31" })], "2026-11-14")).toBeNull();
    expect(
      currentFirmOf(
        [edge({ validTo: "2025-01-31" }), edge({ farEntityId: "org_now", edgeType: "partner_of" })],
        "2026-11-14",
      )?.entityId,
    ).toBe("org_now");
  });
});

describe("counsel roles", () => {
  it("each counsel role has a firm role, and both read as words", () => {
    expect(isCounselRole("opposingcounsel")).toBe(true);
    expect(isCounselRole("client")).toBe(false);
    for (const [counsel, firm] of COUNSEL_FIRM_ROLES) {
      expect(roleLabel(counsel)).not.toBe(counsel);
      expect(roleLabel(firm)).not.toBe(firm);
    }
  });
});
