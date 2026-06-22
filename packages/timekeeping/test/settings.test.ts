import { describe, expect, it } from "vitest";
import {
  abandonedThresholdMinutesDefinition,
  approvalRequiredDefinition,
  incrementMinutesDefinition,
  roundingDirectionDefinition,
  targetAnnualHoursDefinition,
  targetDailyHoursDefinition,
  targetMonthlyHoursDefinition,
} from "../src/settings.ts";

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
