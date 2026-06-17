import { describe, expect, it } from "vitest";
import {
  assertPermission,
  isPermission,
  PERMISSIONS,
  permissionsForNamespace,
} from "../src/registry.ts";

describe("permission registry", () => {
  it("recognizes every registered permission key", () => {
    for (const key of PERMISSIONS) {
      expect(isPermission(key)).toBe(true);
    }
    expect(isPermission("firm:manageMembers")).toBe(true);
    expect(isPermission("firm:provision")).toBe(true);
  });

  it("rejects unknown keys", () => {
    expect(isPermission("firm:deleteEverything")).toBe(false);
    expect(isPermission("matter:read")).toBe(false);
  });

  it("rejects malformed shapes (no namespace, no action, wrong case, padding)", () => {
    expect(isPermission("")).toBe(false);
    expect(isPermission("firm")).toBe(false);
    expect(isPermission("firm:")).toBe(false);
    expect(isPermission(":manageMembers")).toBe(false);
    expect(isPermission("FIRM:MANAGEMEMBERS")).toBe(false);
    expect(isPermission(" firm:manageMembers")).toBe(false);
    expect(isPermission("firm:manageMembers ")).toBe(false);
  });

  it("assertPermission returns the narrowed value for a known key", () => {
    const permission = assertPermission("firm:manageMembers");
    expect(permission).toBe("firm:manageMembers");
  });

  it("assertPermission throws a TypeError naming the JSON-quoted offending value", () => {
    expect(() => assertPermission("firm:deleteEverything")).toThrowError(TypeError);
    expect(() => assertPermission("firm:deleteEverything")).toThrowError('"firm:deleteEverything"');
    expect(() => assertPermission("")).toThrowError(TypeError);
  });

  it("permissionsForNamespace('firm') returns exactly the firm keys", () => {
    expect(permissionsForNamespace("firm")).toEqual([
      "firm:manageMembers",
      "firm:provision",
      "firm:reportIncident",
    ]);
  });

  it("permissionsForNamespace('matters') returns exactly the matters keys, in registry order", () => {
    expect(permissionsForNamespace("matters")).toEqual([
      "matters:create",
      "matters:open",
      "matters:close",
      "matters:reopen",
      "matters:edit",
      "matters:renumber",
      "matters:manageTypes",
      "matters:manageNumbering",
    ]);
  });

  it("permissionsForNamespace('locations') returns exactly the locations keys", () => {
    expect(permissionsForNamespace("locations")).toEqual(["locations:manage"]);
  });

  it("permissionsForNamespace('files') returns exactly the files keys, in registry order", () => {
    expect(permissionsForNamespace("files")).toEqual([
      "files:upload",
      "files:organize",
      "files:delete",
      "files:manageDocumentTypes",
    ]);
  });

  it("permissionsForNamespace('tools') returns exactly the tools keys, in registry order", () => {
    expect(permissionsForNamespace("tools")).toEqual([
      "tools:propertyListings",
      "tools:propertyRecords",
      "tools:businessLookup",
      "tools:attorneyLicense",
      "tools:shipping",
    ]);
  });

  it("permissionsForNamespace returns an empty list for an unknown namespace", () => {
    // 'matter' (singular) is NOT the matters namespace — the keys live under 'matters'.
    expect(permissionsForNamespace("matter")).toEqual([]);
  });

  it("permissionsForNamespace matches the whole namespace, not a prefix of it", () => {
    expect(permissionsForNamespace("fir")).toEqual([]);
    expect(permissionsForNamespace("")).toEqual([]);
  });

  it("every registered key is `<subsystem>:<action>` — lowercase-led camelCase segments", () => {
    for (const key of PERMISSIONS) {
      expect(key).toMatch(/^[a-z][a-zA-Z]*:[a-z][a-zA-Z]*$/);
    }
  });

  it("has no duplicate keys", () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
  });
});
