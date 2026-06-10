import { describe, expect, it } from "vitest";
import { effectivePermissions } from "../src/resolver.ts";

const now = "2026-06-10T12:00:00.000Z";

describe("effectivePermissions", () => {
  it("returns the union of role permissions and direct grants", () => {
    const result = effectivePermissions(
      [{ permission: "firm:manageMembers" }],
      [{ permission: "firm:provision", expires_at: null }],
      now,
    );
    expect(result).toEqual(new Set(["firm:manageMembers", "firm:provision"]));
  });

  it("collapses duplicate keys across and within sources", () => {
    const result = effectivePermissions(
      [{ permission: "firm:manageMembers" }, { permission: "firm:manageMembers" }],
      [
        { permission: "firm:manageMembers", expires_at: null },
        { permission: "firm:manageMembers", expires_at: "2027-01-01T00:00:00.000Z" },
      ],
      now,
    );
    expect(result).toEqual(new Set(["firm:manageMembers"]));
    expect(result.size).toBe(1);
  });

  it("excludes a direct grant whose expires_at is in the past", () => {
    const result = effectivePermissions(
      [],
      [{ permission: "firm:provision", expires_at: "2026-06-10T11:59:59.999Z" }],
      now,
    );
    expect(result).toEqual(new Set());
  });

  it("treats expires_at === now as expired (boundary)", () => {
    const result = effectivePermissions(
      [],
      [{ permission: "firm:provision", expires_at: now }],
      now,
    );
    expect(result).toEqual(new Set());
  });

  it("includes a direct grant with a future expires_at", () => {
    const result = effectivePermissions(
      [],
      [{ permission: "firm:provision", expires_at: "2026-06-10T12:00:00.001Z" }],
      now,
    );
    expect(result).toEqual(new Set(["firm:provision"]));
  });

  it("includes a direct grant with expires_at null (no expiry)", () => {
    const result = effectivePermissions(
      [],
      [{ permission: "firm:provision", expires_at: null }],
      now,
    );
    expect(result).toEqual(new Set(["firm:provision"]));
  });

  it("drops unknown permission strings silently — from both sources", () => {
    const result = effectivePermissions(
      [{ permission: "matter:read" }, { permission: "firm:manageMembers" }],
      [
        { permission: "firm:deleteEverything", expires_at: null },
        { permission: "firm:provision", expires_at: null },
      ],
      now,
    );
    expect(result).toEqual(new Set(["firm:manageMembers", "firm:provision"]));
  });

  it("does not let expiry rescue an unknown key", () => {
    const result = effectivePermissions(
      [],
      [{ permission: "matter:read", expires_at: "2099-01-01T00:00:00.000Z" }],
      now,
    );
    expect(result).toEqual(new Set());
  });

  it("returns an empty set for empty inputs", () => {
    expect(effectivePermissions([], [], now)).toEqual(new Set());
  });
});
