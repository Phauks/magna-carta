import { describe, expect, it } from "vitest";
import { DIAGNOSTIC_PERMISSIONS, resolveSupportPermissions } from "./tier-permissions.ts";

describe("tier permissions", () => {
  it("DIAGNOSTIC_PERMISSIONS is exactly the diagnostics namespace", () => {
    expect(DIAGNOSTIC_PERMISSIONS.has("diagnostics:overview" as never)).toBe(true);
    expect(DIAGNOSTIC_PERMISSIONS.has("support:request" as never)).toBe(false);
    expect(DIAGNOSTIC_PERMISSIONS.has("matters:create" as never)).toBe(false);
  });

  it("diagnostic tier returns the fixed diagnostics set without touching the firm DB", async () => {
    // A throwing fake proves the diagnostic branch never queries the DB.
    const throwingDb = {
      prepare() {
        throw new Error("diagnostic tier must not query the firm DB");
      },
    } as never;
    const set = await resolveSupportPermissions("diagnostic", throwingDb, "user_1" as never);
    expect(set).toBe(DIAGNOSTIC_PERMISSIONS);
  });

  it("privileged tier resolves against the requester's firm DB (queries member permissions)", async () => {
    // Privileged delegates to loadEffectivePermissions, which runs selectMemberPermissionsStatements
    // against the firm DB. Rather than spy on a named ESM import (which can fail to intercept), assert
    // the resolver QUERIES the provided database — a recording fake proves the firm-DB path is taken.
    const queried: string[] = [];
    const fakeDb = {
      prepare(sql: string) {
        queried.push(sql);
        return {
          bind() {
            return this;
          },
          async all() {
            return { results: [] as { permission: string }[] };
          },
        };
      },
    } as never;
    const set = await resolveSupportPermissions("privileged", fakeDb, "user_1" as never);
    expect(set).toBeInstanceOf(Set);
    expect(queried.some((sql) => sql.includes("permission"))).toBe(true);
  });
});
