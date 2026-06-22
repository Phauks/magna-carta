import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  resolveScopedSetting,
  type ScopedSettingDefinition,
  writeScopedSettingStatement,
} from "@magna-carta/data-access/scoped-setting-statements";
import {
  abandonedThresholdMinutesDefinition,
  approvalRequiredDefinition,
  incrementMinutesDefinition,
  roundingDirectionDefinition,
  targetAnnualHoursDefinition,
  targetDailyHoursDefinition,
  targetMonthlyHoursDefinition,
} from "../src/settings.ts";
import type { RoundingDirection } from "../src/rounding.ts";

// Compile-time guarantee: both scoped definitions carry the right ScopedSettingDefinition type.
incrementMinutesDefinition satisfies ScopedSettingDefinition<number>;
roundingDirectionDefinition satisfies ScopedSettingDefinition<RoundingDirection>;

// Adapt node:sqlite to the SqlDatabase surface — same shim used in data-access's own
// scoped-setting round-trip tests.
function memoryDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(
    `CREATE TABLE scoped_setting (
       key TEXT NOT NULL,
       scope_tier TEXT NOT NULL,
       scoped_id TEXT,
       value TEXT NOT NULL,
       updated_at TEXT NOT NULL,
       PRIMARY KEY (key, scope_tier, scoped_id)
     );`,
  );
  return {
    prepare(sql: string) {
      const bindings: unknown[] = [];
      const stmt = {
        sql,
        bind(...values: unknown[]) {
          bindings.push(...values);
          return stmt;
        },
        run() {
          database.prepare(sql.replace(/\?\d+/g, "?")).run(...(bindings as never[]));
          return Promise.resolve({ meta: { changes: 1 } });
        },
        all<T>() {
          const rows = database.prepare(sql.replace(/\?\d+/g, "?")).all(...(bindings as never[]));
          return Promise.resolve({ results: rows as T[] });
        },
      };
      return stmt;
    },
  };
}

describe("firm-level timekeeping settings", () => {
  it("default the frictionless posture: no approval gate, a 10-hour abandoned threshold, no targets", () => {
    expect(approvalRequiredDefinition.key).toBe("time.approval_required");
    expect(approvalRequiredDefinition.defaultValue).toBe(false);

    expect(abandonedThresholdMinutesDefinition.key).toBe("time.abandoned_threshold_minutes");
    expect(abandonedThresholdMinutesDefinition.defaultValue).toBe(600);

    expect(targetDailyHoursDefinition.key).toBe("time.target_daily_hours");
    expect(targetMonthlyHoursDefinition.key).toBe("time.target_monthly_hours");
    expect(targetAnnualHoursDefinition.key).toBe("time.target_annual_hours");
    expect(targetDailyHoursDefinition.defaultValue).toBeNull();
    expect(targetMonthlyHoursDefinition.defaultValue).toBeNull();
    expect(targetAnnualHoursDefinition.defaultValue).toBeNull();
  });

  it("approval_required accepts only a boolean", () => {
    expect(approvalRequiredDefinition.schema.safeParse(true).success).toBe(true);
    expect(approvalRequiredDefinition.schema.safeParse("true").success).toBe(false);
  });

  it("abandoned_threshold_minutes rejects a non-positive value", () => {
    expect(abandonedThresholdMinutesDefinition.schema.safeParse(1).success).toBe(true);
    expect(abandonedThresholdMinutesDefinition.schema.safeParse(0).success).toBe(false);
    expect(abandonedThresholdMinutesDefinition.schema.safeParse(-5).success).toBe(false);
    expect(abandonedThresholdMinutesDefinition.schema.safeParse(1.5).success).toBe(false);
  });

  it("a target is a positive number or null (an unset target), never zero or negative", () => {
    expect(targetDailyHoursDefinition.schema.safeParse(8).success).toBe(true);
    expect(targetDailyHoursDefinition.schema.safeParse(7.5).success).toBe(true);
    expect(targetDailyHoursDefinition.schema.safeParse(null).success).toBe(true);
    expect(targetDailyHoursDefinition.schema.safeParse(0).success).toBe(false);
    expect(targetDailyHoursDefinition.schema.safeParse(-1).success).toBe(false);
  });
});

