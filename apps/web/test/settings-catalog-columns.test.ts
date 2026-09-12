/*
 * The column models behind the five settings tables: what each register declares to the one
 * table, so a settings register sorts, filters and counts like a register anywhere else.
 */
import { describe, expect, it } from "vitest";
import {
  CATALOG_ACTIONS_COLUMN_ID,
  emailPolicyLabel,
  eventTypeColumns,
  inAppPolicyLabel,
  inAppPreferenceLabel,
  memberColumns,
  memberRolesText,
  notificationPolicyColumns,
  notificationPreferenceColumns,
  NO_ROLE_LABEL,
  POLICY_MEMBERS_CHOOSE,
  resourceColumns,
  resourceOfficeName,
} from "$lib/settings/catalog-columns.ts";

describe("every settings register", () => {
  const models = [
    eventTypeColumns(true),
    resourceColumns(true, new Map([["loc_1", "Downtown"]])),
    memberColumns(true),
    notificationPreferenceColumns(),
    notificationPolicyColumns(),
  ];

  it("anchors the row on its name, first and never hidden", () => {
    for (const columns of models) {
      expect(columns[0]?.anchored).toBe(true);
      expect(columns.filter((column) => column.anchored)).toHaveLength(1);
    }
  });

  it("declares every column once", () => {
    for (const columns of models) {
      const ids = columns.map((column) => column.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("hands a declared vocabulary to every set filter, so a value nobody holds today can still be asked for", () => {
    for (const columns of models) {
      for (const column of columns) {
        if (column.filter !== "set") continue;
        expect(column.filterValues, `${column.id} declares its values`).toBeDefined();
        expect(column.filterValues?.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("the actions column", () => {
  it("exists only for a member who may act, ends the row, and sorts or filters on nothing", () => {
    const catalogs = [
      { withActions: eventTypeColumns(true), without: eventTypeColumns(false) },
      { withActions: resourceColumns(true, new Map()), without: resourceColumns(false, new Map()) },
      { withActions: memberColumns(true), without: memberColumns(false) },
    ];
    for (const { withActions, without } of catalogs) {
      const actions = withActions.at(-1);
      expect(actions?.id).toBe(CATALOG_ACTIONS_COLUMN_ID);
      expect(actions?.pinnedEnd).toBe(true);
      expect(actions?.filter).toBe("none");
      expect(without.some((column) => column.id === CATALOG_ACTIONS_COLUMN_ID)).toBe(false);
    }
  });
});

describe("the words the cells read", () => {
  it("names a resource's office from the firm's list, and nothing for none", () => {
    const names = new Map([["loc_1", "Downtown"]]);
    expect(resourceOfficeName({ locationId: "loc_1" }, names)).toBe("Downtown");
    expect(resourceOfficeName({ locationId: null }, names)).toBe("");
    expect(resourceOfficeName({ locationId: "loc_gone" }, names)).toBe("");
  });

  it("states a member with no role as a fact rather than an empty cell", () => {
    expect(memberRolesText({ roleNames: [] })).toBe(NO_ROLE_LABEL);
    expect(memberRolesText({ roleNames: ["Attorney", "Billing"] })).toBe("Attorney, Billing");
  });

  it("reads a locked in-app preference as always on, whichever tier locked it", () => {
    expect(inAppPreferenceLabel({ inApp: "off", inAppLockedBy: "mandatory" })).toBe("Always on");
    expect(inAppPreferenceLabel({ inApp: "on", inAppLockedBy: "firm-policy" })).toBe("Always on");
    expect(inAppPreferenceLabel({ inApp: "on", inAppLockedBy: null })).toBe("On");
    expect(inAppPreferenceLabel({ inApp: "off", inAppLockedBy: null })).toBe("Off");
  });

  it("offers the firm leaving a category to its members as a real choice with a value of its own", () => {
    // The product's combobox refuses an empty value, so "members choose" carries a sentinel.
    expect(POLICY_MEMBERS_CHOOSE).not.toBe("");
    expect(inAppPolicyLabel({ inApp: null })).toBe("Members choose");
    expect(inAppPolicyLabel({ inApp: "on" })).toBe("Everyone hears this");
    expect(emailPolicyLabel({ email: null })).toBe("Members choose");
    expect(emailPolicyLabel({ email: "weekly" })).toBe("Weekly summary by default");
  });
});
