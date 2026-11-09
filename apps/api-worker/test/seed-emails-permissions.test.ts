import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import {
  firmDatabaseFor,
  type ProxyBatchDatabase,
} from "../src/firm-database/firm-database-proxy.ts";

const OWNER_ADMIN = "role_Gw-zKO8hOHQuNv2bWokMp";
const ATTORNEY = "role_gEyJ_YqL1_RI_yDqSa28Y";
const PARALEGAL = "role_917LCQyRKP50Z9bW89vXl";
const BILLING = "role_hwwC1D98d8Lazc_asL6vO";
const READ_ONLY = "role_WojF9F7kksBEftsmZGNhb";
const ALL_DEFAULT_ROLE_IDS = new Set([OWNER_ADMIN, ATTORNEY, PARALEGAL, BILLING, READ_ONLY]);

let testDatabase: ProxyBatchDatabase;

async function rolesFor(permission: string): Promise<Set<string>> {
  const result = await testDatabase
    .prepare("SELECT role_id FROM role_permission WHERE permission = ?")
    .bind(permission)
    .all<{ role_id: string }>();
  return new Set(result.results.map((r) => r.role_id));
}

beforeAll(async () => {
  // The DO self-migrates the per-firm schema on first access — no explicit migration call needed.
  testDatabase = firmDatabaseFor(env.FIRM_DATABASE, newIdentifier("firm"));
});

describe("migration 20260717T120001_seed-emails-permissions", () => {
  it("grants emails:file and emails:manageLinks to the write-capable staff roles", async () => {
    const writeStaff = new Set([OWNER_ADMIN, ATTORNEY, PARALEGAL]);
    expect(await rolesFor("emails:file")).toEqual(writeStaff);
    expect(await rolesFor("emails:manageLinks")).toEqual(writeStaff);
  });

  it("grants emails:read to every default role (matter access still gates what a reader can see)", async () => {
    expect(await rolesFor("emails:read")).toEqual(ALL_DEFAULT_ROLE_IDS);
  });

  it("grants emails:manageCaptureAddresses to Admin only", async () => {
    expect(await rolesFor("emails:manageCaptureAddresses")).toEqual(new Set([OWNER_ADMIN]));
  });
});
