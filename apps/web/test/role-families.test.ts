import { describe, expect, it } from "vitest";
import { orderRolesByFamily, toggleRoleInFamily } from "../src/lib/members/role-families.ts";

const ROLES = [
  { id: "role_partner", name: "Partner", parentRoleId: "role_attorney" },
  { id: "role_billing", name: "Billing", parentRoleId: null },
  { id: "role_associate", name: "Associate", parentRoleId: "role_attorney" },
  { id: "role_attorney", name: "Attorney", parentRoleId: null },
  { id: "role_admin", name: "Admin", parentRoleId: null },
] as const;

describe("orderRolesByFamily", () => {
  it("lists each sub-role straight after its parent, by name within each level", () => {
    expect(
      orderRolesByFamily(ROLES).map(({ role, parent }) => [role.name, parent?.name ?? null]),
    ).toEqual([
      ["Admin", null],
      ["Attorney", null],
      ["Associate", "Attorney"],
      ["Partner", "Attorney"],
      ["Billing", null],
    ]);
  });

  it("shows a sub-role whose parent did not arrive as a top-level role rather than hiding it", () => {
    const orphan = [{ id: "role_partner", name: "Partner", parentRoleId: "role_attorney" }];
    expect(orderRolesByFamily(orphan).map(({ role, parent }) => [role.name, parent])).toEqual([
      ["Partner", null],
    ]);
  });
});

describe("toggleRoleInFamily", () => {
  it("ticking a sub-role ticks its parent too", () => {
    expect(toggleRoleInFamily(["role_billing"], "role_partner", true, ROLES).toSorted()).toEqual(
      ["role_attorney", "role_billing", "role_partner"].toSorted(),
    );
  });

  it("ticking a sub-role unticks the parent's other sub-role", () => {
    expect(
      toggleRoleInFamily(
        ["role_attorney", "role_associate"],
        "role_partner",
        true,
        ROLES,
      ).toSorted(),
    ).toEqual(["role_attorney", "role_partner"].toSorted());
  });

  it("unticking a parent unticks its sub-roles", () => {
    expect(
      toggleRoleInFamily(
        ["role_admin", "role_attorney", "role_partner"],
        "role_attorney",
        false,
        ROLES,
      ),
    ).toEqual(["role_admin"]);
  });

  it("unticking a sub-role keeps the parent", () => {
    expect(
      toggleRoleInFamily(["role_attorney", "role_partner"], "role_partner", false, ROLES),
    ).toEqual(["role_attorney"]);
  });

  it("a top-level role toggles on its own", () => {
    expect(toggleRoleInFamily(["role_attorney"], "role_admin", true, ROLES)).toEqual([
      "role_attorney",
      "role_admin",
    ]);
  });
});
