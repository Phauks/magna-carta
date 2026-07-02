import type { FirmSettingDefinition } from "@magna-carta/data-access/setting-statements";
import type { ScopedSettingDefinition } from "@magna-carta/data-access/scoped-setting-statements";
import { z } from "zod";
import type { RoundingDirection } from "./rounding.ts";

// Timekeeping configuration, each definition a zod schema + an in-code default — a missing row IS the
// default, so a setting is readable before any settings UI exists (the setting-statements seam). Keys
// are namespaced `time.*` so they never collide with another subsystem's flat-setting keys.
//
// Two storage seams, by reach. FIRM-LEVEL knobs (one value per firm) ride the flat `setting` seam
// (FirmSettingDefinition). SCOPE-OVERRIDABLE knobs — the ones a firm may tune per matter/client/
// timekeeper/location — ride the scoped-setting resolver (ScopedSettingDefinition), which walks
// most-specific-first and falls back to this same in-code default.

// The review gate lives in billing-core so it is domain-neutral and shareable across cost/billing
// subsystems. Re-exported here so timekeeping routes import from a single settings module.
export { approvalRequiredDefinition } from "@magna-carta/billing-core/review-gate";

// How long a still-live timer may sit before the live-timer coordinator flags it abandoned. Ten hours
// by default — long enough to span a full working day without a spurious flag, short enough that an
// overnight-forgotten timer is caught. A positive whole number of minutes.
export const abandonedThresholdMinutesDefinition: FirmSettingDefinition<number> = {
  key: "time.abandoned_threshold_minutes",
  schema: z.number().int().positive(),
  defaultValue: 600,
};

// Billable-hour targets the My Day shortfall reads against. Null = no target set (the shortfall read
// simply reports no goal), so the default firm sees totals without a target line. A set target is a
// positive number of hours.
const targetHoursSchema = z.number().positive().nullable();

export const targetDailyHoursDefinition: FirmSettingDefinition<number | null> = {
  key: "time.target_daily_hours",
  schema: targetHoursSchema,
  defaultValue: null,
};

export const targetMonthlyHoursDefinition: FirmSettingDefinition<number | null> = {
  key: "time.target_monthly_hours",
  schema: targetHoursSchema,
  defaultValue: null,
};

export const targetAnnualHoursDefinition: FirmSettingDefinition<number | null> = {
  key: "time.target_annual_hours",
  schema: targetHoursSchema,
  defaultValue: null,
};

// The minimum billing increment the captured duration rounds TO (minutes). Six = a tenth of an hour,
// the prevailing default; a positive whole number. Scope-overridable so a firm can tune it per matter/
// client/timekeeper.
export const incrementMinutesDefinition: ScopedSettingDefinition<number> = {
  key: "time.increment_minutes",
  schema: z.number().int().positive(),
  defaultValue: 6,
};

// The rounding direction applied at that increment. Distinct from the increment (a policy, not a
// hard-coded round-up); default nearest. Scope-overridable on the same tiers as the increment.
export const roundingDirectionDefinition: ScopedSettingDefinition<RoundingDirection> = {
  key: "time.rounding_direction",
  schema: z.enum(["up", "nearest", "down"]),
  defaultValue: "nearest",
};
