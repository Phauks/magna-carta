import { describe, expect, it } from "vitest";
import type { Bindings } from "../src/app.ts";
import { resolveFirmDatabase } from "../src/firm-binding-resolver.ts";

// Sentinels stand in for the bound D1 instances — the resolver only routes references.
const POOL_1 = { sentinel: "pool-1" } as unknown as D1Database;
const POOL_2 = { sentinel: "pool-2" } as unknown as D1Database;
const env = { DB_FIRM_POOL_1: POOL_1, DB_FIRM_POOL_2: POOL_2 } as Bindings;

describe("resolveFirmDatabase", () => {
  it("resolves each pool binding name to its database", () => {
    expect(resolveFirmDatabase(env, "DB_FIRM_POOL_1")).toBe(POOL_1);
    expect(resolveFirmDatabase(env, "DB_FIRM_POOL_2")).toBe(POOL_2);
  });

  it("answers null for an unknown identifier (the absent path)", () => {
    expect(resolveFirmDatabase(env, "11111111-2222-4333-8444-555555555555")).toBeNull();
    expect(resolveFirmDatabase(env, "")).toBeNull();
  });

  it("answers null for prototype-chain names — never non-nullish junk that would 500", () => {
    // A plain-object lookup resolves these to inherited values ('constructor' -> Function, etc.),
    // which the unknown -> null -> 404 contract must never surface. Own-property check only.
    for (const hostile of ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"]) {
      expect(resolveFirmDatabase(env, hostile)).toBeNull();
    }
  });
});
