import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { applyPerFirmMigrations } from "./support/apply-per-firm-migrations.ts";

const OWNER_ADMIN_ROLE_ID = "role_Gw-zKO8hOHQuNv2bWokMp";
const ALL_DEFAULT_ROLE_IDS = new Set([
  "role_Gw-zKO8hOHQuNv2bWokMp", // Owner/Admin
  "role_gEyJ_YqL1_RI_yDqSa28Y", // Attorney
  "role_917LCQyRKP50Z9bW89vXl", // Paralegal
  "role_hwwC1D98d8Lazc_asL6vO", // Billing
  "role_WojF9F7kksBEftsmZGNhb", // Read-only
]);

beforeAll(async () => {
  await applyPerFirmMigrations(env.DB_FIRM_POOL_1);
});

describe("migration 0017_seed-tools-file-converter", () => {
  it("grants tools:fileConverter to the Owner/Admin role only", async () => {
    const result = await env.DB_FIRM_POOL_1.prepare(
      "SELECT role_id FROM role_permission WHERE permission = ?",
    )
      .bind("tools:fileConverter")
      .all<{ role_id: string }>();

    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.role_id).toBe(OWNER_ADMIN_ROLE_ID);

    // Confirm no other default role received this permission.
    const grantedRoles = new Set(result.results.map((r) => r.role_id));
    for (const roleId of ALL_DEFAULT_ROLE_IDS) {
      if (roleId !== OWNER_ADMIN_ROLE_ID) {
        expect(grantedRoles).not.toContain(roleId);
      }
    }
  });
});
