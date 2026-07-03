import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { runPendingMigrations } from "@magna-carta/database/migration-runner";
import { d1MigrationTarget } from "@magna-carta/database/d1-migration-target";
import {
  controlPlaneMigrations,
  controlPlaneHeadSchemaVersion,
} from "../src/control-plane-migrations.ts";

describe("controlPlaneMigrations bundle", () => {
  it("covers the journal and reports the head tag", () => {
    const migrations = controlPlaneMigrations();
    expect(migrations.length).toBeGreaterThanOrEqual(4);
    expect(migrations.at(-1)?.tag).toBe(controlPlaneHeadSchemaVersion());
    expect(controlPlaneHeadSchemaVersion()).toMatch(/^0006_/);
  });

  it("applies the whole lineage from empty, then is a no-op when re-run", async () => {
    const target = d1MigrationTarget(env.DB_CONTROL);
    const first = await runPendingMigrations(target, controlPlaneMigrations());
    expect(first.appliedTags).toContain("0003_handy_rattler");
    // The release-channel column exists -> the control-plane schema is at head.
    const probe = await env.DB_CONTROL.prepare("SELECT release_channel FROM firm LIMIT 1").all();
    expect(probe.success).toBe(true);
    // Idempotent: a second run applies nothing.
    const second = await runPendingMigrations(target, controlPlaneMigrations());
    expect(second.appliedTags).toEqual([]);
  });
});
