import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { applyPerFirmMigrations } from "./support/apply-per-firm-migrations.ts";

const ALL_DEFAULT_ROLE_IDS = new Set([
  "role_Gw-zKO8hOHQuNv2bWokMp",
  "role_gEyJ_YqL1_RI_yDqSa28Y",
  "role_917LCQyRKP50Z9bW89vXl",
  "role_hwwC1D98d8Lazc_asL6vO",
  "role_WojF9F7kksBEftsmZGNhb",
]);

beforeAll(async () => {
  await applyPerFirmMigrations(env.DB_FIRM_POOL_1);
});

describe("migration 0018_seed-tools-metadata-scrubber", () => {
  it("grants tools:metadataScrubber to all five default roles", async () => {
    const result = await env.DB_FIRM_POOL_1.prepare(
      "SELECT role_id FROM role_permission WHERE permission = ?",
    )
      .bind("tools:metadataScrubber")
      .all<{ role_id: string }>();
    expect(result.results).toHaveLength(5);
    const granted = new Set(result.results.map((r) => r.role_id));
    for (const roleId of ALL_DEFAULT_ROLE_IDS) expect(granted).toContain(roleId);
  });
});
