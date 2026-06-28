import { afterAll, describe, expect, it } from "vitest";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { insertMemberStatement } from "@magna-carta/data-access/member-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { MatterId, UserId } from "@magna-carta/identifiers/types";
import { fixtureContext, type FixtureContext } from "../context.ts";
import { createLocalPerFirmDatabase, type LocalDatabase } from "../local-database.ts";
import { ledgerVolume, scaleProfile } from "./profile.ts";
import { findFullScans } from "./runner.ts";
import { generateCostVolume } from "./costs-generate.ts";
import { costsHotPathPlans, COSTS_PLAN_SCAN_ALLOWLIST } from "./costs-measurements.ts";

// A CI-smoke-scale cost volume (the smallest multiplier the floors allow), laid down over a handful of
// real matters at the current per-firm schema. The plan-scan guard then asserts every cost hot read
// walks an index, never a full table scan, at volume.
const SMOKE_SEED = "costs-measurements-smoke";
const SMOKE_PROFILE = scaleProfile(ledgerVolume, 0.01);

// The cost entries reference matters; the practice generator owns matter creation in the full snapshot,
// but this standalone trio seeds its own minimal matter rows (the WIP store only needs the id, the
// e_billing flag, and the columns the schema makes NOT NULL).
async function seedMatters(
  database: SqlDatabase,
  context: FixtureContext,
  count: number,
): Promise<{ matterIds: MatterId[]; actorUserId: UserId }> {
  const actorUserId = newIdentifier("user", context.randomSource);
  const createdAt = context.clock.now();
  // matter.responsible_member_id carries a real foreign key, so the captor must exist as a member.
  await insertMemberStatement(database, {
    userId: actorUserId,
    displayName: "Load-profile captor",
    now: createdAt,
  }).run();
  const matterIds: MatterId[] = [];
  for (let index = 0; index < count; index += 1) {
    const matterId = newIdentifier("matter", context.randomSource);
    matterIds.push(matterId);
    await database
      .prepare(
        `INSERT INTO matter (id, title, status, responsible_member_id, e_billing, created_at, updated_at) VALUES (?1, ?2, 'open', ?3, ?4, ?5, ?5)`,
      )
      // The first matter bills through the e-billing channel so the flag read resolves a real row.
      .bind(matterId, `Matter ${index + 1}`, actorUserId, index === 0 ? 1 : 0, createdAt)
      .run();
  }
  return { matterIds, actorUserId };
}

let local: LocalDatabase | undefined;

afterAll(() => {
  local?.raw.close();
});

describe("cost hot reads are index-served at volume", () => {
  it("lays down the cost volume and plans every hot read free of a full scan", async () => {
    local = createLocalPerFirmDatabase();
    const context = fixtureContext(SMOKE_SEED);
    const { matterIds, actorUserId } = await seedMatters(
      local.database,
      context,
      SMOKE_PROFILE.practice.openMatterCount,
    );
    const result = await generateCostVolume(
      local.database,
      context,
      SMOKE_PROFILE.costs,
      { matterIds, actorUserId },
      { allowSeeding: true },
    );

    // Non-vacuity: the generator actually produced cost entries and at least one recovery entry (so the
    // dedup lookup probes a real ref).
    expect(result.costEntryCount).toBeGreaterThan(0);
    expect(result.recoveryEntryCount).toBeGreaterThan(0);

    const plans = costsHotPathPlans({
      database: local.database,
      raw: local.raw,
      probes: result.probes,
    });
    const scans = findFullScans(plans, COSTS_PLAN_SCAN_ALLOWLIST);
    expect(scans, scans.join(", ")).toEqual([]);
  });
});
