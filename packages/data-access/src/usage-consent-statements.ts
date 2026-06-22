import { z } from "zod";
import { readFirmSetting, type FirmSettingDefinition } from "./setting-statements.ts";
import type { SqlDatabase } from "./idempotency-statements.ts";

// The firm-level product-usage-analytics switch. Default true: usage analytics is always-on and
// opt-out, so an unset firm is enabled. A firm admin writes false to disable it firm-wide.
export const usageAnalyticsEnabledDefinition: FirmSettingDefinition<boolean> = {
  key: "usage_analytics.enabled",
  schema: z.boolean(),
  defaultValue: true,
};

export function readUsageAnalyticsEnabled(database: SqlDatabase): Promise<boolean> {
  return readFirmSetting(database, usageAnalyticsEnabledDefinition);
}

// The per-user override, read from the member row. An absent member reads as not-opted-out (false):
// a request without a member row emits nothing for other reasons (no chokepoint context), so this
// default never widens emission.
export async function readMemberOptedOut(database: SqlDatabase, userId: string): Promise<boolean> {
  const { results } = await database
    .prepare("SELECT opted_out_of_usage_analytics AS optedOut FROM member WHERE user_id = ?1")
    .bind(userId)
    .all<{ optedOut: number }>();
  return results[0]?.optedOut === 1;
}
