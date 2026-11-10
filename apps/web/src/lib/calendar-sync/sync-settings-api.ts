/*
 * The Calendar Sync pages' writes, through the generated client's own functions. No path is
 * spelled here. Each answers what the server said back, or the refusal in the server's own words.
 */
import {
  calendarSyncReplaceMyRules,
  calendarSyncSetFirmLimits,
  type CalendarSyncFirmLimits,
  type CalendarSyncSettings,
} from "@magna-carta/api-client";

export const MANAGE_SYNC_POLICY_PERMISSION = "calendar:manageSyncPolicy";

export type SaveOutcome<T> =
  | { readonly kind: "saved"; readonly value: T }
  | { readonly kind: "refused"; readonly detail: string | null };

function refusal(error: unknown): { kind: "refused"; detail: string | null } {
  const detail =
    typeof error === "object" && error !== null && "detail" in error ? error.detail : null;
  return { kind: "refused", detail: typeof detail === "string" ? detail : null };
}

export async function saveMyRules(
  rules: { subject: string; calendarRemoteId: string; scope: "mine" | "my_matters" }[],
): Promise<SaveOutcome<CalendarSyncSettings>> {
  const { data, error } = await calendarSyncReplaceMyRules({ body: { rules } });
  return data === undefined ? refusal(error) : { kind: "saved", value: data };
}

export async function setFirmLimit(limit: {
  subject: string;
  mayLeave: boolean;
  detail: "full" | "minimal";
}): Promise<SaveOutcome<CalendarSyncFirmLimits>> {
  const { data, error } = await calendarSyncSetFirmLimits({ body: { limits: [limit] } });
  return data === undefined ? refusal(error) : { kind: "saved", value: data };
}