describe("scope-overridable timekeeping settings", () => {
  it("increment_minutes defaults to a tenth of an hour and rejects a non-positive increment", () => {
    expect(incrementMinutesDefinition.key).toBe("time.increment_minutes");
    expect(incrementMinutesDefinition.defaultValue).toBe(6);
    expect(incrementMinutesDefinition.schema.safeParse(6).success).toBe(true);
    expect(incrementMinutesDefinition.schema.safeParse(15).success).toBe(true);
    expect(incrementMinutesDefinition.schema.safeParse(0).success).toBe(false);
    expect(incrementMinutesDefinition.schema.safeParse(-6).success).toBe(false);
    expect(incrementMinutesDefinition.schema.safeParse(6.5).success).toBe(false);
  });

  it("rounding_direction defaults to nearest and rejects an off-enum value", () => {
    expect(roundingDirectionDefinition.key).toBe("time.rounding_direction");
    expect(roundingDirectionDefinition.defaultValue).toBe("nearest");
    expect(roundingDirectionDefinition.schema.safeParse("up").success).toBe(true);
    expect(roundingDirectionDefinition.schema.safeParse("nearest").success).toBe(true);
    expect(roundingDirectionDefinition.schema.safeParse("down").success).toBe(true);
    expect(roundingDirectionDefinition.schema.safeParse("ceil").success).toBe(false);
    expect(roundingDirectionDefinition.schema.safeParse("").success).toBe(false);
  });
});

describe("resolveScopedSetting for scope-overridable timekeeping definitions", () => {
  it("increment_minutes: empty context returns the in-code default (6)", async () => {
    const database = memoryDatabase();
    expect(await resolveScopedSetting(database, incrementMinutesDefinition, {})).toBe(6);
  });

  it("rounding_direction: empty context returns the in-code default (nearest)", async () => {
    const database = memoryDatabase();
    expect(await resolveScopedSetting(database, roundingDirectionDefinition, {})).toBe("nearest");
  });

  it("increment_minutes: a firm-tier row is returned when context is empty", async () => {
    const database = memoryDatabase();
    await writeScopedSettingStatement(
      database,
      incrementMinutesDefinition,
      "firm",
      null,
      15,
      "2026-06-22T00:00:00.000Z",
    ).run();
    expect(await resolveScopedSetting(database, incrementMinutesDefinition, {})).toBe(15);
  });

  it("rounding_direction: a firm-tier row is returned when context is empty", async () => {
    const database = memoryDatabase();
    await writeScopedSettingStatement(
      database,
      roundingDirectionDefinition,
      "firm",
      null,
      "up",
      "2026-06-22T00:00:00.000Z",
    ).run();
    expect(await resolveScopedSetting(database, roundingDirectionDefinition, {})).toBe("up");
  });

  it("increment_minutes: a matter-tier override beats the firm value when the matterId matches", async () => {
    const database = memoryDatabase();
    await writeScopedSettingStatement(
      database,
      incrementMinutesDefinition,
      "firm",
      null,
      15,
      "2026-06-22T00:00:00.000Z",
    ).run();
    await writeScopedSettingStatement(
      database,
      incrementMinutesDefinition,
      "matter",
      "matter_a",
      30,
      "2026-06-22T00:00:00.000Z",
    ).run();
    expect(
      await resolveScopedSetting(database, incrementMinutesDefinition, { matterId: "matter_a" }),
    ).toBe(30);
  });

  it("rounding_direction: a matter-tier override beats the firm value when the matterId matches", async () => {
    const database = memoryDatabase();
    await writeScopedSettingStatement(
      database,
      roundingDirectionDefinition,
      "firm",
      null,
      "nearest",
      "2026-06-22T00:00:00.000Z",
    ).run();
    await writeScopedSettingStatement(
      database,
      roundingDirectionDefinition,
      "matter",
      "matter_a",
      "down",
      "2026-06-22T00:00:00.000Z",
    ).run();
    expect(
      await resolveScopedSetting(database, roundingDirectionDefinition, { matterId: "matter_a" }),
    ).toBe("down");
  });
});
