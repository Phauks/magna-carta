/*
 * What this account may do on the calendar, said once.
 *
 * Every calendar surface that writes — the entry window, the firm screen's Record control, the
 * matter section's create control, the three settings catalogs — asks the same question of the
 * same session and must answer it in the same words. Four wordings for one permission had
 * appeared; this is the one.
 *
 * The answer has three parts, in the order a reader meets them: the session is still being read;
 * the session could not be read at all; the session holds no calendar:manage. Undefined means the
 * act is open.
 */
import { permissionRefusal } from "$lib/access/refusal.ts";
import { MANAGE_CALENDAR_PERMISSION } from "./calendar-api.ts";

/** The slice of a session a calendar surface needs to answer "may I write". */
export interface CalendarSessionState {
  /** Whether the session read has answered, one way or the other. */
  readonly sessionSettled: boolean;
  /** Whether the session read answered with a session; null when it failed. */
  readonly session: object | null;
  /** Whether the session holds the calendar-manage permission. */
  readonly mayManage: boolean;
}

/** Whether a session as the bootstrap read returns it may write on the calendar. */
export function mayManageCalendar(session: { permissions: readonly string[] } | null): boolean {
  return session?.permissions.includes(MANAGE_CALENDAR_PERMISSION) ?? false;
}

/**
 * Why `act` refuses on this session, or undefined when it may proceed. `act` is the gerund phrase
 * the refusal opens with: "Recording on the calendar", "Changing a calendar record".
 */
export function calendarManageRefusal(
  act: string,
  state: CalendarSessionState,
): string | undefined {
  if (!state.sessionSettled) return "Reading your session.";
  if (state.session === null) {
    return "Your session could not be read, so nothing can be recorded.";
  }
  if (!state.mayManage) return permissionRefusal(act, MANAGE_CALENDAR_PERMISSION);
  return undefined;
}
