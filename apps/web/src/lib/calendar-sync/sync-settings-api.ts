/*
 * The Calendar Sync pages' writes, through the generated client's own functions. No path is
 * spelled here. Each answers what the server said back, or the refusal in the server's own words.
 */
import {
  calendarSyncLeaveMyCopy,
  calendarSyncPutBackMyCopy,
  calendarSyncReplaceMyRules,
  calendarSyncReplaceMyShownCalendars,
  calendarSyncSetFirmLimits,
  type CalendarSyncFirmLimits,
  type CalendarSyncIssue,
  type CalendarSyncIssueList,
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

// A member's answer to one copy they changed in their own calendar: have it written again as
// Magna Carta has the event, or keep it as they made it. Either answers with the questions left.
export async function answerSyncIssue(
  issue: Pick<CalendarSyncIssue, "localKind" | "localId">,
  answer: "putBack" | "leave",
): Promise<SaveOutcome<CalendarSyncIssueList>> {
  const path = { localKind: issue.localKind, localId: issue.localId };
  const { data, error } =
    answer === "putBack"
      ? await calendarSyncPutBackMyCopy({ path })
      : await calendarSyncLeaveMyCopy({ path });
  return data === undefined ? refusal(error) : { kind: "saved", value: data };
}

// The member's whole choice of which of their own calendars are shown to them. Answers with their
// settings as they now stand.
export async function saveMyShownCalendars(
  calendarRemoteIds: string[],
): Promise<SaveOutcome<CalendarSyncSettings>> {
  const { data, error } = await calendarSyncReplaceMyShownCalendars({
    body: { calendarRemoteIds },
  });
  return data === undefined ? refusal(error) : { kind: "saved", value: data };
}
