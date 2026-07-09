import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import {
  firmDatabaseFor,
  type ProxyBatchDatabase,
} from "../src/firm-database/firm-database-proxy.ts";

const ALL_DEFAULT_ROLE_IDS = new Set([
  "role_Gw-zKO8hOHQuNv2bWokMp",
  "role_gEyJ_YqL1_RI_yDqSa28Y",
  "role_917LCQyRKP50Z9bW89vXl",
  "role_hwwC1D98d8Lazc_asL6vO",
  "role_WojF9F7kksBEftsmZGNhb",
]);

let testDatabase: ProxyBatchDatabase;

beforeAll(async () => {
  // The DO self-migrates the per-firm schema on first access — no explicit migration call needed.
  testDatabase = firmDatabaseFor(env.FIRM_DATABASE, newIdentifier("firm"));
});

describe("migration 20260704T041519_seed-tools-speed-test", () => {
  it("grants tools:speedTest to all five default roles", async () => {
    const result = await testDatabase
      .prepare("SELECT role_id FROM role_permission WHERE permission = ?")
      .bind("tools:speedTest")
      .all<{ role_id: string }>();
    expect(result.results).toHaveLength(5);
    const granted = new Set(result.results.map((row) => row.role_id));
    for (const roleId of ALL_DEFAULT_ROLE_IDS) expect(granted).toContain(roleId);
  });

  // The omission this migration repairs: tools:speedTest was the one tools:* permission no seeded
  // role carried, so the diagnostic every member is meant to reach was reachable by no one.
  it("leaves tools:speedTest no less reachable than its sibling utilities", async () => {
    const speedTest = await testDatabase
      .prepare("SELECT COUNT(*) AS count FROM role_permission WHERE permission = ?")
      .bind("tools:speedTest")
      .all<{ count: number }>();
    const whois = await testDatabase
      .prepare("SELECT COUNT(*) AS count FROM role_permission WHERE permission = ?")
      .bind("tools:whois")
      .all<{ count: number }>();
    expect(speedTest.results[0]?.count).toBe(whois.results[0]?.count);
  });
});
